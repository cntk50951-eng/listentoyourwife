import type { AppConfig } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: { total_tokens: number };
}

export async function chat(
  config: AppConfig,
  messages: ChatMessage[],
  model: string = "abab6.5s-chat"
): Promise<ChatResult> {
  if (!config.MINIMAX_API_KEY) {
    throw new Error("MINIMAX_API_KEY is not configured");
  }

  const res = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.MINIMAX_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      tokens_to_generate: 1024,
      temperature: 0.7,
      top_p: 0.95
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API error [${res.status}]: ${err.slice(0, 300)}`);
  }

  const json = await res.json();
  const reply = json.reply || (json.choices?.[0]?.message?.content) || "";
  const usage = json.usage || (json.usage_info);

  return {
    content: typeof reply === "string" ? reply : "",
    model: json.model || model,
    usage: usage ? { total_tokens: usage.total_tokens || 0 } : undefined
  };
}
