import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { Copy, Play, RefreshCw, Search } from "lucide-react";

const TH = ({ children }) => (
  <th style={{
    padding:"9px 12px", textAlign:"left", fontSize:10, fontWeight:600,
    letterSpacing:"0.06em", textTransform:"uppercase", color:"#999",
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap",
    background:"#f5f7fa", position:"sticky", top:0, zIndex:1
  }}>{children}</th>
);

const TD = ({ children, mono=false, tone }) => (
  <td style={{
    padding:"8px 12px", fontSize:11, color:tone||"#333",
    fontFamily:mono?"'IBM Plex Mono',Consolas,monospace":"Inter,sans-serif",
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap", verticalAlign:"top"
  }}>{children}</td>
);

function parsePayload(row) {
  if (!row?.parsed_json) return {};
  if (typeof row.parsed_json === "object") return row.parsed_json;
  try { return JSON.parse(row.parsed_json); } catch { return {}; }
}

function firstReadingValue(reading={}) {
  const fields = ["ambient_temp","indoor_temp","suction_pressure","discharge_pressure",
    "compressor_speed","fan_speed","power_consumption","superheat",
    "subcooling","cop","evap_temp","cond_temp","fault_mode"];
  for (const key of fields) {
    if (reading[key] !== null && reading[key] !== undefined)
      return `${key.replace(/_/g," ")}: ${reading[key]}`;
  }
  return "--";
}

function frameSummary(row) {
  const payload = parsePayload(row);
  const directValue = payload.value !== undefined
    ? `${payload.value}${payload.unit ? ` ${payload.unit}` : ""}`
    : firstReadingValue(payload.reading);
  return {
    parser:   payload.parser || "--",
    protocol: payload.protocol || payload.frame_name || row.frame_name || "--",
    value:    row.value_summary || directValue || "--",
    status:   payload.status_code || payload.status_label || (row.parsed_ok ? "parsed" : "failed"),
    health:   payload.health || (row.parsed_ok ? "healthy" : "unhealthy"),
  };
}

function compactRaw(raw) {
  if (!raw) return "--";
  return raw;
}

function isMeaningfulField(field) {
  const name = `${field.parameter_name || ""} ${field.parameter || ""} ${field.field_key || ""}`.toLowerCase();
  return field.value_type === "number" ||
    Boolean(field.decoded_label) ||
    /temp|pressure|rpm|speed|power|current|voltage|frequency|fan|compressor|suction|discharge|toc|tamb|tgas|tliq|rps|pwr/.test(name);
}

function resultFields(result) {
  return (result?.frames||[]).flatMap((frame, frameIndex) => {
    if (Array.isArray(frame.fields) && frame.fields.length) {
      return frame.fields.filter(f=>f.present).map(field=>({
        frameIndex,
        frame: frame.frame_name || frame.protocol || "--",
        parameter_name: field.parameter,
        byte_no: field.byte_no,
        raw_value: field.raw_value,
        decoded_value: field.decoded_value,
        decoded_label: field.decoded_label,
        value_type: field.value_type,
      }));
    }
    if (frame.parser === "legacy_demo") {
      return [{ frameIndex, frame:frame.protocol, parameter_name:frame.name,
        byte_no:"--", raw_value:frame.raw_value, decoded_value:frame.value,
        decoded_label:frame.status_label, value_type:"number" }];
    }
    return [];
  });
}

function Stat({ label, value, tone="#1a4fa0", bg="#eaf0fb", border="#c8d9f5" }) {
  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:6,
      minWidth:72, padding:"8px 10px", textAlign:"center" }}>
      <div style={{ fontSize:18, fontWeight:700, color:tone,
        fontFamily:"'IBM Plex Mono',monospace" }}>{value}</div>
      <div style={{ fontSize:9, color:tone, fontWeight:700,
        textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</div>
    </div>
  );
}

