import { useState, useEffect, useRef } from "react";
import { TempChart, PressureChart, PowerChart, AnomalyChart } from "../components/Charts";
import Controls from "../components/Controls";

const MAX_CHART = 60;

export default function LiveMonitor({ data, history, streaming, ready,
  onInjectFault, onClearFault, onSetSetpoint, onRetrain, onToggleStream, onExportCSV }) {

  const [chartData, setChartData] = useState({ temp:[], pressure:[], power:[], anomaly:[] });

  useEffect(() => {
    if (!data) return;
    const ts = new Date().toLocaleTimeString();
    setChartData(prev => ({
      temp:     [...prev.temp.slice(-(MAX_CHART-1)),     { ts, ambient:data.ambient_temp, indoor:data.indoor_temp, setpoint:data.setpoint_temp }],
      pressure: [...prev.pressure.slice(-(MAX_CHART-1)), { ts, suction:data.suction_pressure, discharge:data.discharge_pressure }],
      power:    [...prev.power.slice(-(MAX_CHART-1)),    { ts, power:data.power_consumption }],
      anomaly:  [...prev.anomaly.slice(-(MAX_CHART-1)),  { ts, severity:data.ml_anomaly?.severity ?? 0 }],
    }));
  }, [data]);

  const showBanner = ready && !data;

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
            Waiting for data — make sure{" "}
            <code style={{ background:"#fef3c7", padding:"1px 6px", borderRadius:3 }}>python app.py</code>
            {" "}is running on port 5000, then refresh.
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