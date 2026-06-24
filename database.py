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

def _ensure_column(cur, table: str, column: str, definition: str):
    cur.execute(f"SHOW COLUMNS FROM {table} LIKE %s", (column,))
    if cur.fetchone() is None:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _ensure_index(cur, table: str, index_name: str, columns_sql: str):
    cur.execute(f"SHOW INDEX FROM {table} WHERE Key_name = %s", (index_name,))
    if cur.fetchone() is None:
        cur.execute(f"CREATE INDEX {index_name} ON {table} ({columns_sql})")

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
                    raw_string          LONGTEXT,
                    source              VARCHAR(50)  DEFAULT 'real',
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
                    source          VARCHAR(50)     DEFAULT 'real',
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
                    source              VARCHAR(50)     DEFAULT 'real',
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

            _ensure_column(cur, "raw_packets", "source", "VARCHAR(50) DEFAULT 'simulator'")
            _ensure_column(cur, "protocol_frames", "source", "VARCHAR(50) DEFAULT 'device'")
            _ensure_column(cur, "parsed_readings", "raw_string", "LONGTEXT")
            _ensure_column(cur, "parsed_readings", "source", "VARCHAR(50) DEFAULT 'real'")
            _ensure_column(cur, "health_log", "source", "VARCHAR(50) DEFAULT 'real'")
            _ensure_column(cur, "ml_predictions", "source", "VARCHAR(50) DEFAULT 'real'")

            _ensure_index(cur, "protocol_frames", "idx_protocol_frames_source_time_id", "source, timestamp, id")
            _ensure_index(cur, "protocol_field_values", "idx_protocol_field_values_frame_byte", "frame_id, byte_no")
            _ensure_index(cur, "protocol_field_values", "idx_protocol_field_values_frame_type", "frame_id, value_type")
            _ensure_index(cur, "parsed_readings", "idx_parsed_readings_source_time_id", "source, timestamp, id")
            _ensure_index(cur, "ml_predictions", "idx_ml_predictions_source_time_id", "source, timestamp, id")
            _ensure_index(cur, "health_log", "idx_health_log_source_status", "source, status")

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


def insert_parsed_reading(reading: dict, source: str = "real"):
    """Save a parsed sensor reading to parsed_readings table."""
    try:
        row_source = reading.get("source") or source
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO parsed_readings (
                    timestamp, raw_string, source,
                    ambient_temp, indoor_temp, setpoint_temp,
                    suction_pressure, discharge_pressure, compressor_speed,
                    fan_speed, power_consumption, superheat, subcooling,
                    cop, evap_temp, cond_temp, fault_mode, compressor_on
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
            """, (
                str(reading.get("timestamp", "")).replace("T", " ")[:19],
                reading.get("raw_string"),
                row_source,
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
                      actual_value, expected_min, expected_max, reason,
                      source: str = "real"):
    """Log a healthy/unhealthy/warning event."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO health_log (
                    timestamp, protocol, source, status, parameter,
                    actual_value, expected_min, expected_max, reason
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (timestamp, protocol, source, status, parameter,
                  actual_value, expected_min, expected_max, reason))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] insert_health_log: {e}")


def insert_ml_prediction(timestamp, ml_anomaly: dict, ml_fault: dict, ml_energy: dict,
                         source: str = "real"):
    """Save ML model predictions."""
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ml_predictions (
                    timestamp, source,
                    anomaly_detected, anomaly_score, anomaly_severity,
                    fault_predicted, fault_confidence,
                    current_power_kw, optimized_power_kw, savings_pct, recommended_params
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                str(timestamp).replace("T", " ")[:19],
                source,
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
    "ambient_temp":        (0,  60),
    "indoor_temp":         (0,  60),
    "suction_pressure":    (0,   12),
    "discharge_pressure":  (0,  35),
    "compressor_speed":    (0, 6000),
    "fan_speed":           (0, 2000),
    "power_consumption":   (0,   20),
    "superheat":           (0,   15),
    "subcooling":          (0,   12),
    "cop":                 (0,  5),
    "evap_temp":           (0,   20),
    "cond_temp":           (0,  60),
}

