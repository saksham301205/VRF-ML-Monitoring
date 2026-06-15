import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import LiveMonitor from "./pages/LiveMonitor";
import ProtocolStream from "./pages/ProtocolStream";
import History from "./pages/History";
import Analytics from "./pages/Analytics";
import useSerialConnection from "./hooks/useSerialConnection";
import "./index.css";

const API = "http://localhost:5000";

const socket = io(API, {
  transports: ["polling", "websocket"],
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

export default function App() {
  const [tab,       setTab]       = useState("live");
  const [live,      setLive]      = useState(false);
  const [data,      setData]      = useState(null);
  const [history,   setHistory]   = useState([]);
  const [streaming, setStreaming] = useState(true);
  const [sidebarW,  setSidebarW]  = useState(268);
  const [ready,     setReady]     = useState(false);
  const serial = useSerialConnection();

  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(268);
  const serialBuffer    = useRef("");
  const lastSerialEvent = useRef("");

  // ── Accept any reading and push to charts + sidebar ─────────────────
  const acceptReading = useCallback((reading, persist = false) => {
    if (!reading || typeof reading !== "object") return;
    if (Object.keys(reading).length === 0) return;
    // Merge with existing data so partial readings don't blank out fields
    setData(prev => ({ ...(prev || {}), ...reading }));
    // Only append to history if this reading is a persisted/manual reading
    const src = reading.source || "";
    if (persist || src === "manual") {
      setHistory(h => [reading, ...h].slice(0, 200));
    }
  }, []);

  // ── Parse protocol frames and push decoded values into charts ────────
  const ingestProtocol = useCallback(async (payload, source = "manual") => {
    const body = typeof payload === "string"
      ? { raw_batch: payload, source }
      : { ...payload, source };

    const response = await axios.post(`${API}/api/protocol/ingest`, body);
    const result   = response.data;

    // 1. If backend returns a fully assembled reading, use it directly
    if (result?.latest_reading &&
        Object.keys(result.latest_reading).length > 0) {
      acceptReading(result.latest_reading, source === "manual");
      return result;
    }

    // 2. Otherwise assemble a reading from all parsed frame fields
    const assembled = {};
    (result?.frames || []).forEach(frame => {
      // From frame.reading (legacy parser)
      if (frame.reading && typeof frame.reading === "object") {
        Object.entries(frame.reading).forEach(([k, v]) => {
          if (v !== null && v !== undefined) assembled[k] = v;
        });
      }
      // From frame.fields array (workbook parser)
      if (Array.isArray(frame.fields)) {
        frame.fields
          .filter(f => f.present && f.decoded_value !== null)
          .forEach(f => {
            // Map common parameter names to our sensor keys
            const key = paramToSensorKey(f.parameter || "");
            if (key) assembled[key] = f.decoded_value;
          });
      }
      // Direct frame values (legacy_demo parser)
      if (frame.parser === "legacy_demo" && frame.field) {
        assembled[frame.field] = frame.value;
      }
    });

    if (Object.keys(assembled).length > 0) {
      assembled.timestamp = assembled.timestamp || new Date().toISOString();
      acceptReading(assembled, source === "manual");
    }

    return result;
  }, [acceptReading]);

  // ── Map protocol parameter names → our sensor keys ───────────────────
  function paramToSensorKey(param) {
    const p = param.toLowerCase();
    if (p.includes("ambient") || p.includes("outdoor temp")) return "ambient_temp";
    if (p.includes("indoor") || p.includes("room temp") || p.includes("set temp")) return "indoor_temp";
    if (p.includes("suction") && p.includes("press")) return "suction_pressure";
    if (p.includes("discharge") && p.includes("press")) return "discharge_pressure";
    if (p.includes("compressor") && (p.includes("speed") || p.includes("freq"))) return "compressor_speed";
    if (p.includes("fan") && p.includes("speed")) return "fan_speed";
    if (p.includes("power") || p.includes("current") && p.includes("input")) return "power_consumption";
    if (p.includes("superheat")) return "superheat";
    if (p.includes("subcool")) return "subcooling";
    if (p.includes("cop") || p.includes("coefficient")) return "cop";
    if (p.includes("evap") && p.includes("temp")) return "evap_temp";
    if (p.includes("cond") && p.includes("temp")) return "cond_temp";
    return null;
  }

  // ── Socket + initial load ────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3000);
    socket.on("connect",    () => { setLive(true); setReady(true); });
    socket.on("disconnect", () => setLive(false));
    socket.on("vrf_data",   (r) => acceptReading(r, false));
    // New realtime events for quick UI updates — buffer and flush to avoid render storms
    const protocolBuffer = [];
    let protocolFlush = null;
    socket.on("protocol_parsed", (data) => {
      if (!data) return;
      const frames = data.frames || [];
      if (!frames.length) return;
      protocolBuffer.push(...frames);
      if (protocolFlush) return;
      protocolFlush = setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent("protocol_parsed", { detail: { frames: [...protocolBuffer] } }));
        } catch (e) { /* ignore */ }
        protocolBuffer.length = 0;
        protocolFlush = null;
      }, 200);
    });

    // Buffer preview_reading so acceptReading is called at most every 200ms
    let previewAccum = null;
    let previewFlush = null;
    socket.on("preview_reading", (reading) => {
      if (!reading) return;
      previewAccum = previewAccum ? { ...previewAccum, ...reading } : { ...reading };
      if (previewFlush) return;
      previewFlush = setTimeout(() => {
        if (previewAccum) acceptReading(previewAccum, false);
        previewAccum = null;
        previewFlush = null;
      }, 200);
    });

    // Batch ML predictions and dispatch in short bursts
    const mlBuffer = [];
    let mlFlush = null;
    socket.on("ml_prediction", (p) => {
      if (!p) return;
      mlBuffer.push(p);
      if (mlFlush) return;
      mlFlush = setTimeout(() => {
        try {
          // dispatch combined ml events so History.jsx can update in one go
          window.dispatchEvent(new CustomEvent("ml_prediction", { detail: mlBuffer[mlBuffer.length-1] }));
        } catch (e) {}
        mlBuffer.length = 0;
        mlFlush = null;
      }, 200);
    });

    axios.get(`${API}/api/history`)
      .then(r => setHistory([...r.data].reverse()))
      .catch(() => {});
    axios.get(`${API}/api/live/latest`)
      .then(r => { if (r.data) acceptReading(r.data, false); })
      .catch(() => {});

    return () => {
      clearTimeout(timer);
      socket.off("connect");
      socket.off("disconnect");
      socket.off("vrf_data");
    };
  }, [acceptReading]);

  // ── Clear data on Serial Disconnect ──────────────────────────────────
  const prevSerialConn = useRef(false);
  useEffect(() => {
    // If it was connected before, and now it is disconnected
    if (prevSerialConn.current === true && !serial.connected) {
      axios.post(`${API}/api/db/clear_all_data`).then(() => {
        setHistory([]);
        setData(null);
        console.log("All data cleared due to RS485 disconnect");
      }).catch(err => console.error("Failed to clear data on disconnect", err));
    }
    prevSerialConn.current = serial.connected;
  }, [serial.connected]);

  // ── Serial data → ingest ─────────────────────────────────────────────
  useEffect(() => {
    const payload = serial.latestData;
    if (!payload) return;
    const signature = `${payload.timestamp||""}:${payload.hex||""}`;
    if (!signature || signature === lastSerialEvent.current) return;
    lastSerialEvent.current = signature;

    const text = payload.text || "";
    if (!text) return;

    serialBuffer.current = `${serialBuffer.current}${text}`;
    const frames  = serialBuffer.current.match(/\*[^#]*#/g) || [];
    const lastEnd = serialBuffer.current.lastIndexOf("#");
    serialBuffer.current = lastEnd >= 0
      ? serialBuffer.current.slice(lastEnd + 1)
      : serialBuffer.current.slice(-512);

    if (frames.length === 0) return;
    ingestProtocol({
      frames,
      serial: { path:payload.path, timestamp:payload.timestamp, hex:payload.hex },
    }, "serial").catch(err => console.error("Serial ingest error:", err));
  }, [ingestProtocol, serial.latestData]);

  // ── Resizable sidebar ────────────────────────────────────────────────
  const onMouseDown = (e) => {
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = sidebarW;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setSidebarW(Math.max(180, Math.min(420,
        startW.current + (e.clientX - startX.current))));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  // ── Control handlers ─────────────────────────────────────────────────
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
    data, history, streaming, ready, serial,
    onInjectFault: injectFault, onClearFault: clearFault,
    onSetSetpoint: setSetpoint, onRetrain: retrain,
    onToggleStream: toggleStream, onExportCSV: exportCSV,
  };

  return (
    <div style={{ display:"flex", flexDirection:"column",
      height:"100vh", overflow:"hidden" }}>
      <Header tab={tab} setTab={setTab} live={live} />
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* Resizable sidebar */}
        <div style={{ width:sidebarW, flexShrink:0, position:"relative",
          display:"flex", overflow:"hidden" }}>
          <Sidebar data={data} />
          <div onMouseDown={onMouseDown} style={{
            position:"absolute", right:0, top:0, bottom:0,
            width:5, cursor:"col-resize", background:"transparent",
            borderRight:"2px solid #e0e3e8", transition:"border-color 0.15s", zIndex:10
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor="#1a4fa0"}
            onMouseLeave={e => e.currentTarget.style.borderColor="#e0e3e8"}
          />
        </div>

        <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {tab === "live"      && <LiveMonitor {...liveProps} />}
          {tab === "protocol"  && <ProtocolStream API={API} serial={serial} onIngest={ingestProtocol} />}
          {tab === "history"   && <History API={API} onIngest={ingestProtocol} />}
          {tab === "analytics" && <Analytics API={API} />}
        </main>
      </div>
    </div>
  );
}