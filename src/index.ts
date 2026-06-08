import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getConfig, getIsvConfig } from "./config.js";
import {
  createGroup,
  deleteGroup,
  createFeature,
  deleteFeature,
  queryFeatureList,
  updateFeature,
  searchFeature,
  compareFeature
} from "./iflytek-isv.js";
import { transcribeAudio } from "./iflytek-asr.js";
import { chat } from "./minimax.js";
import { initDB, saveTranscript, saveTranscripts, listTranscripts, saveMemo, listMemos, deleteMemo } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(projectRoot, "public")));

const RegisterRequestSchema = z.object({
  audioBase64: z.string().min(1)
});

const ProcessRequestSchema = z.object({
  audioBase64: z.string().min(1),
  wifeFeatureId: z.string().min(1)
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/voiceprint/register", async (req, res) => {
  const parsed = RegisterRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  try {
    const config = getIsvConfig();
    const groupId = "wife_voiceprints";

    // Ensure the default group exists (ignore error if already created)
    try {
      await createGroup(config, groupId, "老婆的声纹", "auto-created default group");
    } catch {
      // Group likely already exists — that's fine
    }

    // Generate feature ID with timestamp
    const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
    const featureId = `wife_fp_${ts}`;
    const featureInfo = `registered_at_${new Date().toLocaleString("zh-CN")}`;

    const result = await createFeature(config, groupId, featureId, parsed.data.audioBase64, featureInfo);

    return res.json({
      ok: true,
      groupId,
      featureId: result.decoded.featureId || featureId,
      sid: result.header.sid,
      message: "声纹注册成功！featureId 已保存到声纹组 wife_voiceprints 中。"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
});

app.post("/api/audio/process", (req, res) => {
  const parsed = ProcessRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  return res.json({
    ok: true,
    implemented: false,
    message:
      "Pipeline stub created. Next step is adding diarization + wife voiceprint match + ASR + schedule extraction.",
    nextSteps: [
      "Run speaker diarization/segmentation over mixed audio",
      "Match segments against wife feature_id with iFlytek voiceprint compare/search",
      "Send matched segments to ASR provider (iFlytek or MiniMax)",
      "Extract tasks/events and write to calendar/todo system"
    ]
  });
});

// ── ISV Voiceprint Library Routes ──────────────────────────────────────────────

const IsvGroupCreateSchema = z.object({
  groupId: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_]+$/, "groupId must be alphanumeric/underscore"),
  groupName: z.string().max(256).optional(),
  groupInfo: z.string().max(256).optional()
});

const IsvFeatureCreateSchema = z.object({
  groupId: z.string().min(1).max(32),
  featureId: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_]+$/, "featureId must be alphanumeric/underscore"),
  audioBase64: z.string().min(1),
  featureInfo: z.string().max(256).optional()
});

const IsvFeatureUpdateSchema = z.object({
  groupId: z.string().min(1).max(32),
  featureId: z.string().min(1).max(32),
  audioBase64: z.string().min(1),
  featureInfo: z.string().max(256).optional()
});

const IsvSearchSchema = z.object({
  groupId: z.string().min(1).max(32),
  audioBase64: z.string().min(1),
  topK: z.number().int().min(1).max(50).default(5)
});

const IsvCompareSchema = z.object({
  groupId: z.string().min(1).max(32),
  dstFeatureId: z.string().min(1).max(32),
  audioBase64: z.string().min(1)
});

