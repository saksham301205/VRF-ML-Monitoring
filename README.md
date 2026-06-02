# VRF Diagnostic Desktop

This project runs the existing Flask + React VRF dashboard inside an Electron desktop app.

## Run The Desktop App

Install Python dependencies from the project root:

```bash
pip install -r requirements.txt
```

Install frontend and desktop dependencies:

```bash
cd vrf_react
npm install
```

Start the desktop app in development mode:

```bash
npm run desktop
```

The Electron app starts the Flask backend quietly, opens the React dashboard in a desktop window, and exposes serial-port access through the COM Port controls in the Live Monitor screen.

## Serial Port Behavior

The COM Port dropdown is populated dynamically with `serialport` from the user's operating system. The polling frequency control is clamped from 2 seconds to 30 seconds. Serial data is read through Electron and shown in the Live Monitor controls after connecting.
