import { BrowserWindow, ipcMain } from "electron";
import {
  DEFAULT_POLLING_SECONDS,
  normalizePollingSeconds,
  validateConnectPayload,
  validateWritePayload,
} from "./serial-ipc-validation.js";

let pollingTimer = null;
let pollingSeconds = DEFAULT_POLLING_SECONDS;
let lastPortsSignature = "";

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function portsSignature(ports) {
  return JSON.stringify(
    ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      productId: port.productId,
      vendorId: port.vendorId,
    }))
  );
}

async function publishPorts(serialManager, force = false) {
  const ports = await serialManager.listPorts();
  const signature = portsSignature(ports);
  if (force || signature !== lastPortsSignature) {
    lastPortsSignature = signature;
    broadcast("serial:ports-updated", ports);
  }
  return ports;
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function startPolling(serialManager, seconds) {
  pollingSeconds = normalizePollingSeconds(seconds);
  stopPolling();
  publishPorts(serialManager, true).catch((error) => {
    broadcast("serial:error", { message: error.message });
  });
  pollingTimer = setInterval(() => {
    publishPorts(serialManager).catch((error) => {
      broadcast("serial:error", { message: error.message });
    });
  }, pollingSeconds * 1000);

  return { pollingSeconds };
}

export function registerSerialIpc(serialManager) {
  serialManager.on("data", (payload) => broadcast("serial:data", payload));
  serialManager.on("error", (payload) => broadcast("serial:error", payload));
  serialManager.on("connected", (payload) => broadcast("serial:status", payload));
  serialManager.on("disconnected", (payload) => broadcast("serial:status", payload));
  serialManager.on("closed", () => broadcast("serial:status", serialManager.getStatus()));

  ipcMain.handle("serial:list-ports", async () => publishPorts(serialManager, true));

  ipcMain.handle("serial:start-port-polling", async (_event, payload = {}) => {
    return startPolling(serialManager, payload.seconds);
  });

  ipcMain.handle("serial:set-port-polling-frequency", async (_event, payload = {}) => {
    return startPolling(serialManager, payload.seconds);
  });

  ipcMain.handle("serial:stop-port-polling", async () => {
    stopPolling();
    return { pollingSeconds };
  });

  ipcMain.handle("serial:get-status", async () => serialManager.getStatus());

  ipcMain.handle("serial:connect", async (_event, payload = {}) => {
    const options = validateConnectPayload(payload);
    return serialManager.connect(options);
  });

  ipcMain.handle("serial:disconnect", async () => serialManager.disconnect());

  ipcMain.handle("serial:write", async (_event, payload = {}) => {
    const options = validateWritePayload(payload);
    return serialManager.write(options.data, options.encoding);
  });

  return {
    startPolling: (seconds = pollingSeconds) => startPolling(serialManager, seconds),
    stopPolling,
  };
}
