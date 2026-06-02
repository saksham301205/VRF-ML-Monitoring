const POLLING_MIN_SECONDS = 2;
const POLLING_MAX_SECONDS = 30;
const DEFAULT_POLLING_SECONDS = 2;
const DEFAULT_BAUD_RATE = 9600;
const ALLOWED_BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

export function normalizePortPath(path) {
  if (typeof path !== "string") {
    return "";
  }
  return path.trim();
}

export function normalizeBaudRate(value) {
  const baudRate = Number(value);
  if (!Number.isInteger(baudRate) || baudRate <= 0) {
    return DEFAULT_BAUD_RATE;
  }
  return baudRate;
}

export function normalizePollingSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_POLLING_SECONDS;
  }
  return Math.min(POLLING_MAX_SECONDS, Math.max(POLLING_MIN_SECONDS, Math.round(seconds)));
}

export function validateConnectPayload(payload = {}) {
  const path = normalizePortPath(payload.path);
  if (!path) {
    throw new Error("Select a serial port first.");
  }

  return {
    path,
    baudRate: normalizeBaudRate(payload.baudRate),
  };
}

export function validateWritePayload(payload = {}) {
  const data = typeof payload.data === "string" ? payload.data : "";
  if (!data) {
    throw new Error("Nothing to write to the serial port.");
  }
  return {
    data,
    encoding: typeof payload.encoding === "string" ? payload.encoding : "utf8",
  };
}

export {
  ALLOWED_BAUD_RATES,
  DEFAULT_BAUD_RATE,
  DEFAULT_POLLING_SECONDS,
  POLLING_MAX_SECONDS,
  POLLING_MIN_SECONDS,
};
