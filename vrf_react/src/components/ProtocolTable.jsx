import { useState } from "react";

const PROTO_DESC = {
  TOC:"Temperature Command", AMB:"Ambient Temperature", PRS:"Suction Pressure",
  DPS:"Discharge Pressure",  CMP:"Compressor Speed",    FAN:"Fan Speed",
  PWR:"Power Consumption",   SHT:"Superheat Temp",      SCL:"Subcooling Level",
  COP:"Coeff. of Performance",EVP:"Evaporator Temp",   CND:"Condenser Temp",
  ALM:"Alarm / Fault Status"
};

function sc(v, min, max) {
  if (v > max * 1.05) return "HH";
  if (v < min * 0.95) return "LL";
  return "AA";
}
function p3(n) { return String(Math.round(Math.abs(n||0))).padStart(3,"0").slice(-3); }

function buildRows(d) {
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
  const rows = [
    { proto:"TOC", raw:`*TOC${p3(d.indoor_temp)}${sc(d.indoor_temp,16,30)}${ts}#`,            v:d.indoor_temp,         unit:"°C",  min:16,  max:30   },
    { proto:"AMB", raw:`*AMB${p3(d.ambient_temp)}${sc(d.ambient_temp,10,50)}${ts}#`,           v:d.ambient_temp,        unit:"°C",  min:10,  max:50   },
    { proto:"PRS", raw:`*PRS${p3((d.suction_pressure||0)*10)}${sc(d.suction_pressure,4,12)}${ts}#`,    v:d.suction_pressure,   unit:"bar", min:4,   max:12   },
    { proto:"DPS", raw:`*DPS${p3((d.discharge_pressure||0)*10)}${sc(d.discharge_pressure,15,35)}${ts}#`, v:d.discharge_pressure, unit:"bar", min:15,  max:35   },
    { proto:"CMP", raw:`*CMP${p3((d.compressor_speed||0)/10)}${sc(d.compressor_speed,1000,5500)}${ts}#`,  v:d.compressor_speed,   unit:"RPM", min:1000,max:5500 },
    { proto:"FAN", raw:`*FAN${p3((d.fan_speed||0)/10)}${sc(d.fan_speed,500,1800)}${ts}#`,      v:d.fan_speed,           unit:"RPM", min:500, max:1800 },
    { proto:"PWR", raw:`*PWR${p3((d.power_consumption||0)*100)}${sc(d.power_consumption,1,10)}${ts}#`,  v:d.power_consumption,  unit:"kW",  min:1,   max:10   },
    { proto:"SHT", raw:`*SHT${p3((d.superheat||0)*10)}${sc(d.superheat,3,15)}${ts}#`,          v:d.superheat,           unit:"°C",  min:3,   max:15   },
    { proto:"SCL", raw:`*SCL${p3((d.subcooling||0)*10)}${sc(d.subcooling,2,12)}${ts}#`,        v:d.subcooling,          unit:"°C",  min:2,   max:12   },
    { proto:"COP", raw:`*COP${p3((d.cop||0)*100)}${sc(d.cop,1.5,5)}${ts}#`,                   v:d.cop,                 unit:"",    min:1.5, max:5    },
    { proto:"EVP", raw:`*EVP${p3((d.evap_temp||0)*10)}${sc(d.evap_temp,5,20)}${ts}#`,          v:d.evap_temp,           unit:"°C",  min:5,   max:20   },
    { proto:"CND", raw:`*CND${p3((d.cond_temp||0)*10)}${sc(d.cond_temp,30,60)}${ts}#`,         v:d.cond_temp,           unit:"°C",  min:30,  max:60   },
  ];
  const alm = {refrigerant_leak:"001",compressor_overload:"002",dirty_filter:"003",sensor_drift:"004"}[d.fault_mode]||"000";
  const hasAlm = d.fault_mode && d.fault_mode !== "none";
  rows.push({ proto:"ALM", raw:`*ALM${alm}${hasAlm?"ER":"AA"}${ts}#`, v:alm, unit:"code", min:0, max:0, isAlm:true, hasAlm });
  return rows;
}

