import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8787),
  IFLYTEK_APP_ID: z.string().min(1, "IFLYTEK_APP_ID is required"),
  IFLYTEK_ACCESS_KEY_ID: z.string().min(1, "IFLYTEK_ACCESS_KEY_ID is required"),
  IFLYTEK_ACCESS_KEY_SECRET: z.string().min(1, "IFLYTEK_ACCESS_KEY_SECRET is required"),
  IFLYTEK_VOICEPRINT_BASE_URL: z.string().url().default("https://office-api-personal-dx.iflyaisol.com"),
  IFLYTEK_VOICEPRINT_REGISTER_PATH: z.string().default("/res/feature/v1/register"),
  IFLYTEK_VOICEPRINT_UPDATE_PATH: z.string().default("/res/feature/v1/update"),
  IFLYTEK_VOICEPRINT_DELETE_PATH: z.string().default("/res/feature/v1/delete"),
  IFLYTEK_ISV_API_KEY: z.string().optional(),
  IFLYTEK_ISV_API_SECRET: z.string().optional(),
  IFLYTEK_ISV_APP_ID: z.string().optional(),
  IFLYTEK_ISV_BASE_URL: z.string().url().default("https://api.xf-yun.com"),
  IFLYTEK_ISV_PATH: z.string().default("/v1/private/s1aa729d0"),
  DATABASE_URL: z.string().optional(),
  MINIMAX_API_KEY: z.string().optional()
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function getConfig(): AppConfig {
  return EnvSchema.parse(process.env);
}

export function getIsvConfig() {
  const config = getConfig();
  if (!config.IFLYTEK_ISV_API_KEY || !config.IFLYTEK_ISV_API_SECRET || !config.IFLYTEK_ISV_APP_ID) {
    throw new Error("ISV voiceprint API not configured. Set IFLYTEK_ISV_API_KEY, IFLYTEK_ISV_API_SECRET, and IFLYTEK_ISV_APP_ID in .env");
  }
  return config as AppConfig & { IFLYTEK_ISV_API_KEY: string; IFLYTEK_ISV_API_SECRET: string; IFLYTEK_ISV_APP_ID: string };
}
