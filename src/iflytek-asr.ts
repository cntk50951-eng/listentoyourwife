import crypto from "node:crypto";
import WebSocket from "ws";
import type { AppConfig } from "./config.js";

// ── Auth ────────────────────────────────────────────────────────────────────

type AsrConfig = AppConfig & {
  IFLYTEK_ISV_API_KEY: string;
  IFLYTEK_ISV_API_SECRET: string;
  IFLYTEK_ISV_APP_ID: string;
};

function rfc1123(date: Date): string {
  return date.toUTCString().replace("UTC", "GMT");
}

function buildAsrAuthUrl(config: AsrConfig): string {
  const host = "iat-api.xfyun.cn";
  const path = "/v2/iat";
  const date = new Date();
  const dateStr = rfc1123(date);
  const requestLine = `GET ${path} HTTP/1.1`;

  const signatureOrigin = `host: ${host}\ndate: ${dateStr}\n${requestLine}`;
  const signatureSha = crypto
    .createHmac("sha256", config.IFLYTEK_ISV_API_SECRET)
    .update(signatureOrigin)
    .digest();
  const signature = signatureSha.toString("base64");

  const authorizationOrigin =
    `api_key="${config.IFLYTEK_ISV_API_KEY}", ` +
    `algorithm="hmac-sha256", ` +
    `headers="host date request-line", ` +
    `signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  const params = new URLSearchParams();
  params.set("authorization", authorization);
  params.set("host", host);
  params.set("date", dateStr);

  return `wss://${host}${path}?${params.toString()}`;
}

// ── ASR Transcription ───────────────────────────────────────────────────────

export interface AsrOptions {
  accent?: string;   // "mandarin" | "cantonese" | "mianqie"
  language?: string; // "zh_cn" | "en_us"
}

export interface AsrResult {
  text: string;
  fullResponse: unknown[];
}

export function transcribeAudio(
  config: AsrConfig,
  audioBase64: string,
  options: AsrOptions = {}
): Promise<AsrResult> {
  const { accent = "mandarin", language = "zh_cn" } = options;

  // Map accent to business params
  let domain = "iat";
  let accentParam = accent;
  if (accent === "mianqie") {
    domain = "xfime-mianqie";
    accentParam = "mandarin"; // mianqie domain auto-detects dialects
  }
  return new Promise((resolve, reject) => {
    const url = buildAsrAuthUrl(config);
    const ws = new WebSocket(url);

    // Strip WAV header (44 bytes) to get raw PCM
    const wavBuffer = Buffer.from(audioBase64, "base64");
    const pcmBuffer = wavBuffer.length > 44 ? wavBuffer.subarray(44) : wavBuffer;

    const results: unknown[] = [];
    let fullText = "";
    let firstFrameSent = false;
    const frameSize = 1280; // 1280 bytes per frame for PCM 16k 16bit mono

    ws.on("open", () => {
      sendNextChunk(0);
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        results.push(msg);

        if (msg.code !== 0) {
          ws.close();
          reject(new Error(`ASR error [${msg.code}]: ${msg.message || JSON.stringify(msg)}`));
          return;
        }

        // Extract text from result
        if (msg.data?.result) {
          const result = msg.data.result;
          // Handle ws (word segmentation) format
          if (result.ws) {
            const sentence = result.ws
              .map((w: { cw?: { w: string }[] }) =>
                w.cw ? w.cw.map((c) => c.w).join("") : ""
              )
              .join("");
            if (result.pgs === "rpl" && result.sn != null) {
              // Dynamic correction: replace previous segment
              const parts = fullText.split("");
              // Simply append for non-dynamic-correct mode
              fullText += sentence;
            } else {
              fullText += sentence;
            }
          }
          // Handle plain text format
          if (result.text) {
            fullText = result.text;
          }
        }

        // Last frame received
        if (msg.data?.status === 2 || msg.code === 0 && !msg.data) {
          ws.close();
        }
      } catch (e) {
        reject(new Error(`ASR parse error: ${(e as Error).message}`));
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve({ text: fullText, fullResponse: results });
    });

    ws.on("error", (err) => {
      reject(new Error(`ASR WebSocket error: ${err.message}`));
    });

    let offset = 0;

    function sendNextChunk(status: number) {
      const remaining = pcmBuffer.length - offset;
      if (remaining <= 0 && status > 0) {
        // Send final empty frame
        const finalPayload: Record<string, unknown> = {
          data: { status: 2, format: "audio/L16;rate=16000", encoding: "raw", audio: "" }
        };
        ws.send(JSON.stringify(finalPayload));
        return;
      }

      const chunkSize = Math.min(frameSize, remaining);
      const chunk = pcmBuffer.subarray(offset, offset + chunkSize);
      offset += chunkSize;
      const isLast = offset >= pcmBuffer.length ? 2 : status;
      const audioB64 = chunk.toString("base64");

      const payload: Record<string, unknown> = {
        data: { status: isLast, format: "audio/L16;rate=16000", encoding: "raw", audio: audioB64 }
      };

      if (!firstFrameSent) {
        firstFrameSent = true;
        payload.common = { app_id: config.IFLYTEK_ISV_APP_ID };
        payload.business = { language, domain, accent: accentParam };
      }

      ws.send(JSON.stringify(payload));

      if (offset < pcmBuffer.length) {
        // Schedule next chunk at ~40ms interval
        setTimeout(() => sendNextChunk(1), 40);
      } else {
        // All data sent, send final status=2 frame
        // Wait a bit then send final empty frame
        setTimeout(() => {
          ws.send(JSON.stringify({
            data: { status: 2, format: "audio/L16;rate=16000", encoding: "raw", audio: "" }
          }));
        }, 100);
      }
    }
  });
}
