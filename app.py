import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import threading
import time
import webbrowser
from datetime import datetime
import pandas as pd

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

from vrf_simulator import VRFSimulator
from ml_engine import AnomalyDetector, FaultClassifier, EnergyOptimizer, FEATURES, train_all_models
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
    get_latest_reading,
    get_health_summary,
    get_anomaly_stats,
    get_fault_distribution,
    delete_sample_data,
    delete_all_data
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
SIMULATOR_ENABLED = os.environ.get("VRF_ENABLE_SIMULATOR") == "1"
SYNTHETIC_TRAINING_ENABLED = os.environ.get("VRF_AUTO_TRAIN_SYNTHETIC") == "1"
stream_active = SIMULATOR_ENABLED

ML_REQUIRED_FEATURES = FEATURES
latest_real_reading = {}

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

if not models_exist and SYNTHETIC_TRAINING_ENABLED:
    print("Training ML models (first run)...")
    train_all_models()
elif not models_exist:
    print("ML models not found. Add real parsed readings, then press Retrain ML.")

anomaly.load()
fault_clf.load()
energy.load()
print("ML Models Loaded")


def _jsonify_row(row):
    if not row:
        return row
    clean = {}
    for key, value in row.items():
        if hasattr(value, "isoformat"):
            clean[key] = value.isoformat()
        else:
            clean[key] = value
    return clean


def _legacy_reading(parsed_frame: dict) -> dict:
    field = parsed_frame.get("field")
    if not field:
        return {}
    reading = {
        "timestamp": parsed_frame.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "fault_mode": parsed_frame.get("fault_mode", "none"),
        "compressor_on": True,
        "source": "legacy_demo",
    }
    if parsed_frame.get("protocol") == "ALM":
        reading["fault_mode"] = parsed_frame.get("fault_mode", "none")
    elif parsed_frame.get("value") is not None:
        reading[field] = parsed_frame.get("value")
    return reading


def _reading_from_parsed_frame(parsed_frame: dict) -> dict:
    reading = dict(parsed_frame.get("reading") or {})
    if not reading and parsed_frame.get("parser") == "legacy_demo":
        reading = _legacy_reading(parsed_frame)
    return reading


def _can_predict(reading: dict) -> bool:
    return all(reading.get(key) is not None for key in ML_REQUIRED_FEATURES)


def _run_ml(reading: dict, source: str, raw_string: str = "", snapshot: dict = None) -> dict:
    if not _can_predict(reading):
        # Insert a placeholder ML prediction so the UI shows a row even when
        # not all features are present. This helps users see parse+predict
        # activity and understand that ML is not ready yet.
        placeholder_anomaly = {"anomaly": False, "score": 0, "severity": 0, "ready": False}
        placeholder_fault = {"fault": "unknown", "confidence": 0, "ready": False}
        placeholder_energy = {"ready": False, "current_power_kw": None, "optimized_power_kw": None, "savings_pct": None, "recommended_params": {}}
        # Only persist and emit placeholder ML predictions when the source is a manual parse
        if source == "manual":
            insert_ml_prediction(reading.get("timestamp"), placeholder_anomaly, placeholder_fault, placeholder_energy, source=source)
            try:
                # Extract decoded fields from the reading/snapshot
                sensor_fields = {
                    "ambient_temp": snapshot.get("ambient_temp") if snapshot else reading.get("ambient_temp"),
                    "indoor_temp": snapshot.get("indoor_temp") if snapshot else reading.get("indoor_temp"),
                    "suction_pressure": snapshot.get("suction_pressure") if snapshot else reading.get("suction_pressure"),
                    "discharge_pressure": snapshot.get("discharge_pressure") if snapshot else reading.get("discharge_pressure"),
                    "compressor_speed": snapshot.get("compressor_speed") if snapshot else reading.get("compressor_speed"),
                    "fan_speed": snapshot.get("fan_speed") if snapshot else reading.get("fan_speed"),
                    "power_consumption": snapshot.get("power_consumption") if snapshot else reading.get("power_consumption"),
                }
                decoded_fields = {k: v for k, v in sensor_fields.items() if v is not None}
                socketio.emit("ml_prediction", {
                    "timestamp": reading.get("timestamp"),
                    "source": source,
                    "raw_input": raw_string,
                    "decoded_fields": decoded_fields,
                    "ml_anomaly": placeholder_anomaly,
                    "ml_fault": placeholder_fault,
                    "ml_energy": placeholder_energy,
                })
            except Exception:
                pass
        return {
            "ml_anomaly": placeholder_anomaly,
            "ml_fault": placeholder_fault,
            "ml_energy": placeholder_energy,
            "ml_ready": False,
        }

    ml_anomaly = anomaly.predict(reading)
    ml_fault = fault_clf.predict(reading)
    ml_energy = energy.recommend(reading)
    # Persist and emit ML predictions only for manual parses; do not emit for simulator/preview
    if source == "manual":
        insert_ml_prediction(reading["timestamp"], ml_anomaly, ml_fault, ml_energy, source=source)
        try:
            # Extract decoded fields from the reading/snapshot
            sensor_fields = {
                "ambient_temp": snapshot.get("ambient_temp") if snapshot else reading.get("ambient_temp"),
                "indoor_temp": snapshot.get("indoor_temp") if snapshot else reading.get("indoor_temp"),
                "suction_pressure": snapshot.get("suction_pressure") if snapshot else reading.get("suction_pressure"),
                "discharge_pressure": snapshot.get("discharge_pressure") if snapshot else reading.get("discharge_pressure"),
                "compressor_speed": snapshot.get("compressor_speed") if snapshot else reading.get("compressor_speed"),
                "fan_speed": snapshot.get("fan_speed") if snapshot else reading.get("fan_speed"),
                "power_consumption": snapshot.get("power_consumption") if snapshot else reading.get("power_consumption"),
            }
            decoded_fields = {k: v for k, v in sensor_fields.items() if v is not None}
            socketio.emit("ml_prediction", {
                "timestamp": reading.get("timestamp"),
                "source": source,
                "raw_input": raw_string,
                "decoded_fields": decoded_fields,
                "ml_anomaly": ml_anomaly,
                "ml_fault": ml_fault,
                "ml_energy": ml_energy,
            })
        except Exception:
            pass
    return {
        "ml_anomaly": ml_anomaly,
        "ml_fault": ml_fault,
        "ml_energy": ml_energy,
        "ml_ready": True,
    }


