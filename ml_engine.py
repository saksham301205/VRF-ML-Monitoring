import numpy as np
import pandas as pd
import joblib
import os
from sklearn.ensemble import IsolationForest, RandomForestRegressor, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, mean_absolute_error
import warnings
warnings.filterwarnings("ignore")

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

FEATURES = [
    "ambient_temp", "indoor_temp", "suction_pressure", "discharge_pressure",
    "compressor_speed", "fan_speed", "power_consumption", "superheat",
    "subcooling", "cop", "evap_temp", "cond_temp"
]

# ─────────────────────────────────────────────
#  1. ANOMALY DETECTION  (Isolation Forest)
# ─────────────────────────────────────────────
class AnomalyDetector:
    def __init__(self):
        self.model = None
        self.path  = os.path.join(MODEL_DIR, "anomaly_detector.pkl")

    def train(self, df: pd.DataFrame):
        X = df[FEATURES].dropna()
        pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("iso",    IsolationForest(n_estimators=200, contamination=0.05,
                                       random_state=42, n_jobs=-1))
        ])
        pipe.fit(X)
        self.model = pipe
        joblib.dump(pipe, self.path)
        return {"status": "trained", "samples": len(X)}

    def load(self):
        if os.path.exists(self.path):
            self.model = joblib.load(self.path)
            return True
        return False

    def predict(self, reading: dict) -> dict:
        if self.model is None:
            self.load()
        if self.model is None:
            return {"anomaly": False, "score": 0.0, "ready": False}
        X = pd.DataFrame([{f: reading.get(f, 0) for f in FEATURES}])
        score  = float(self.model.decision_function(X)[0])   # lower = more anomalous
        label  = int(self.model.predict(X)[0])               # -1 = anomaly
        return {
            "anomaly":  label == -1,
            "score":    round(score, 4),
            "severity": round(max(0, min(1, -score / 0.5)), 3),
            "ready":    True
        }


# ─────────────────────────────────────────────
#  2. FAULT CLASSIFIER  (Random Forest)
# ─────────────────────────────────────────────
class FaultClassifier:
    FAULT_LABELS = ["none", "refrigerant_leak", "compressor_overload", "dirty_filter", "sensor_drift"]
    LABEL_MAP    = {v: i for i, v in enumerate(FAULT_LABELS)}

    def __init__(self):
        self.model = None
        self.path  = os.path.join(MODEL_DIR, "fault_classifier.pkl")

    def train(self, df: pd.DataFrame):
        if "fault_mode" not in df.columns:
            return {"status": "skipped", "reason": "no fault_mode column"}
        df = df.dropna(subset=FEATURES + ["fault_mode"])
        X = df[FEATURES]
        y = df["fault_mode"].map(self.LABEL_MAP).fillna(0).astype(int)
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)
        pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1))
        ])
        pipe.fit(X_tr, y_tr)
        self.model = pipe
        joblib.dump(pipe, self.path)
        acc = pipe.score(X_te, y_te)
        return {"status": "trained", "accuracy": round(acc, 4), "samples": len(X)}

    def load(self):
        if os.path.exists(self.path):
            self.model = joblib.load(self.path)
            return True
        return False

    def predict(self, reading: dict) -> dict:
        if self.model is None:
            self.load()
        if self.model is None:
            return {"fault": "unknown", "confidence": 0.0, "ready": False}
        X      = pd.DataFrame([{f: reading.get(f, 0) for f in FEATURES}])
        idx    = int(self.model.predict(X)[0])
        proba  = self.model.predict_proba(X)[0]
        label  = self.FAULT_LABELS[idx] if idx < len(self.FAULT_LABELS) else "unknown"
        return {
            "fault":      label,
            "confidence": round(float(proba[idx]), 3),
            "all_probs":  {k: round(float(v), 3) for k, v in zip(self.FAULT_LABELS, proba)},
            "ready":      True
        }


