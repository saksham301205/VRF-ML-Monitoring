import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";
import { DEFAULT_BAUD_RATE } from "./serial-ipc-validation.js";

const FLASK_URL = "http://localhost:5000/api/protocol/ingest";
const FRAME_REGEX = /\*[^#]{4,}#/g;

// ── CRC-16/Modbus over ASCII bytes ──
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
}

// ── Build IVRF User Frame request ──
// Format: *PC[frame_count 2][system_id 2][cmd 2][data_type][pv 2][CRC 4]#
function buildUserFrameRequest(systemId = 1) {
  const sid = systemId.toString(16).toUpperCase().padStart(2, "0");
  const body = `*PC0C${sid}01U01`;
  const crc  = calculateCRC16(body);
  return `${body}${crc}#`;
}

function buildEngineeringFrameRequest(systemId = 1) {
  const sid = systemId.toString(16).toUpperCase().padStart(2, "0");
  const body = `*PC0C${sid}01E01`;
  const crc  = calculateCRC16(body);
  return `${body}${crc}#`;
}

function toHex(buffer) {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function buildPortLabel(port) {
  const details = [
    port.manufacturer,
    port.serialNumber ? `SN ${port.serialNumber}` : "",
    port.vendorId && port.productId
      ? `VID:${port.vendorId} PID:${port.productId}`
      : "",
  ].filter(Boolean);
  return details.length ? `${port.path} - ${details.join(" / ")}` : port.path;
}

async function forwardToFlask(frames) {
  if (!frames.length) return;
  try {
    await fetch(FLASK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "serial",
        frames,
        raw_batch: frames.join("\n"),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch { /* silent fail */ }
}

export class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port          = null;
    this.current       = null;
    this._buffer       = "";
    this._pollTimer    = null;
    this._pollInterval = 2000; // ms
  }

  async listPorts() {
    const ports = await SerialPort.list();
    return ports
      .map((p) => ({
        path:         p.path,
        label:        buildPortLabel(p),
        manufacturer: p.manufacturer  || "",
        serialNumber: p.serialNumber  || "",
        pnpId:        p.pnpId         || "",
        locationId:   p.locationId    || "",
        productId:    p.productId     || "",
        vendorId:     p.vendorId      || "",
      }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  getStatus() {
    return {
      connected: Boolean(this.port?.isOpen),
      path:      this.current?.path    || "",
      baudRate:  this.current?.baudRate || DEFAULT_BAUD_RATE,
    };
  }

  // ── Send a single ASCII frame to the VRF ──
  async _sendAscii(frame) {
    if (!this.port?.isOpen) return;
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(frame, "ascii"), (err) => {
        if (err) { reject(err); return; }
        this.port.drain((err2) => {
          if (err2) { reject(err2); return; }
          resolve();
        });
      });
    });
  }

  // ── Start periodic request polling ──
  _startRequestPolling(intervalMs) {
    this._stopRequestPolling();
    this._pollInterval = intervalMs || 2000;
    
    // Cycle through system IDs 1 to 11
    let currentSystemId = 1;

    const poll = async () => {
      if (!this.port?.isOpen) return;
      try {
        // Send User Frame request then Engineering Frame request
        const userReq = buildUserFrameRequest(currentSystemId);
        await this._sendAscii(userReq);
        this.emit("sent", { frame: userReq, timestamp: new Date().toISOString() });

        // Small gap then engineering frame
        await new Promise((r) => setTimeout(r, 200));
        const engReq = buildEngineeringFrameRequest(currentSystemId);
        await this._sendAscii(engReq);
        
        // Move to the next VRF system (1 through 11)
        currentSystemId++;
        if (currentSystemId > 11) {
          currentSystemId = 1;
        }
      } catch { /* ignore write errors */ }
    };

    // First request immediately
    poll();
    this._pollTimer = setInterval(poll, this._pollInterval);
  }

  _stopRequestPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async connect({ path, baudRate = DEFAULT_BAUD_RATE, pollingFrequency = 2000 }) {
    if (
      this.port?.isOpen &&
      this.current?.path === path &&
      this.current?.baudRate === baudRate
    ) {
      return this.getStatus();
    }

    await this.disconnect();

    this.port    = new SerialPort({ path, baudRate, autoOpen: false });
    this.current = { path, baudRate };
    this._buffer = "";

    this.port.on("data", (buffer) => {
      const chunk = buffer.toString("latin1");
      this._buffer += chunk;

      // Extract complete frames
      const matches = [...this._buffer.matchAll(FRAME_REGEX)];
      if (!matches.length) {
        if (this._buffer.length > 8192) this._buffer = "";
        return;
      }

      const completeFrames = matches.map((m) => m[0]);
      const lastMatch = matches[matches.length - 1];
      this._buffer = this._buffer.slice(lastMatch.index + lastMatch[0].length);

      this.emit("data", {
        path,
        timestamp:  new Date().toISOString(),
        text:       buffer.toString("latin1"),
        hex:        toHex(buffer),
        bytes:      Array.from(buffer),
        frames:     completeFrames,
      });

      // Forward complete frames to Flask
      forwardToFlask(completeFrames);
    });

    this.port.on("error",  (e) => this.emit("error",  { path, message: e.message }));
    this.port.on("close",  ()  => {
      this._buffer = "";
      this._stopRequestPolling();
      this.emit("closed", { path, timestamp: new Date().toISOString() });
    });

    await new Promise((resolve, reject) => {
      this.port.open((err) => { if (err) { reject(err); } else { resolve(); } });
    });

    this.emit("connected", this.getStatus());

    // Start sending request frames at the chosen polling frequency
    this._startRequestPolling(pollingFrequency);

    return this.getStatus();
  }

  async write(data, encoding = "utf8") {
    if (!this.port?.isOpen) throw new Error("Serial port is not connected.");
    await this._sendAscii(typeof data === "string" ? data : data.toString(encoding));
    return { status: "sent", path: this.current?.path || "", timestamp: new Date().toISOString() };
  }

  async disconnect() {
    this._stopRequestPolling();
    if (!this.port) { this.current = null; return this.getStatus(); }
    const p = this.port;
    this.port    = null;
    this._buffer = "";
    await new Promise((resolve, reject) => {
      if (!p.isOpen) { resolve(); return; }
      p.close((err) => { if (err) { reject(err); } else { resolve(); } });
    });
    this.current = null;
    this.emit("disconnected", this.getStatus());
    return this.getStatus();
  }
}