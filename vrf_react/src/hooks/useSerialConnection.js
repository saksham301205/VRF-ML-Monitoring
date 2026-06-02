import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_POLLING_SECONDS = 2;
const MIN_POLLING_SECONDS = 2;
const MAX_POLLING_SECONDS = 30;

function getSerialApi() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.vrfSerial || null;
}

function clampPollingSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_POLLING_SECONDS;
  }
  return Math.min(MAX_POLLING_SECONDS, Math.max(MIN_POLLING_SECONDS, Math.round(seconds)));
}

export default function useSerialConnection() {
  const [available, setAvailable] = useState(false);
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD_RATE);
  const [pollingSeconds, setPollingSecondsState] = useState(DEFAULT_POLLING_SECONDS);
  const [status, setStatus] = useState({
    connected: false,
    path: "",
    baudRate: DEFAULT_BAUD_RATE,
  });
  const [latestData, setLatestData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connected = Boolean(status.connected);

  const selectedPortInfo = useMemo(
    () => ports.find((port) => port.path === selectedPort) || null,
    [ports, selectedPort]
  );

  const setPollingSeconds = useCallback((value) => {
    setPollingSecondsState(clampPollingSeconds(value));
  }, []);

  const refreshPorts = useCallback(async () => {
    const api = getSerialApi();
    if (!api) {
      setAvailable(false);
      setError("Serial bridge is available only in the Electron desktop app.");
      return [];
    }

    setAvailable(true);
    const nextPorts = await api.listPorts();
    setPorts(nextPorts);
    return nextPorts;
  }, []);

  const connect = useCallback(async () => {
    const api = getSerialApi();
    if (!api || !selectedPort) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextStatus = await api.connect({ path: selectedPort, baudRate });
      setStatus(nextStatus);
    } catch (err) {
      setError(err.message || "Failed to connect serial port.");
    } finally {
      setBusy(false);
    }
  }, [baudRate, selectedPort]);

  const disconnect = useCallback(async () => {
    const api = getSerialApi();
    if (!api) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextStatus = await api.disconnect();
      setStatus(nextStatus);
    } catch (err) {
      setError(err.message || "Failed to disconnect serial port.");
    } finally {
      setBusy(false);
    }
  }, []);

  const write = useCallback(async (data) => {
    const api = getSerialApi();
    if (!api) {
      return null;
    }

    setError("");
    try {
      return await api.write(data);
    } catch (err) {
      setError(err.message || "Failed to write to serial port.");
      return null;
    }
  }, []);

  useEffect(() => {
    const api = getSerialApi();
    if (!api) {
      setAvailable(false);
      setError("Serial bridge is available only in the Electron desktop app.");
      return undefined;
    }

    let mounted = true;
    setAvailable(true);

    api.getStatus().then((nextStatus) => {
      if (mounted) {
        setStatus(nextStatus);
      }
    }).catch(() => {});

    refreshPorts().catch((err) => setError(err.message || "Failed to list serial ports."));
    api.startPortPolling(pollingSeconds).catch((err) => {
      setError(err.message || "Failed to start serial port polling.");
    });

    const offPorts = api.onPortsUpdated((nextPorts = []) => {
      setPorts(nextPorts);
      setSelectedPort((current) => {
        if (!current) {
          return current;
        }
        return nextPorts.some((port) => port.path === current) ? current : "";
      });
    });

    const offStatus = api.onStatus((nextStatus) => {
      setStatus(nextStatus);
    });

    const offData = api.onData((payload) => {
      setLatestData(payload);
    });

    const offError = api.onError((payload) => {
      setError(payload?.message || "Serial port error.");
    });

    return () => {
      mounted = false;
      offPorts();
      offStatus();
      offData();
      offError();
      api.stopPortPolling().catch(() => {});
    };
  }, [pollingSeconds, refreshPorts]);

  useEffect(() => {
    const api = getSerialApi();
    if (!api) {
      return;
    }

    api.setPortPollingFrequency(pollingSeconds).catch((err) => {
      setError(err.message || "Failed to update polling frequency.");
    });
  }, [pollingSeconds]);

  return {
    available,
    ports,
    selectedPort,
    selectedPortInfo,
    setSelectedPort,
    baudRate,
    setBaudRate,
    pollingSeconds,
    setPollingSeconds,
    status,
    connected,
    latestData,
    busy,
    error,
    refreshPorts,
    connect,
    disconnect,
    write,
  };
}
