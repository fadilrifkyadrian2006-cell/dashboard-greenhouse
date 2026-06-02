
const state = {
  readings: [],
  history: [],
  selectedId: 1,
  mode: "AUTO",
  actuators: { pump: false, fan: false, misting: false, growLight: false }
};

const IDEAL = {
  temperature: { min: 23, max: 30 },
  airHumidity: { min: 58, max: 82 },
  soilMoisture: { min: 45, max: 80 },
  light: { min: 520, max: 1000 }
};

const $ = (id) => document.getElementById(id);
const fmt = (v, suffix = "") => Number(v).toFixed(1).replace(".0", "") + suffix;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const rand = (min, max) => Math.round((Math.random() * (max - min) + min) * 10) / 10;

const actuatorInfo = {
  pump: { label: "Pompa Air", icon: "💧", sub: "Irigasi media tanam" },
  fan: { label: "Kipas Exhaust", icon: "🌀", sub: "Turunkan suhu / RH" },
  misting: { label: "Mist Sprayer", icon: "🌫", sub: "Naikkan RH udara" },
  growLight: { label: "Grow Light", icon: "💡", sub: "Tambahan intensitas cahaya" }
};

function statusClass(text) { return String(text || "").toLowerCase(); }
function plantIcon(status) { return status === "Bahaya" ? "🥀" : status === "Warning" ? "🌿" : "🌱"; }
function issueText(bed) { return (!bed.issues || !bed.issues.length) ? "Rentang ideal" : bed.issues.slice(0, 2).join(" • "); }
function avg(key) { return state.readings.reduce((sum, bed) => sum + bed[key], 0) / state.readings.length; }

function initBeds() {
  state.readings = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: `Bed ${i + 1}`,
    temperature: rand(24.5, 29.2),
    airHumidity: rand(60, 78),
    soilMoisture: rand(50, 72),
    light: Math.round(rand(570, 860)),
    status: "Normal",
    issues: []
  }));
  state.readings.forEach(evaluateBed);
}

function evaluateBed(bed) {
  const issues = [], danger = [];

  if (bed.temperature < IDEAL.temperature.min) issues.push("Suhu rendah");
  if (bed.temperature > IDEAL.temperature.max) issues.push("Suhu tinggi");
  if (bed.temperature <= 21.5) danger.push("Suhu sangat rendah");
  if (bed.temperature >= 34.5) danger.push("Suhu sangat tinggi");

  if (bed.airHumidity < IDEAL.airHumidity.min) issues.push("RH rendah");
  if (bed.airHumidity > IDEAL.airHumidity.max) issues.push("RH tinggi");
  if (bed.airHumidity <= 40) danger.push("RH sangat rendah");
  if (bed.airHumidity >= 90) danger.push("RH sangat tinggi");

  if (bed.soilMoisture < IDEAL.soilMoisture.min) issues.push("Soil kering");
  if (bed.soilMoisture > IDEAL.soilMoisture.max) issues.push("Soil basah");
  if (bed.soilMoisture <= 25) danger.push("Soil sangat kering");
  if (bed.soilMoisture >= 88) danger.push("Soil sangat basah");

  if (bed.light < IDEAL.light.min) issues.push("Cahaya rendah");
  if (bed.light > IDEAL.light.max) issues.push("Cahaya tinggi");
  if (bed.light <= 260) danger.push("Cahaya sangat rendah");
  if (bed.light >= 1045) danger.push("Cahaya sangat tinggi");

  bed.issues = [...danger, ...issues];
  bed.status = danger.length ? "Bahaya" : issues.length ? "Warning" : "Normal";
}

function computeRules() {
  const soilLow = state.readings.filter((b) => b.soilMoisture < IDEAL.soilMoisture.min);
  const soilHigh = state.readings.filter((b) => b.soilMoisture > IDEAL.soilMoisture.max);
  const tempHigh = state.readings.filter((b) => b.temperature > IDEAL.temperature.max);
  const tempLow = state.readings.filter((b) => b.temperature < IDEAL.temperature.min);
  const rhLow = state.readings.filter((b) => b.airHumidity < IDEAL.airHumidity.min);
  const rhHigh = state.readings.filter((b) => b.airHumidity > IDEAL.airHumidity.max);
  const lightLow = state.readings.filter((b) => b.light < IDEAL.light.min);
  const lightHigh = state.readings.filter((b) => b.light > IDEAL.light.max);
  const names = (arr) => arr.map((b) => b.name);

  return {
    pump: { title: "Soil rendah", output: "Pompa Air ON", recommended: soilLow.length > 0, affectedBeds: names(soilLow), info: soilLow.length ? `${soilLow.length} bed kering` : soilHigh.length ? `${soilHigh.length} bed terlalu basah` : "Aman", value: "Ideal 45–80%" },
    fan: { title: "Suhu/RH tinggi", output: "Kipas ON", recommended: tempHigh.length > 0 || rhHigh.length > 0, affectedBeds: names([...new Set([...tempHigh, ...rhHigh])]), info: tempHigh.length || rhHigh.length ? `${tempHigh.length} suhu tinggi · ${rhHigh.length} RH tinggi` : tempLow.length ? `${tempLow.length} suhu rendah` : "Aman", value: "Suhu 23–30°C" },
    misting: { title: "RH rendah", output: "Mist ON", recommended: rhLow.length > 0, affectedBeds: names(rhLow), info: rhLow.length ? `${rhLow.length} bed RH rendah` : rhHigh.length ? `${rhHigh.length} bed RH tinggi` : "Aman", value: "Ideal 58–82%" },
    growLight: { title: "Cahaya rendah", output: "Light ON", recommended: lightLow.length > 0, affectedBeds: names(lightLow), info: lightLow.length ? `${lightLow.length} bed cahaya rendah` : lightHigh.length ? `${lightHigh.length} bed cahaya tinggi` : "Aman", value: "Ideal 520–1000 lux" }
  };
}

