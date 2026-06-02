const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const clients = new Set();
const history = [];
const MAX_HISTORY = 48;

let systemMode = "AUTO";
let lastUpdated = new Date();

const IDEAL = {
  temperature: { min: 23, max: 30, dangerLow: 21.5, dangerHigh: 34.5, unit: "°C" },
  airHumidity: { min: 58, max: 82, dangerLow: 40, dangerHigh: 90, unit: "%" },
  soilMoisture: { min: 45, max: 80, dangerLow: 25, dangerHigh: 88, unit: "%" },
  light: { min: 520, max: 1000, dangerLow: 260, dangerHigh: 1045, unit: "lux" }
};

const AUTO_OFF = {
  soilMoisture: 55,
  temperature: 28.5,
  airHumidity: 66,
  light: 650
};

const actuators = {
  pump: false,
  fan: false,
  misting: false,
  growLight: false
};

const actuatorMeta = {
  pump: { label: "Pompa Air", icon: "💧", affects: "Kelembaban tanah" },
  fan: { label: "Kipas Exhaust", icon: "🌀", affects: "Suhu & RH tinggi" },
  misting: { label: "Mist Sprayer", icon: "🌫", affects: "Kelembaban udara" },
  growLight: { label: "Grow Light", icon: "💡", affects: "Intensitas cahaya" }
};