// POST /api/isv/group/create
app.post("/api/isv/group/create", async (req, res) => {
  const parsed = IsvGroupCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const config = getIsvConfig();
    const result = await createGroup(config, parsed.data.groupId, parsed.data.groupName, parsed.data.groupInfo);
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// DELETE /api/isv/group/:groupId
app.delete("/api/isv/group/:groupId", async (req, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ ok: false, error: "groupId is required" });

  try {
    const config = getIsvConfig();
    const result = await deleteGroup(config, groupId);
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/isv/feature/create
app.post("/api/isv/feature/create", async (req, res) => {
  const parsed = IsvFeatureCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const config = getIsvConfig();
    const result = await createFeature(
      config,
      parsed.data.groupId,
      parsed.data.featureId,
      parsed.data.audioBase64,
      parsed.data.featureInfo
    );
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// DELETE /api/isv/feature/:groupId/:featureId
app.delete("/api/isv/feature/:groupId/:featureId", async (req, res) => {
  const { groupId, featureId } = req.params;
  if (!groupId || !featureId) return res.status(400).json({ ok: false, error: "groupId and featureId are required" });

  try {
    const config = getIsvConfig();
    const result = await deleteFeature(config, groupId, featureId);
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// GET /api/isv/feature/list/:groupId
app.get("/api/isv/feature/list/:groupId", async (req, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ ok: false, error: "groupId is required" });

  try {
    const config = getIsvConfig();
    const result = await queryFeatureList(config, groupId);
    return res.json({ ok: true, features: result.decoded ?? [], total: (result.decoded ?? []).length, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/isv/feature/update
app.post("/api/isv/feature/update", async (req, res) => {
  const parsed = IsvFeatureUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const config = getIsvConfig();
    const result = await updateFeature(
      config,
      parsed.data.groupId,
      parsed.data.featureId,
      parsed.data.audioBase64,
      parsed.data.featureInfo
    );
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/isv/search
app.post("/api/isv/search", async (req, res) => {
  const parsed = IsvSearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const config = getIsvConfig();
    const result = await searchFeature(config, parsed.data.groupId, parsed.data.audioBase64, parsed.data.topK);
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/isv/compare
app.post("/api/isv/compare", async (req, res) => {
  const parsed = IsvCompareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const config = getIsvConfig();
    const result = await compareFeature(config, parsed.data.groupId, parsed.data.dstFeatureId, parsed.data.audioBase64);
    return res.json({ ok: true, ...result.decoded, sid: result.header.sid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/asr/transcribe
app.post("/api/asr/transcribe", async (req, res) => {
  const { audioBase64, accent } = req.body || {};
  if (!audioBase64) return res.status(400).json({ ok: false, error: "audioBase64 is required" });

  try {
    const config = getIsvConfig();
    const result = await transcribeAudio(config, audioBase64, { accent: accent || "mandarin" });
    return res.json({ ok: true, text: result.text, raw: result.fullResponse });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ ok: false, error: "messages array is required" });
  }
  try {
    const config = getConfig();
    const result = await chat(config, messages);
    return res.json({ ok: true, content: result.content, model: result.model });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown error" });
  }
});

// ── Transcripts API ───────────────────────────────────────────────────────────
app.get("/api/transcripts", async (_req, res) => {
  try { const rows = await listTranscripts(); return res.json({ ok: true, entries: rows }); }
  catch (err) { return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown" }); }
});

app.post("/api/transcripts", async (req, res) => {
  try {
    const { entries } = req.body || {};
    if (entries) { await saveTranscripts(entries); return res.json({ ok: true }); }
    await saveTranscript(req.body);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown" }); }
});

// ── Memos API ─────────────────────────────────────────────────────────────────
app.get("/api/memos", async (_req, res) => {
  try { const rows = await listMemos(); return res.json({ ok: true, memos: rows }); }
  catch (err) { return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown" }); }
});

app.post("/api/memos", async (req, res) => {
  try { await saveMemo(req.body); return res.json({ ok: true }); }
  catch (err) { return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown" }); }
});

app.delete("/api/memos/:id", async (req, res) => {
  try { await deleteMemo(parseInt(req.params.id)); return res.json({ ok: true }); }
  catch (err) { return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "unknown" }); }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(projectRoot, "public", "index.html"));
});

const config = getConfig();
initDB().then(() => {
  app.listen(config.PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
    console.log(`LAN access: http://<your-ip>:${config.PORT}`);
  });
}).catch((err) => {
  console.error("[DB] Init failed:", err.message);
  app.listen(config.PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${config.PORT} (no DB)`);
  });
});
