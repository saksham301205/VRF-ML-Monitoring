import numpy as np
import pandas as pd
from datetime import datetime
import random

class VRFSimulator:
    """
    Simulates a Variable Refrigerant Flow (VRF) HVAC system.
    Generates realistic sensor readings with occasional fault injection.
    Replace get_readings() with actual Modbus/BACnet reads when hardware is connected.
    """

    def __init__(self):
        self.time_step = 0
        self.fault_mode = None
        self.fault_severity = 0.0
        self.compressor_on = True
        self.setpoint_temp = 24.0  # Celsius
        self._base_noise = 0.0

    def inject_fault(self, fault_type: str, severity: float = 0.5):
        """Inject a simulated fault for testing ML detection."""
        self.fault_mode = fault_type
        self.fault_severity = severity

    def clear_fault(self):
        self.fault_mode = None
        self.fault_severity = 0.0

    def get_readings(self) -> dict:
        """
        Returns a dict of VRF sensor readings.
        In production: replace this with pymodbus / bacpypes calls.
        """
        self.time_step += 1
        t = self.time_step

        # --- Normal operating baselines ---
        ambient_temp     = 32.0 + 4 * np.sin(t / 120) + np.random.normal(0, 0.3)
        suction_pressure = 8.5  + 0.5 * np.sin(t / 60) + np.random.normal(0, 0.1)
        discharge_pressure = 28.0 + 2 * np.sin(t / 60) + np.random.normal(0, 0.2)
        compressor_speed = 3000 + 500 * np.sin(t / 80) + np.random.normal(0, 20)
        indoor_temp      = self.setpoint_temp + 2 * np.sin(t / 100) + np.random.normal(0, 0.2)
        power_consumption = 4.5 + 1.5 * np.sin(t / 80) + np.random.normal(0, 0.1)
        superheat        = 6.0 + np.random.normal(0, 0.5)
        subcooling       = 5.0 + np.random.normal(0, 0.4)
        cop              = 3.2 + 0.4 * np.sin(t / 90) + np.random.normal(0, 0.1)
        evap_temp        = 12.0 + np.random.normal(0, 0.3)
        cond_temp        = 45.0 + np.random.normal(0, 0.5)
        fan_speed        = 1200 + 100 * np.sin(t / 70) + np.random.normal(0, 10)

        # --- Fault injection ---
        if self.fault_mode == "refrigerant_leak":
            s = self.fault_severity
            suction_pressure   -= 3.0 * s
            discharge_pressure -= 4.0 * s
            superheat          += 8.0 * s
            cop                -= 0.8 * s
            power_consumption  += 1.0 * s

        elif self.fault_mode == "compressor_overload":
            s = self.fault_severity
            compressor_speed   += 800 * s
            power_consumption  += 2.5 * s
            discharge_pressure += 5.0 * s
            cond_temp          += 10.0 * s

        elif self.fault_mode == "dirty_filter":
            s = self.fault_severity
            indoor_temp        += 3.0 * s
            cop                -= 0.5 * s
            fan_speed          -= 200 * s
            power_consumption  += 0.8 * s

        elif self.fault_mode == "sensor_drift":
            s = self.fault_severity
            indoor_temp        += np.random.normal(0, 3.0 * s)
            suction_pressure   += np.random.normal(0, 1.5 * s)

        # Clip to physically plausible ranges
        readings = {
            "timestamp":          datetime.now().isoformat(),
            "ambient_temp":       round(float(np.clip(ambient_temp, 15, 55)), 2),
            "indoor_temp":        round(float(np.clip(indoor_temp, 10, 40)), 2),
            "setpoint_temp":      self.setpoint_temp,
            "suction_pressure":   round(float(np.clip(suction_pressure, 2, 20)), 2),
            "discharge_pressure": round(float(np.clip(discharge_pressure, 10, 45)), 2),
            "compressor_speed":   round(float(np.clip(compressor_speed, 0, 6000)), 1),
            "fan_speed":          round(float(np.clip(fan_speed, 0, 2000)), 1),
            "power_consumption":  round(float(np.clip(power_consumption, 0.5, 12)), 3),
            "superheat":          round(float(np.clip(superheat, -2, 25)), 2),
            "subcooling":         round(float(np.clip(subcooling, -1, 15)), 2),
            "cop":                round(float(np.clip(cop, 0.5, 6)), 3),
            "evap_temp":          round(float(np.clip(evap_temp, 0, 25)), 2),
            "cond_temp":          round(float(np.clip(cond_temp, 30, 70)), 2),
            "fault_mode":         self.fault_mode or "none",
            "compressor_on":      self.compressor_on,
        }
        return readings