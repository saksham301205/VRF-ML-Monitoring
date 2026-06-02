import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";
import { DEFAULT_BAUD_RATE } from "./serial-ipc-validation.js";

function toHex(buffer) {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function buildPortLabel(port) {
  const details = [
    port.manufacturer,
    port.serialNumber ? `SN ${port.serialNumber}` : "",
    port.vendorId && port.productId ? `VID:${port.vendorId} PID:${port.productId}` : "",
  ].filter(Boolean);

  return details.length ? `${port.path} - ${details.join(" / ")}` : port.path;
}

export class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.current = null;
  }

  async listPorts() {
    const ports = await SerialPort.list();
    return ports
      .map((port) => ({
        path: port.path,
        label: buildPortLabel(port),
        manufacturer: port.manufacturer || "",
        serialNumber: port.serialNumber || "",
        pnpId: port.pnpId || "",
        locationId: port.locationId || "",
        productId: port.productId || "",
        vendorId: port.vendorId || "",
      }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  getStatus() {
    return {
      connected: Boolean(this.port?.isOpen),
      path: this.current?.path || "",
      baudRate: this.current?.baudRate || DEFAULT_BAUD_RATE,
    };
  }

  async connect({ path, baudRate = DEFAULT_BAUD_RATE }) {
    if (this.port?.isOpen && this.current?.path === path && this.current?.baudRate === baudRate) {
      return this.getStatus();
    }

    await this.disconnect();

    this.port = new SerialPort({
      path,
      baudRate,
      autoOpen: false,
    });

    this.current = { path, baudRate };

    this.port.on("data", (buffer) => {
      const payload = {
        path,
        timestamp: new Date().toISOString(),
        text: buffer.toString("utf8"),
        hex: toHex(buffer),
        bytes: Array.from(buffer),
      };
      this.emit("data", payload);
    });

    this.port.on("error", (error) => {
      this.emit("error", {
        path,
        message: error.message,
      });
    });

    this.port.on("close", () => {
      this.emit("closed", {
        path,
        timestamp: new Date().toISOString(),
      });
    });

    await new Promise((resolve, reject) => {
      this.port.open((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.emit("connected", this.getStatus());
    return this.getStatus();
  }

  async write(data, encoding = "utf8") {
    if (!this.port?.isOpen) {
      throw new Error("Serial port is not connected.");
    }

    await new Promise((resolve, reject) => {
      this.port.write(data, encoding, (writeError) => {
        if (writeError) {
          reject(writeError);
          return;
        }

        this.port.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }
          resolve();
        });
      });
    });

    return {
      status: "sent",
      path: this.current?.path || "",
      timestamp: new Date().toISOString(),
    };
  }

  async disconnect() {
    if (!this.port) {
      this.current = null;
      return this.getStatus();
    }

    const portToClose = this.port;
    this.port = null;

    await new Promise((resolve, reject) => {
      if (!portToClose.isOpen) {
        resolve();
        return;
      }

      portToClose.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.current = null;
    this.emit("disconnected", this.getStatus());
    return this.getStatus();
  }
}
