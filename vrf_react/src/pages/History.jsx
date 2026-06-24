import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Copy, Play, RefreshCw, Trash2 } from "lucide-react";

export default function History({ API, onIngest }) {
  const [rows,       setRows]       = useState([]);
  const [mlRows,     setMlRows]     = useState([]);
  const [frameRows,  setFrameRows]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [mlLoading,  setMlLoading]  = useState(true);
  const [limit,      setLimit]      = useState(200);
  const [parseInput, setParseInput] = useState("");
  const [parseMsg,   setParseMsg]   = useState("");
  const [copied,     setCopied]     = useState(null);
  const [expandedMlId, setExpandedMlId] = useState(null);
  const [viewPage, setViewPage] = useState(1);
  const [mlPreviewData, setMlPreviewData] = useState({});
  const [fetchedFields, setFetchedFields] = useState({});   // ml_id -> fields array
  const [fieldsLoading, setFieldsLoading] = useState(false);
  
  const getPreviewData = (mlId) => {
    if (!mlId) return null;
    if (mlPreviewData[mlId]) {
      const preview = mlPreviewData[mlId];
      if (!preview.all_fields) {
        preview.all_fields = Object.entries(preview.decoded_fields || {}).map(([key, val]) => ({
          parameter_name: key.replace(/_/g, " "),
          decoded_value: val,
          raw_value: "—",
          value_type: typeof val === "number" ? "number" : "text"
        }));
      }
      return preview;
    }
    const m = mlRows.find(r => r.id === mlId);
    if (!m) return null;
    const r = rows.find(x => x.timestamp === m.timestamp) || {};
    const dec = {};
    ["ambient_temp","indoor_temp","suction_pressure","discharge_pressure","compressor_speed","fan_speed","power_consumption","superheat","subcooling","cop","evap_temp","cond_temp"].forEach(k => {
      if (r[k] !== undefined && r[k] !== null) dec[k] = r[k];
    });

    const mTime = new Date(m.timestamp).getTime();
    const matchingFrames = frameRows.filter(f => {
      if (f.timestamp === m.timestamp) return true;
      if (mTime && new Date(f.timestamp).getTime() === mTime) return true;
      // Allow up to 2 seconds drift just in case inserts were slightly apart
      if (mTime && Math.abs(new Date(f.timestamp).getTime() - mTime) < 2000) return true;
      return false;
    });
    let allFields = [];
    matchingFrames.forEach(f => {
      let fieldsArray = f.fields;
      if (typeof fieldsArray === 'string') {
        try { fieldsArray = JSON.parse(fieldsArray); } catch(e) {}
      }
      if (Array.isArray(fieldsArray)) {
         // tag fields with their frame ID/name to group them if needed
         const fieldsWithFrame = fieldsArray.map(field => ({...field, frame_name: f.protocol || field.frame_name}));
         allFields.push(...fieldsWithFrame);
      }
    });

    return {
      timestamp: m.timestamp,
      raw_input: r.raw_string || matchingFrames.map(f => f.raw_string).join("\\n") || "—",
      decoded_fields: dec,
      all_fields: allFields,
      ml_anomaly: { anomaly: m.anomaly_detected, score: m.anomaly_score, severity: m.anomaly_severity },
      ml_fault: { fault: m.fault_predicted, confidence: m.fault_confidence },
      ml_energy: { current_power_kw: m.current_power_kw, optimized_power_kw: m.optimized_power_kw, savings_pct: m.savings_pct }
    };
  };
  
  const parseBoxRef = useRef(null);
  const prevRowsId = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/db/readings?limit=${limit}`);
      const newRows = r.data || [];
      const latestId = newRows.length > 0 ? newRows[0].id : null;
      
      if (latestId !== prevRowsId.current || prevRowsId.current === null) {
        setRows(newRows);
        prevRowsId.current = latestId;
      }
    } catch(e) { console.error("History load error:", e); }
    setLoading(false);

    axios.get(`${API}/api/db/predictions?limit=${limit}`)
      .then(m => setMlRows(m.data || []))
      .catch(e => console.error("Prediction load error:", e))
      .finally(() => setMlLoading(false));

    axios.get(`${API}/api/db/protocol_frames?limit=${limit}`)
      .then(m => setFrameRows(m.data || []))
      .catch(e => console.error("Frame load error:", e));
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
        <div style={{ overflowX:"auto", maxHeight:300, overflowY:"scroll" }}>
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
                            <td key={c} style={{...tdStyle(false), fontSize:9, fontFamily:"monospace", maxWidth:150, overflow: "hidden", textOverflow: "ellipsis"}}>
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
        <div style={{ overflowX:"auto", maxHeight:300, overflowY:"scroll" }}>
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
                        const isExpanded = expandedMlId === row.id;
                        return (
                          <td key={c} style={{...tdStyle(false), whiteSpace:"nowrap", textAlign:"center"}}>
                            <button onClick={() => {
                              if (isExpanded) {
                                setExpandedMlId(null);
                                return;
                              }
                              setViewPage(1);
                              setExpandedMlId(row.id);
                              // Only fetch if we haven't already
                              if (!fetchedFields[row.id]) {
                                setFieldsLoading(true);
                                axios.get(`${API}/api/db/prediction_fields/${row.id}`)
                                  .then(res => setFetchedFields(prev => ({ ...prev, [row.id]: res.data || [] })))
                                  .catch(err => console.error("Fields fetch error:", err))
                                  .finally(() => setFieldsLoading(false));
                              }
                            }}
                              title="View prediction details"
                              style={{
                                padding:"6px 10px", borderRadius:4, fontSize:11, fontWeight:700,
                                border: `1px solid ${isExpanded ? "#1a4fa0" : "#3b82f6"}`,
                                background: isExpanded ? "#1a4fa0" : "#dbeafe",
                                color: isExpanded ? "#fff" : "#1a4fa0",
                                cursor:"pointer", transition:"all 0.2s"
                              }}>
                              {isExpanded ? "Hide" : "View"}
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
      {expandedMlId && (() => {
        const mlPred = mlRows.find(r => r.id === expandedMlId) || {};
        const activeFields = fetchedFields[expandedMlId] || [];
        return (
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
            {/* Decoded Fields Section (Tabular Card Format) */}
            <div style={{ marginBottom:20 }}>
              <h4 style={{ fontSize:11, fontWeight:700, color:"#0a0a0a", marginBottom:8,
                letterSpacing:"0.05em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:6 }}>
                <span style={{color:"#1a4fa0"}}>◇</span> Decoded Values
                {fieldsLoading && <span style={{fontSize:10,color:"#999",marginLeft:8}}>Loading…</span>}
                {!fieldsLoading && activeFields.length > 0 && (
                  <span style={{fontSize:10,color:"#fff",fontWeight:600,background:"#166534",padding:"2px 8px",borderRadius:3,marginLeft:8}}>
                    {activeFields.length} fields
                  </span>
                )}
              </h4>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:10, maxHeight:"400px", overflowY:"auto", paddingRight:"8px" }}>
                {fieldsLoading ? (
                  <div style={{color:"#999",fontSize:12,gridColumn:"1/-1",padding:"20px 0",textAlign:"center"}}>Loading decoded fields…</div>
                ) : activeFields.length > 0 ? (
                  activeFields.slice((viewPage-1)*100, viewPage*100).map((field, index) => {
                    const frameLabel = field.frame || field.frame_name || field.sheet_name || "Frame";
                    const paramName = field.parameter_name || field.field_key || "Unknown";
                    const rawVal = field.raw_value ?? "--";
                    const decodedVal = field.decoded_value ?? "--";
                    const label = field.decoded_label || "";
                    const type = field.value_type || "text";
                    const isBad = type === "number" && decodedVal === "--";
                    
                    return (
                      <div key={`${index}`}
                        style={{
                          border: isBad ? "1px solid #fca5a5" : "1px solid #e0e3e8",
                          borderRadius:6, padding:10, background: isBad ? "#fef2f2" : "#f9fafb",
                          transition: "all 0.2s"
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.border = isBad ? "1px solid #f87171" : "1px solid #cbd0d8";
                          e.currentTarget.style.background = isBad ? "#fef9f9" : "#f5f7fa";
                          e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.06)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.border = isBad ? "1px solid #fca5a5" : "1px solid #e0e3e8";
                          e.currentTarget.style.background = isBad ? "#fef2f2" : "#f9fafb";
                          e.currentTarget.style.boxShadow = "none";
                        }}>
                        <div style={{ fontSize:9, fontWeight:700, color:"#999", textTransform:"uppercase",
                          letterSpacing:"0.06em", marginBottom:6 }}>
                          {frameLabel} - {paramName}
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:6 }}>
                          <div>
                            <div style={{ fontSize:9, color:"#666", marginBottom:2 }}>Raw</div>
                            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace",
                              fontWeight:600, color:"#333", wordBreak:"break-all" }}>
                              {rawVal}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize:9, color:"#666", marginBottom:2 }}>Decoded</div>
                            <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace",
                              fontWeight:600, color: decodedVal === "--" ? "#999" : "#166534",
                              wordBreak:"break-all" }}>
                              {decodedVal}
                            </div>
                          </div>
                        </div>
                        {label && (
                          <div style={{ fontSize:10, color:"#1a4fa0", fontStyle:"italic",
                            borderTop:"1px solid #e0e3e8", paddingTop:6, marginTop:6 }}>
                            {label}
                          </div>
                        )}
                        <div style={{ fontSize:9, color:"#999", marginTop:6,
                          borderTop:"1px solid #e0e3e8", paddingTop:6 }}>
                          Byte {field.byte_no ?? "?"} - {type}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ color:"#999", fontSize:11, gridColumn:"1/-1" }}>No decoded fields found. Try clicking View again or check your data.</div>
                )}
              </div>
              {activeFields.length > 100 && (
                <div style={{ marginTop:10, padding:"10px 14px", borderTop:"1px solid #e0e3e8", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f9fafb" }}>
                  <div style={{ fontSize:11, color:"#666" }}>
                    Showing {(viewPage-1)*100 + 1}–{Math.min(viewPage*100, activeFields.length)} of {activeFields.length} fields
                    &nbsp;(Total {activeFields.reduce((acc, f) => acc + (Number(f.length) || (f.raw_value ? String(f.raw_value).length : 0)), 0)} bytes)
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button disabled={viewPage === 1} onClick={() => setViewPage(p => p - 1)}
                      style={{ padding:"4px 12px", fontSize:11, borderRadius:4, border:"1px solid #cbd0d8", background: viewPage===1?"#f1f5f9":"#fff", cursor:viewPage===1?"not-allowed":"pointer" }}>
                      Previous
                    </button>
                    <button disabled={viewPage * 100 >= activeFields.length} onClick={() => setViewPage(p => p + 1)}
                      style={{ padding:"4px 12px", fontSize:11, borderRadius:4, border:"1px solid #cbd0d8", background: viewPage*100>=activeFields.length?"#f1f5f9":"#fff", cursor:viewPage*100>=activeFields.length?"not-allowed":"pointer" }}>
                      Next
                    </button>
                  </div>
                </div>
              )}
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
                  {mlPred.anomaly_detected ? "DETECTED" : "NORMAL"}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Score: {(mlPred.anomaly_score || 0).toFixed(4)}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Severity: {(mlPred.anomaly_severity || 0).toFixed(3)}
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
                  {(mlPred.fault_predicted || "unknown").toUpperCase().replace(/_/g," ")}
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Confidence: {((mlPred.fault_confidence || 0) * 100).toFixed(1)}%
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
                  {mlPred.current_power_kw || "—"} kW
                </div>
                <div style={{ fontSize:10, color:"#666" }}>
                  Potential saving: {mlPred.savings_pct || 0}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )})()}

    </div>
  );
}
