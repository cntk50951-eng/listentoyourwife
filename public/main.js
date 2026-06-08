async function postJSON(u, b) { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return r.json(); }

async function blobToWavBase64(blob) {
  const buf = await blob.arrayBuffer(), ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(buf);
  const offline = new OfflineAudioContext(1, audio.duration * 16000, 16000);
  const src = offline.createBufferSource(); src.buffer = audio; src.connect(offline.destination); src.start(0);
  const rendered = await offline.startRendering(); await ctx.close();
  const wav = encodeWav(rendered), bytes = new Uint8Array(wav); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function encodeWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
  const len = d[0].length, dLen = len * ch * 2, out = new ArrayBuffer(44 + dLen), v = new DataView(out);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dLen, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, dLen, true);
  let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, d[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
  return out;
}

// DOM
const onboarding = document.getElementById("onboarding"), recorder = document.getElementById("recorder");
const transcriptSection = document.getElementById("transcriptSection"), recordBtn = document.getElementById("recordBtn");
const timerEl = document.getElementById("timer"), statusEl = document.getElementById("status");
const canvasEl = document.getElementById("wave"), ctx = canvasEl.getContext("2d");
const groupSelect = document.getElementById("groupSelect"), intervalSelect = document.getElementById("intervalSelect");
const thresholdSelect = document.getElementById("thresholdSelect");
const transcriptList = document.getElementById("transcriptList"), copyBtn = document.getElementById("copyBtn");

// State
const SK = "ltwy_entries", SG = "ltwy_group";
let listening = false, sessionStart = 0, mediaRecorder = null, audioStream = null;
let audioChunks = [], cycleTimer = null, cycleTimeout = null;
let entries = [], pendingBlobs = [];
let segIdx = 0, sessionId = "";

// Init
async function init() {
  const groups = getGroups();
  if (groups.length === 0) {
    onboarding.classList.remove("hidden"); recorder.classList.add("hidden"); transcriptSection.classList.add("hidden");
    return;
  }
  onboarding.classList.add("hidden"); recorder.classList.remove("hidden"); transcriptSection.classList.remove("hidden");
  const savedGroup = localStorage.getItem(SG) || groups[0].groupId;
  groupSelect.innerHTML = groups.map((g) => `<option value="${esc(g.groupId)}" ${g.groupId === savedGroup ? "selected" : ""}>${esc(g.groupName || g.groupId)}</option>`).join("");
  groupSelect.addEventListener("change", () => localStorage.setItem(SG, groupSelect.value));
  intervalSelect.addEventListener("change", () => localStorage.setItem("ltwy_interval", intervalSelect.value));
  thresholdSelect.addEventListener("change", () => localStorage.setItem("ltwy_threshold", thresholdSelect.value));
  restorePref("groupSelect", SG);
  restorePref("intervalSelect", "ltwy_interval");
  restorePref("thresholdSelect", "ltwy_threshold");
  await loadEntries();
}
function getGroups() { try { return JSON.parse(localStorage.getItem("isv_groups") || "[]"); } catch { return []; } }
function restorePref(elId, key) { const v = localStorage.getItem(key); if (v) document.getElementById(elId).value = v; }
// Clean legacy storage keys from previous versions
try { ["ltwy_sessions"].forEach((k) => localStorage.removeItem(k)); } catch {}

// Recording — one cycle = one segment
let cycleActive = false;

function beginCycle() {
  if (!listening) return;
  audioChunks = [];
  cycleActive = true;
  navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    .then((stream) => {
      if (!listening) { stream.getTracks().forEach((t) => t.stop()); cycleActive = false; return; }
      audioStream = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        // Clean up stream
        if (audioStream) { audioStream.getTracks().forEach((t) => t.stop()); audioStream = null; }
        cycleActive = false;
        if (audioChunks.length === 0) return;
        // Save this segment
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        const id = `${sessionId}_${segIdx++}`;
        pendingBlobs.push({ id, blob, time });
        if (!Array.isArray(entries)) entries = [];
        entries.push({ id, time, matched: null, score: 0, text: "" });
        renderEntries(); saveEntries();
        // Auto-process if still listening; leave pending if stopped
        if (listening) {
          processEntry(id).then(() => scheduleNextCycle());
        }
      };
      mediaRecorder.onerror = () => { cycleActive = false; if (listening) scheduleNextCycle(); };
      mediaRecorder.start(1000);
      // Schedule end of this cycle
      const intervalMs = (parseInt(intervalSelect.value) || 5) * 60 * 1000;
      cycleTimeout = setTimeout(() => endCycle(), intervalMs);
    })
    .catch((e) => { statusEl.textContent = "麦克风不可用: " + e.message; });
}

