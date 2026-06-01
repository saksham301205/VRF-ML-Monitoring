import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
         ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#1a4fa0","#64a0e8","#c0392b","#b45309","#166534"];

function StatCard({ label, value, sub, color="#1a4fa0" }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #e0e3e8", borderRadius:8,
      padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize:10, fontWeight:600, color:"#999",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color, fontFamily:"'IBM Plex Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"#999", marginTop:4 }}>{sub}</div>}
    </div>
  );
}

export default function Analytics({ API }) {
  const [health,  setHealth]  = useState({});
  const [anomaly, setAnomaly] = useState({ total:0, total_anomalies:0, avg_severity:0, max_severity:0 });
  const [faults,  setFaults]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [h, a, f] = await Promise.all([
          axios.get(`${API}/api/db/health_summary`),
          axios.get(`${API}/api/db/anomaly_stats`),
          axios.get(`${API}/api/db/fault_distribution`),
        ]);
        setHealth(h.data || {});
        const raw = a.data || {};
        setAnomaly({
          total:           Number(raw.total           ?? 0),
          total_anomalies: Number(raw.total_anomalies ?? 0),
          avg_severity:    Number(raw.avg_severity    ?? 0),
          max_severity:    Number(raw.max_severity    ?? 0),
        });
        setFaults(f.data || []);
      } catch(e) { console.error("Analytics load error:", e); }
      setLoading(false);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const total    = anomaly.total || 0;
  const anomalies = anomaly.total_anomalies || 0;
  const anomPct  = total > 0 ? ((anomalies / total) * 100).toFixed(1) : "0.0";

  const healthColors = { healthy:"#dcfce7", warning:"#fef3c7", unhealthy:"#fdecea" };
  const healthBorder = { healthy:"#bbf7d0", warning:"#fcd34d", unhealthy:"#fca5a5" };
  const healthData = Object.entries(health).map(([k, v]) => ({ name: k, value: Number(v) }));
  const faultData  = faults.map(f => ({
    name: (f.fault_predicted || "").replace(/_/g, " "),
    count: Number(f.count)
  }));

  if (loading) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
      color:"#999", fontSize:13 }}>Loading analytics...</div>
  );

  return (
    <div style={{ flex:1, padding:20, overflowY:"auto" }}>
      <div style={{ marginBottom:16 }}>
        <h2 style={{ fontSize:16, fontWeight:700, color:"#0a0a0a" }}>Analytics</h2>
        <p style={{ fontSize:12, color:"#999", marginTop:2 }}>Aggregated statistics from MySQL database</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
        <StatCard label="Total Readings"     value={total.toLocaleString()}     sub="All time" />
        <StatCard label="Anomalies Detected" value={anomalies.toLocaleString()} sub={`${anomPct}% of readings`} color="#c0392b" />
        <StatCard label="Avg Severity"       value={anomaly.avg_severity.toFixed(4)} sub="Lower is better" color="#b45309" />
        <StatCard label="Max Severity"       value={anomaly.max_severity.toFixed(4)} sub="Peak anomaly"    color="#c0392b" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ background:"#fff", border:"1px solid #e0e3e8", borderRadius:8,
          padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#0a0a0a", marginBottom:14 }}>Health Distribution</div>
          {healthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={healthData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80}
                  label={({ name, value }) => `${name}: ${value}`} labelLine fontSize={10}>
                  {healthData.map((entry, i) => (
                    <Cell key={i}
                      fill={healthColors[entry.name] || COLORS[i % COLORS.length]}
                      stroke={healthBorder[entry.name] || "#e0e3e8"} strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }} />
                <Legend wrapperStyle={{ fontSize:10 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height:200, display:"flex", alignItems:"center",
              justifyContent:"center", color:"#999", fontSize:12 }}>No health data yet</div>
          )}
        </div>

        <div style={{ background:"#fff", border:"1px solid #e0e3e8", borderRadius:8,
          padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#0a0a0a", marginBottom:14 }}>Fault Distribution</div>
          {faultData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={faultData} margin={{ top:4, right:8, bottom:30, left:-10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize:9, fill:"#999" }} angle={-15} textAnchor="end" />
                <YAxis tick={{ fontSize:9, fill:"#999" }} />
                <Tooltip contentStyle={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }} />
                <Bar dataKey="count" fill="#1a4fa0" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height:200, display:"flex", alignItems:"center",
              justifyContent:"center", color:"#999", fontSize:12 }}>
              No fault data yet — inject a fault to see distribution
            </div>
          )}
        </div>
      </div>
    </div>
  );
}