def check_health(reading: dict, source: str = "real") -> str:
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
            if source == "manual":
                insert_health_log(ts, "VRF", status, param, value, min_val, max_val, reason, source=source)

    return overall


# ─────────────────────────────────────────────
#  QUERY FUNCTIONS
# ─────────────────────────────────────────────

def _source_where(source: str, alias: str = ""):
    column = f"{alias}.source" if alias else "source"
    if source == "all" or not source:
        return "", ()
    elif source == "real":
        return f"WHERE ({column} != 'simulator' OR {column} IS NULL)", ()
    else:
        return f"WHERE {column} = %s", (source,)


def _field_label(field: dict) -> str:
    label = (field.get("parameter_name") or field.get("field_key") or "").strip()
    if not label:
        label = f"B{field.get('byte_no')}"
    return label.replace("_", " ")[:32]


def _field_value(field: dict):
    label = field.get("decoded_label")
    value = field.get("decoded_value")
    return label if label not in (None, "") else value


def _summarize_fields(fields: list[dict], max_items: int = 6) -> str:
    parts = []
    seen = set()
    for field in fields:
        value = _field_value(field)
        if value in (None, ""):
            continue
        label = _field_label(field)
        if label in ("*", "#") or label in seen:
            continue
        seen.add(label)
        parts.append(f"{label}: {value}")
        if len(parts) >= max_items:
            break
    return " | ".join(parts)

def get_latest_reading(source: str = "real") -> dict:
    """Fetch the single most recent parsed reading."""
    rows = get_recent_readings(limit=1, source=source)
    return rows[0] if rows else {}

def delete_sample_data() -> dict:
    """Delete all data where source = 'simulator'."""
    counts = {}
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            for table in ["ml_predictions", "parsed_readings", "health_log", "protocol_frames", "raw_packets"]:
                cur.execute(f"DELETE FROM {table} WHERE source = 'simulator'")
                counts[table] = cur.rowcount
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] delete_sample_data: {e}")
    return counts

def delete_all_data() -> dict:
    """Delete all data from the database."""
    counts = {}
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            for table in ["ml_predictions", "parsed_readings", "health_log", "protocol_frames", "raw_packets"]:
                cur.execute(f"DELETE FROM {table}")
                counts[table] = cur.rowcount
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] delete_all_data: {e}")
    return counts

def get_recent_readings(limit: int = 100, source: str = "real") -> list:
    """Fetch the most recent parsed readings."""
    try:
        where_sql, params = _source_where(source)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    id, timestamp, raw_string, source,
                    ambient_temp, indoor_temp, setpoint_temp,
                    suction_pressure, discharge_pressure,
                    compressor_speed, fan_speed, power_consumption,
                    superheat, subcooling, cop, evap_temp, cond_temp,
                    fault_mode, compressor_on, created_at
                FROM parsed_readings
                {where_sql}
                ORDER BY timestamp DESC, id DESC
                LIMIT %s
            """, (*params, limit))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_readings: {e}")
        return []


def get_recent_predictions(limit: int = 100, source: str = "real") -> list:
    """Fetch recent ML predictions."""
    try:
        where_sql, params = _source_where(source)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    id, timestamp, source, anomaly_detected,
                    anomaly_score, anomaly_severity, fault_predicted,
                    fault_confidence, current_power_kw,
                    optimized_power_kw, savings_pct, created_at
                FROM ml_predictions
                {where_sql}
                ORDER BY timestamp DESC, id DESC
                LIMIT %s
            """, (*params, limit))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_predictions: {e}")
        return []


