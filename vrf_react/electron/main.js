import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SerialManager } from "./serial/serial-manager.js";
import { registerSerialIpc } from "./serial/serial-ipc.js";
import { DEFAULT_POLLING_SECONDS } from "./serial/serial-ipc-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const serialManager = new SerialManager();
const serialIpc = registerSerialIpc(serialManager);
let mainWindow = null;
let backendProcess = null;

function getPythonExecutable() {
  const venvPython = process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");

  if (existsSync(venvPython)) {
    return venvPython;
  }

  return process.platform === "win32" ? "python" : "python3";
}

function pingBackend() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:5000/", (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(750, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pingBackend()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureBackend() {
  if (await pingBackend()) {
    return;
  }

  const pythonExecutable = getPythonExecutable();
  backendProcess = spawn(pythonExecutable, ["app.py"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      VRF_DISABLE_BROWSER_OPEN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  backendProcess.stdout.on("data", (chunk) => {
    console.log(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.stderr.on("data", (chunk) => {
    console.error(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });

  await waitForBackend();
}

async function createWindow() {
  await ensureBackend();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    title: "VRF Diagnostic Desktop",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadURL("http://localhost:5173");

  serialIpc.startPolling(DEFAULT_POLLING_SECONDS);
}

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  serialIpc.stopPolling();
  await serialManager.disconnect().catch(() => {});

  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
