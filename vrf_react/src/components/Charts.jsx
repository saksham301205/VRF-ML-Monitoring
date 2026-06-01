import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";

const tooltipStyle = {
  backgroundColor:"#fff", border:"1px solid #e0e3e8",
  borderRadius:6, fontSize:11, fontFamily:"'IBM Plex Mono',monospace",
  boxShadow:"0 2px 8px rgba(0,0,0,0.08)"
};

function ChartCard({ title, children, badge }) {
  return (
    <div style={{
      background:"#fff", border:"1px solid #e0e3e8",
      borderRadius:8, padding:"16px 18px",
      boxShadow:"0 1px 3px rgba(0,0,0,0.04)"
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a", letterSpacing:"0.02em" }}>{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      height:220, display:"flex", alignItems:"center", justifyContent:"center",
      color:"#ccc", fontSize:11, fontFamily:"Inter,sans-serif",
      border:"1px dashed #e0e3e8", borderRadius:6
    }}>
      No data yet — connect to backend
    </div>
  );
}

export function TempChart({ data }) {
  if (!data || data.length === 0) return <ChartCard title="Temperature (°C)"><EmptyState /></ChartCard>;
  const last = data[data.length - 1];
  return (
    <ChartCard title="Temperature (°C)"
      badge={<span style={{ fontFamily:"monospace", fontSize:12, color:"#1a4fa0", fontWeight:600 }}>
        {last?.ambient?.toFixed(1)}°C
      </span>}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top:4, right:8, bottom:0, left:-20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f5f7fa" />
          <XAxis dataKey="ts" hide />
          <YAxis tick={{ fontSize:10, fontFamily:"monospace", fill:"#999" }} domain={["auto","auto"]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => v?.toFixed(2)} />
          <Legend wrapperStyle={{ fontSize:11, fontFamily:"Inter,sans-serif" }} />
          <Line type="monotone" dataKey="ambient"  name="Ambient"  stroke="#1a4fa0" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="indoor"   name="Indoor"   stroke="#64a0e8" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="setpoint" name="Setpoint" stroke="#cbd0d8" dot={false} strokeWidth={1.5} strokeDasharray="5 3" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PressureChart({ data }) {
  if (!data || data.length === 0) return <ChartCard title="Pressure (bar)"><EmptyState /></ChartCard>;
  const last = data[data.length - 1];
  return (
    <ChartCard title="Pressure (bar)"
      badge={<span style={{ fontFamily:"monospace", fontSize:12, color:"#1a4fa0", fontWeight:600 }}>
        HP {last?.discharge?.toFixed(1)} / LP {last?.suction?.toFixed(1)}
      </span>}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top:4, right:8, bottom:0, left:-20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f5f7fa" />
          <XAxis dataKey="ts" hide />
          <YAxis tick={{ fontSize:10, fontFamily:"monospace", fill:"#999" }} domain={["auto","auto"]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => v?.toFixed(2)} />
          <Legend wrapperStyle={{ fontSize:11 }} />
          <Line type="monotone" dataKey="suction"   name="Suction"   stroke="#1a4fa0" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="discharge" name="Discharge" stroke="#e07b39" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PowerChart({ data }) {
  if (!data || data.length === 0) return <ChartCard title="Power Consumption (kW)"><EmptyState /></ChartCard>;
  const last = data[data.length - 1];
  const avg  = data.reduce((s, d) => s + (d.power || 0), 0) / data.length;
  return (
    <ChartCard title="Power Consumption (kW)"
      badge={<span style={{ fontFamily:"monospace", fontSize:12, color:"#166534", fontWeight:600 }}>
        {last?.power?.toFixed(2)} kW
      </span>}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top:4, right:8, bottom:0, left:-20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f5f7fa" />
          <XAxis dataKey="ts" hide />
          <YAxis tick={{ fontSize:10, fontFamily:"monospace", fill:"#999" }} domain={["auto","auto"]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => v?.toFixed(3) + " kW"} />
          <ReferenceLine y={avg} stroke="#dcfce7" strokeDasharray="4 4" label={{ value:"avg", fill:"#166534", fontSize:9 }} />
          <Line type="monotone" dataKey="power" name="Power kW" stroke="#1a4fa0" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AnomalyChart({ data }) {
  if (!data || data.length === 0) return <ChartCard title="Anomaly Severity Score"><EmptyState /></ChartCard>;
  const last    = data[data.length - 1];
  const isAlert = (last?.severity || 0) > 0.5;
  return (
    <ChartCard title="Anomaly Severity Score"
      badge={<span style={{
        fontFamily:"monospace", fontSize:12, fontWeight:700,
        color: isAlert ? "#c0392b" : "#166534"
      }}>
        {isAlert ? "⚠ ANOMALY" : "✓ NORMAL"}
      </span>}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top:4, right:8, bottom:0, left:-20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f5f7fa" />
          <XAxis dataKey="ts" hide />
          <YAxis tick={{ fontSize:10, fontFamily:"monospace", fill:"#999" }} domain={[0, 1]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => v?.toFixed(4)} />
          <ReferenceLine y={0.5} stroke="#fca5a5" strokeDasharray="4 4" label={{ value:"alert", fill:"#c0392b", fontSize:9 }} />
          <Line type="monotone" dataKey="severity" name="Severity" stroke="#c0392b" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}