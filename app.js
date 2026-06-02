const state = {
  readings: [],
  summary: null,
  history: [],
  selectedId: 1
};

const $ = (id) => document.getElementById(id);
const fmt = (v, suffix = "") => Number(v).toFixed(1).replace(".0", "") + suffix;

const actuatorInfo = {
  pump: { label: "Pompa Air", icon: "💧", sub: "Irigasi media tanam" },
  fan: { label: "Kipas Exhaust", icon: "🌀", sub: "Buang panas & RH tinggi" },
  misting: { label: "Mist Sprayer", icon: "🌫", sub: "Naikkan RH udara" },
  growLight: { label: "Grow Light", icon: "💡", sub: "Tambahan cahaya" }
};

function statusClass(text) {
  return String(text || "").toLowerCase();
}

function plantIcon(status) {
  if (status === "Bahaya") return "🥀";
  if (status === "Warning") return "🌿";
  return "🌱";
}

function issueText(bed) {
  if (!bed.issues || !bed.issues.length) return "Rentang ideal";
  return bed.issues.slice(0, 2).join(" • ");
}

function setModeButtons(mode) {
  $("autoBtn").className = `mode-btn ${mode === "AUTO" ? "active auto" : ""}`;
  $("manualBtn").className = `mode-btn ${mode === "MANUAL" ? "active manual" : ""}`;
}

function updateSummary(summary) {
  $("avgTemp").textContent = fmt(summary.avgTemperature, " °C");
  $("avgRh").textContent = fmt(summary.avgAirHumidity, " %");
  $("avgSoil").textContent = fmt(summary.avgSoilMoisture, " %");
  $("avgLight").textContent = `${Math.round(summary.avgLight)} lux`;

  $("normalCount").textContent = summary.counts.Normal || 0;
  $("warningCount").textContent = summary.counts.Warning || 0;
  $("dangerCount").textContent = summary.counts.Bahaya || 0;

  const date = new Date(summary.lastUpdated);
  $("updatedText").textContent = `Update terakhir: ${date.toLocaleTimeString("id-ID", { hour12: false })}`;
  setModeButtons(summary.mode);
}

function renderBeds() {
  const holder = $("bedGrid");
  holder.innerHTML = state.readings.map((bed) => {
    const cls = statusClass(bed.status);
    return `
      <button class="bed-card ${cls} ${bed.id === state.selectedId ? "selected" : ""}" onclick="selectBed(${bed.id})">
        <div class="bed-top">
          <span>${bed.name}</span>
          <i class="dot ${cls}"></i>
        </div>
        <div class="plant">${plantIcon(bed.status)}</div>
        <div class="bed-meta">
          <span>Soil ${fmt(bed.soilMoisture, "%")} · RH ${fmt(bed.airHumidity, "%")}</span>
          <span>${fmt(bed.temperature, "°C")} · ${Math.round(bed.light)} lux</span>
          <b class="issue-pill ${cls}">${issueText(bed)}</b>
        </div>
      </button>
    `;
  }).join("");
}

function renderSelected() {
  const bed = state.readings.find((b) => b.id === state.selectedId) || state.readings[0];
  if (!bed) return;

  $("selectedTitle").textContent = bed.name;
  const cls = statusClass(bed.status);
  $("selectedStatus").className = `status-pill ${cls}`;
  $("selectedStatus").textContent = bed.status;

  $("detailMetrics").innerHTML = `
    <div class="metric-box"><span>Suhu Udara</span><b>${fmt(bed.temperature, " °C")}</b></div>
    <div class="metric-box"><span>RH Udara</span><b>${fmt(bed.airHumidity, " %")}</b></div>
    <div class="metric-box"><span>Soil Moisture</span><b>${fmt(bed.soilMoisture, " %")}</b></div>
    <div class="metric-box"><span>Cahaya</span><b>${Math.round(bed.light)} lux</b></div>
  `;

  $("recommendation").innerHTML = `
    <b>${issueText(bed)}</b><br>
    ${bed.recommendation || makeRecommendation(bed)}
  `;
}

function makeRecommendation(bed) {
  if (!bed.issues || !bed.issues.length) return "Kondisi stabil. Tidak ada tindakan khusus.";
  return "Periksa area ini dan sesuaikan aktuator berdasarkan parameter yang keluar dari rentang ideal.";
}