def get_recent_protocol_frames(limit: int = 100, source: str = "real") -> list:
    """Fetch recent parsed company protocol frames."""
    try:
        where_sql, params = _source_where(source)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    id, timestamp, frame_name, source, raw_string,
                    crc, crc_calculated,
                    crc_valid, parsed_ok, present_field_count,
                    numeric_field_count, error, created_at
                FROM protocol_frames
                {where_sql}
                ORDER BY timestamp DESC, id DESC
                LIMIT %s
            """, (*params, limit))
            rows = cur.fetchall()

            frame_ids = [row["id"] for row in rows]
            if frame_ids:
                placeholders = ",".join(["%s"] * len(frame_ids))
                cur.execute(f"""
                    SELECT
                        frame_id, parameter_name, field_key, byte_no,
                        raw_value, LENGTH(raw_value) as length,
                        decoded_value, decoded_label, value_type
                    FROM protocol_field_values
                    WHERE frame_id IN ({placeholders})
                      AND (decoded_value IS NOT NULL OR raw_value IS NOT NULL)
                      AND COALESCE(parameter_name, '') NOT IN ('*', '#')
                    ORDER BY frame_id DESC, byte_no ASC
                """, frame_ids)
                fields_by_frame = {}
                for field in cur.fetchall():
                    fields_by_frame.setdefault(field["frame_id"], []).append(field)
                for row in rows:
                    fields = fields_by_frame.get(row["id"], [])
                    row["value_summary"] = _summarize_fields(fields)
                    row["fields"] = fields
            else:
                for row in rows:
                    row["value_summary"] = ""
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_protocol_frames: {e}")
        return []


def get_recent_protocol_fields(limit: int = 300, source: str = "real") -> list:
    """Fetch recent decoded protocol field values."""
    try:
        where_sql, params = _source_where(source, alias="pf")

        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT pf.id
                FROM protocol_frames pf
                {where_sql}
                ORDER BY pf.timestamp DESC, pf.id DESC
                LIMIT %s
            """, (*params, max(1, min(25, limit))))
            frame_ids = [row["id"] for row in cur.fetchall()]
            if not frame_ids:
                conn.close()
                return []

            placeholders = ",".join(["%s"] * len(frame_ids))
            cur.execute(f"""
                SELECT
                    pfv.*, pf.frame_name, pf.timestamp
                FROM protocol_field_values pfv
                JOIN protocol_frames pf ON pf.id = pfv.frame_id
                WHERE pfv.frame_id IN ({placeholders})
                ORDER BY pf.id DESC, pfv.byte_no ASC
                LIMIT 10000
            """, (*frame_ids,))
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_recent_protocol_fields: {e}")
        return []


def get_health_summary(source: str = "real") -> dict:
    """Get count of healthy/warning/unhealthy events."""
    try:
        where_sql, params = _source_where(source)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT status, COUNT(*) as count
                FROM health_log
                {where_sql}
                GROUP BY status
            """, params)
            rows = cur.fetchall()
        conn.close()
        return {r["status"]: r["count"] for r in rows}
    except Exception as e:
        print(f"[DB ERROR] get_health_summary: {e}")
        return {}


def get_anomaly_stats(source: str = "real") -> dict:
    """Get anomaly statistics from ML predictions."""
    try:
        where_sql, params = _source_where(source)
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    COUNT(*) as total,
                    SUM(anomaly_detected) as total_anomalies,
                    AVG(anomaly_severity) as avg_severity,
                    MAX(anomaly_severity) as max_severity
                FROM ml_predictions
                {where_sql}
            """, params)
            row = cur.fetchone()
        conn.close()
        return row or {}
    except Exception as e:
        print(f"[DB ERROR] get_anomaly_stats: {e}")
        return {}


def get_fault_distribution(source: str = "real") -> list:
    """Get count of each fault type predicted."""
    try:
        where_sql, params = _source_where(source)
        if where_sql:
            where_sql += " AND fault_predicted != 'none'"
        else:
            where_sql = "WHERE fault_predicted != 'none'"
        
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT fault_predicted, COUNT(*) as count
                FROM ml_predictions
                {where_sql}
                GROUP BY fault_predicted
                ORDER BY count DESC
            """, params)
            rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"[DB ERROR] get_fault_distribution: {e}")
        return []


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!")