function getHealth(r) {
  if (r.isAlm) return r.hasAlm ? "bad" : "ok";
  if (r.v === null || r.v === undefined) return "ok";
  if (r.v > r.max*1.08 || r.v < r.min*0.92) return "bad";
  if (r.v > r.max*1.01 || r.v < r.min*0.99) return "warn";
  return "ok";
}

const TH = ({ children }) => (
  <th style={{ padding:"8px 12px", textAlign:"left", fontSize:10, fontWeight:600,
    letterSpacing:"0.08em", textTransform:"uppercase", color:"#999",
    borderRight:"1px solid #e0e3e8", whiteSpace:"nowrap",
    background:"#f5f7fa", position:"sticky", top:0, zIndex:1 }}>
    {children}
  </th>
);

export default function ProtocolTable({ packets }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #e0e3e8",
      borderRadius:8, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"12px 16px", borderBottom:"1px solid #e0e3e8" }}>
        <span style={{ fontSize:12, fontWeight:600, color:"#0a0a0a" }}>
          Protocol Stream — Live Aggregation
        </span>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#999" }}>
          {packets.length} packets received
        </span>
      </div>
      <div style={{ maxHeight:260, overflowY:"auto", overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <TH>#</TH><TH>Raw String</TH><TH>Protocol</TH>
              <TH>Description</TH><TH>Value</TH><TH>Unit</TH>
              <TH>Status</TH><TH>Health</TH><TH>Time</TH>
            </tr>
          </thead>
          <tbody>
            {packets.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign:"center", padding:28,
                color:"#999", fontSize:12 }}>Waiting for data stream...</td></tr>
            ) : packets.map((row, i) => {
              const h = getHealth(row);
              const vDisp = row.isAlm ? row.v : (typeof row.v==="number" ? row.v.toFixed(row.v>100?0:2) : "--");
              const statusCode = row.raw.slice(7,9);
              const scColor = statusCode==="AA"?"#166534":statusCode==="ER"?"#c0392b":"#b45309";
              const hBg    = h==="bad"?"#fdecea":h==="warn"?"#fef3c7":"#dcfce7";
              const hColor = h==="bad"?"#c0392b":h==="warn"?"#b45309":"#166534";
              const hBorder= h==="bad"?"#fca5a5":h==="warn"?"#fcd34d":"#bbf7d0";
              const hLabel = h==="bad"?"Fault":h==="warn"?"Warning":"Healthy";
              return (
                <tr key={i} style={{ borderBottom:"1px solid #e0e3e8",
                  transition:"background 0.12s" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#f5f7fa"}
                  onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999",
                    fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{row.seq}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#333",
                    fontFamily:"'IBM Plex Mono',monospace", borderRight:"1px solid #e0e3e8" }}>{row.raw}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#1a4fa0",
                    fontWeight:600, fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{row.proto}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, color:"#666",
                    borderRight:"1px solid #e0e3e8" }}>{PROTO_DESC[row.proto]||row.proto}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, fontWeight:600,
                    color: h==="bad"?"#c0392b":h==="warn"?"#b45309":"#0a0a0a",
                    fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{vDisp}</td>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999",
                    borderRight:"1px solid #e0e3e8" }}>{row.unit}</td>
                  <td style={{ padding:"7px 12px", fontSize:11, fontWeight:600,
                    color:scColor, fontFamily:"monospace", borderRight:"1px solid #e0e3e8" }}>{statusCode}</td>
                  <td style={{ padding:"7px 12px", borderRight:"1px solid #e0e3e8" }}>
                    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:3,
                      fontSize:9, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
                      background:hBg, color:hColor, border:`1px solid ${hBorder}` }}>{hLabel}</span>
                  </td>
                  <td style={{ padding:"7px 12px", fontSize:10, color:"#999",
                    fontFamily:"monospace" }}>{row.ts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { buildRows, getHealth };