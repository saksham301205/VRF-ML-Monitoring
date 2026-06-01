import { useState, useEffect, useCallback } from "react";
import axios from "axios";

export default function History({ API }) {
  const [rows,    setRows]    = useState([]);
  const [mlRows,  setMlRows]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit,   setLimit]   = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([
        axios.get(`${API}/api/db/readings?limit=${limit}`),
        axios.get(`${API}/api/db/predictions?limit=${limit}`),
      ]);
      setRows(r.data || []);
      setMlRows(m.data || []);
    } catch (e) { console.error("History load error:", e); }
    setLoading(false);
  }, [API, limit]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const COLS = ["id","timestamp","ambient_temp","indoor_temp","suction_pressure",
    "discharge_pressure","compressor_speed","power_consumption","cop","fault_mode"];

  const ML_COLS = ["id","timestamp","anomaly_detected","anomaly_score",
    "anomaly_severity","fault_predicted","fault_confidence",
    "current_power_kw","optimized_power_kw","savings_pct"];

  const thStyle = {
    padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:600,
    letterSpacing:"0.06em", textTransform:"uppercase", color:"#999",
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap",
    background:"#f5f7fa", position:"sticky", top:0, zIndex:1
  };

  const tdStyle = (highlight) => ({
    padding:"6px 10px", fontSize:11,
    fontFamily:"'IBM Plex Mono',monospace",
    color: highlight ? "#c0392b" : "#333",
    fontWeight: highlight ? 600 : 400,
    borderRight:"1px solid #e0e3e8",
    whiteSpace:"nowrap"
  });

  const fmt = (col, val) => {
    if (val === null || val === undefined) return "—";
    if (col === "anomaly_detected") return Number(val) ? "YES" : "no";
    if (typeof val === "number") return Number.isInteger(val) ? val : val.toFixed(3);
    if (typeof val === "string" && !isNaN(val) && val.trim() !== "") {
      const n = Number(val);
      return Number.isInteger(n) ? n : n.toFixed(3);
    }
    return String(val);
  };

  const TableCard = ({ title, count, cols, data: tableData, highlightFn }) => (
    <div style={{ background:"#fff", border:"1px solid #e0e3e8",
      borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ padding:"10px 14px", borderBottom:"1px solid #e0e3e8",
        display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a" }}>{title}</span>
        <span style={{ fontSize:10, color:"#999", background:"#f5f7fa",
          padding:"2px 7px", borderRadius:10, border:"1px solid #e0e3e8" }}>
          {count} rows
        </span>
      </div>
      <div style={{ overflowX:"auto", maxHeight:320, overflowY:"auto" }}>
        {loading ? (
          <div style={{ padding:24, color:"#999", fontSize:12 }}>Loading...</div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>{cols.map(c => <th key={c} style={thStyle}>{c.replace(/_/g," ")}</th>)}</tr>
            </thead>
            <tbody>
              {tableData.length === 0 ? (
                <tr><td colSpan={cols.length} style={{ padding:24, color:"#999", fontSize:12 }}>
                  No data yet
                </td></tr>
              ) : tableData.map((row, i) => (
                <tr key={i} style={{ borderBottom:"1px solid #e0e3e8" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f5f7fa"}
                  onMouseLeave={e => e.currentTarget.style.background=""}>
                  {cols.map(c => (
                    <td key={c} style={tdStyle(highlightFn(c, row[c]))}>
                      {fmt(c, row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ flex:1, padding:20, overflowY:"auto",
      display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:"#0a0a0a" }}>History & ML Predictions</h2>
          <p style={{ fontSize:11, color:"#999", marginTop:2 }}>All data saved to MySQL database</p>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#999" }}>Show:</span>
          {[50, 100, 500].map(l => (
            <button key={l} onClick={() => setLimit(l)} style={{
              padding:"5px 10px", borderRadius:4, fontSize:11, fontWeight:500, cursor:"pointer",
              background: limit===l ? "#1a4fa0" : "#fff",
              color: limit===l ? "#fff" : "#333",
              border:`1px solid ${limit===l ? "#1a4fa0" : "#cbd0d8"}`
            }}>{l}</button>
          ))}
          <button onClick={load} style={{ padding:"5px 10px", borderRadius:4,
            fontSize:11, background:"#fff", border:"1px solid #cbd0d8",
            cursor:"pointer", color:"#333" }}>↻ Refresh</button>
        </div>
      </div>

      <TableCard title="Sensor Readings" count={rows.length} cols={COLS} data={rows}
        highlightFn={(c, v) => c === "fault_mode" && v && v !== "none"} />

      <TableCard title="ML Predictions" count={mlRows.length} cols={ML_COLS} data={mlRows}
        highlightFn={(c, v) =>
          (c === "anomaly_detected" && Number(v)) ||
          (c === "fault_predicted" && v && v !== "none")} />
    </div>
  );
}