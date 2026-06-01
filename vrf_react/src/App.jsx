import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import LiveMonitor from "./pages/LiveMonitor";
import ProtocolStream from "./pages/ProtocolStream";
import History from "./pages/History";
import Analytics from "./pages/Analytics";
import "./index.css";

const API = "http://localhost:5000";

const socket = io(API, {
  transports: ["polling", "websocket"],
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

export default function App() {
  const [tab, setTab]             = useState("live");
  const [live, setLive]           = useState(false);
  const [data, setData]           = useState(null);
  const [history, setHistory]     = useState([]);
  const [streaming, setStreaming] = useState(true);
  const [sidebarW, setSidebarW]   = useState(268);
  const [ready, setReady]         = useState(false);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(268);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3000);
    socket.on("connect",    () => { setLive(true); setReady(true); });
    socket.on("disconnect", () => setLive(false));
    socket.on("vrf_data",   (d) => {
      setData(d);
      setHistory(h => [d, ...h].slice(0, 200));
    });
    axios.get(`${API}/api/history`).then(r => setHistory([...r.data].reverse())).catch(()=>{});
    return () => {
      clearTimeout(timer);
      socket.off("connect");
      socket.off("disconnect");
      socket.off("vrf_data");
    };
  }, []);

  const onMouseDown = (e) => {
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = sidebarW;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setSidebarW(Math.max(180, Math.min(420, startW.current + (e.clientX - startX.current))));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  const injectFault  = (fault, severity) => axios.post(`${API}/api/inject_fault`, { fault, severity });
  const clearFault   = ()     => axios.post(`${API}/api/clear_fault`);
  const setSetpoint  = (temp) => axios.post(`${API}/api/set_setpoint`, { temp });
  const retrain      = ()     => axios.post(`${API}/api/train`);
  const exportCSV    = ()     => axios.get(`${API}/api/export_csv`);
  const toggleStream = async () => {
    const r = await axios.post(`${API}/api/toggle_stream`);
    setStreaming(r.data.active);
  };

  const liveProps = {
    data, history, streaming, ready,
    onInjectFault: injectFault, onClearFault: clearFault,
    onSetSetpoint: setSetpoint, onRetrain: retrain,
    onToggleStream: toggleStream, onExportCSV: exportCSV,
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
      <Header tab={tab} setTab={setTab} live={live} />
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        <div style={{ width:sidebarW, flexShrink:0, position:"relative", display:"flex", overflow:"hidden" }}>
          <Sidebar data={data} />
          <div onMouseDown={onMouseDown} style={{
            position:"absolute", right:0, top:0, bottom:0, width:5,
            cursor:"col-resize", background:"transparent",
            borderRight:"2px solid #e0e3e8", transition:"border-color 0.15s", zIndex:10
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor="#1a4fa0"}
            onMouseLeave={e => e.currentTarget.style.borderColor="#e0e3e8"}
          />
        </div>
        <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {tab === "live"      && <LiveMonitor {...liveProps} />}
          {tab === "protocol"  && <ProtocolStream data={data} />}
          {tab === "history"   && <History API={API} />}
          {tab === "analytics" && <Analytics API={API} />}
        </main>
      </div>
    </div>
  );
}