function endCycle() {
  if (cycleTimeout) { clearTimeout(cycleTimeout); cycleTimeout = null; }
  cycleActive = false;
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

function scheduleNextCycle() {
  if (!listening) return;
  cycleTimeout = setTimeout(() => beginCycle(), 200); // small delay between cycles
}

// Start / Stop
recordBtn.addEventListener("click", () => { if (listening) stopAll(); else startAll(); });

function startAll() {
  listening = true; segIdx = 0; sessionId = "s_" + Date.now(); sessionStart = Date.now();
  recordBtn.textContent = "结束"; recordBtn.className = "btn-record recording";
  statusEl.textContent = "🔴 正在记录";
  beginCycle();
  tickLoop();
}

function stopAll() {
  listening = false;
  recordBtn.textContent = "开始记录"; recordBtn.className = "btn-record idle";
  statusEl.textContent = "已停止 — 点击每段旁边的「整理」处理";
  endCycle();
}

// Manual processing
async function processEntry(entryId) {
  const pb = pendingBlobs.find((p) => p.id === entryId);
  if (!pb) return;
  updateEntry(entryId, { matched: null, text: "整理中..." }); // busy
  try {
    const wavB64 = await blobToWavBase64(pb.blob);
    const groupId = groupSelect.value;
    if (!groupId) { updateEntry(entryId, { matched: false }); return; }
    const search = await postJSON("/api/isv/search", { groupId, audioBase64: wavB64, topK: 1 });
    const top = (search.scoreList || [])[0];
    const threshold = parseFloat(thresholdSelect.value);
    if (!top || top.score < threshold) { updateEntry(entryId, { matched: false }); return; }
    updateEntry(entryId, { matched: true, score: top.score, text: "识别中..." });
    const asr = await postJSON("/api/asr/transcribe", { audioBase64: wavB64, accent: "cn_cantonese" });
    updateEntry(entryId, { text: asr.text || "(未识别到文字)" });
  } catch (err) { updateEntry(entryId, { matched: false, text: "出错: " + err.message }); }
}
function updateEntry(id, patch) { const e = entries.find((x) => x.id === id); if (e) Object.assign(e, patch); renderEntries(); saveEntries(); }

// Rendering
function renderEntries() {
  if (entries.length === 0) { transcriptList.innerHTML = '<div class="empty">按下按钮，老婆说的话会自动出现在这里</div>'; return; }
  transcriptList.innerHTML = entries.slice().reverse().map((e) => {
    let badge = "", action = "", chat = "";
    if (e.matched === null && (e.text === "整理中..." || !e.text)) {
      badge = '<span class="entry-badge badge-busy">待整理</span>';
      if (e.text !== "整理中...") action = `<span class="entry-action"><button onclick="processEntry('${e.id}')">整理</button></span>`;
    } else if (e.matched === null && e.text === "整理中...") {
      badge = '<span class="entry-badge badge-busy">整理中</span>';
    } else if (e.matched) {
      badge = '<span class="entry-badge badge-wife">老婆</span>';
      action = `<span class="entry-chat-toggle" onclick="toggleChat('${e.id}')" title="AI 分析">💬</span>`;
      if (e.chatOpen) chat = renderChatPanel(e);
    } else {
      badge = '<span class="entry-badge badge-other">其他人</span>';
    }
    return `<div class="entry-wrap" id="wrap-${e.id}"><div class="entry"><span class="entry-time">${e.time}</span>${badge}
      <span class="entry-text${e.matched === false ? " other" : ""}">${esc(e.text || "—")}</span>${action}</div>${chat}</div>`;
  }).join("");
}

function renderChatPanel(e) {
  const msgs = (e.chatMessages || []).map((m) =>
    `<div class="chat-msg"><span class="role">${m.role === "user" ? "你" : "AI"}:</span> ${esc(m.content)}</div>`
  ).join("");
  const memoBtn = e.chatMessages && e.chatMessages.length > 1
    ? `<button class="memo-btn" onclick="saveMemo('${e.id}')">📝 记入备忘录</button>` : "";
  return `<div class="chat-panel" id="chat-${e.id}">
    ${msgs}
    <div class="chat-input-row">
      <input id="chat-input-${e.id}" placeholder="基于这段话问 AI..." onkeydown="if(event.key==='Enter')sendChat('${e.id}')" />
      <button onclick="sendChat('${e.id}')">发送</button>
      ${memoBtn}
    </div>
  </div>`;
}

// Chat
window.toggleChat = function(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  if (!e.chatMessages) e.chatMessages = [];
  e.chatOpen = !e.chatOpen;
  renderEntries();
  saveEntries();
  if (e.chatOpen) setTimeout(() => { const inp = document.getElementById("chat-input-" + id); if (inp) inp.focus(); }, 100);
};

window.sendChat = async function(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  const inp = document.getElementById("chat-input-" + id);
  if (!inp || !inp.value.trim()) return;
  const userMsg = inp.value.trim(); inp.value = ""; inp.disabled = true;
  if (!e.chatMessages) e.chatMessages = [];
  e.chatMessages.push({ role: "user", content: userMsg });
  renderEntries(); saveEntries();
  // Build messages for API: system + context + conversation
  const messages = [
    { role: "system", content: "你是老婆的生活助理。根据老婆说的话，帮她提取待办事项、行程安排、购物清单、提醒等。用简洁的中文回复，用 bullet points 列出要点。" },
    { role: "user", content: `老婆说: "${e.text}"\n\n${userMsg}` }
  ];
  try {
    const res = await postJSON("/api/chat", { messages });
    if (res.ok) e.chatMessages.push({ role: "assistant", content: res.content });
    else e.chatMessages.push({ role: "assistant", content: "AI 调用失败: " + (res.error || "") });
  } catch (err) { e.chatMessages.push({ role: "assistant", content: "错误: " + err.message }); }
  renderEntries(); saveEntries();
  const inp2 = document.getElementById("chat-input-" + id); if (inp2) { inp2.disabled = false; inp2.focus(); }
};

// Memo
window.saveMemo = async function(id) {
  const e = entries.find((x) => x.id === id);
  if (!e || !e.chatMessages) return;
  const aiReply = e.chatMessages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
  try {
    await postJSON("/api/memos", { source: e.text, ai_reply: aiReply });
    alert("已记入备忘录 ✓");
  } catch (err) { alert("保存失败: " + err.message); }
};
async function saveEntries() {
  try {
    const batch = entries.slice(-50).map((e) => ({
      entry_id: e.id, session_id: sessionId || "", time_str: e.time,
      matched: e.matched, score: e.score, text: e.text
    }));
    await postJSON("/api/transcripts", { entries: batch });
  } catch { /* DB offline, skip */ }
}
async function loadEntries() {
  try {
    const res = await fetch("/api/transcripts").then((r) => r.json());
    if (res.ok && Array.isArray(res.entries)) {
      entries = res.entries.map((r) => ({
        id: r.entry_id, time: r.time_str || "",
        matched: r.matched, score: r.score || 0, text: r.text || ""
      }));
    }
  } catch { entries = []; }
  pendingBlobs = []; // blobs don't survive refresh
  renderEntries();
}

// Timer + Wave
function tickLoop() {
  function tick() { if (!listening) return; const e = Date.now() - sessionStart; timerEl.textContent = `${pad(Math.floor(e / 3600000))}:${pad(Math.floor((e % 3600000) / 60000))}:${pad(Math.floor((e % 60000) / 1000))}`; drawWave(); requestAnimationFrame(() => setTimeout(tick, 250)); }
  tick();
}
function drawWave() { const w = canvasEl.width, h = canvasEl.height; ctx.clearRect(0, 0, w, h); if (!listening) return; for (let i = 0; i < 40; i++) { const bh = (Math.sin(Date.now() / 150 + i * 0.4) * 0.5 + 0.5) * h * 0.7 + h * 0.15; ctx.fillStyle = "#e74c3c"; ctx.fillRect(i * 7 + 1, (h - bh) / 2, 5, bh); } }

// Copy
copyBtn.addEventListener("click", () => {
  const text = entries.filter((e) => e.matched && e.text).map((e) => `[${e.time}] ${e.text}`).join("\n");
  if (!text) return alert("还没有老婆说的内容");
  navigator.clipboard.writeText(text).then(() => alert("已复制")).catch(() => alert(text));
});

window.processEntry = processEntry;

function pad(n) { return String(n).padStart(2, "0"); }
function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
init();
