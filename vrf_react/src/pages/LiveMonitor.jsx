import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { TempChart, PressureChart, PowerChart, AnomalyChart } from "../components/Charts";
import Controls from "../components/Controls";

const MAX_CHART = 60;
const API_BASE = "http://localhost:5000";

export default function LiveMonitor({ data, history, streaming, ready,
  serial, onInjectFault, onClearFault, onSetSetpoint, onRetrain, onToggleStream, onExportCSV }) {

  const [chartData, setChartData] = useState({ temp:[], pressure:[], power:[], anomaly:[] });
  const [seeded, setSeeded] = useState(false);

  // ── Seed charts from DB history on first mount ──────────────────────
  const seedFromHistory = useCallback(async () => {
    if (seeded) return;
    try {
      const res = await axios.get(`${API_BASE}/api/db/readings?limit=${MAX_CHART}&source=real`);
      const rows = res.data || [];
      if (rows.length === 0) return;

      // Rows come newest-first from API, reverse for chronological chart order
      const chronological = [...rows].reverse();

      const temp = [];
      const pressure = [];
      const power = [];
      const anomaly = [];

      chronological.forEach(row => {
        const ts = row.timestamp
          ? new Date(row.timestamp).toLocaleTimeString()
          : new Date().toLocaleTimeString();

        if (row.ambient_temp !== null || row.indoor_temp !== null) {
          temp.push({
            ts,
            ambient: row.ambient_temp != null ? Number(row.ambient_temp) : undefined,
            indoor: row.indoor_temp != null ? Number(row.indoor_temp) : undefined,
            setpoint: row.setpoint_temp != null ? Number(row.setpoint_temp) : 24,
          });
        }
        if (row.suction_pressure !== null || row.discharge_pressure !== null) {
          pressure.push({
            ts,
            suction: row.suction_pressure != null ? Number(row.suction_pressure) : undefined,
            discharge: row.discharge_pressure != null ? Number(row.discharge_pressure) : undefined,
          });
        }
        if (row.power_consumption !== null) {
          power.push({
            ts,
            power: row.power_consumption != null ? Number(row.power_consumption) : undefined,
          });
        }
        // Anomaly severity from ML predictions if available
        anomaly.push({
          ts,
          severity: row.ml_anomaly?.severity ?? row.anomaly_severity ?? 0,
        });
      });

      setChartData({
        temp: temp.slice(-MAX_CHART),
        pressure: pressure.slice(-MAX_CHART),
        power: power.slice(-MAX_CHART),
        anomaly: anomaly.slice(-MAX_CHART),
      });
      setSeeded(true);
    } catch (err) {
      console.error("Failed to seed charts from history:", err);
    }
  }, [seeded]);

  useEffect(() => {
    seedFromHistory();
  }, [seedFromHistory]);

  // ── Append live data points as they arrive ──────────────────────────
  useEffect(() => {
    if (!data) return;
    const ts = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    setChartData(prev => ({
      temp: [...prev.temp.slice(-(MAX_CHART-1)), {
        ts,
        ambient: data.ambient_temp,
        indoor: data.indoor_temp,
        setpoint: data.setpoint_temp,
      }],
      pressure: [...prev.pressure.slice(-(MAX_CHART-1)), {
        ts,
        suction: data.suction_pressure,
        discharge: data.discharge_pressure,
      }],
      power: [...prev.power.slice(-(MAX_CHART-1)), {
        ts,
        power: data.power_consumption,
      }],
      anomaly: [...prev.anomaly.slice(-(MAX_CHART-1)), {
        ts,
        severity: data.ml_anomaly?.severity ?? 0,
      }],
    }));
    setSeeded(true);
  }, [data]);

  // ── Also seed from history prop (in-memory readings from App.jsx) ───
  useEffect(() => {
    if (seeded || !history || history.length === 0) return;
    const recent = history.slice(-MAX_CHART);
    const temp = [];
    const pressure = [];
    const power = [];
    const anomaly = [];

    recent.forEach(row => {
      const ts = row.timestamp
        ? new Date(row.timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString();
      temp.push({ ts, ambient: row.ambient_temp, indoor: row.indoor_temp, setpoint: row.setpoint_temp });
      pressure.push({ ts, suction: row.suction_pressure, discharge: row.discharge_pressure });
      power.push({ ts, power: row.power_consumption });
      anomaly.push({ ts, severity: row.ml_anomaly?.severity ?? 0 });
    });

    if (temp.length > 0) {
      setChartData({ temp, pressure, power, anomaly });
      setSeeded(true);
    }
  }, [history, seeded]);

  const showBanner = ready && !data && !seeded;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", gap:16 }}>

        {showBanner && (
          <div style={{
            background:"#fff8e1", border:"1px solid #fcd34d", borderRadius:8,
            padding:"12px 16px", fontSize:12, color:"#b45309", fontWeight:500,
            display:"flex", alignItems:"center", gap:10
          }}>
            <span style={{ fontSize:16 }}>⚠</span>
            Waiting for real parsed data. Make sure{" "}
            <code style={{ background:"#fef3c7", padding:"1px 6px", borderRadius:3 }}>python app.py</code>
            {" "}is running, then connect the COM port or paste a protocol frame.
          </div>
        )}

        {/* 2x2 chart grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <TempChart     data={chartData.temp} />
          <PressureChart data={chartData.pressure} />
          <PowerChart    data={chartData.power} />
          <AnomalyChart  data={chartData.anomaly} />
        </div>

      </div>

      <Controls
        streaming={streaming}
        serial={serial}
        onInjectFault={onInjectFault}
        onClearFault={onClearFault}
        onSetSetpoint={onSetSetpoint}
        onRetrain={onRetrain}
        onToggleStream={onToggleStream}
        onExportCSV={onExportCSV}
      />
    </div>
  );
}
