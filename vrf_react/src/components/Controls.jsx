import { useState } from "react";
import { Cable, Download, RefreshCw, Send, Square, Zap } from "lucide-react";

const Btn = ({ children, onClick, variant = "default", disabled = false, title }) => {
  const styles = {
    default: { background:"#fff", color:"#333", border:"1px solid #cbd0d8" },
    primary: { background:"#1a4fa0", color:"#fff", border:"1px solid #1a4fa0" },
    danger:  { background:"#fff", color:"#c0392b", border:"1px solid #fca5a5" },
  };
  return (
    <button disabled={disabled} title={title} onClick={disabled ? undefined : onClick} style={{
      ...styles[variant],
      fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:500,
      padding:"6px 14px", borderRadius:4, cursor:disabled ? "not-allowed" : "pointer",
      transition:"all 0.15s", opacity:disabled ? 0.55 : 1,
      display:"inline-flex", alignItems:"center", gap:6, minHeight:30
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.85"; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = "1"; }}>
      {children}
    </button>
  );
};

const Sep = () => <div style={{ width:1, height:20, background:"#e0e3e8", margin:"0 4px" }} />;
const Lbl = ({ children }) => <span style={{ fontSize:11, color:"#999", whiteSpace:"nowrap" }}>{children}</span>;

const Sel = ({ children, value, onChange, disabled = false, minWidth = 0 }) => (
  <select disabled={disabled} value={value} onChange={e => onChange(e.target.value)} style={{
    fontFamily:"Inter,sans-serif", fontSize:11,
    background:"#fff", color:"#333",
    border:"1px solid #cbd0d8", borderRadius:4,
    padding:"6px 10px", cursor:disabled ? "not-allowed" : "pointer",
    opacity:disabled ? 0.6 : 1, minWidth
  }}>{children}</select>
);

export default function Controls({ serial, onRetrain, onExportCSV }) {
  const [toast, setToast] = useState("");
  const [tx, setTx] = useState("");

  const ports = serial?.ports || [];
  const serialAvailable = Boolean(serial?.available);
  const serialConnected = Boolean(serial?.connected);
  const serialBusy = Boolean(serial?.busy);
  const selectedPort = serial?.selectedPort || "";
  const pollingSeconds = serial?.pollingSeconds || 2;
  const latestText = serial?.latestData?.text?.trim();
  const latestHex = serial?.latestData?.hex;
  const serialStatus = serial?.error
    || (latestText ? `RX ${latestText}` : latestHex ? `RX ${latestHex}` : "")
    || (serialConnected ? "Connected" : serialAvailable ? `${ports.length} port${ports.length === 1 ? "" : "s"}` : "Desktop serial unavailable");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  return (
    <div style={{ padding:"12px 20px", borderTop:"1px solid #e0e3e8",
      background:"#fff", display:"flex", gap:8, alignItems:"center",
      flexWrap:"wrap", flexShrink:0 }}>

      <Lbl>COM Port:</Lbl>
      <Sel
        value={selectedPort}
        disabled={!serialAvailable || serialConnected}
        onChange={serial?.setSelectedPort}
        minWidth={230}
      >
        <option value="">Select port...</option>
        {ports.length === 0 && <option value="" disabled>No ports detected</option>}
        {ports.map(port => (
          <option key={port.path} value={port.path}>{port.label || port.path}</option>
        ))}
      </Sel>
      <Btn
        title="Refresh ports"
        disabled={!serialAvailable || serialBusy}
        onClick={async () => {
          await serial.refreshPorts();
          showToast("Ports refreshed");
        }}
      >
        <RefreshCw size={13} /> Refresh
      </Btn>
      <Sel
        value={String(serial?.baudRate || 9600)}
        disabled={!serialAvailable || serialConnected}
        onChange={(value) => serial?.setBaudRate(Number(value))}
      >
        <option value="9600">9600</option>
        <option value="19200">19200</option>
        <option value="38400">38400</option>
        <option value="57600">57600</option>
        <option value="115200">115200</option>
      </Sel>
      <Lbl>Poll:</Lbl>
      <input
        type="range"
        min={2}
        max={30}
        step={1}
        value={pollingSeconds}
        disabled={!serialAvailable}
        style={{ accentColor:"#1a4fa0", width:92, cursor:serialAvailable ? "pointer" : "not-allowed" }}
        onChange={e => serial?.setPollingSeconds(Number(e.target.value))}
      />
      <Lbl>{pollingSeconds}s</Lbl>
      <Btn
        variant={serialConnected ? "danger" : "primary"}
        disabled={!serialAvailable || serialBusy || (!serialConnected && !selectedPort)}
        onClick={async () => {
          if (serialConnected) {
            await serial.disconnect();
            showToast("Serial port disconnected");
          } else {
            await serial.connect();
            showToast("Serial port connected");
          }
        }}
      >
        {serialConnected ? <Square size={13} /> : <Cable size={13} />}
        {serialConnected ? "Disconnect" : "Connect"}
      </Btn>
      <input
        value={tx}
        disabled={!serialConnected}
        placeholder="TX"
        onChange={e => setTx(e.target.value)}
        style={{
          width:90, fontFamily:"Inter,sans-serif", fontSize:11,
          border:"1px solid #cbd0d8", borderRadius:4, padding:"7px 9px",
          opacity:serialConnected ? 1 : 0.55
        }}
      />
      <Btn
        title="Send serial text"
        disabled={!serialConnected || !tx.trim()}
        onClick={async () => {
          await serial.write(tx);
          setTx("");
          showToast("Serial text sent");
        }}
      >
        <Send size={13} /> Send
      </Btn>
      <div title={latestHex || serialStatus} style={{
        maxWidth:260, minWidth:140, overflow:"hidden", textOverflow:"ellipsis",
        whiteSpace:"nowrap", fontSize:11, color:serial?.error ? "#c0392b" : "#4b5563",
        background:serialConnected ? "#eef6ff" : "#f8fafc",
        border:"1px solid #dbe3ea", borderRadius:4, padding:"7px 10px",
        fontFamily:"Consolas, 'Courier New', monospace"
      }}>
        {serialStatus}
      </div>

      <Sep />

      <Btn variant="primary" onClick={async () => {
        try {
          await onRetrain();
          showToast("Retrained from real readings");
        } catch (err) {
          showToast(err?.response?.data?.message || "Need more complete real readings");
        }
      }}>
        <Zap size={13} /> Retrain ML
      </Btn>
      <Btn onClick={() => { onExportCSV(); showToast("Exported to CSV"); }}>
        <Download size={13} /> Export CSV
      </Btn>

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
