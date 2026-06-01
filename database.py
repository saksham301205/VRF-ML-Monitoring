import pymysql
import json
from datetime import datetime

# ─────────────────────────────────────────────
#  DATABASE CONFIGURATION
# ─────────────────────────────────────────────

DB_CONFIG = {
    "host":     "127.0.0.1",
    "port":     3306,
    "user":     "root",
    "password": "root123",
    "charset":  "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor
}

DB_NAME = "vrf_system"

# ─────────────────────────────────────────────
#  CONNECTION HELPER
# ─────────────────────────────────────────────

def get_connection():
    conn = pymysql.connect(**DB_CONFIG)
    conn.select_db(DB_NAME)
    return conn


# ─────────────────────────────────────────────
#  INITIALIZE DATABASE & TABLES
# ─────────────────────────────────────────────

def init_db():
    """Create database and all tables if they don't exist."""

    # Connect without selecting a DB first
    conn = pymysql.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        charset=DB_CONFIG["charset"],
        cursorclass=DB_CONFIG["cursorclass"]
    )

    try:
        with conn.cursor() as cur:

            # Create database
            cur.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
            cur.execute(f"USE {DB_NAME}")

            # ── Table 1: raw_packets ──────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw_packets (
                    id            INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp     DATETIME        NOT NULL,
                    raw_string    VARCHAR(500)    DEFAULT NULL,
                    protocol_name VARCHAR(50)     DEFAULT NULL,
                    source        VARCHAR(50)     DEFAULT 'simulator',
                    created_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Generic company protocol frame store. This keeps every workbook
            # protocol usable without creating hundreds of fixed DB columns.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS protocol_frames (
                    id                   INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp            DATETIME        NOT NULL,
                    frame_name           VARCHAR(100)    DEFAULT NULL,
                    source               VARCHAR(50)     DEFAULT 'device',
                    raw_string           LONGTEXT,
                    crc                  VARCHAR(4)      DEFAULT NULL,
                    crc_calculated       VARCHAR(4)      DEFAULT NULL,
                    crc_valid            BOOLEAN         DEFAULT NULL,
                    parsed_ok            BOOLEAN         DEFAULT FALSE,
                    present_field_count  INT             DEFAULT 0,
                    numeric_field_count  INT             DEFAULT 0,
                    parsed_json          JSON            DEFAULT NULL,
                    error                VARCHAR(255)    DEFAULT NULL,
                    created_at           TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS protocol_field_values (
                    id             INT AUTO_INCREMENT PRIMARY KEY,
                    frame_id       INT             NOT NULL,
                    sheet_name     VARCHAR(100)    DEFAULT NULL,
                    row_no         INT             DEFAULT NULL,
                    byte_no        INT             DEFAULT NULL,
                    length_bytes   INT             DEFAULT NULL,
                    parameter_name VARCHAR(150)    DEFAULT NULL,
                    field_key      VARCHAR(150)    DEFAULT NULL,
                    raw_value      VARCHAR(255)    DEFAULT NULL,
                    decoded_value  VARCHAR(255)    DEFAULT NULL,
                    decoded_label  VARCHAR(255)    DEFAULT NULL,
                    value_type     VARCHAR(30)     DEFAULT NULL,
                    created_at     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_protocol_field_values_frame_id (frame_id),
                    INDEX idx_protocol_field_values_key (field_key),
                    CONSTRAINT fk_protocol_field_values_frame
                        FOREIGN KEY (frame_id) REFERENCES protocol_frames(id)
                        ON DELETE CASCADE
                )
            """)

            # ── Table 2: parsed_readings ──────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS parsed_readings (
                    id                  INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp           DATETIME     NOT NULL,
                    ambient_temp        FLOAT,
                    indoor_temp         FLOAT,
                    setpoint_temp       FLOAT,
                    suction_pressure    FLOAT,
                    discharge_pressure  FLOAT,
                    compressor_speed    FLOAT,
                    fan_speed           FLOAT,
                    power_consumption   FLOAT,
                    superheat           FLOAT,
                    subcooling          FLOAT,
                    cop                 FLOAT,
                    evap_temp           FLOAT,
                    cond_temp           FLOAT,
                    fault_mode          VARCHAR(50)  DEFAULT 'none',
                    compressor_on       BOOLEAN      DEFAULT TRUE,
                    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # ── Table 3: health_log ───────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS health_log (
                    id              INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp       DATETIME        NOT NULL,
                    protocol        VARCHAR(50)     DEFAULT NULL,
                    status          ENUM('healthy', 'unhealthy', 'warning') NOT NULL,
                    parameter       VARCHAR(100)    DEFAULT NULL,
                    actual_value    FLOAT           DEFAULT NULL,
                    expected_min    FLOAT           DEFAULT NULL,
                    expected_max    FLOAT           DEFAULT NULL,
                    reason          VARCHAR(255)    DEFAULT NULL,
                    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # ── Table 4: ml_predictions ───────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ml_predictions (
                    id                  INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp           DATETIME        NOT NULL,
                    anomaly_detected    BOOLEAN         DEFAULT FALSE,
                    anomaly_score       FLOAT           DEFAULT NULL,
                    anomaly_severity    FLOAT           DEFAULT NULL,
                    fault_predicted     VARCHAR(50)     DEFAULT 'none',
                    fault_confidence    FLOAT           DEFAULT NULL,
                    current_power_kw    FLOAT           DEFAULT NULL,
                    optimized_power_kw  FLOAT           DEFAULT NULL,
                    savings_pct         FLOAT           DEFAULT NULL,
                    recommended_params  JSON            DEFAULT NULL,
                    created_at          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
                )
            """)

        conn.commit()
        print("MySQL Database & Tables ready")

    finally:
        conn.close()