# ─────────────────────────────────────────────
#  3. ENERGY OPTIMIZER  (Regression)
# ─────────────────────────────────────────────
class EnergyOptimizer:
    OPT_FEATURES = [
        "ambient_temp", "indoor_temp", "setpoint_temp",
        "compressor_speed", "fan_speed", "superheat", "subcooling"
    ]

    def __init__(self):
        self.model = None
        self.path  = os.path.join(MODEL_DIR, "energy_optimizer.pkl")

    def train(self, df: pd.DataFrame):
        df = df.dropna(subset=self.OPT_FEATURES + ["power_consumption"])
        X  = df[self.OPT_FEATURES]
        y  = df["power_consumption"]
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)
        pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("reg",    RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1))
        ])
        pipe.fit(X_tr, y_tr)
        self.model = pipe
        joblib.dump(pipe, self.path)
        mae = mean_absolute_error(y_te, pipe.predict(X_te))
        return {"status": "trained", "mae_kw": round(mae, 4), "samples": len(X)}

    def load(self):
        if os.path.exists(self.path):
            self.model = joblib.load(self.path)
            return True
        return False

    def recommend(self, reading: dict) -> dict:
        """Returns estimated power at current settings + optimized suggestion."""
        if self.model is None:
            self.load()
        if self.model is None:
            return {"ready": False}

        X_now = pd.DataFrame([{f: reading.get(f, 0) for f in self.OPT_FEATURES}])
        power_now = float(self.model.predict(X_now)[0])

        # Try small setpoint and speed adjustments
        best_power = power_now
        best_params = {}
        for sp_delta in [-1, 0, 1]:
            for speed_factor in [0.85, 0.92, 1.0]:
                candidate = dict(reading)
                candidate["setpoint_temp"]   = reading.get("setpoint_temp", 24) + sp_delta
                candidate["compressor_speed"] = reading.get("compressor_speed", 3000) * speed_factor
                candidate["fan_speed"]        = reading.get("fan_speed", 1200) * speed_factor
                Xc = pd.DataFrame([{f: candidate.get(f, 0) for f in self.OPT_FEATURES}])
                p  = float(self.model.predict(Xc)[0])
                if p < best_power:
                    best_power  = p
                    best_params = {
                        "setpoint_temp":   candidate["setpoint_temp"],
                        "compressor_speed": round(candidate["compressor_speed"], 0),
                        "fan_speed":        round(candidate["fan_speed"], 0),
                    }

        savings_pct = round((power_now - best_power) / max(power_now, 0.01) * 100, 1)
        return {
            "current_power_kw":   round(power_now, 3),
            "optimized_power_kw": round(best_power, 3),
            "savings_pct":        savings_pct,
            "recommended_params": best_params,
            "ready": True
        }

def generate_training_data(n_normal=2000, n_fault=500) -> pd.DataFrame:
    """Generate synthetic VRF dataset for initial model training."""
    from vrf_simulator import VRFSimulator
    sim   = VRFSimulator()
    rows  = []

    # Normal operation
    for _ in range(n_normal):
        rows.append(sim.get_readings())

    # Fault scenarios
    faults = ["refrigerant_leak", "compressor_overload", "dirty_filter", "sensor_drift"]
    per_fault = n_fault // len(faults)
    for fault in faults:
        sim.inject_fault(fault, severity=random.uniform(0.3, 0.9))
        for _ in range(per_fault):
            rows.append(sim.get_readings())
        sim.clear_fault()

    return pd.DataFrame(rows)

import random

def train_all_models(save_csv=True):
    print("⚙️Generating training data...")
    df = generate_training_data()
    if save_csv:
        df.to_csv(os.path.join(os.path.dirname(__file__), "data", "training_data.csv"), index=False)
        print(f"   Saved {len(df)} rows to data/training_data.csv")

    print("🤖Training Anomaly Detector...")
    r1 = AnomalyDetector().train(df)
    print(f"   {r1}")

    print("🤖Training Fault Classifier...")
    r2 = FaultClassifier().train(df)
    print(f"   {r2}")

    print("🤖Training Energy Optimizer...")
    r3 = EnergyOptimizer().train(df)
    print(f"   {r3}")

    print("✅All models trained and saved to /models/")
    return {"anomaly": r1, "fault": r2, "energy": r3}


if __name__ == "__main__":
    train_all_models()