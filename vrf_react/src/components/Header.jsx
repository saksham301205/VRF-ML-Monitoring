const TABS = [
  { id: "live",     label: "Live Monitor" },
  { id: "protocol", label: "Protocol Stream" },
  { id: "history",  label: "History" },
  { id: "analytics",label: "Analytics" },
];

export default function Header({ tab, setTab, live }) {
  return (
    <header style={{
      background:"#fff", borderBottom:"1px solid #e0e3e8",
      height:56, display:"flex", alignItems:"center",
      justifyContent:"space-between", padding:"0 24px",
      position:"sticky", top:0, zIndex:100,
      boxShadow:"0 1px 3px rgba(0,0,0,0.06)", flexShrink:0
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:14, fontWeight:700, color:"#0a0a0a", letterSpacing:"-0.01em" }}>
          VRF <span style={{ color:"#1a4fa0" }}>INTEL</span>
        </span>
        <div style={{ width:1, height:20, background:"#cbd0d8" }} />
        <span style={{ fontSize:11, color:"#999" }}>Monitoring Dashboard</span>
        <div style={{ display:"flex", alignItems:"center", gap:5,
          padding:"3px 10px", borderRadius:20,
          background: live ? "#dcfce7" : "#fdecea",
          border:`1px solid ${live ? "#bbf7d0" : "#fca5a5"}` }}>
          <div style={{
            width:6, height:6, borderRadius:"50%",
            background: live ? "#166534" : "#c0392b",
            animation: live ? "blink 1.5s infinite" : "none"
          }} />
          <span style={{ fontSize:10, fontWeight:600,
            color: live ? "#166534" : "#c0392b", letterSpacing:"0.06em" }}>
            {live ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      <nav style={{ display:"flex" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"0 18px", height:56, border:"none", background:"none",
            cursor:"pointer", fontSize:12, fontWeight:500,
            color: tab===t.id ? "#1a4fa0" : "#666",
            borderBottom:`2px solid ${tab===t.id ? "#1a4fa0" : "transparent"}`,
            transition:"all 0.15s"
          }}>{t.label}</button>
        ))}
      </nav>

      <img
        src="https://www.bluestarindia.com/img/logo.png"
        alt="Blue Star"
        style={{ height:34, objectFit:"contain", marginLeft:8 }}
        onError={e => { e.target.onerror=null; e.target.src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Blue_Star_primary_logo.png"; }}
      />

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </header>
  );
}