# ─────────────────────────────────────────────
#  INSERT FUNCTIONS
# ─────────────────────────────────────────────

def insert_raw_packet(raw_string: str, protocol_name: str = None, source: str = "simulator"):
    """Save a raw protocol string to raw_packets table."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO raw_packets (timestamp, raw_string, protocol_name, source)
                VALUES (%s, %s, %s, %s)
            """, (datetime.now(), raw_string, protocol_name, source))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] insert_raw_packet: {e}")


def insert_protocol_frame(parsed_frame: dict, source: str = "device"):
    """Save a parsed company protocol frame and all decoded field values."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO protocol_frames (
                    timestamp, frame_name, source, raw_string,
                    crc, crc_calculated, crc_valid, parsed_ok,
                    present_field_count, numeric_field_count, parsed_json, error
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                datetime.now(),
                parsed_frame.get("frame_name"),
                source,
                parsed_frame.get("raw"),
                parsed_frame.get("crc"),
                parsed_frame.get("crc_calculated"),
                parsed_frame.get("crc_valid"),
                parsed_frame.get("parsed_ok", False),
                parsed_frame.get("present_field_count", 0),
                parsed_frame.get("numeric_field_count", 0),
                json.dumps(parsed_frame, default=str),
                parsed_frame.get("error")
            ))
            frame_id = cur.lastrowid

            rows = []
            for field in parsed_frame.get("fields", []):
                if not field.get("present"):
                    continue
                rows.append((
                    frame_id,
                    field.get("sheet"),
                    field.get("row"),
                    field.get("byte_no"),
                    field.get("length"),
                    field.get("parameter"),
                    field.get("field_key"),
                    field.get("raw_value"),
                    None if field.get("decoded_value") is None else str(field.get("decoded_value")),
                    field.get("decoded_label"),
                    field.get("value_type"),
                ))

            if rows:
                cur.executemany("""
                    INSERT INTO protocol_field_values (
                        frame_id, sheet_name, row_no, byte_no, length_bytes,
                        parameter_name, field_key, raw_value, decoded_value,
                        decoded_label, value_type
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, rows)

        conn.commit()
        conn.close()
        return frame_id
    except Exception as e:
        print(f"[DB ERROR] insert_protocol_frame: {e}")
        return None


def insert_parsed_reading(reading: dict):
    """Save a parsed sensor reading to parsed_readings table."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO parsed_readings (
                    timestamp, ambient_temp, indoor_temp, setpoint_temp,
                    suction_pressure, discharge_pressure, compressor_speed,
                    fan_speed, power_consumption, superheat, subcooling,
                    cop, evap_temp, cond_temp, fault_mode, compressor_on
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
            """, (
                str(reading.get("timestamp", "")).replace("T", " ")[:19],
                reading.get("ambient_temp"),
                reading.get("indoor_temp"),
                reading.get("setpoint_temp"),
                reading.get("suction_pressure"),
                reading.get("discharge_pressure"),
                reading.get("compressor_speed"),
                reading.get("fan_speed"),
                reading.get("power_consumption"),
                reading.get("superheat"),
                reading.get("subcooling"),
                reading.get("cop"),
                reading.get("evap_temp"),
                reading.get("cond_temp"),
                reading.get("fault_mode", "none"),
                reading.get("compressor_on", True)
            ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] insert_parsed_reading: {e}")


