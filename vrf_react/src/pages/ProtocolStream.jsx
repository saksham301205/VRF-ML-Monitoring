import { useState, useEffect, useRef } from "react";
import { buildRows, getHealth } from "../components/ProtocolTable";

const PROTO_DESC = {
  TOC:"Temperature Command", AMB:"Ambient Temperature", PRS:"Suction Pressure",
  DPS:"Discharge Pressure",  CMP:"Compressor Speed",    FAN:"Fan Speed",
  PWR:"Power Consumption",   SHT:"Superheat Temp",      SCL:"Subcooling Level",
  COP:"Coeff. of Performance",EVP:"Evaporator Temp",   CND:"Condenser Temp",
  ALM:"Alarm / Fault Status"
};

const TH = ({ children }) => (
  <th style={{
    padding:"9px 12px", textAlign:"left", fontSize:10, fontWeight:600,
    letterSpacing:"0.08em", textTransform:"uppercase", color:"#999",
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap",
    background:"#f5f7fa", position:"sticky", top:0, zIndex:1
  }}>{children}</th>
);

export default function ProtocolStream({ data }) {
  const [packets, setPackets]   = useState([]);
  const [paused,  setPaused]    = useState(false);
  const [filter,  setFilter]    = useState("ALL");
  const [search,  setSearch]    = useState("");
  const seqRef  = useRef(0);
  const tableRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!data || paused) return;
    const ts = new Date().toLocaleTimeString();
    const rows = buildRows(data).map(r => ({ ...r, seq: ++seqRef.current, ts }));
    setPackets(p => [...rows, ...p].slice(0, 500));
  }, [data]);

  useEffect(() => {
    if (autoScroll && tableRef.current && !paused) {
      tableRef.current.scrollTop = 0;
    }
  }, [packets]);

  const PROTOCOLS = ["ALL", "TOC","AMB","PRS","DPS","CMP","FAN","PWR","SHT","SCL","COP","EVP","CND","ALM"];

  const visible = packets.filter(r => {
    if (filter !== "ALL" && r.proto !== filter) return false;
    if (search && !r.raw.toLowerCase().includes(search.toLowerCase()) &&
        !r.proto.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const healthCounts = packets.reduce((acc, r) => {
    const h = getHealth(r);
    acc[h] = (acc[h] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:20, gap:12 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:"#0a0a0a" }}>Protocol Stream</h2>
          <p style={{ fontSize:11, color:"#999", marginTop:2 }}>Live VRF serial protocol aggregation</p>
        </div>

        {/* Stats chips */}
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {[
            { label:"Total", val: packets.length, bg:"#eaf0fb", color:"#1a4fa0", border:"#c8d9f5" },
            { label:"Healthy", val: healthCounts.ok||0, bg:"#dcfce7", color:"#166534", border:"#bbf7d0" },
            { label:"Warning", val: healthCounts.warn||0, bg:"#fef3c7", color:"#b45309", border:"#fcd34d" },
            { label:"Fault",   val: healthCounts.bad||0, bg:"#fdecea", color:"#c0392b", border:"#fca5a5" },
          ].map(s => (
            <div key={s.label} style={{
              background:s.bg, border:`1px solid ${s.border}`,
              borderRadius:6, padding:"6px 12px", textAlign:"center"
            }}>
              <div style={{ fontSize:16, fontWeight:700, color:s.color, fontFamily:"'IBM Plex Mono',monospace" }}>{s.val}</div>
              <div style={{ fontSize:9, color:s.color, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls bar */}
      <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0, flexWrap:"wrap" }}>
        {/* Protocol filter */}
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{
          fontSize:11, padding:"6px 10px", borderRadius:4,
          border:"1px solid #cbd0d8", background:"#fff", cursor:"pointer"
        }}>
          {PROTOCOLS.map(p => <option key={p} value={p}>{p === "ALL" ? "All Protocols" : p}</option>)}
        </select>

        {/* Search */}
        <input
          type="text" placeholder="Search raw string..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            fontSize:11, padding:"6px 10px", borderRadius:4,
            border:"1px solid #cbd0d8", background:"#fff",
            fontFamily:"'IBM Plex Mono',monospace", width:180
          }}
        />

        <div style={{ width:1, height:20, background:"#e0e3e8" }} />

        {/* Pause/Resume */}
        <button onClick={() => setPaused(p => !p)} style={{
          padding:"6px 14px", borderRadius:4, fontSize:11, fontWeight:500,
          cursor:"pointer", border:"1px solid #cbd0d8",
          background: paused ? "#1a4fa0" : "#fff",
          color: paused ? "#fff" : "#333"
        }}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        {/* Auto scroll */}
        <button onClick={() => setAutoScroll(a => !a)} style={{
          padding:"6px 14px", borderRadius:4, fontSize:11, fontWeight:500,
          cursor:"pointer", border:"1px solid #cbd0d8",
          background: autoScroll ? "#dcfce7" : "#fff",
          color: autoScroll ? "#166534" : "#333"
        }}>
          {autoScroll ? "↑ Auto-scroll ON" : "↑ Auto-scroll OFF"}
        </button>

        {/* Clear */}
        <button onClick={() => { setPackets([]); seqRef.current = 0; }} style={{
          padding:"6px 14px", borderRadius:4, fontSize:11, fontWeight:500,
          cursor:"pointer", border:"1px solid #fca5a5",
          background:"#fff", color:"#c0392b"
        }}>
          Clear
        </button>

        <span style={{ fontSize:11, color:"#999", marginLeft:"auto" }}>
          {visible.length} / {packets.length} packets
          {paused && <span style={{ color:"#b45309", fontWeight:600, marginLeft:8 }}>● PAUSED</span>}
        </span>
      </div>

      {/* Table */}
      <div ref={tableRef} style={{
        flex:1, overflowY:"auto", overflowX:"auto",
        background:"#fff", border:"1px solid #e0e3e8",
        borderRadius:8, boxShadow:"0 1px 3px rgba(0,0,0,0.04)"
      }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <TH>#</TH>
              <TH>Raw String</TH>
              <TH>Protocol</TH>
              <TH>Description</TH>
              <TH>Value</TH>
              <TH>Unit</TH>
              <TH>Status</TH>
              <TH>Health</TH>
              <TH>Time</TH>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign:"center", padding:40,
                  color:"#999", fontSize:12 }}>
                  {packets.length === 0 ? "Waiting for data stream..." : "No packets match filter"}
                </td>
              </tr>
            ) : visible.map((row, i) => {
              const h = getHealth(row);
              const vDisp = row.isAlm
                ? row.v
                : (typeof row.v === "number" ? row.v.toFixed(row.v > 100 ? 0 : 2) : "--");
              const statusCode = row.raw.slice(7, 9);
              const scColor = statusCode==="AA" ? "#166534" : statusCode==="ER" ? "#c0392b" : "#b45309";
              const hBg     = h==="bad" ? "#fdecea" : h==="warn" ? "#fef3c7" : "#dcfce7";
              const hColor  = h==="bad" ? "#c0392b" : h==="warn" ? "#b45309" : "#166534";
              const hBorder = h==="bad" ? "#fca5a5" : h==="warn" ? "#fcd34d" : "#bbf7d0";
              const hLabel  = h==="bad" ? "Fault"   : h==="warn" ? "Warning" : "Healthy";
              const rowBg   = h==="bad" ? "rgba(253,238,234,0.3)" : h==="warn" ? "rgba(254,243,199,0.3)" : "";

              return (
                <tr key={i} style={{ borderBottom:"1px solid #e0e3e8", background:rowBg, transition:"background 0.12s" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f5f7fa"}
                  onMouseLeave={e => e.currentTarget.style.background=rowBg}>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999", fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{row.seq}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#333", fontFamily:"'IBM Plex Mono',monospace", borderRight:"1px solid #e0e3e8" }}>{row.raw}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#1a4fa0", fontWeight:600, fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{row.proto}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#666", borderRight:"1px solid #e0e3e8" }}>{PROTO_DESC[row.proto] || row.proto}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, fontWeight:600, color: h==="bad"?"#c0392b":h==="warn"?"#b45309":"#0a0a0a", fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{vDisp}</td>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999", borderRight:"1px solid #e0e3e8" }}>{row.unit}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, fontWeight:600, color:scColor, fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{statusCode}</td>
                  <td style={{ padding:"7px 12px", borderRight:"1px solid #e0e3e8" }}>
                    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:3, fontSize:9, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", background:hBg, color:hColor, border:`1px solid ${hBorder}` }}>{hLabel}</span>
                  </td>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999", fontFamily:"monospace" }}>{row.ts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}