function renderActuators() {
  const actuators = state.summary?.actuators || {};
  $("actuatorGrid").innerHTML = Object.entries(actuatorInfo).map(([key, item]) => {
    const on = Boolean(actuators[key]);
    return `
      <button class="actuator-btn ${on ? "on" : ""}" onclick="toggleActuator('${key}')">
        <span class="actuator-left">
          <span class="actuator-ico">${item.icon}</span>
          <span><strong>${item.label}</strong><small>${item.sub}</small></span>
        </span>
        <span class="switch"></span>
      </button>
    `;
  }).join("");
}

function renderRules() {
  const rules = state.summary?.rules || {};
  const order = ["pump", "fan", "misting", "growLight"];
  $("rulesGrid").innerHTML = order.map((key) => {
    const r = rules[key] || {};
    const active = Boolean(state.summary?.actuators?.[key]);
    const affected = r.affectedBeds && r.affectedBeds.length ? r.affectedBeds.join(", ") : "Tidak ada";
    return `
      <div class="rule-card ${active ? "active" : ""}">
        <i class="rule-line"></i>
        <b>${r.title || "-"}</b>
        <span>${r.output || "-"} · ${r.value || ""}</span>
        <em>${active ? "AKTIF" : "STANDBY"}</em>
        <span>Pemicu: ${affected}</span>
      </div>
    `;
  }).join("");
}

function renderTable() {
  $("sensorTable").innerHTML = state.readings.map((bed) => {
    const cls = statusClass(bed.status);
    return `
      <tr>
        <td><b>${bed.name}</b></td>
        <td>${fmt(bed.temperature, " °C")}</td>
        <td>${fmt(bed.airHumidity, " %")}</td>
        <td>${fmt(bed.soilMoisture, " %")}</td>
        <td>${Math.round(bed.light)} lux</td>
        <td><span class="table-status ${cls}">${bed.status}</span></td>
      </tr>
    `;
  }).join("");
}

function drawTrend() {
  const canvas = $("trendCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || 780);
  const height = 240;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 38, right: 18, top: 20, bottom: 32 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const data = state.history.slice(-32);
  if (data.length < 2) return;

  ctx.strokeStyle = "#e3edf2";
  ctx.lineWidth = 1;
  ctx.font = "11px Inter, sans-serif";
  ctx.fillStyle = "#738195";

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * h;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  function line(key, min, max, color, label) {
    const x = (i) => pad.left + (i / (data.length - 1)) * w;
    const y = (v) => pad.top + h - ((v - min) / (max - min)) * h;

    ctx.beginPath();
    data.forEach((d, i) => {
      const px = x(i);
      const py = y(d[key]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    const last = data[data.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(data.length - 1), y(last[key]), 4, 0, Math.PI * 2);
    ctx.fill();

    return { label, color };
  }

  const labels = [
    line("temperature", 20, 38, "#dd1f26", "Suhu"),
    line("humidity", 35, 92, "#0ea5a8", "RH"),
    line("soil", 15, 92, "#058646", "Soil"),
    line("light", 120, 1050, "#f3bd00", "Cahaya")
  ];

  let lx = pad.left;
  labels.forEach((l) => {
    ctx.fillStyle = l.color;
    ctx.fillRect(lx, height - 18, 12, 4);
    ctx.fillStyle = "#52616B";
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.fillText(l.label, lx + 18, height - 12);
    lx += 90;
  });
}

function renderAll(payload) {
  state.readings = payload.readings || [];
  state.summary = payload.summary || null;
  state.history = payload.history || [];

  if (!state.readings.find((b) => b.id === state.selectedId) && state.readings.length) {
    state.selectedId = state.readings[0].id;
  }

  if (state.summary) updateSummary(state.summary);
  renderBeds();
  renderSelected();
  renderActuators();
  renderRules();
  renderTable();
  drawTrend();
}

function selectBed(id) {
  state.selectedId = Number(id);
  renderBeds();
  renderSelected();
}

async function setMode(mode) {
  setModeButtons(mode);
  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
}

async function toggleActuator(name) {
  const current = Boolean(state.summary?.actuators?.[name]);
  await fetch("/api/actuator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, value: !current })
  });
}

window.selectBed = selectBed;
window.toggleActuator = toggleActuator;

$("autoBtn").addEventListener("click", () => setMode("AUTO"));
$("manualBtn").addEventListener("click", () => setMode("MANUAL"));

fetch("/api/readings").then(r => r.json()).then(renderAll);

const source = new EventSource("/events");
source.onopen = () => { $("connectionText").textContent = "Terhubung"; };
source.onerror = () => { $("connectionText").textContent = "Terputus"; };
source.onmessage = (event) => renderAll(JSON.parse(event.data));

window.addEventListener("resize", drawTrend);
