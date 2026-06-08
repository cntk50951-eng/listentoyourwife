import crypto from "node:crypto";
import { URLSearchParams } from "node:url";
import { z } from "zod";
import type { AppConfig } from "./config.js";

const VoiceprintResponseSchema = z.object({
  code: z.string(),
  desc: z.string(),
  data: z.string().optional(),
  sid: z.string().optional()
});

export type VoiceprintRegisterInput = {
  audioData: string;
  audioType: "raw" | "speex" | "opus-ogg";
  uid?: string;
};

function nowDateTimeWithTZ() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const tzh = String(Math.floor(Math.abs(tz) / 60)).padStart(2, "0");
  const tzm = String(Math.abs(tz) % 60).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${sign}${tzh}${tzm}`;
}

function createSignature(params: Record<string, string>, accessKeySecret: string): string {
  const baseString = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? "")}`)
    .join("&");

  return crypto.createHmac("sha1", accessKeySecret).update(baseString).digest("base64");
}

export async function registerVoiceprint(config: AppConfig, input: VoiceprintRegisterInput) {
  const signatureRandom = crypto.randomUUID();
  const dateTime = nowDateTimeWithTZ();
  const query = {
    appId: config.IFLYTEK_APP_ID,
    accessKeyId: config.IFLYTEK_ACCESS_KEY_ID,
    dateTime,
    signatureRandom
  };
  const signature = createSignature(query, config.IFLYTEK_ACCESS_KEY_SECRET);

  const queryString = new URLSearchParams(query).toString();
  const url = `${config.IFLYTEK_VOICEPRINT_BASE_URL}${config.IFLYTEK_VOICEPRINT_REGISTER_PATH}?${queryString}`;

  const payload: Record<string, unknown> = {
    audio_data: input.audioData,
    audio_type: input.audioType
  };
  if (input.uid) payload.uid = input.uid;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      signature
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  const parsed = VoiceprintResponseSchema.parse(json);

  if (!response.ok || parsed.code !== "000000") {
    throw new Error(`iFlytek voiceprint register failed: ${parsed.code} ${parsed.desc}`);
  }

  let featureId: string | undefined;
  if (parsed.data) {
    try {
      const dataJson = JSON.parse(parsed.data) as { feature_id?: string };
      featureId = dataJson.feature_id;
    } catch {
      featureId = undefined;
    }
  }

  return {
    featureId,
    raw: parsed
  };
}
