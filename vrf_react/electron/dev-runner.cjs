const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "..");
const devServerUrl = "http://127.0.0.1:5173";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBin = path.join(
  frontendRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);

let viteProcess = null;
let electronProcess = null;

function waitForUrl(url, timeoutMs = 20000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 400);
      });

      request.setTimeout(750, () => {
        request.destroy();
      });
    };

    check();
  });
}

function cleanup() {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }
}

async function run() {
  viteProcess = spawn(
    npmBin,
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    {
      cwd: frontendRoot,
      env: { ...process.env, BROWSER: "none" },
      stdio: "inherit",
      windowsHide: true,
    }
  );

  viteProcess.on("exit", (code) => {
    if (code && electronProcess && !electronProcess.killed) {
      electronProcess.kill();
    }
  });

  await waitForUrl(devServerUrl);

  electronProcess = spawn(electronBin, ["electron/main.js"], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  electronProcess.on("exit", (code) => {
    cleanup();
    process.exit(code || 0);
  });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

run().catch((error) => {
  console.error(error.message);
  cleanup();
  process.exit(1);
});