def _merge_and_store_reading(parsed_frames: list[dict], source: str) -> tuple[dict | None, list[str]]:
    global latest_real_reading, history

    updated_fields = []
    if not latest_real_reading:
        latest_real_reading = _jsonify_row(get_latest_reading("real") or {}) or {}

    for parsed_frame in parsed_frames:
        # Accept frames that decoded numeric fields even if CRC failed.
        # This prevents perfect CRC requirement from blocking useful data
        # when the frame contains valid sensor values but CRC doesn't match.
        if not parsed_frame.get("parsed_ok") and parsed_frame.get("numeric_field_count", 0) == 0:
            continue

        reading = _reading_from_parsed_frame(parsed_frame)
        for key, value in reading.items():
            if key in ("timestamp", "source"):
                continue
            if value is None:
                continue
            latest_real_reading[key] = value
            if key not in updated_fields:
                updated_fields.append(key)

    if not updated_fields:
        return None, []

    snapshot = {
        **latest_real_reading,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
        "setpoint_temp": latest_real_reading.get("setpoint_temp") or 24,
        "fault_mode": latest_real_reading.get("fault_mode") or "none",
        "compressor_on": latest_real_reading.get("compressor_on", True),
    }
    # Preserve the raw string(s) that produced this snapshot so the History UI
    # can show and copy the exact raw frame(s) used to create the reading.
    try:
        snapshot_raws = ",".join([pf.get("raw") for pf in parsed_frames if pf.get("raw")])
    except Exception:
        snapshot_raws = None
    if snapshot_raws:
        snapshot["raw_string"] = snapshot_raws

    snapshot["health_status"] = check_health(snapshot, source=source)
    raw_string_val = snapshot.get("raw_string", "")
    snapshot.update(_run_ml(snapshot, source, raw_string=raw_string_val, snapshot=snapshot))

    if source == "manual":
        insert_parsed_reading(snapshot, source=source)
    latest_real_reading = dict(snapshot)

    history.append(snapshot)
    history = history[-MAX_HIST:]
    socketio.emit("vrf_data", snapshot)

    return snapshot, updated_fields

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
                reading["source"] = "simulator"
                reading["health_status"] = check_health(reading, source="simulator")

                # Do NOT persist simulator readings or ML predictions to the DB.
                # Emit them for real-time UI only.

                history.append(reading)
                if len(history) > MAX_HIST:
                    history.pop(0)

                socketio.emit("vrf_data", reading)
                print(f"LIVE: {reading['ambient_temp']}°C | Fault: {reading['fault_mode']} | Health: {reading['health_status']}")

            except Exception as e:
                print(f"[STREAM ERROR] {e}")

        time.sleep(2)

if SIMULATOR_ENABLED:
    stream_thread = threading.Thread(target=data_stream, daemon=True)
    stream_thread.start()
    print("Simulator stream enabled via VRF_ENABLE_SIMULATOR=1")
else:
    print("Simulator stream disabled. Waiting for serial/manual protocol ingest.")

# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return jsonify({
        "status": "VRF API running",
        "simulator_enabled": SIMULATOR_ENABLED,
        "real_sources": ["device", "serial", "manual"],
    })