function applyAuto() {
  const rules = computeRules();
  state.actuators.pump = rules.pump.recommended;
  state.actuators.fan = rules.fan.recommended;
  state.actuators.misting = rules.misting.recommended;
  state.actuators.growLight = rules.growLight.recommended;
}

function simulateStep() {
  if (state.mode === "AUTO") applyAuto();

  state.readings.forEach((bed) => {
    bed.temperature = clamp(bed.temperature + rand(-0.15, 0.24), 20, 38);
    bed.airHumidity = clamp(bed.airHumidity + rand(-0.55, 0.45), 35, 92);
    bed.soilMoisture = clamp(bed.soilMoisture + rand(-0.65, 0.25), 15, 92);
    bed.light = clamp(bed.light + rand(-28, 28), 120, 1050);

    if (state.actuators.pump) { bed.soilMoisture += bed.soilMoisture < 45 ? rand(3.4, 6.0) : rand(0.4, 1.2); bed.temperature -= rand(0.0, 0.12); }
    if (state.actuators.fan) { bed.temperature -= bed.temperature > 30 ? rand(0.8, 1.5) : rand(0.22, 0.65); bed.airHumidity -= bed.airHumidity > 82 ? rand(1.4, 2.6) : rand(0.2, 0.8); }
    if (state.actuators.misting) { bed.airHumidity += bed.airHumidity < 58 ? rand(4.2, 7.0) : rand(0.8, 2.0); bed.temperature -= rand(0.12, 0.5); }
    if (state.actuators.growLight) { bed.light += bed.light < 520 ? rand(75, 130) : rand(16, 45); bed.temperature += rand(0.05, 0.25); }

    if (state.mode === "AUTO") {
      bed.temperature += (27 - bed.temperature) * 0.08;
      bed.airHumidity += (68 - bed.airHumidity) * 0.07;
      bed.soilMoisture += (61 - bed.soilMoisture) * 0.05;
      bed.light += (760 - bed.light) * 0.07;
    }

    bed.temperature = Number(clamp(bed.temperature, 20, 38).toFixed(1));
    bed.airHumidity = Number(clamp(bed.airHumidity, 35, 92).toFixed(1));
    bed.soilMoisture = Number(clamp(bed.soilMoisture, 15, 92).toFixed(1));
    bed.light = Math.round(clamp(bed.light, 120, 1050));
    evaluateBed(bed);
  });

  if (state.mode === "AUTO") applyAuto();

  state.history.push({
    time: new Date().toLocaleTimeString("id-ID", { hour12: false }),
    temperature: avg("temperature"),
    humidity: avg("airHumidity"),
    soil: avg("soilMoisture"),
    light: avg("light")
  });
  if (state.history.length > 48) state.history.shift();

  renderAll();
}

function makeRecommendation(bed) {
  if (!bed.issues || !bed.issues.length) return "Kondisi stabil. Tidak ada tindakan khusus yang perlu dilakukan saat ini.";
  const rec = [];
  if (bed.soilMoisture < 45) rec.push("aktifkan pompa air");
  if (bed.soilMoisture > 80) rec.push("kurangi irigasi");
  if (bed.temperature > 30) rec.push("aktifkan kipas exhaust");
  if (bed.temperature < 23) rec.push("kurangi pendinginan");
  if (bed.airHumidity < 58) rec.push("aktifkan mist sprayer");
  if (bed.airHumidity > 82) rec.push("tingkatkan sirkulasi udara");
  if (bed.light < 520) rec.push("aktifkan grow light");
  if (bed.light > 1000) rec.push("lakukan peneduhan manual");
  return `Saran tindakan: ${rec.join(", ")}.`;
}

