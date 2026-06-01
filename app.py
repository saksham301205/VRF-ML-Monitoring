import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import threading
import time
import webbrowser
import pandas as pd

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

from vrf_simulator import VRFSimulator
from ml_engine import AnomalyDetector, FaultClassifier, EnergyOptimizer, train_all_models
from protocol_catalog import get_catalog_summary
from protocol_parser import parse_incoming_payload
from database import (
    init_db,
    insert_parsed_reading,
    insert_protocol_frame,
    insert_ml_prediction,
    check_health,
    get_recent_readings,
    get_recent_predictions,
    get_recent_protocol_frames,
    get_recent_protocol_fields,
    get_health_summary,
    get_anomaly_stats,
    get_fault_distribution
)

# ─────────────────────────────────────────────
#  App Setup
# ─────────────────────────────────────────────

app = Flask(__name__)
CORS(app)
app.config["SECRET_KEY"] = "vrf-secret"
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False
)

# ─────────────────────────────────────────────
#  Initialize Components
# ─────────────────────────────────────────────

sim       = VRFSimulator()
anomaly   = AnomalyDetector()
fault_clf = FaultClassifier()
energy    = EnergyOptimizer()

history       = []
MAX_HIST      = 200
stream_active = True

# ─────────────────────────────────────────────
#  Ensure data/ folder exists
# ─────────────────────────────────────────────

data_dir = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(data_dir, exist_ok=True)

models_dir = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(models_dir, exist_ok=True)

# ─────────────────────────────────────────────
#  Initialize Database
# ─────────────────────────────────────────────

print("Initializing MySQL database...")
init_db()

# ─────────────────────────────────────────────
#  Load / Train ML Models
# ─────────────────────────────────────────────

models_exist = all(
    os.path.exists(os.path.join(models_dir, f))
    for f in ["anomaly_detector.pkl", "fault_classifier.pkl", "energy_optimizer.pkl"]
)

if not models_exist:
    print("Training ML models (first run)...")
    train_all_models()

anomaly.load()
fault_clf.load()
energy.load()
print("ML Models Loaded")

# ─────────────────────────────────────────────
#  Background Live Data Stream
# ─────────────────────────────────────────────

def data_stream():
    global history

    while True:
        if stream_active:
            try:
                reading = sim.get_readings()

                reading["ml_anomaly"] = anomaly.predict(reading)
                reading["ml_fault"]   = fault_clf.predict(reading)
                reading["ml_energy"]  = energy.recommend(reading)
                reading["health_status"] = check_health(reading)

                insert_parsed_reading(reading)
                insert_ml_prediction(
                    reading["timestamp"],
                    reading["ml_anomaly"],
                    reading["ml_fault"],
                    reading["ml_energy"]
                )

                history.append(reading)
                if len(history) > MAX_HIST:
                    history.pop(0)

                socketio.emit("vrf_data", reading)
                print(f"LIVE: {reading['ambient_temp']}°C | Fault: {reading['fault_mode']} | Health: {reading['health_status']}")

            except Exception as e:
                print(f"[STREAM ERROR] {e}")

        time.sleep(2)

stream_thread = threading.Thread(target=data_stream, daemon=True)
stream_thread.start()

# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return jsonify({"status": "VRF API running"})

@app.route("/api/history")
def api_history():
    return jsonify(history[-100:])

@app.route("/api/inject_fault", methods=["POST"])
def inject_fault():
    data     = request.json
    fault    = data.get("fault", "refrigerant_leak")
    severity = float(data.get("severity", 0.5))
    sim.inject_fault(fault, severity)
    return jsonify({"status": "success", "fault": fault, "severity": severity})

@app.route("/api/clear_fault", methods=["POST"])
def clear_fault():
    sim.clear_fault()
    return jsonify({"status": "cleared"})

@app.route("/api/set_setpoint", methods=["POST"])
def set_setpoint():
    data = request.json
    temp = float(data.get("temp", 24))
    sim.setpoint_temp = temp
    return jsonify({"status": "success", "setpoint": temp})