@app.route("/api/history")
def api_history():
    rows = get_recent_readings(100, source="real")
    return jsonify([_jsonify_row(row) for row in reversed(rows)])

@app.route("/api/live/latest")
def api_live_latest():
    row = latest_real_reading or get_latest_reading("real")
    return jsonify(_jsonify_row(row) or {})

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
    if not SIMULATOR_ENABLED:
        return jsonify({"active": False, "simulator_enabled": False})
    stream_active = not stream_active
    return jsonify({"active": stream_active, "simulator_enabled": True})

@app.route("/api/export_csv")
def export_csv():
    rows = get_recent_readings(5000, source="real")
    if not rows:
        return jsonify({"error": "No data"}), 400
    df = pd.DataFrame(rows)
    export_path = os.path.join(data_dir, "live_export.csv")
    df.to_csv(export_path, index=False)
    return jsonify({"status": "saved", "rows": len(df), "path": export_path})

@app.route("/api/train", methods=["POST"])
def train():
    rows = get_recent_readings(5000, source="real")
    df = pd.DataFrame(rows)
    if len(df) < 20:
        return jsonify({
            "status": "needs_more_real_data",
            "rows": len(df),
            "message": "Collect at least 20 real parsed readings before retraining."
        }), 400

    for col in FEATURES + ["setpoint_temp", "power_consumption"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    feature_rows = df.dropna(subset=FEATURES)
    if len(feature_rows) < 20:
        return jsonify({
            "status": "needs_more_complete_real_data",
            "rows": len(df),
            "complete_rows": len(feature_rows),
            "message": "Collect at least 20 complete real readings before retraining."
        }), 400

    results = {
        "anomaly": anomaly.train(df),
        "fault": fault_clf.train(df),
        "rows": len(df),
        "complete_rows": len(feature_rows),
        "source": "real",
    }

    opt_rows = df.dropna(subset=energy.OPT_FEATURES + ["power_consumption"])
    results["energy"] = energy.train(df) if len(opt_rows) >= 20 else {
        "status": "skipped",
        "reason": "needs at least 20 rows with optimizer features and power_consumption",
        "samples": len(opt_rows),
    }
    return jsonify({"status": "ok", "results": results})

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

    # Parse immediately and return results quickly
    result = parse_incoming_payload(data, frame_name=frame_name)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for pf in result.get("frames", []):
        pf["raw_string"] = pf.get("raw")
        pf["source"] = source
        pf["timestamp"] = now_str
        pf["id"] = "--"

    # Emit parsed frames immediately so frontend can show them without waiting for DB writes
    try:
        socketio.emit("protocol_parsed", {"frames": result.get("frames", []), "source": source})
    except Exception:
        pass

    # Build a preview merged reading (no DB writes) and emit so History/Live UI updates fast
    try:
        preview = {}
        for pf in result.get("frames", []):
            reading_piece = _reading_from_parsed_frame(pf)
            for k, v in reading_piece.items():
                if v is not None:
                    preview[k] = v
        if preview:
            preview["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            preview["source"] = source
            socketio.emit("preview_reading", preview)
    except Exception:
        pass

    # Do database operations in background thread to speed up response
    def background_save():
        try:
            # Only persist protocol frames and merged readings when this was a manual or serial ingest
            if source in ("manual", "serial"):
                for parsed_frame in result.get("frames", []):
                    parsed_frame["db_id"] = insert_protocol_frame(parsed_frame, source=source)
                latest_reading, updated_fields = _merge_and_store_reading(result.get("frames", []), source)
                result["latest_reading"] = latest_reading
                result["updated_fields"] = updated_fields
        except Exception as e:
            print(f"[BACKGROUND SAVE ERROR] {e}")
    
    # Start background thread for saving to database only for manual/serial parses
    if source in ("manual", "serial"):
        threading.Thread(target=background_save, daemon=True).start()
    
    result["source"] = source
    return jsonify(result)

# ─────────────────────────────────────────────
#  Database Query Routes
# ─────────────────────────────────────────────

@app.route("/api/db/readings")
def db_readings():
    limit = int(request.args.get("limit", 100))
    source = request.args.get("source", "real")
    rows  = get_recent_readings(limit, source=source)
    return jsonify([_jsonify_row(r) for r in rows])

@app.route("/api/db/predictions")
def db_predictions():
    limit = int(request.args.get("limit", 100))
    source = request.args.get("source", "real")
    rows  = get_recent_predictions(limit, source=source)
    return jsonify([_jsonify_row(r) for r in rows])

@app.route("/api/db/protocol_frames")
def db_protocol_frames():
    limit = int(request.args.get("limit", 100))
    source = request.args.get("source", "real")
    rows = get_recent_protocol_frames(limit, source=source)
    return jsonify([_jsonify_row(r) for r in rows])

@app.route("/api/db/protocol_fields")
def db_protocol_fields():
    limit = int(request.args.get("limit", 300))
    source = request.args.get("source", "real")
    rows = get_recent_protocol_fields(limit, source=source)
    return jsonify([_jsonify_row(r) for r in rows])

@app.route("/api/db/prediction_fields/<int:ml_id>")
def db_prediction_fields(ml_id):
    """Return full decoded fields for a given ML prediction ID.
    First tries to find matching protocol_frames by timestamp (exact join).
    Falls back to re-parsing the raw_string from parsed_readings if no frame exists.
    """
    try:
        from database import get_connection
        import pymysql
        conn = get_connection()
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            # Get the timestamp for this ML prediction
            cur.execute("SELECT timestamp FROM ml_predictions WHERE id = %s", (ml_id,))
            row = cur.fetchone()
            if not row:
                conn.close()
                return jsonify([])
            ts = row["timestamp"]

            # Try protocol_frames first (has pre-saved fields)
            cur.execute("""
                SELECT id FROM protocol_frames
                WHERE ABS(TIMESTAMPDIFF(SECOND, timestamp, %s)) <= 5
                ORDER BY ABS(TIMESTAMPDIFF(SECOND, timestamp, %s)) ASC
                LIMIT 5
            """, (ts, ts))
            frame_rows = cur.fetchall()
            frame_ids = [r["id"] for r in frame_rows]

            if frame_ids:
                placeholders = ",".join(["%s"] * len(frame_ids))
                cur.execute(f"""
                    SELECT parameter_name, field_key, byte_no,
                           raw_value, LENGTH(raw_value) as length,
                           decoded_value, decoded_label, value_type
                    FROM protocol_field_values
                    WHERE frame_id IN ({placeholders})
                      AND COALESCE(parameter_name, '') NOT IN ('*', '#')
                    ORDER BY byte_no ASC
                """, frame_ids)
                fields = cur.fetchall()
                conn.close()
                return jsonify([_jsonify_row(f) for f in fields])

            # Fall back: re-parse from parsed_readings raw_string
            cur.execute("""
                SELECT raw_string FROM parsed_readings
                WHERE ABS(TIMESTAMPDIFF(SECOND, timestamp, %s)) <= 5
                ORDER BY ABS(TIMESTAMPDIFF(SECOND, timestamp, %s)) ASC
                LIMIT 1
            """, (ts, ts))
            reading_row = cur.fetchone()
            conn.close()

            if not reading_row or not reading_row.get("raw_string"):
                return jsonify([])

            from protocol_parser import parse_company_protocol_frame
            raw = reading_row["raw_string"]
            parsed = parse_company_protocol_frame(raw)
            all_fields = parsed.get("fields", [])
            result = []
            for f in all_fields:
                if not f.get("present", True):
                    continue
                param = f.get("parameter", "") or ""
                if param in ("*", "#"):
                    continue
                result.append({
                    "parameter_name": param,
                    "field_key": f.get("field_key", ""),
                    "byte_no": f.get("byte_no"),
                    "raw_value": f.get("raw_value", ""),
                    "length": f.get("length", 0),
                    "decoded_value": f.get("decoded_value"),
                    "decoded_label": f.get("decoded_label"),
                    "value_type": f.get("value_type", "text"),
                })
            return jsonify(result)
    except Exception as e:
        print(f"[ERROR] prediction_fields: {e}")
        return jsonify([])

@app.route("/api/db/health_summary")
def db_health_summary():
    source = request.args.get("source", "real")
    return jsonify(get_health_summary(source=source))

@app.route("/api/db/anomaly_stats")
def db_anomaly_stats():
    source = request.args.get("source", "real")
    stats = get_anomaly_stats(source=source)
    return jsonify(_jsonify_row(stats))

@app.route("/api/db/fault_distribution")
def db_fault_distribution():
    source = request.args.get("source", "real")
    return jsonify(get_fault_distribution(source=source))

@app.route("/api/db/clear_sample_data", methods=["POST"])
def db_clear_sample_data():
    return jsonify({"status": "ok", "deleted": delete_sample_data()})

@app.route("/api/db/clear_all_data", methods=["POST"])
def db_clear_all_data():
    return jsonify({"status": "ok", "deleted": delete_all_data()})

# ─────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────


@app.route('/api/log_error', methods=['POST', 'OPTIONS'])
def log_error():
    if request.method == 'OPTIONS':
        return '', 200
    print('FRONTEND ERROR:', request.json)
    with open('frontend_error.log', 'a') as f:
        f.write(str(request.json) + '\n')
    return '', 200

if __name__ == "__main__":
    print("VRF Dashboard Running: http://localhost:5000")
    if os.environ.get("VRF_DISABLE_BROWSER_OPEN") != "1":
        threading.Timer(1.5, lambda: webbrowser.open("http://localhost:5000")).start()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
