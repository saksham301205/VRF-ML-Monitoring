const { contextBridge, ipcRenderer } = require("electron");

const allowedEvents = new Set([
  "serial:ports-updated",
  "serial:data",
  "serial:error",
  "serial:status",
]);

function onSerialEvent(channel, callback) {
  if (!allowedEvents.has(channel) || typeof callback !== "function") {
    return () => {};
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("vrfSerial", {
  listPorts: () => ipcRenderer.invoke("serial:list-ports"),
  startPortPolling: (seconds) => ipcRenderer.invoke("serial:start-port-polling", { seconds }),
  setPortPollingFrequency: (seconds) =>
    ipcRenderer.invoke("serial:set-port-polling-frequency", { seconds }),
  stopPortPolling: () => ipcRenderer.invoke("serial:stop-port-polling"),
  getStatus: () => ipcRenderer.invoke("serial:get-status"),
  connect: ({ path, baudRate }) => ipcRenderer.invoke("serial:connect", { path, baudRate }),
  disconnect: () => ipcRenderer.invoke("serial:disconnect"),
  write: (data, encoding = "utf8") => ipcRenderer.invoke("serial:write", { data, encoding }),
  onPortsUpdated: (callback) => onSerialEvent("serial:ports-updated", callback),
  onData: (callback) => onSerialEvent("serial:data", callback),
  onError: (callback) => onSerialEvent("serial:error", callback),
  onStatus: (callback) => onSerialEvent("serial:status", callback),
});