export default function ProtocolStream({ API, serial, onIngest }) {
  const [frames,      setFrames]      = useState([]);
  const [fields,      setFields]      = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [lastResult,  setLastResult]  = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [parsing,     setParsing]     = useState(false);
  const [error,       setError]       = useState("");
  const [parseMsg,    setParseMsg]    = useState("");
  const [filter,      setFilter]      = useState("ALL");
  const [search,      setSearch]      = useState("");
  const [copied,      setCopied]      = useState(null);
  const prevDataId = useRef(null);
  const fieldsForId = useRef(null);

  const load = useCallback(async () => {
    try {
      const frameRes = await axios.get(`${API}/api/db/protocol_frames?limit=200`);
      const newFrames = frameRes.data || [];
      const currentLatestId = newFrames.length > 0 ? newFrames[0].id : null;
      if (currentLatestId !== prevDataId.current || prevDataId.current === null) {
        setFrames(newFrames);
        prevDataId.current = currentLatestId;
      }

      if (currentLatestId && currentLatestId !== fieldsForId.current) {
        setFieldsLoading(true);
        axios.get(`${API}/api/db/protocol_fields?limit=200`)
          .then(fieldRes => {
            setFields(fieldRes.data || []);
            fieldsForId.current = currentLatestId;
          })
          .catch(err => setError(err.message || "Failed to load decoded fields."))
          .finally(() => setFieldsLoading(false));
      }
      setError("");
    } catch(err) {
      setError(err.message||"Failed to load protocol data.");
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000); // Increased polling to 15s to reduce database load
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const handler = (e) => {
      const frames = (e.detail && e.detail.frames) || [];
      if (!frames || !frames.length) return;
      // Prepend new frames and keep cap
        setFrames(prev => {
        const merged = [...frames, ...prev];
        return merged.slice(0, 200);
      });
    };
    window.addEventListener("protocol_parsed", handler);
    return () => window.removeEventListener("protocol_parsed", handler);
  }, []);

  const protocols = useMemo(() => {
    const names = new Set(["ALL"]);
    frames.forEach(row => names.add(frameSummary(row).protocol));
    return [...names].filter(Boolean);
  }, [frames]);

  const visibleFrames = useMemo(() => {
    return frames.filter(row => {
      const summary = frameSummary(row);
      const haystack = `${row.raw_string||""} ${summary.protocol} ${summary.parser} ${summary.value}`.toLowerCase();
      if (filter !== "ALL" && summary.protocol !== filter) return false;
      if (search && !haystack.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [filter, frames, search]);

  const lastResultFields = useMemo(() => resultFields(lastResult), [lastResult]);
  const decodedFields = useMemo(() => {
    const base = lastResultFields.length ? lastResultFields : fields;
    const meaningful = base.filter(isMeaningfulField);
    return meaningful.length ? meaningful : base;
  }, [fields, lastResultFields]);

  const parsedCount = frames.filter(row => Number(row.parsed_ok)).length;
  const failedCount = frames.length - parsedCount;
  const serialLabel = serial?.connected
    ? `${serial.status?.path||serial.selectedPort||"COM"} connected`
    : "Serial disconnected";

  // ── Copy raw string into parse box ──────────────────────────────────
  const copyToParseBox = (rawString) => {
    if (!rawString || rawString === "--") return;
    setManualInput(prev => prev ? `${prev}\n${rawString}` : rawString);
    setCopied(rawString);
    setTimeout(() => setCopied(null), 1500);
    // Scroll to parse box
    document.getElementById("parse-box")?.scrollIntoView({ behavior:"smooth" });
  };

  const parseManual = async () => {
    if (!manualInput.trim()) return;
    setParsing(true);
    setError("");
    setParseMsg("");
    try {
      const result = await onIngest({ raw_batch: manualInput }, "manual");
      setLastResult(result);
      setManualInput("");
      setParseMsg(`Parsed ${result.successful || 0} frame(s), ${result.failed || 0} failed`);
      
      // Auto-clear lastResult highlighting after a few seconds
      setTimeout(() => setLastResult(null), 8000);
      setTimeout(() => setParseMsg(""), 6000);
      
      prevDataId.current = null;
      fieldsForId.current = null;
      await load();
    } catch(err) {
      setError(err?.response?.data?.error||err.message||"Protocol parse failed.");
    } finally {
      setParsing(false);
    }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column",
      overflow:"hidden", padding:20, gap:12 }}>
      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(22, 101, 52, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(22, 101, 52, 0); }
          100% { box-shadow: 0 0 0 0 rgba(22, 101, 52, 0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:"flex", alignItems:"flex-start",
        justifyContent:"space-between", gap:12, flexShrink:0 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:"#0a0a0a" }}>Protocol Stream</h2>
          <p style={{ fontSize:11, color:"#999", marginTop:2 }}>
            Real serial and manual protocol parsing
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Stat label="Frames" value={frames.length} />
          <Stat label="Parsed" value={parsedCount}
            tone="#166534" bg="#dcfce7" border="#bbf7d0" />
          <Stat label="Failed" value={failedCount}
            tone="#c0392b" bg="#fdecea" border="#fca5a5" />
        </div>
      </div>

      {/* ── Filter ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr",
        gap:12, flexShrink:0 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center", fontSize:11, color:"#666" }}>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace",
            color: serial?.connected ? "#166534" : "#999" }}>
            {serialLabel}
          </span>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ position:"relative" }}>
              <Search size={13} style={{ position:"absolute", left:8, top:7, color:"#999" }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter frames"
                style={{
                  width:180, padding:"6px 8px 6px 27px",
                  border:"1px solid #cbd0d8", borderRadius:4,
                  fontSize:11, color:"#333"
                }}
              />
            </div>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{
              padding:"6px 8px", border:"1px solid #cbd0d8",
              borderRadius:4, fontSize:11, background:"#fff", color:"#333"
            }}>
              {protocols.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button onClick={() => { prevDataId.current=null; fieldsForId.current=null; load(); }}
              style={{ display:"inline-flex", alignItems:"center", gap:6,
                padding:"6px 10px", borderRadius:4, border:"1px solid #cbd0d8",
                background:"#fff", color:"#333", fontSize:11, cursor:"pointer" }}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Parse command */}
      <div id="parse-box" style={{
        background:"#fff", border:"1px solid #d8dee8", borderRadius:8,
        padding:10, display:"grid", gridTemplateColumns:"1fr auto",
        gap:10, alignItems:"stretch", flexShrink:0,
        boxShadow:"0 1px 3px rgba(0,0,0,0.04)"
      }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#0a0a0a" }}>Parse Command</span>
            {parseMsg && <span style={{ fontSize:10, color:"#166534", fontWeight:600 }}>{parseMsg}</span>}
            {error && <span style={{ fontSize:10, color:"#c0392b", fontWeight:600 }}>{error}</span>}
          </div>
          <textarea
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="Paste raw frame(s), e.g. *PC0C0101E0180A0#"
            style={{
              minHeight:42, maxHeight:90, resize:"vertical",
              border:"1px solid #cbd0d8", borderRadius:4,
              padding:"8px 10px", fontSize:11,
              fontFamily:"'IBM Plex Mono',Consolas,monospace"
            }}
          />
        </div>
        <button onClick={parseManual} disabled={!manualInput.trim() || parsing} style={{
          alignSelf:"end", display:"inline-flex", alignItems:"center", gap:7,
          padding:"9px 14px", height:36, borderRadius:4,
          border:`1px solid ${manualInput.trim() ? "#1a4fa0" : "#cbd0d8"}`,
          background: manualInput.trim() ? "#1a4fa0" : "#f5f7fa",
          color: manualInput.trim() ? "#fff" : "#999",
          cursor: manualInput.trim() && !parsing ? "pointer" : "not-allowed",
          fontSize:11, fontWeight:700, whiteSpace:"nowrap"
        }}>
          <Play size={14} /> {parsing ? "Parsing..." : "Parse"}
        </button>
      </div>

      {/* Tables */}
      <div style={{ flex:1, overflow:"hidden", display:"grid",
        gridTemplateRows:"minmax(240px,1fr) minmax(160px,0.72fr)", gap:12 }}>

        {/* Raw frames table */}
        <div style={{ overflow:"auto", background:"#fff", border:"1px solid #e0e3e8",
          borderRadius:8, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <TH>ID</TH><TH>Time</TH><TH>Source</TH><TH>Action</TH>
                <TH>Raw String</TH><TH>Protocol</TH><TH>Decoded Values</TH>
                <TH>Status</TH><TH>Health</TH><TH>Fields</TH>
              </tr>
            </thead>
            <tbody>
              {loading && frames.length === 0 ? (
                <tr><td colSpan={10} style={{ padding:28, color:"#999", fontSize:12 }}>
                  Loading...
                </td></tr>
              ) : visibleFrames.length === 0 ? (
                <tr><td colSpan={10} style={{ padding:28, color:"#999", fontSize:12 }}>
                  No protocol frames yet — connect COM port or paste a frame above
                </td></tr>
              ) : visibleFrames.map(row => {
                const summary = frameSummary(row);
                const ok = Number(row.parsed_ok);
                const isCopied = copied === row.raw_string;
                return (
                  <tr key={row.id} style={{ borderBottom:"1px solid #e0e3e8",
                    background: isCopied ? "#eaf0fb" : undefined,
                    transition:"background 0.3s" }}
                    onMouseEnter={e => !isCopied && (e.currentTarget.style.background="#f5f7fa")}
                    onMouseLeave={e => !isCopied && (e.currentTarget.style.background="")}>

                    <TD mono>{row.id}</TD>
                    <TD mono>{row.timestamp}</TD>
                    <TD>{row.source}</TD>
                    <TD>
                      <button onClick={() => copyToParseBox(row.raw_string)}
                        disabled={!row.raw_string}
                        title="Copy raw frame into parse box"
                        style={{
                          display:"inline-flex", alignItems:"center", gap:5,
                          padding:"5px 10px", borderRadius:4,
                          border:`1px solid ${row.raw_string ? "#1a4fa0" : "#cbd0d8"}`,
                          background: row.raw_string ? "#1a4fa0" : "#f5f7fa",
                          color: row.raw_string ? "#fff" : "#999",
                          cursor: row.raw_string ? "pointer" : "not-allowed",
                          fontSize:10, fontWeight:700, transition:"all 0.2s"
                        }}>
                        <Copy size={12} /> {isCopied ? "✓" : "Copy"}
                      </button>
                    </TD>
                    <TD mono style={{fontSize:10, fontFamily:"'IBM Plex Mono',monospace", maxWidth:250, wordBreak:"break-all"}}>{compactRaw(row.raw_string)}</TD>
                    <TD mono tone="#1a4fa0">{summary.protocol}</TD>
                    <TD mono tone={summary.value !== "--" ? "#166534" : "#999"}>{summary.value}</TD>
                    <TD tone={ok ? "#166534" : "#c0392b"}>
                      <span style={{
                        display:"inline-block", padding:"2px 8px", borderRadius:3,
                        fontSize:9, fontWeight:700, letterSpacing:"0.06em",
                        textTransform:"uppercase",
                        background: ok ? "#dcfce7" : "#fdecea",
                        color:      ok ? "#166534" : "#c0392b",
                        border:`1px solid ${ok ? "#bbf7d0" : "#fca5a5"}`
                      }}>
                        {ok ? summary.status : row.error || "failed"}
                      </span>
                    </TD>
                    <TD>
                      <span style={{
                        display:"inline-block", padding:"2px 8px", borderRadius:3,
                        fontSize:9, fontWeight:700, textTransform:"uppercase",
                        background: summary.health==="healthy" ? "#dcfce7" : "#fdecea",
                        color:      summary.health==="healthy" ? "#166534" : "#c0392b",
                        border:`1px solid ${summary.health==="healthy" ? "#bbf7d0" : "#fca5a5"}`
                      }}>
                        {summary.health}
                      </span>
                    </TD>
                    <TD mono>{row.present_field_count ?? "--"}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Decoded fields - Structured Box UI */}
        <div style={{ overflow:"auto", background:"#fff", border: lastResult ? "2px solid #22c55e" : "1px solid #e0e3e8",
          borderRadius:8, boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
          animation: lastResult ? "pulseGlow 2s infinite" : "none", transition: "border 0.3s" }}>
          <div style={{ padding:"12px 14px", borderBottom:"1px solid #e0e3e8",
            background: lastResult ? "#dcfce7" : "#f5f7fa", display:"flex", alignItems:"center", gap:8,
            transition: "background 0.3s" }}>
            <span style={{ fontSize:12, fontWeight:700, color: lastResult ? "#166534" : "#0a0a0a" }}>
              ◇ Decoded Values
            </span>
            {fieldsLoading && (
              <span style={{ fontSize:10, color:"#999" }}>Loading decoded fields...</span>
            )}
            {lastResult && (
              <span style={{ fontSize:10, color:"#fff", fontWeight:600,
                background:"#166534", padding:"3px 10px", borderRadius:3,
                animation: "slideDown 0.3s ease-out" }}>
                {lastResultFields.length} fields parsed
              </span>
            )}
          </div>
          <div style={{ padding:"12px 14px", overflowY:"auto", maxHeight:200 }}>
            {decodedFields.length === 0 ? (
              <div style={{ padding:24, color:"#999", fontSize:12, textAlign:"center" }}>
                No decoded fields yet — parse a frame above to see results here
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:10 }}>
                {decodedFields.slice(0, 50).map((field, index) => {
                  const frameLabel = field.frame||field.frame_name||field.sheet_name||"Frame";
                  const paramName = field.parameter_name || field.field_key || "Unknown";
                  const rawVal = field.raw_value ?? "--";
                  const decodedVal = field.decoded_value ?? "--";
                  const label = field.decoded_label || "";
                  const type = field.value_type || "text";
                  const isBad = type === "number" && decodedVal === "--";
                  
                  return (
                    <div key={`${field.frame_id||field.frameIndex||0}-${index}`}
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
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
