const SENSORS = [
  { key:"ambient_temp",       label:"Ambient Temp",     unit:"°C",  min:0,    max:60   },
  { key:"indoor_temp",        label:"Indoor Temp",      unit:"°C",  min:0,    max:60   },
  { key:"suction_pressure",   label:"Suction Press.",   unit:"bar", min:0,    max:12   },
  { key:"discharge_pressure", label:"Discharge Press.", unit:"bar", min:0,    max:35   },
  { key:"compressor_speed",   label:"Compressor",       unit:"RPM", min:0,    max:6000 },
  { key:"fan_speed",          label:"Fan Speed",        unit:"RPM", min:0,    max:2000 },
  { key:"power_consumption",  label:"Power",            unit:"kW",  min:0,    max:20   },
];

function MLCard({ tag, value, sub, alert, warn, info }) {
  const bg    = alert?"#fdecea":warn?"#fef3c7":info?"#eaf0fb":"#f5f7fa";
  const border= alert?"#fca5a5":warn?"#fcd34d":info?"#c8d9f5":"#e0e3e8";
  const color = alert?"#c0392b":warn?"#b45309":info?"#1a4fa0":"#0a0a0a";
  return (
    <div style={{ background:bg, border:`1px solid ${border}`,
      borderRadius:6, padding:12, marginBottom:6 }}>
      <div style={{ fontSize:10, fontWeight:600, color:"#999",
        letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>{tag}</div>
      <div style={{ fontSize:14, fontWeight:700, color,
        fontFamily:"'IBM Plex Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:"#999", marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function Chip({ label, ok, alert, warn }) {
  const bg    = alert?"#fdecea":ok?"#dcfce7":warn?"#fef3c7":"#f5f7fa";
  const border= alert?"#fca5a5":ok?"#bbf7d0":warn?"#fcd34d":"#e0e3e8";
  const color = alert?"#c0392b":ok?"#166534":warn?"#b45309":"#666";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5,
      padding:"4px 10px", borderRadius:4, fontSize:10, fontWeight:600,
      letterSpacing:"0.06em", textTransform:"uppercase",
      background:bg, color, border:`1px solid ${border}` }}>{label}</span>
  );
}

export default function Sidebar({ data }) {
  const a  = data?.ml_anomaly || {};
  const f  = data?.ml_fault   || {};
  const e  = data?.ml_energy  || {};
  const hs = data?.health_status || "healthy";
  const fault   = data?.fault_mode;
  const hasFault= fault && fault !== "none";
  const hasData = SENSORS.some(({ key }) =>
    data?.[key] !== undefined && data?.[key] !== null
  );

  return (
    <aside style={{ width:"100%", background:"#fff",
      borderRight:"1px solid #e0e3e8",
      overflowY:"auto", padding:16, flexShrink:0 }}>

      <div style={{ fontSize:10, fontWeight:600, color:"#999",
        letterSpacing:"0.1em", textTransform:"uppercase",
        marginBottom:10, paddingBottom:6, borderBottom:"1px solid #e0e3e8" }}>
        ML Analysis
      </div>

      <MLCard tag="Anomaly Detection"
        value={a.anomaly ? "ANOMALY DETECTED" : "NORMAL"}
        sub={`Score: ${(a.score||0).toFixed(4)}`}
        alert={a.anomaly} />

      <MLCard tag="Fault Classifier"
        value={!hasData ? "WAITING" : f.fault && f.fault!=="none" && f.fault!=="unknown"
          ? f.fault.toUpperCase().replace(/_/g," ") : "NONE"}
        sub={hasData ? `Confidence: ${((f.confidence||0)*100).toFixed(1)}%` : "No real reading yet"}
        alert={f.fault && f.fault!=="none" && f.fault!=="unknown"} />

      <MLCard tag="Energy Optimizer"
        value={`${e.current_power_kw||"--"} kW`}
        sub={`Potential saving: ${e.savings_pct||0}%`}
        info />

      {/* Severity bar */}
      {a.ready && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, color:"#999", marginBottom:4 }}>
            Anomaly Severity
          </div>
          <div style={{ height:4, background:"#e0e3e8",
            borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:2,
              width:`${Math.min(100,(a.severity||0)*100)}%`,
              background: a.anomaly ? "#c0392b" : "#166534",
              transition:"width 0.5s, background 0.3s" }} />
          </div>
        </div>
      )}

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
        <Chip label={hasFault ? fault.replace(/_/g," ") : "No Fault"}
          alert={hasFault} ok={!hasFault} />
        <Chip label={hs.charAt(0).toUpperCase()+hs.slice(1)}
          ok={hs==="healthy"} warn={hs==="warning"} alert={hs==="unhealthy"} />
      </div>

      <div style={{ fontSize:10, fontWeight:600, color:"#999",
        letterSpacing:"0.1em", textTransform:"uppercase",
        marginBottom:8, paddingBottom:6, borderBottom:"1px solid #e0e3e8" }}>
        Live Sensors
      </div>

      {SENSORS.map(s => {
        const v  = data?.[s.key];
        const hi = v !== undefined && v > s.max;
        const lo = v !== undefined && v < s.min;
        const bg    = hi?"#fdecea":lo?"#fef3c7":"transparent";
        const border= hi?"#fca5a5":lo?"#fcd34d":"transparent";
        const valColor = hi?"#c0392b":lo?"#b45309":"#0a0a0a";
        const dispVal = v !== undefined
          ? (typeof v==="number" ? v.toFixed(v>100?0:2) : v)
          : "--";

        return (
          <div key={s.key} style={{
            display:"flex", justifyContent:"space-between",
            alignItems:"center", padding:"6px 8px",
            borderRadius:4, marginBottom:2,
            background:bg, border:`1px solid ${border}`,
            transition:"all 0.25s", overflow:"hidden"
          }}>
            <span style={{ fontSize:11, color:"#666",
              whiteSpace:"nowrap", flexShrink:0, marginRight:6 }}>
              {s.label}
            </span>
            <span style={{
              fontFamily:"'IBM Plex Mono',monospace",
              fontSize:12, fontWeight:500,
              color: valColor, whiteSpace:"nowrap"
            }}>
              {dispVal}{s.unit ? ` ${s.unit}` : ""}
            </span>
          </div>
        );
      })}
    </aside>
  );
}
