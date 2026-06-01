import { useState } from "react";

const Btn = ({ children, onClick, variant="default" }) => {
  const styles = {
    default: { background:"#fff", color:"#333", border:"1px solid #cbd0d8" },
    primary: { background:"#1a4fa0", color:"#fff", border:"1px solid #1a4fa0" },
    danger:  { background:"#fff", color:"#c0392b", border:"1px solid #fca5a5" },
  };
  return (
    <button onClick={onClick} style={{
      ...styles[variant],
      fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:500,
      padding:"6px 14px", borderRadius:4, cursor:"pointer",
      transition:"all 0.15s"
    }}
    onMouseEnter={e => { e.currentTarget.style.opacity="0.85"; }}
    onMouseLeave={e => { e.currentTarget.style.opacity="1"; }}>
      {children}
    </button>
  );
};

const Sep = () => <div style={{ width:1, height:20, background:"#e0e3e8", margin:"0 4px" }} />;
const Lbl = ({ children }) => <span style={{ fontSize:11, color:"#999", whiteSpace:"nowrap" }}>{children}</span>;

const Sel = ({ children, value, onChange }) => (
  <select value={value} onChange={e=>onChange(e.target.value)} style={{
    fontFamily:"Inter,sans-serif", fontSize:11,
    background:"#fff", color:"#333",
    border:"1px solid #cbd0d8", borderRadius:4,
    padding:"6px 10px", cursor:"pointer"
  }}>{children}</select>
);

export default function Controls({
  streaming, onInjectFault, onClearFault,
  onSetSetpoint, onRetrain, onToggleStream, onExportCSV
}) {
  const [fault,    setFault]    = useState("refrigerant_leak");
  const [severity, setSeverity] = useState("0.6");
  const [setpoint, setSetpoint_] = useState(24);
  const [toast,    setToast]    = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  return (
    <div style={{ padding:"12px 20px", borderTop:"1px solid #e0e3e8",
      background:"#fff", display:"flex", gap:8, alignItems:"center",
      flexWrap:"wrap", flexShrink:0 }}>

      <Lbl>Inject Fault:</Lbl>
      <Sel value={fault} onChange={setFault}>
        <option value="refrigerant_leak">Refrigerant Leak</option>
        <option value="compressor_overload">Compressor Overload</option>
        <option value="dirty_filter">Dirty Filter</option>
        <option value="sensor_drift">Sensor Drift</option>
      </Sel>
      <Sel value={severity} onChange={setSeverity}>
        <option value="0.3">Low</option>
        <option value="0.6">Medium</option>
        <option value="0.9">High</option>
      </Sel>
      <Btn variant="danger" onClick={() => {
        onInjectFault(fault, parseFloat(severity));
        showToast(`Fault injected: ${fault.replace(/_/g," ")}`);
      }}>Inject Fault</Btn>
      <Btn onClick={() => { onClearFault(); showToast("Fault cleared"); }}>Clear Fault</Btn>

      <Sep />

      <Lbl>Setpoint:</Lbl>
      <input type="range" min={18} max={30} step={0.5} value={setpoint}
        style={{ accentColor:"#1a4fa0", width:80, cursor:"pointer" }}
        onChange={e => { setSetpoint_(parseFloat(e.target.value)); onSetSetpoint(parseFloat(e.target.value)); }} />
      <Lbl>{setpoint}°C</Lbl>

      <Sep />

      <Btn variant="primary" onClick={() => { onRetrain(); showToast("Retraining ML models..."); }}>Retrain ML</Btn>
      <Btn onClick={() => { onToggleStream(); showToast(streaming ? "Stream paused" : "Stream resumed"); }}>
        {streaming ? "Pause" : "Resume"}
      </Btn>
      <Btn onClick={() => { onExportCSV(); showToast("Exported to CSV"); }}>Export CSV</Btn>

      {toast && (
        <div style={{ position:"fixed", bottom:20, right:20,
          padding:"10px 16px", borderRadius:6, fontSize:12, fontWeight:500,
          background:"#0a0a0a", color:"#fff",
          boxShadow:"0 4px 12px rgba(0,0,0,0.15)", zIndex:9999,
          animation:"fadeIn 0.2s ease" }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}