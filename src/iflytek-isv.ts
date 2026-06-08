import crypto from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "./config.js";

// Narrow config type with required ISV fields
type IsvConfig = AppConfig & {
  IFLYTEK_ISV_API_KEY: string;
  IFLYTEK_ISV_API_SECRET: string;
  IFLYTEK_ISV_APP_ID: string;
};

// ── Auth ────────────────────────────────────────────────────────────────────

function rfc1123(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const yyyy = date.getUTCFullYear();
  const M = months[date.getUTCMonth()];
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  const day = days[date.getUTCDay()];
  return `${day}, ${d} ${M} ${yyyy} ${hh}:${mm}:${ss} GMT`;
}

function buildAuthUrl(config: IsvConfig): string {
  const host = new URL(config.IFLYTEK_ISV_BASE_URL).host;
  const path = config.IFLYTEK_ISV_PATH;
  const date = new Date();
  const dateStr = rfc1123(date);
  const requestLine = `POST ${path} HTTP/1.1`;

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

  return `${config.IFLYTEK_ISV_BASE_URL}${path}?${params.toString()}`;
}

// ── Shared response handling ────────────────────────────────────────────────

const IsvHeaderSchema = z.object({
  code: z.number(),
  message: z.string(),
  sid: z.string().optional()
});

interface IsvCallResult<T = unknown> {
  header: z.infer<typeof IsvHeaderSchema>;
  decoded: T;
}

async function callIsv<T>(
  config: IsvConfig,
  body: Record<string, unknown>,
  textKey: string
): Promise<IsvCallResult<T>> {
  const url = buildAuthUrl(config);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json: unknown = await response.json();

  // Validate header
  const headerParsed = z
    .object({ header: IsvHeaderSchema, payload: z.any().optional() })
    .safeParse(json);

  if (!headerParsed.success) {
    throw new Error(
      `ISV API unexpected response: ${JSON.stringify(json).slice(0, 300)}`
    );
  }

  const { header, payload } = headerParsed.data;

  if (header.code !== 0) {
    throw new Error(`ISV API error [${header.code}]: ${header.message}`);
  }

  // Decode payload text
  let decoded: T = {} as T;
  if (payload?.[textKey]?.text) {
    try {
      const textBuf = Buffer.from(payload[textKey].text, "base64").toString("utf-8");
      decoded = JSON.parse(textBuf) as T;
    } catch {
      // text field may not be valid JSON for all responses
    }
  }

  return { header, decoded };
}

// ── Group management ────────────────────────────────────────────────────────

export interface CreateGroupResult {
  groupId: string;
  groupName: string;
  groupInfo: string;
}

export async function createGroup(
  config: IsvConfig,
  groupId: string,
  groupName?: string,
  groupInfo?: string
): Promise<IsvCallResult<CreateGroupResult>> {
  return callIsv<CreateGroupResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "createGroup",
          groupId,
          groupName: groupName ?? groupId,
          groupInfo: groupInfo ?? "",
          createGroupRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      }
    },
    "createGroupRes"
  );
}

export interface DeleteGroupResult {
  msg: string;
}

export async function deleteGroup(
  config: IsvConfig,
  groupId: string
): Promise<IsvCallResult<DeleteGroupResult>> {
  return callIsv<DeleteGroupResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "deleteGroup",
          groupId,
          deleteGroupRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      }
    },
    "deleteGroupRes"
  );
}

// ── Feature management ──────────────────────────────────────────────────────

export interface CreateFeatureResult {
  featureId: string;
}

export async function createFeature(
  config: IsvConfig,
  groupId: string,
  featureId: string,
  audioBase64: string,
  featureInfo?: string
): Promise<IsvCallResult<CreateFeatureResult>> {
  return callIsv<CreateFeatureResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "createFeature",
          groupId,
          featureId,
          featureInfo: featureInfo ?? "",
          createFeatureRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      },
      payload: {
        resource: {
          encoding: "raw",
          sample_rate: 16000,
          channels: 1,
          bit_depth: 16,
          status: 3,
          audio: audioBase64
        }
      }
    },
    "createFeatureRes"
  );
}

export interface DeleteFeatureResult {
  msg: string;
}

export async function deleteFeature(
  config: IsvConfig,
  groupId: string,
  featureId: string
): Promise<IsvCallResult<DeleteFeatureResult>> {
  return callIsv<DeleteFeatureResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "deleteFeature",
          groupId,
          featureId,
          deleteFeatureRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      }
    },
    "deleteFeatureRes"
  );
}

export interface FeatureInfo {
  featureId: string;
  featureInfo: string;
}

export async function queryFeatureList(
  config: IsvConfig,
  groupId: string
): Promise<IsvCallResult<FeatureInfo[]>> {
  return callIsv<FeatureInfo[]>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "queryFeatureList",
          groupId,
          queryFeatureListRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      }
    },
    "queryFeatureListRes"
  );
}

export interface UpdateFeatureResult {
  msg: string;
}

export async function updateFeature(
  config: IsvConfig,
  groupId: string,
  featureId: string,
  audioBase64: string,
  featureInfo?: string
): Promise<IsvCallResult<UpdateFeatureResult>> {
  return callIsv<UpdateFeatureResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "updateFeature",
          groupId,
          featureId,
          featureInfo: featureInfo ?? "",
          updateFeatureRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      },
      payload: {
        resource: {
          encoding: "raw",
          sample_rate: 16000,
          channels: 1,
          bit_depth: 16,
          status: 3,
          audio: audioBase64
        }
      }
    },
    "updateFeatureRes"
  );
}

// ── Search & Compare ────────────────────────────────────────────────────────

export interface SearchResultItem {
  featureId: string;
  featureInfo: string;
  score: number;
}

export interface SearchFeatureResult {
  scoreList: SearchResultItem[];
}

export async function searchFeature(
  config: IsvConfig,
  groupId: string,
  audioBase64: string,
  topK: number = 5
): Promise<IsvCallResult<SearchFeatureResult>> {
  return callIsv<SearchFeatureResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "searchFea",
          groupId,
          topK,
          searchFeaRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      },
      payload: {
        resource: {
          encoding: "raw",
          sample_rate: 16000,
          channels: 1,
          bit_depth: 16,
          status: 3,
          audio: audioBase64
        }
      }
    },
    "searchFeaRes"
  );
}

export interface CompareFeatureResult {
  score: number;
  featureId: string;
  featureInfo: string;
}

export async function compareFeature(
  config: IsvConfig,
  groupId: string,
  dstFeatureId: string,
  audioBase64: string
): Promise<IsvCallResult<CompareFeatureResult>> {
  return callIsv<CompareFeatureResult>(
    config,
    {
      header: { app_id: config.IFLYTEK_ISV_APP_ID, status: 3 },
      parameter: {
        s1aa729d0: {
          func: "searchScoreFea",
          groupId,
          dstFeatureId,
          searchScoreFeaRes: { encoding: "utf8", compress: "raw", format: "json" }
        }
      },
      payload: {
        resource: {
          encoding: "raw",
          sample_rate: 16000,
          channels: 1,
          bit_depth: 16,
          status: 3,
          audio: audioBase64
        }
      }
    },
    "searchScoreFeaRes"
  );
}