const beds = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Bed ${i + 1}`,
  temperature: rand(24.5, 29.2),
  airHumidity: rand(60, 78),
  soilMoisture: rand(50, 72),
  light: Math.round(rand(570, 860)),
  status: "Normal",
  issues: []
}));

function rand(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function avg(key) {
  return round1(beds.reduce((sum, b) => sum + b[key], 0) / beds.length);
}

function minOf(key) {
  return Math.min(...beds.map(b => b[key]));
}

function maxOf(key) {
  return Math.max(...beds.map(b => b[key]));
}

function names(list) {
  return list.map(b => b.name);
}

function evaluateBed(bed) {
  const issues = [];
  const danger = [];

  if (bed.temperature < IDEAL.temperature.min) issues.push("Suhu rendah");
  if (bed.temperature > IDEAL.temperature.max) issues.push("Suhu tinggi");
  if (bed.temperature <= IDEAL.temperature.dangerLow) danger.push("Suhu sangat rendah");
  if (bed.temperature >= IDEAL.temperature.dangerHigh) danger.push("Suhu sangat tinggi");

  if (bed.airHumidity < IDEAL.airHumidity.min) issues.push("RH rendah");
  if (bed.airHumidity > IDEAL.airHumidity.max) issues.push("RH tinggi");
  if (bed.airHumidity <= IDEAL.airHumidity.dangerLow) danger.push("RH sangat rendah");
  if (bed.airHumidity >= IDEAL.airHumidity.dangerHigh) danger.push("RH sangat tinggi");

  if (bed.soilMoisture < IDEAL.soilMoisture.min) issues.push("Soil kering");
  if (bed.soilMoisture > IDEAL.soilMoisture.max) issues.push("Soil basah");
  if (bed.soilMoisture <= IDEAL.soilMoisture.dangerLow) danger.push("Soil sangat kering");
  if (bed.soilMoisture >= IDEAL.soilMoisture.dangerHigh) danger.push("Soil sangat basah");

  if (bed.light < IDEAL.light.min) issues.push("Cahaya rendah");
  if (bed.light > IDEAL.light.max) issues.push("Cahaya tinggi");
  if (bed.light <= IDEAL.light.dangerLow) danger.push("Cahaya sangat rendah");
  if (bed.light >= IDEAL.light.dangerHigh) danger.push("Cahaya sangat tinggi");

  bed.issues = [...danger, ...issues];
  bed.status = danger.length ? "Bahaya" : issues.length ? "Warning" : "Normal";
  bed.riskScore = riskScore(bed);
}

function riskScore(bed) {
  let score = 0;
  score += Math.max(0, IDEAL.temperature.min - bed.temperature) * 3;
  score += Math.max(0, bed.temperature - IDEAL.temperature.max) * 4;
  score += Math.max(0, IDEAL.airHumidity.min - bed.airHumidity) * 2;
  score += Math.max(0, bed.airHumidity - IDEAL.airHumidity.max) * 2;
  score += Math.max(0, IDEAL.soilMoisture.min - bed.soilMoisture) * 3;
  score += Math.max(0, bed.soilMoisture - IDEAL.soilMoisture.max) * 2.5;
  score += Math.max(0, IDEAL.light.min - bed.light) / 60;
  score += Math.max(0, bed.light - IDEAL.light.max) / 80;
  if (bed.status === "Bahaya") score += 80;
  if (bed.status === "Warning") score += 30;
  return round1(score);
}

function computeRules() {
  const soilLow = beds.filter(b => b.soilMoisture < IDEAL.soilMoisture.min);
  const soilRecovered = beds.every(b => b.soilMoisture >= AUTO_OFF.soilMoisture);
  const soilHigh = beds.filter(b => b.soilMoisture > IDEAL.soilMoisture.max);

  const tempHigh = beds.filter(b => b.temperature > IDEAL.temperature.max);
  const tempRecovered = beds.every(b => b.temperature <= AUTO_OFF.temperature);
  const tempLow = beds.filter(b => b.temperature < IDEAL.temperature.min);

  const rhLow = beds.filter(b => b.airHumidity < IDEAL.airHumidity.min);
  const rhRecovered = beds.every(b => b.airHumidity >= AUTO_OFF.airHumidity);
  const rhHigh = beds.filter(b => b.airHumidity > IDEAL.airHumidity.max);

  const lightLow = beds.filter(b => b.light < IDEAL.light.min);
  const lightRecovered = beds.every(b => b.light >= AUTO_OFF.light);
  const lightHigh = beds.filter(b => b.light > IDEAL.light.max);

  const pump = actuators.pump ? !soilRecovered : soilLow.length > 0;
  const fan = actuators.fan ? !(tempRecovered && rhHigh.length === 0) : tempHigh.length > 0 || rhHigh.length > 0;
  const misting = actuators.misting ? !rhRecovered : rhLow.length > 0;
  const growLight = actuators.growLight ? !lightRecovered : lightLow.length > 0;

  return {
    pump: {
      title: "Soil rendah",
      output: "Pompa Air ON",
      active: actuators.pump,
      recommended: pump,
      affectedBeds: names(soilLow),
      info: soilLow.length ? `${soilLow.length} bed kering` : soilHigh.length ? `${soilHigh.length} bed terlalu basah` : "Aman",
      value: `Ideal ${IDEAL.soilMoisture.min}–${IDEAL.soilMoisture.max}%`
    },
    fan: {
      title: "Suhu/RH tinggi",
      output: "Kipas ON",
      active: actuators.fan,
      recommended: fan,
      affectedBeds: names([...new Set([...tempHigh, ...rhHigh])]),
      info: tempHigh.length || rhHigh.length ? `${tempHigh.length} suhu tinggi · ${rhHigh.length} RH tinggi` : tempLow.length ? `${tempLow.length} suhu rendah` : "Aman",
      value: `Suhu ${IDEAL.temperature.min}–${IDEAL.temperature.max}°C`
    },
    misting: {
      title: "RH rendah",
      output: "Mist ON",
      active: actuators.misting,
      recommended: misting,
      affectedBeds: names(rhLow),
      info: rhLow.length ? `${rhLow.length} bed RH rendah` : rhHigh.length ? `${rhHigh.length} bed RH tinggi` : "Aman",
      value: `Ideal ${IDEAL.airHumidity.min}–${IDEAL.airHumidity.max}%`
    },
    growLight: {
      title: "Cahaya rendah",
      output: "Light ON",
      active: actuators.growLight,
      recommended: growLight,
      affectedBeds: names(lightLow),
      info: lightLow.length ? `${lightLow.length} bed cahaya rendah` : lightHigh.length ? `${lightHigh.length} bed cahaya tinggi` : "Aman",
      value: `Ideal ${IDEAL.light.min}–${IDEAL.light.max} lux`
    }
  };
}

function applyAutoRules() {
  const rules = computeRules();
  actuators.pump = rules.pump.recommended;
  actuators.fan = rules.fan.recommended;
  actuators.misting = rules.misting.recommended;
  actuators.growLight = rules.growLight.recommended;
}

function recommendation(bed) {
  if (!bed.issues.length) return "Kondisi stabil. Tidak ada tindakan khusus.";
  const actions = [];
  if (bed.soilMoisture < IDEAL.soilMoisture.min) actions.push("pompa air ON");
  if (bed.soilMoisture > IDEAL.soilMoisture.max) actions.push("kurangi irigasi");
  if (bed.temperature > IDEAL.temperature.max) actions.push("kipas ON");
  if (bed.temperature < IDEAL.temperature.min) actions.push("kurangi pendinginan");
  if (bed.airHumidity < IDEAL.airHumidity.min) actions.push("mist sprayer ON");
  if (bed.airHumidity > IDEAL.airHumidity.max) actions.push("sirkulasi udara ditingkatkan");
  if (bed.light < IDEAL.light.min) actions.push("grow light ON");
  if (bed.light > IDEAL.light.max) actions.push("peneduhan manual");
  return `Saran: ${actions.join(", ")}.`;
}

function summary() {
  const counts = beds.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, { Normal: 0, Warning: 0, Bahaya: 0 });

  return {
    avgTemperature: avg("temperature"),
    avgAirHumidity: avg("airHumidity"),
    avgSoilMoisture: avg("soilMoisture"),
    avgLight: Math.round(avg("light")),
    minMax: {
      temperature: { min: minOf("temperature"), max: maxOf("temperature") },
      airHumidity: { min: minOf("airHumidity"), max: maxOf("airHumidity") },
      soilMoisture: { min: minOf("soilMoisture"), max: maxOf("soilMoisture") },
      light: { min: minOf("light"), max: maxOf("light") }
    },
    counts,
    activeActuators: Object.values(actuators).filter(Boolean).length,
    mode: systemMode,
    actuators,
    actuatorMeta,
    rules: computeRules(),
    ideal: IDEAL,
    lastUpdated: lastUpdated.toISOString()
  };
}

function updateData() {
  if (systemMode === "AUTO") applyAutoRules();

  beds.forEach(bed => {
    // drift halus agar dashboard tidak terlalu acak dan tidak terus warning
    bed.temperature = clamp(bed.temperature + rand(-0.15, 0.24), 20, 38);
    bed.airHumidity = clamp(bed.airHumidity + rand(-0.55, 0.45), 35, 92);
    bed.soilMoisture = clamp(bed.soilMoisture + rand(-0.65, 0.25), 15, 92);
    bed.light = clamp(bed.light + rand(-28, 28), 120, 1050);

    if (actuators.pump) {
      bed.soilMoisture += bed.soilMoisture < 45 ? rand(3.4, 6.0) : rand(0.4, 1.2);
      bed.temperature -= rand(0.0, 0.12);
    }
    if (actuators.fan) {
      bed.temperature -= bed.temperature > 30 ? rand(0.8, 1.5) : rand(0.22, 0.65);
      if (bed.airHumidity > 82) bed.airHumidity -= rand(1.4, 2.6);
      else bed.airHumidity -= rand(0.2, 0.8);
    }
    if (actuators.misting) {
      bed.airHumidity += bed.airHumidity < 58 ? rand(4.2, 7.0) : rand(0.8, 2.0);
      bed.temperature -= rand(0.12, 0.5);
    }
    if (actuators.growLight) {
      bed.light += bed.light < 520 ? rand(75, 130) : rand(16, 45);
      bed.temperature += rand(0.05, 0.25);
    }

    if (systemMode === "AUTO") {
      // stabilisasi pasif ke kondisi ideal
      bed.temperature += (27 - bed.temperature) * 0.08;
      bed.airHumidity += (68 - bed.airHumidity) * 0.07;
      bed.soilMoisture += (61 - bed.soilMoisture) * 0.05;
      bed.light += (760 - bed.light) * 0.07;
    }

    bed.temperature = round1(clamp(bed.temperature, 20, 38));
    bed.airHumidity = round1(clamp(bed.airHumidity, 35, 92));
    bed.soilMoisture = round1(clamp(bed.soilMoisture, 15, 92));
    bed.light = Math.round(clamp(bed.light, 120, 1050));
    evaluateBed(bed);
  });

  if (systemMode === "AUTO") applyAutoRules();

  lastUpdated = new Date();
  const s = summary();
  history.push({
    time: lastUpdated.toLocaleTimeString("id-ID", { hour12: false }),
    temperature: s.avgTemperature,
    humidity: s.avgAirHumidity,
    soil: s.avgSoilMoisture,
    light: s.avgLight
  });
  if (history.length > MAX_HISTORY) history.shift();

  broadcast({ readings: beds, summary: s, history });
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

function serveStatic(res, filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, content) => {
    if (err) return sendJson(res, 404, { error: "File not found" });
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function statePayload() {
  return { readings: beds, summary: summary(), history };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  if (pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(statePayload())}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (pathname === "/api/readings" && req.method === "GET") {
    return sendJson(res, 200, statePayload());
  }

  if (pathname === "/api/mode" && req.method === "POST") {
    const body = await parseBody(req);
    systemMode = body.mode === "MANUAL" ? "MANUAL" : "AUTO";
    if (systemMode === "AUTO") applyAutoRules();
    lastUpdated = new Date();
    broadcast(statePayload());
    return sendJson(res, 200, { ok: true, mode: systemMode });
  }

  if (pathname === "/api/actuator" && req.method === "POST") {
    const body = await parseBody(req);
    const name = String(body.name || "");
    if (!(name in actuators)) return sendJson(res, 400, { ok: false, error: "Aktuator tidak valid" });
    systemMode = "MANUAL";
    actuators[name] = Boolean(body.value);
    lastUpdated = new Date();
    broadcast(statePayload());
    return sendJson(res, 200, { ok: true, mode: systemMode, actuators });
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const safe = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  serveStatic(res, path.join(PUBLIC_DIR, safe));
});

beds.forEach(evaluateBed);
updateData();
setInterval(updateData, 2500);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard berjalan di http://localhost:${PORT}`);
});