@app.route("/api/toggle_stream", methods=["POST"])
def toggle_stream():
    global stream_active
    stream_active = not stream_active
    return jsonify({"active": stream_active})

@app.route("/api/export_csv")
def export_csv():
    if not history:
        return jsonify({"error": "No data"}), 400
    df = pd.DataFrame(history)
    export_path = os.path.join(data_dir, "live_export.csv")
    df.to_csv(export_path, index=False)
    return jsonify({"status": "saved", "rows": len(df), "path": export_path})

@app.route("/api/train", methods=["POST"])
def train():
    result = train_all_models(save_csv=True)
    anomaly.load()
    fault_clf.load()
    energy.load()
    return jsonify({"status": "ok", "results": result})

@app.route("/api/protocol/catalog")
def protocol_catalog():
    return jsonify(get_catalog_summary())

@app.route("/api/protocol/ingest", methods=["POST"])
def protocol_ingest():
    data = request.get_json(silent=True)
    if data is None:
        data = request.get_data(as_text=True)

    frame_name = request.args.get("frame_name")
    if isinstance(data, dict):
        frame_name = data.get("frame_name") or frame_name
        source = data.get("source", "device")
    else:
        source = "device"

    result = parse_incoming_payload(data, frame_name=frame_name)
    ml_feature_keys = [
        "ambient_temp", "indoor_temp", "suction_pressure", "discharge_pressure",
        "compressor_speed", "fan_speed", "power_consumption", "superheat",
        "subcooling", "cop", "evap_temp", "cond_temp"
    ]

    for parsed_frame in result["frames"]:
        parsed_frame["db_id"] = insert_protocol_frame(parsed_frame, source=source)
        reading = parsed_frame.get("reading", {})
        present_ml_features = [key for key in ml_feature_keys if reading.get(key) is not None]
        if present_ml_features:
            reading["health_status"] = check_health(reading)
            insert_parsed_reading(reading)
            parsed_frame["mapped_ml_features"] = present_ml_features
        if len(present_ml_features) >= 3:
            reading["ml_anomaly"] = anomaly.predict(reading)
            reading["ml_fault"]   = fault_clf.predict(reading)
            reading["ml_energy"]  = energy.recommend(reading)
            insert_ml_prediction(
                reading["timestamp"],
                reading["ml_anomaly"],
                reading["ml_fault"],
                reading["ml_energy"]
            )

    return jsonify(result)

# ─────────────────────────────────────────────
#  Database Query Routes
# ─────────────────────────────────────────────

@app.route("/api/db/readings")
def db_readings():
    limit = int(request.args.get("limit", 100))
    rows  = get_recent_readings(limit)
    for r in rows:
        for k, v in r.items():
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
    return jsonify(rows)

@app.route("/api/db/predictions")
def db_predictions():
    limit = int(request.args.get("limit", 100))
    rows  = get_recent_predictions(limit)
    for r in rows:
        for k, v in r.items():
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
    return jsonify(rows)

@app.route("/api/db/protocol_frames")
def db_protocol_frames():
    limit = int(request.args.get("limit", 100))
    rows = get_recent_protocol_frames(limit)
    for r in rows:
        for k, v in r.items():
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
    return jsonify(rows)

@app.route("/api/db/protocol_fields")
def db_protocol_fields():
    limit = int(request.args.get("limit", 300))
    rows = get_recent_protocol_fields(limit)
    for r in rows:
        for k, v in r.items():
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
    return jsonify(rows)

@app.route("/api/db/health_summary")
def db_health_summary():
    return jsonify(get_health_summary())

@app.route("/api/db/anomaly_stats")
def db_anomaly_stats():
    stats = get_anomaly_stats()
    for k, v in stats.items():
        if hasattr(v, "isoformat"):
            stats[k] = v.isoformat()
    return jsonify(stats)

@app.route("/api/db/fault_distribution")
def db_fault_distribution():
    return jsonify(get_fault_distribution())

# ─────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("VRF Dashboard Running: http://localhost:5000")
    threading.Timer(1.5, lambda: webbrowser.open("http://localhost:5000")).start()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)