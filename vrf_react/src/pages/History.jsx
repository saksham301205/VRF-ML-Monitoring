import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Copy, Play, RefreshCw, Trash2 } from "lucide-react";

export default function History({ API, onIngest }) {
  const [rows,       setRows]       = useState([]);
  const [mlRows,     setMlRows]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [mlLoading,  setMlLoading]  = useState(true);
  const [limit,      setLimit]      = useState(200);
  const [parseInput, setParseInput] = useState("");
  const [parseMsg,   setParseMsg]   = useState("");
  const [copied,     setCopied]     = useState(null);
  const [expandedMlId, setExpandedMlId] = useState(null);
  const [mlPreviewData, setMlPreviewData] = useState({});
  
  const parseBoxRef = useRef(null);
  const prevRowsId = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/db/readings?limit=${limit}&source=real`);
      const newRows = r.data || [];
      const latestId = newRows.length > 0 ? newRows[0].id : null;
      
      if (latestId !== prevRowsId.current || prevRowsId.current === null) {
        setRows(newRows);
        prevRowsId.current = latestId;
      }
    } catch(e) { console.error("History load error:", e); }
    setLoading(false);

    axios.get(`${API}/api/db/predictions?limit=${limit}&source=real`)
      .then(m => setMlRows(m.data || []))
      .catch(e => console.error("Prediction load error:", e))
      .finally(() => setMlLoading(false));
  }, [API, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15000); // 15s poll to reduce database load and improve performance
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onMl = (e) => {
      const p = e.detail;
      if (!p) return;
      // Store full ML preview data for modal display
      const previewId = `preview-${Date.now()}`;
      setMlPreviewData(prev => ({
        ...prev,
        [previewId]: {
          timestamp: p.timestamp,
          raw_input: p.raw_input || "",
          decoded_fields: p.decoded_fields || {},
          ml_anomaly: p.ml_anomaly,
          ml_fault: p.ml_fault,
          ml_energy: p.ml_energy,
        }
      }));
      // prepend a quick ML row preview
      setMlRows(prev => [{
        id: previewId,
        timestamp: p.timestamp || new Date().toISOString(),
        anomaly_detected: p.ml_anomaly?.anomaly || false,
        anomaly_score: p.ml_anomaly?.score || 0,
        anomaly_severity: p.ml_anomaly?.severity || 0,
        fault_predicted: p.ml_fault?.fault || 'unknown',
        fault_confidence: p.ml_fault?.confidence || 0,
        current_power_kw: p.ml_energy?.current_power_kw || null,
      }, ...prev].slice(0, limit));
    };
    window.addEventListener("ml_prediction", onMl);
    return () => window.removeEventListener("ml_prediction", onMl);
  }, [limit]);

  const parseManual = async () => {
    if (!parseInput.trim()) return;
    try {
      // Use the onIngest from App.jsx so that it flows into the Live Monitor power charts
      const result = await onIngest({ raw_batch: parseInput }, "manual");
      setParseMsg(`✓ Data Parsed Successfully! [${result.successful||0} ok, ${result.failed||0} failed]`);
      setParseInput("");
      setTimeout(() => setParseMsg(""), 6000); // Auto-clear after 6s
      prevRowsId.current = null; // force reload state update
      setLoading(true);
      setMlLoading(true);
      await load();
    } catch(err) {
      setParseMsg(err?.response?.data?.message||err.message||"Parse failed");
    }
  };

  const clearSamples = async () => {
    try {
      const r = await axios.post(`${API}/api/db/clear_sample_data`);
      const total = Object.values(r.data.deleted||{})
        .reduce((sum, v) => sum + (Number(v)||0), 0);
      setParseMsg(`Removed ${total} sample row(s)`);
      prevRowsId.current = null;
      setLoading(true);
      setMlLoading(true);
      await load();
    } catch(err) {
      setParseMsg(err.message||"Cleanup failed");
    }
  };

  // Copy raw string to parse box
  const copyToParseBox = (rawString) => {
    if (!rawString || rawString === "--") return;
    setParseInput(prev => prev ? `${prev}\n${rawString}` : rawString);
    setCopied(rawString);
    setTimeout(() => setCopied(null), 1500);
    parseBoxRef.current?.scrollIntoView({ behavior:"smooth" });
  };

  const COLS = ["persisted","id","timestamp","action","raw_string","ambient_temp","indoor_temp","suction_pressure",
    "discharge_pressure","compressor_speed","power_consumption","fault_mode"];

  const ML_COLS = ["persisted","id","timestamp","anomaly_detected","anomaly_score",
    "anomaly_severity","fault_predicted","fault_confidence","current_power_kw","action"];

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
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap"
  });

  const fmt = (col, val) => {
    if (val === null || val === undefined) return "—";
    if (col === "anomaly_detected") return Number(val) ? "YES" : "no";
    if (col === "recommended_params") return (val && val !== "{}" && val !== "\"\"" && val !== "null") ? JSON.stringify(val) : "—";
    if (typeof val === "number") return Number.isInteger(val) ? val : val.toFixed(3);
    if (typeof val === "string" && !isNaN(val) && val.trim() !== "") {
      const n = Number(val);
      return Number.isInteger(n) ? n : n.toFixed(3);
    }
    return String(val);
  };

  return (
    <div style={{ flex:1, padding:20, overflowY:"auto",
      display:"flex", flexDirection:"column", gap:12 }}>

      <style>{`
        @keyframes slideInMsg {
          0% { opacity: 0; transform: translateY(-10px) scale(0.95); }
          50% { transform: translateY(2px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes subtlePulse {
          0% { box-shadow: 0 0 0 0 rgba(22, 101, 52, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(22, 101, 52, 0); }
          100% { box-shadow: 0 0 0 0 rgba(22, 101, 52, 0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:"#0a0a0a" }}>
            History & ML Predictions
          </h2>
          <p style={{ fontSize:11, color:"#999", marginTop:2 }}>
            All data saved to MySQL database
          </p>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#999" }}>Show:</span>
          {[50,100,200,500,1000].map(l => (
            <button key={l} onClick={() => {
              setLimit(l);
              prevRowsId.current=null;
              setLoading(true);
              setMlLoading(true);
            }} style={{
              padding:"5px 10px", borderRadius:4, fontSize:11,
              fontWeight:500, cursor:"pointer",
              background: limit===l ? "#1a4fa0" : "#fff",
              color:      limit===l ? "#fff"     : "#333",
              border:`1px solid ${limit===l ? "#1a4fa0" : "#cbd0d8"}`
            }}>{l}</button>
          ))}
          <button onClick={() => {
            prevRowsId.current=null;
            setLoading(true);
            setMlLoading(true);
            load();
          }} style={{ padding:"5px 10px", borderRadius:4,
            fontSize:11, background:"#fff", border:"1px solid #cbd0d8",
            cursor:"pointer", color:"#333", display:"inline-flex",
            alignItems:"center", gap:6 }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button onClick={clearSamples} style={{ padding:"5px 10px", borderRadius:4,
            fontSize:11, background:"#fff", border:"1px solid #fca5a5",
            cursor:"pointer", color:"#c0392b", display:"inline-flex",
            alignItems:"center", gap:6 }}>
            <Trash2 size={13} /> Clear Samples
          </button>
        </div>
      </div>

      {/* Sensor Readings */}
      <div style={{ background:"#fff", border:"1px solid #e0e3e8",
        borderRadius:8, overflow:"hidden",
        boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #e0e3e8",
          display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a" }}>
            Sensor Readings
          </span>
          <span style={{ fontSize:10, color:"#999", background:"#f5f7fa",
            padding:"2px 7px", borderRadius:10, border:"1px solid #e0e3e8" }}>
            {rows.length} rows
          </span>
          <span style={{ fontSize:10, color:"#666", marginLeft:"auto" }}>
            Click <strong style={{color:"#1a4fa0"}}>Copy</strong> on any row to send its raw frame to the parse box below
          </span>
        </div>
        <div style={{ overflowX:"auto", maxHeight:300, overflowY:"auto" }}>
          {loading && rows.length === 0 ? (
            <div style={{ padding:24, color:"#999", fontSize:12 }}>Loading...</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  {COLS.map(c => <th key={c} style={thStyle}>{c.replace(/_/g," ")}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={COLS.length}
                    style={{ padding:24, color:"#999", fontSize:12 }}>
                    No data yet — run app.py and connect the VRF
                  </td></tr>
                ) : rows.map((row, i) => {
                  const rowCopied = copied === row.raw_string;
                  return (
                    <tr key={i} style={{ borderBottom:"1px solid #e0e3e8", transition: "background 0.3s",
                      background: rowCopied ? "#eaf0fb" : undefined }}
                      onMouseEnter={e => !rowCopied && (e.currentTarget.style.background="#f5f7fa")}
                      onMouseLeave={e => !rowCopied && (e.currentTarget.style.background="")}>
                      {COLS.map(c => {
                        if (c === "persisted") {
                          const isPreview = String(row.id).startsWith("preview-") || row._preview === true;
                          return (
                            <td key={c} style={{...tdStyle(false), whiteSpace:"nowrap"}}>
                              <span style={{display:"inline-block", padding:"4px 8px", borderRadius:6,
                                fontSize:10, fontWeight:700,
                                background: isPreview ? "#f5f7fa" : "#dcfce7",
                                color: isPreview ? "#666" : "#166534",
                                border: `1px solid ${isPreview ? "#e0e3e8" : "#bbf7d0"}`
                              }}>{isPreview ? "Preview" : "Saved"}</span>
                            </td>
                          );
                        }
                        if (c === "action") {
                          return (
                            <td key={c} style={{...tdStyle(false), whiteSpace:"nowrap", textAlign:"center"}}>
                              {row.raw_string && (
                                <button onClick={() => copyToParseBox(row.raw_string)}
                                  title="Copy raw frame to parse box"
                                  style={{
                                    display:"inline-flex", alignItems:"center", gap:5,
                                    padding:"6px 10px", borderRadius:4, flexShrink:0,
                                    border:`1px solid ${rowCopied ? "#16a34a" : "#22c55e"}`,
                                    background: rowCopied ? "#dcfce7" : "#f0fdf4",
                                    color: rowCopied ? "#16a34a" : "#16a34a",
                                    cursor:"pointer", fontSize:11, fontWeight:700,
                                    transition:"all 0.2s", hover:"#bbf7d0"
                                  }}>
                                  <Copy size={12} /> {rowCopied ? "✓ Copied" : "Copy"}
                                </button>
                              )}
                            </td>
                          );
                        }
                        if (c === "raw_string") {
                          const displayStr = row[c] ? (row[c].length > 60 ? row[c].substring(0, 60) + "..." : row[c]) : "—";
                          return (
                            <td key={c} style={{...tdStyle(false), fontSize:9, fontFamily:"monospace", maxWidth:150}}>
                              {displayStr}
                            </td>
                          );
                        }
                        return (
                          <td key={c} style={tdStyle(
                            c==="fault_mode" && row[c] && row[c]!=="none"
                          )}>
                            {fmt(c, row[c])}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Parse & Predict box */}
      <div ref={parseBoxRef} style={{ background:"#fff", border:"1px solid #e0e3e8",
        borderRadius:8, padding:12, boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
        display:"flex", gap:10, alignItems:"flex-start", flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 360px", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#0a0a0a" }}>
            Parse & Predict
          </div>
          <div style={{ fontSize:10, color:"#999" }}>
            Paste a raw *...# frame here (or copy from any row above) to run ML prediction
          </div>
          <textarea
            value={parseInput}
            onChange={e => setParseInput(e.target.value)}
            placeholder="*MDXXI3+1595+0000+... or *TOC024AA1401#"
            style={{
              minHeight:54, maxHeight:120, resize:"vertical",
              border:"1px solid #cbd0d8", borderRadius:4, padding:"8px 10px",
              fontSize:11, fontFamily:"'IBM Plex Mono',Consolas,monospace"
            }}
          />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, paddingTop:24 }}>
          <button onClick={parseManual} disabled={!parseInput.trim()} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            padding:"8px 16px", borderRadius:4, border:"1px solid #1a4fa0",
            background: parseInput.trim() ? "#1a4fa0" : "#f5f7fa",
            color:      parseInput.trim() ? "#fff"    : "#999",
            cursor:     parseInput.trim() ? "pointer" : "not-allowed",
            fontSize:11, fontWeight:600, transition: "all 0.2s"
          }}>
            <Play size={13} /> Parse & Predict
          </button>
          {parseMsg && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 6,
              background: parseMsg.includes("✓") ? "linear-gradient(to right, #dcfce7, #f0fdf4)" : "#fef3c7",
              color: parseMsg.includes("✓") ? "#166534" : "#b45309",
              border: `1px solid ${parseMsg.includes("✓") ? "#22c55e" : "#fcd34d"}`,
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
              animation: "slideInMsg 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, subtlePulse 2s infinite"
            }}>
              <span style={{ fontSize: 14 }}>{parseMsg.includes("✓") ? "✨" : "⚠"}</span>
              {parseMsg}
            </div>
          )}
        </div>
      </div>

      {/* ML Predictions */}
      <div style={{ background:"#fff", border:"1px solid #e0e3e8",
        borderRadius:8, overflow:"hidden",
        boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #e0e3e8",
          display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a" }}>
            ML Predictions
          </span>
          <span style={{ fontSize:10, color:"#999", background:"#f5f7fa",
            padding:"2px 7px", borderRadius:10, border:"1px solid #e0e3e8" }}>
            {mlRows.length} rows
          </span>
        </div>
        <div style={{ overflowX:"auto", maxHeight:300, overflowY:"auto" }}>
          {mlLoading && mlRows.length === 0 ? (
            <div style={{ padding:24, color:"#999", fontSize:12 }}>Loading...</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>{ML_COLS.map(c =>
                  <th key={c} style={thStyle}>{c.replace(/_/g," ")}</th>
                )}</tr>
              </thead>
              <tbody>
                {mlRows.length === 0 ? (
                  <tr><td colSpan={ML_COLS.length}
                    style={{ padding:24, color:"#999", fontSize:12 }}>
                    No predictions yet — parse a frame above
                  </td></tr>
                ) : mlRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom:"1px solid #e0e3e8" }}
                    onMouseEnter={e => e.currentTarget.style.background="#f5f7fa"}
                    onMouseLeave={e => e.currentTarget.style.background=""}>
                    {ML_COLS.map(c => {
                      if (c === "persisted") {
                        const isPreview = String(row.id).startsWith("preview-");
                        return (
                          <td key={c} style={{...tdStyle(false), whiteSpace:"nowrap"}}>
                            <span style={{display:"inline-block", padding:"4px 8px", borderRadius:6,
                              fontSize:10, fontWeight:700,
                              background: isPreview ? "#f5f7fa" : "#dcfce7",
                              color: isPreview ? "#666" : "#166534",
                              border: `1px solid ${isPreview ? "#e0e3e8" : "#bbf7d0"}`
                            }}>{isPreview ? "Preview" : "Saved"}</span>
                          </td>
                        );
                      }
                      if (c === "action") {
                        return (
                          <td key={c} style={{...tdStyle(false), whiteSpace:"nowrap", textAlign:"center"}}>
                            <button onClick={() => setExpandedMlId(expandedMlId === row.id ? null : row.id)}
                              title="View prediction details"
                              style={{
                                padding:"6px 10px", borderRadius:4, fontSize:11, fontWeight:700,
                                border: `1px solid ${expandedMlId === row.id ? "#1a4fa0" : "#3b82f6"}`,
                                background: expandedMlId === row.id ? "#1a4fa0" : "#dbeafe",
                                color: expandedMlId === row.id ? "#fff" : "#1a4fa0",
                                cursor:"pointer", transition:"all 0.2s"
                              }}>
                              {expandedMlId === row.id ? "Hide" : "View"}
                            </button>
                          </td>
                        );
                      }
                      const highlight =
                        (c==="anomaly_detected" && Number(row[c])) ||
                        (c==="fault_predicted"  && row[c] && row[c]!=="none" && row[c]!=="unknown");
                      return (
                        <td key={c} style={{
                          ...tdStyle(highlight),
                          background: highlight ? "#fdecea" : undefined
                        }}>
                          {fmt(c, row[c])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ML Preview Modal */}
      {expandedMlId && mlPreviewData[expandedMlId] && (
        <div style={{ background:"#fff", border:"1px solid #e0e3e8",
          borderRadius:8, overflow:"hidden", marginTop:12,
          boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ padding:"12px 14px", borderBottom:"1px solid #e0e3e8",
            display:"flex", alignItems:"center", justifyContent:"space-between", backgroundColor:"#f5f7fa" }}>
            <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a" }}>
              Parsing & Prediction Details
            </span>
            <button onClick={() => setExpandedMlId(null)}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#999" }}>
              ✕
            </button>
          </div>
          <div style={{ padding:16 }}>
            {/* Raw Input Display */}
            {mlPreviewData[expandedMlId].raw_input && (
              <div style={{ marginBottom:16, padding:10, background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:6 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#166534", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  Raw Input Frame
                </div>
                <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#16a34a", wordBreak:"break-all", lineHeight:1.4 }}>
                  {mlPreviewData[expandedMlId].raw_input}
                </div>
              </div>
            )}
            {/* Decoded Fields Section */}
            <div style={{ marginBottom:20 }}>
              <h4 style={{ fontSize:11, fontWeight:700, color:"#0a0a0a", marginBottom:8,
                letterSpacing:"0.05em", textTransform:"uppercase" }}>
                Decoded Values
              </h4>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:12 }}>
                {Object.entries(mlPreviewData[expandedMlId].decoded_fields || {}).length > 0 ? (
                  Object.entries(mlPreviewData[expandedMlId].decoded_fields).map(([key, val]) => (
                    <div key={key} style={{ background:"#f5f7fa", border:"1px solid #e0e3e8",
                      borderRadius:6, padding:10 }}>
                      <div style={{ fontSize:10, color:"#999", fontWeight:600, marginBottom:4,
                        textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        {key.replace(/_/g," ")}
                      </div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#0a0a0a",
                        fontFamily:"'IBM Plex Mono',monospace" }}>
                        {typeof val === "number" ? val.toFixed(3) : val || "—"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color:"#999", fontSize:11, gridColumn:"1/-1" }}>No decoded fields available</div>
                )}
              </div>
            </div>

            {/* ML Predictions Section */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12 }}>
              {/* Anomaly Detection */}
              <div style={{ background:"#eaf0fb", border:"1px solid #c8d9f5", borderRadius:6, padding:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#1a4fa0", marginBottom:8,
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  Anomaly Detection
                </div>
                <div style={{ fontSize:14, fontWeight:700, color:"#0a0a0a", marginBottom:6,
                  fontFamily:"'IBM Plex Mono',monospace" }}>
                  {mlPreviewData[expandedMlId].ml_anomaly?.anomaly ? "DETECTED" : "NORMAL"}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Score: {(mlPreviewData[expandedMlId].ml_anomaly?.score || 0).toFixed(4)}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Severity: {(mlPreviewData[expandedMlId].ml_anomaly?.severity || 0).toFixed(3)}
                </div>
              </div>

              {/* Fault Classifier */}
              <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:6, padding:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#b45309", marginBottom:8,
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  Fault Prediction
                </div>
                <div style={{ fontSize:14, fontWeight:700, color:"#0a0a0a", marginBottom:6,
                  fontFamily:"'IBM Plex Mono',monospace" }}>
                  {(mlPreviewData[expandedMlId].ml_fault?.fault || "unknown").toUpperCase().replace(/_/g," ")}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Confidence: {((mlPreviewData[expandedMlId].ml_fault?.confidence || 0) * 100).toFixed(1)}%
                </div>
              </div>

              {/* Energy Optimizer */}
              <div style={{ background:"#dcfce7", border:"1px solid #bbf7d0", borderRadius:6, padding:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#166534", marginBottom:8,
                  textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  Energy Info
                </div>
                <div style={{ fontSize:14, fontWeight:700, color:"#0a0a0a", marginBottom:6,
                  fontFamily:"'IBM Plex Mono',monospace" }}>
                  {mlPreviewData[expandedMlId].ml_energy?.current_power_kw || "—"} kW
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Potential saving: {mlPreviewData[expandedMlId].ml_energy?.savings_pct || 0}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