function setModeButtons() {
  $("autoBtn").className = `mode-btn ${state.mode === "AUTO" ? "active auto" : ""}`;
  $("manualBtn").className = `mode-btn ${state.mode === "MANUAL" ? "active manual" : ""}`;
}

function updateSummary() {
  const counts = state.readings.reduce((acc, bed) => {
    acc[bed.status] = (acc[bed.status] || 0) + 1;
    return acc;
  }, { Normal: 0, Warning: 0, Bahaya: 0 });

  $("avgTemp").textContent = fmt(avg("temperature"), " °C");
  $("avgRh").textContent = fmt(avg("airHumidity"), " %");
  $("avgSoil").textContent = fmt(avg("soilMoisture"), " %");
  $("avgLight").textContent = `${Math.round(avg("light"))} lux`;
  $("normalCount").textContent = counts.Normal || 0;
  $("warningCount").textContent = counts.Warning || 0;
  $("dangerCount").textContent = counts.Bahaya || 0;
  $("updatedText").textContent = `Update terakhir: ${new Date().toLocaleTimeString("id-ID", { hour12: false })}`;
  setModeButtons();
}

function renderBeds() {
  $("bedGrid").innerHTML = state.readings.map((bed) => {
    const cls = statusClass(bed.status);
    return `
      <button class="bed-card ${cls} ${bed.id === state.selectedId ? "selected" : ""}" onclick="selectBed(${bed.id})">
        <div class="bed-top"><span>${bed.name}</span><i class="dot ${cls}"></i></div>
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
  const cls = statusClass(bed.status);

  $("selectedTitle").textContent = bed.name;
  $("selectedStatus").className = `status-pill ${cls}`;
  $("selectedStatus").textContent = bed.status;
  $("detailMetrics").innerHTML = `
    <div class="metric-box"><span>Suhu Udara</span><b>${fmt(bed.temperature, " °C")}</b></div>
    <div class="metric-box"><span>Kelembaban Udara</span><b>${fmt(bed.airHumidity, " %")}</b></div>
    <div class="metric-box"><span>Kelembaban Tanah</span><b>${fmt(bed.soilMoisture, " %")}</b></div>
    <div class="metric-box"><span>Intensitas Cahaya</span><b>${Math.round(bed.light)} lux</b></div>
  `;
  $("recommendation").innerHTML = `<b>${issueText(bed)}</b><br>${makeRecommendation(bed)}`;
}

function renderActuators() {
  $("actuatorGrid").innerHTML = Object.entries(actuatorInfo).map(([key, item]) => {
    const on = Boolean(state.actuators[key]);
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
  const rules = computeRules();
  const order = ["pump", "fan", "misting", "growLight"];
  $("rulesGrid").innerHTML = order.map((key) => {
    const rule = rules[key] || {};
    const active = Boolean(state.actuators[key]);
    const trigger = rule.affectedBeds && rule.affectedBeds.length ? rule.affectedBeds.join(", ") : "Tidak ada";
    return `
      <div class="rule-card ${active ? "active" : ""}">
        <i class="rule-line"></i>
        <b>${rule.title || "-"}</b>
        <span>${rule.output || "-"} · ${rule.value || ""}</span>
        <em>${active ? "AKTIF" : "STANDBY"}</em>
        <span>${rule.info || ""}</span>
        <span>Pemicu: ${trigger}</span>
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

  const pad = { left: 38, right: 18, top: 20, bottom: 34 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const data = state.history.slice(-28);
  if (data.length < 2) return;

  ctx.strokeStyle = "#e4edf1";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * h;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  function plot(key, min, max, color, label) {
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
    plot("temperature", 20, 38, "#dd1f26", "Suhu"),
    plot("humidity", 35, 92, "#0ea5a8", "RH"),
    plot("soil", 15, 92, "#0c8b61", "Soil"),
    plot("light", 120, 1050, "#f3bd00", "Cahaya")
  ];

  let lx = pad.left;
  ctx.font = "bold 12px Inter, sans-serif";
  labels.forEach((item) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, height - 18, 12, 4);
    ctx.fillStyle = "#52616B";
    ctx.fillText(item.label, lx + 18, height - 12);
    lx += 92;
  });
}

function renderAll() {
  updateSummary();
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

function toggleActuator(name) {
  state.mode = "MANUAL";
  state.actuators[name] = !state.actuators[name];
  renderAll();
}

function setMode(mode) {
  state.mode = mode;
  if (mode === "AUTO") applyAuto();
  renderAll();
}

window.selectBed = selectBed;
window.toggleActuator = toggleActuator;

$("autoBtn").addEventListener("click", () => setMode("AUTO"));
$("manualBtn").addEventListener("click", () => setMode("MANUAL"));

if ($("connectionText")) $("connectionText").textContent = "Simulasi statis aktif";

initBeds();
renderAll();
setInterval(simulateStep, 2500);
