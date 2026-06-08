// ── Helpers ──────────────────────────────────────────────────────────────────

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function deleteJSON(url) {
  const res = await fetch(url, { method: "DELETE" });
  return res.json();
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

// ── Audio Recording ──────────────────────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let recordingStartTime = 0;
let recordingTimer = null;
let recordedBlob = null;
let recordedBase64 = null;

const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const timerEl = document.getElementById("recordingTimer");
const previewAudio = document.getElementById("previewAudio");
const canvasEl = document.getElementById("waveCanvas");
const canvasCtx = canvasEl.getContext("2d");

recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

async function startRecording() {
  audioChunks = [];
  recordedBlob = null;
  recordedBase64 = null;
  previewAudio.classList.add("hidden");

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
  } catch {
    // fallback: some browsers ignore constraints
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  // Prefer webm/opus, fallback to whatever is available
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";

  mediaRecorder = new MediaRecorder(recordingStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    // Stop all tracks
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;

    if (audioChunks.length === 0) return;

    recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
    const previewUrl = URL.createObjectURL(recordedBlob);
    previewAudio.src = previewUrl;
    previewAudio.classList.remove("hidden");

    // Convert to WAV 16kHz mono PCM → base64
    const statusEl = document.getElementById("convertStatus");
    statusEl.textContent = "正在转换音频格式...";
    try {
      recordedBase64 = await blobToWavBase64(recordedBlob);
      statusEl.textContent = "✓ 音频就绪，可上传到声纹库";
      statusEl.style.color = "green";
    } catch (err) {
      statusEl.textContent = `转换失败: ${err.message}`;
      statusEl.style.color = "red";
      recordedBase64 = null;
    }
  };

  mediaRecorder.start(250); // timeslice for chunked data
  recordingStartTime = Date.now();
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  updateTimer();
  recordingTimer = setInterval(updateTimer, 200);
  drawWaveformLoop();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
}

function updateTimer() {
  const elapsed = Date.now() - recordingStartTime;
  const secs = Math.floor(elapsed / 1000);
  const mins = Math.floor(secs / 60);
  timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

// ── Waveform visualization ──────────────────────────────────────────────────

let waveformId = 0;
function drawWaveformLoop() {
  const id = ++waveformId;
  function frame() {
    if (id !== waveformId) return;
    drawWaveform();
    if (mediaRecorder && mediaRecorder.state === "recording") {
      requestAnimationFrame(frame);
    }
  }
  requestAnimationFrame(frame);
}

function drawWaveform() {
  const w = canvasEl.width;
  const h = canvasEl.height;
  canvasCtx.clearRect(0, 0, w, h);
  canvasCtx.strokeStyle = "#e74c3c";
  canvasCtx.lineWidth = 2;
  canvasCtx.beginPath();

  const bars = 40;
  const barW = (w / bars) * 0.6;
  const gap = w / bars;

  for (let i = 0; i < bars; i++) {
    const height = (Math.sin(Date.now() / 150 + i * 0.4) * 0.5 + 0.5) * h * 0.8 + h * 0.1;
    const x = i * gap + (gap - barW) / 2;
    canvasCtx.fillStyle = "#e74c3c";
    canvasCtx.fillRect(x, (h - height) / 2, barW, height);
  }
}

// ── Audio conversion: blob → WAV 16kHz mono PCM16 → base64 ──────────────────

async function blobToWavBase64(blob) {
  // Decode the compressed audio
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Resample to 16kHz mono
  const targetSampleRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * targetSampleRate, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();

  // Close the original context to free resources
  await audioCtx.close();

  // Encode as WAV
  const wavBuffer = encodeWav(rendered);
  return arrayBufferToBase64(wavBuffer);
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;

  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  const length = channelData[0].length;
  const dataLength = length * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // subchunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // PCM data (interleaved if multi-channel, but we have mono)
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── Group Management ─────────────────────────────────────────────────────────

const refreshGroupsBtn = document.getElementById("refreshGroupsBtn");
const createGroupBtn = document.getElementById("createGroupBtn");
const deleteGroupBtn = document.getElementById("deleteGroupBtn");
const groupListEl = document.getElementById("groupList");

refreshGroupsBtn.addEventListener("click", loadGroups);
createGroupBtn.addEventListener("click", createNewGroup);
deleteGroupBtn.addEventListener("click", deleteSelectedGroup);

async function loadGroups() {
  groupListEl.textContent = "加载中...";
  // We don't have a list-groups API, so we cache group IDs locally in localStorage
  const cached = getCachedGroups();
  if (cached.length === 0) {
    groupListEl.innerHTML = '<span class="dim">暂无已创建的声纹组。请创建一个。</span>';
  } else {
    renderGroupList(cached);
  }
  renderGroupSelect(cached);
}

function getCachedGroups() {
  try {
    return JSON.parse(localStorage.getItem("isv_groups") || "[]");
  } catch {
    return [];
  }
}

function addCachedGroup(groupId, groupName) {
  const groups = getCachedGroups();
  const existing = groups.find((g) => g.groupId === groupId);
  if (existing) {
    existing.groupName = groupName;
  } else {
    groups.push({ groupId, groupName });
  }
  localStorage.setItem("isv_groups", JSON.stringify(groups));
}

function removeCachedGroup(groupId) {
  const groups = getCachedGroups().filter((g) => g.groupId !== groupId);
  localStorage.setItem("isv_groups", JSON.stringify(groups));
}

function renderGroupList(groups) {
  groupListEl.innerHTML = groups
    .map(
      (g) => `<div class="group-item" data-group-id="${g.groupId}">
        <span class="group-id">${escapeHtml(g.groupId)}</span>
        <span class="group-name">${escapeHtml(g.groupName)}</span>
      </div>`
    )
    .join("");

  // Click to select
  groupListEl.querySelectorAll(".group-item").forEach((el) => {
    el.addEventListener("click", () => {
      groupListEl.querySelectorAll(".group-item").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      loadFeaturesForGroup(el.dataset.groupId);
    });
  });
}

function renderGroupSelect(groups) {
  const opts = '<option value="">-- 选择声纹组 --</option>' +
    groups.map((g) => `<option value="${escapeHtml(g.groupId)}">${escapeHtml(g.groupName || g.groupId)}</option>`).join("");
  featureGroupSelect.innerHTML = opts;
  document.getElementById("searchGroupSelect").innerHTML = opts;
  document.getElementById("compareGroupSelect").innerHTML = opts;
}

async function createNewGroup() {
  const groupId = document.getElementById("newGroupId").value.trim();
  const groupName = document.getElementById("newGroupName").value.trim();
  const groupInfo = document.getElementById("newGroupInfo").value.trim();
  const resultEl = document.getElementById("groupResult");

  if (!groupId) { resultEl.textContent = "请输入 Group ID"; return; }

  resultEl.textContent = "创建中...";
  try {
    const res = await postJSON("/api/isv/group/create", { groupId, groupName, groupInfo });
    if (res.ok) {
      addCachedGroup(groupId, groupName || groupId);
      resultEl.textContent = `✓ 声纹组 "${res.groupId}" 创建成功`;
      resultEl.style.color = "green";
      document.getElementById("newGroupId").value = "";
      document.getElementById("newGroupName").value = "";
      document.getElementById("newGroupInfo").value = "";
      loadGroups();
    } else {
      resultEl.textContent = `✗ 创建失败: ${res.error}`;
      resultEl.style.color = "red";
    }
  } catch (err) {
    resultEl.textContent = `✗ 错误: ${err.message}`;
    resultEl.style.color = "red";
  }
}

async function deleteSelectedGroup() {
  const selected = groupListEl.querySelector(".group-item.selected");
  if (!selected) { alert("请先在列表中点击要删除的声纹组"); return; }

  const groupId = selected.dataset.groupId;
  if (!confirm(`确认删除声纹组 "${groupId}"？该组内所有声纹特征将被删除。`)) return;

  const resultEl = document.getElementById("groupResult");
  resultEl.textContent = "删除中...";
  try {
    const res = await deleteJSON(`/api/isv/group/${encodeURIComponent(groupId)}`);
    if (res.ok) {
      removeCachedGroup(groupId);
      resultEl.textContent = `✓ 声纹组 "${groupId}" 已删除`;
      resultEl.style.color = "green";
      document.getElementById("featureList").innerHTML = "";
      loadGroups();
    } else {
      resultEl.textContent = `✗ 删除失败: ${res.error}`;
      resultEl.style.color = "red";
    }
  } catch (err) {
    resultEl.textContent = `✗ 错误: ${err.message}`;
    resultEl.style.color = "red";
  }
}

// ── Feature Management ───────────────────────────────────────────────────────

const uploadFeatureBtn = document.getElementById("uploadFeatureBtn");
const deleteFeatureBtn = document.getElementById("deleteFeatureBtn");
const featureListEl = document.getElementById("featureList");
const featureGroupSelect = document.getElementById("featureGroupSelect");

// Sync feature group select with search group select
featureGroupSelect.addEventListener("change", () => {
  document.getElementById("searchGroupSelect").value = featureGroupSelect.value;
});
document.getElementById("searchGroupSelect").addEventListener("change", () => {
  featureGroupSelect.value = document.getElementById("searchGroupSelect").value;
});

uploadFeatureBtn.addEventListener("click", uploadFeature);
deleteFeatureBtn.addEventListener("click", deleteSelectedFeature);

async function loadFeaturesForGroup(groupId) {
  featureGroupSelect.value = groupId;
  document.getElementById("searchGroupSelect").value = groupId;

  if (!groupId) {
    featureListEl.innerHTML = '<span class="dim">请先选择声纹组</span>';
    return;
  }

  featureListEl.textContent = "加载中...";
  try {
    const res = await getJSON(`/api/isv/feature/list/${encodeURIComponent(groupId)}`);
    if (res.ok) {
      renderFeatureList(res.features || []);
    } else {
      featureListEl.textContent = `加载失败: ${res.error}`;
    }
  } catch (err) {
    featureListEl.textContent = `错误: ${err.message}`;
  }
}

function renderFeatureList(features) {
  if (features.length === 0) {
    featureListEl.innerHTML = '<span class="dim">该组暂无特征，请录制并上传。</span>';
    return;
  }
  featureListEl.innerHTML = features
    .map(
      (f) => `<div class="feature-item" data-feature-id="${escapeHtml(f.featureId)}">
        <span class="feature-id">${escapeHtml(f.featureId)}</span>
        <span class="feature-info">${escapeHtml(f.featureInfo || "")}</span>
      </div>`
    )
    .join("");

  featureListEl.querySelectorAll(".feature-item").forEach((el) => {
    el.addEventListener("click", () => {
      featureListEl.querySelectorAll(".feature-item").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
}

async function uploadFeature() {
  const groupId = featureGroupSelect.value;
  const resultEl = document.getElementById("featureResult");

  if (!groupId) { resultEl.textContent = "请选择目标声纹组"; return; }
  if (!recordedBase64) { resultEl.textContent = "请先录制音频"; return; }

  // Generate a feature ID with timestamp
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const featureId = `fp_${timestamp}`;
  const featureInfo = `recorded_at_${now.toLocaleString("zh-CN")}`;

  resultEl.textContent = "上传中...";
  try {
    const res = await postJSON("/api/isv/feature/create", {
      groupId,
      featureId,
      audioBase64: recordedBase64,
      featureInfo
    });
    if (res.ok) {
      resultEl.textContent = `✓ 声纹特征 "${res.featureId}" 已添加到组 "${groupId}"`;
      resultEl.style.color = "green";
      loadFeaturesForGroup(groupId);
    } else {
      resultEl.textContent = `✗ 上传失败: ${res.error}`;
      resultEl.style.color = "red";
    }
  } catch (err) {
    resultEl.textContent = `✗ 错误: ${err.message}`;
    resultEl.style.color = "red";
  }
}

async function deleteSelectedFeature() {
  const selected = featureListEl.querySelector(".feature-item.selected");
  if (!selected) { alert("请先在特征列表中点击要删除的特征"); return; }

  const featureId = selected.dataset.featureId;
  const groupId = featureGroupSelect.value;
  if (!groupId || !featureId) return;

  if (!confirm(`确认删除特征 "${featureId}"？`)) return;

  const resultEl = document.getElementById("featureResult");
  resultEl.textContent = "删除中...";
  try {
    const res = await deleteJSON(`/api/isv/feature/${encodeURIComponent(groupId)}/${encodeURIComponent(featureId)}`);
    if (res.ok) {
      resultEl.textContent = `✓ 特征 "${featureId}" 已删除`;
      resultEl.style.color = "green";
      loadFeaturesForGroup(groupId);
    } else {
      resultEl.textContent = `✗ 删除失败: ${res.error}`;
      resultEl.style.color = "red";
    }
  } catch (err) {
    resultEl.textContent = `✗ 错误: ${err.message}`;
    resultEl.style.color = "red";
  }
}

// ── 1:N Search (Recognition Test) ────────────────────────────────────────────

const searchBtn = document.getElementById("searchBtn");
const searchResultEl = document.getElementById("searchResult");

searchBtn.addEventListener("click", runSearch);

async function runSearch() {
  const groupId = document.getElementById("searchGroupSelect").value;
  searchResultEl.textContent = "";

  if (!groupId) { searchResultEl.textContent = "请选择搜索组"; return; }
  if (!recordedBase64) { searchResultEl.textContent = "请先录制要识别的音频"; return; }

  searchResultEl.textContent = "检索中...";
  try {
    const res = await postJSON("/api/isv/search", {
      groupId,
      audioBase64: recordedBase64,
      topK: 5
    });
    if (res.ok) {
      const list = res.scoreList || [];
      if (list.length === 0) {
        searchResultEl.innerHTML = '<p>未匹配到任何声纹。请确认声纹库中已注册该说话人的特征。</p>';
      } else {
        searchResultEl.innerHTML = `<p>匹配结果 (Top ${list.length}):</p>` +
          list.map((item, i) => {
            const pct = (item.score * 100).toFixed(1);
            const barW = Math.max(2, item.score * 100);
            const color = item.score >= 0.6 ? "#27ae60" : item.score >= 0.4 ? "#f39c12" : "#e74c3c";
            return `<div class="search-item">
              <span class="rank">#${i + 1}</span>
              <span class="fid">${escapeHtml(item.featureId)}</span>
              <div class="score-bar-bg"><div class="score-bar" style="width:${barW}%;background:${color}"></div></div>
              <span class="score">${pct}%</span>
            </div>`;
          }).join("");
      }
    } else {
      searchResultEl.textContent = `检索失败: ${res.error}`;
    }
  } catch (err) {
    searchResultEl.textContent = `错误: ${err.message}`;
  }
}

// ── 1:1 Voiceprint Comparison ────────────────────────────────────────────────

const compareGroupSelect = document.getElementById("compareGroupSelect");
const compareFeatureSelect = document.getElementById("compareFeatureSelect");
const compareBtn = document.getElementById("compareBtn");
const compareResultEl = document.getElementById("compareResult");

// When user selects a group, load its features into the feature dropdown
compareGroupSelect.addEventListener("change", async () => {
  const groupId = compareGroupSelect.value;
  compareFeatureSelect.innerHTML = '<option value="">-- 加载中 --</option>';
  if (!groupId) {
    compareFeatureSelect.innerHTML = '<option value="">-- 先选组，再选特征 --</option>';
    return;
  }
  try {
    const res = await getJSON(`/api/isv/feature/list/${encodeURIComponent(groupId)}`);
    if (res.ok && res.features) {
      compareFeatureSelect.innerHTML = '<option value="">-- 选择目标特征 --</option>' +
        res.features.map((f) => `<option value="${escapeHtml(f.featureId)}">${escapeHtml(f.featureId)} ${escapeHtml(f.featureInfo || "")}</option>`).join("");
    }
  } catch {
    compareFeatureSelect.innerHTML = '<option value="">加载失败</option>';
  }
});

compareBtn.addEventListener("click", async () => {
  const groupId = compareGroupSelect.value;
  const dstFeatureId = compareFeatureSelect.value;
  compareResultEl.textContent = "";

  if (!groupId) { compareResultEl.textContent = "请选择声纹组"; return; }
  if (!dstFeatureId) { compareResultEl.textContent = "请选择要比对的特征"; return; }
  if (!recordedBase64) { compareResultEl.textContent = "请先录制音频"; return; }

  compareResultEl.textContent = "比对中...";
  try {
    const res = await postJSON("/api/isv/compare", { groupId, dstFeatureId, audioBase64: recordedBase64 });
    if (res.ok) {
      const pct = (res.score * 100).toFixed(1);
      const verdict = res.score >= 0.6 ? "✅ 匹配 — 确认是同一说话人" : res.score >= 0.4 ? "⚠️ 不确定 — 相似度偏低" : "❌ 不匹配 — 可能不是同一人";
      compareResultEl.innerHTML =
        `<p>比对特征: <code>${escapeHtml(res.featureId)}</code></p>` +
        `<p>相似度: <strong style="font-size:24px;">${pct}%</strong></p>` +
        `<p>${verdict}</p>` +
        (res.featureInfo ? `<p class="dim">特征描述: ${escapeHtml(res.featureInfo)}</p>` : "");
    } else {
      compareResultEl.textContent = `比对失败: ${res.error}`;
    }
  } catch (err) {
    compareResultEl.textContent = `错误: ${err.message}`;
  }
});

// ── Speech-to-Text ───────────────────────────────────────────────────────────

const asrBtn = document.getElementById("asrBtn");
const asrResultEl = document.getElementById("asrResult");

asrBtn.addEventListener("click", async () => {
  asrResultEl.textContent = "";
  if (!recordedBase64) { asrResultEl.textContent = "请先录制音频"; return; }

  const accent = document.getElementById("asrAccent").value;
  asrResultEl.textContent = `转写中... (accent: ${accent})`;
  try {
    const res = await postJSON("/api/asr/transcribe", { audioBase64: recordedBase64, accent });
    if (res.ok) {
      asrResultEl.textContent = res.text || "(未识别到文字)";
      if (!res.text) {
        asrResultEl.textContent += "\n\n[调试] 原始返回:\n" + JSON.stringify(res.raw, null, 2);
      }
    } else {
      asrResultEl.textContent = `转写失败: ${res.error}`;
    }
  } catch (err) {
    asrResultEl.textContent = `错误: ${err.message}`;
  }
});

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ─────────────────────────────────────────────────────────────────────

loadGroups();