def insert_health_log(timestamp, protocol, status, parameter,
                      actual_value, expected_min, expected_max, reason):
    """Log a healthy/unhealthy/warning event."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO health_log (
                    timestamp, protocol, status, parameter,
                    actual_value, expected_min, expected_max, reason
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (timestamp, protocol, status, parameter,
                  actual_value, expected_min, expected_max, reason))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] insert_health_log: {e}")


def insert_ml_prediction(timestamp, ml_anomaly: dict, ml_fault: dict, ml_energy: dict):
    """Save ML model predictions."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ml_predictions (
                    timestamp, anomaly_detected, anomaly_score, anomaly_severity,
                    fault_predicted, fault_confidence,
                    current_power_kw, optimized_power_kw, savings_pct, recommended_params
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                str(timestamp).replace("T", " ")[:19],
                ml_anomaly.get("anomaly", False),
                ml_anomaly.get("score"),
                ml_anomaly.get("severity"),
                ml_fault.get("fault", "none"),
                ml_fault.get("confidence"),
                ml_energy.get("current_power_kw"),
                ml_energy.get("optimized_power_kw"),
                ml_energy.get("savings_pct"),
                json.dumps(ml_energy.get("recommended_params", {}))
            ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] insert_ml_prediction: {e}")


# ─────────────────────────────────────────────
#  HEALTH CHECK FUNCTION
# ─────────────────────────────────────────────

# Normal operating ranges for each parameter
HEALTHY_RANGES = {
    "ambient_temp":        (10,  50),
    "indoor_temp":         (16,  30),
    "suction_pressure":    (4,   12),
    "discharge_pressure":  (15,  35),
    "compressor_speed":    (1000, 5500),
    "fan_speed":           (500, 1800),
    "power_consumption":   (1,   10),
    "superheat":           (3,   15),
    "subcooling":          (2,   12),
    "cop":                 (1.5,  5),
    "evap_temp":           (5,   20),
    "cond_temp":           (30,  60),
}

def check_health(reading: dict) -> str:
    """
    Check if a reading is healthy, warning, or unhealthy.
    Logs any out-of-range parameters to health_log table.
    Returns overall status: 'healthy', 'warning', or 'unhealthy'
    """
    overall = "healthy"
    ts = str(reading.get("timestamp", datetime.now().isoformat())).replace("T", " ")[:19]

    for param, (min_val, max_val) in HEALTHY_RANGES.items():
        value = reading.get(param)
        if value is None:
            continue

        if value < min_val or value > max_val:
            # Determine severity
            deviation = max(
                abs(value - min_val) / max(abs(min_val), 1),
                abs(value - max_val) / max(abs(max_val), 1)
            )
            status = "unhealthy" if deviation > 0.2 else "warning"
            if status == "unhealthy":
                overall = "unhealthy"
            elif overall == "healthy":
                overall = "warning"

            reason = f"{param} = {value} out of range [{min_val}, {max_val}]"
            insert_health_log(ts, "VRF", status, param, value, min_val, max_val, reason)

    return overall


# ─────────────────────────────────────────────
#  QUERY FUNCTIONS
# ─────────────────────────────────────────────

def get_recent_readings(limit: int = 100) -> list:
    """Fetch the most recent parsed readings."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM parsed_readings
                ORDER BY timestamp DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_readings: {e}")
        return []


def get_recent_predictions(limit: int = 100) -> list:
    """Fetch recent ML predictions."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM ml_predictions
                ORDER BY timestamp DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_predictions: {e}")
        return []


def get_recent_protocol_frames(limit: int = 100) -> list:
    """Fetch recent parsed company protocol frames."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id, timestamp, frame_name, source, crc, crc_calculated,
                    crc_valid, parsed_ok, present_field_count,
                    numeric_field_count, error, created_at
                FROM protocol_frames
                ORDER BY timestamp DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_protocol_frames: {e}")
        return []


def get_recent_protocol_fields(limit: int = 300) -> list:
    """Fetch recent decoded protocol field values."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    pfv.*, pf.frame_name, pf.timestamp
                FROM protocol_field_values pfv
                JOIN protocol_frames pf ON pf.id = pfv.frame_id
                ORDER BY pf.timestamp DESC, pfv.byte_no ASC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_protocol_fields: {e}")
        return []


def get_health_summary() -> dict:
    """Get count of healthy/warning/unhealthy events."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT status, COUNT(*) as count
                FROM health_log
                GROUP BY status
            """)
            rows = cur.fetchall()
        conn.close()
        return {r["status"]: r["count"] for r in rows}
    except Exception as e:
        print(f"[DB ERROR] get_health_summary: {e}")
        return {}


def get_anomaly_stats() -> dict:
    """Get anomaly statistics from ML predictions."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) as total,
                    SUM(anomaly_detected) as total_anomalies,
                    AVG(anomaly_severity) as avg_severity,
                    MAX(anomaly_severity) as max_severity
                FROM ml_predictions
            """)
            row = cur.fetchone()
        conn.close()
        return row or {}
    except Exception as e:
        print(f"[DB ERROR] get_anomaly_stats: {e}")
        return {}


def get_fault_distribution() -> list:
    """Get count of each fault type predicted."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fault_predicted, COUNT(*) as count
                FROM ml_predictions
                WHERE fault_predicted != 'none'
                GROUP BY fault_predicted
                ORDER BY count DESC
            """)
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_fault_distribution: {e}")
        return []


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!")
