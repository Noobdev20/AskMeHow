import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

function hasApiKeys(): boolean {
  return Boolean(
    process.env.GROK_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.GEMINI_API_KEY
  );
}

function getBestModelKey(): string | undefined {
  return (
    process.env.GROK_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.XAI_API_KEY
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!hasApiKeys()) {
      return res.status(500).json({
        error:
          "No AI API keys configured. Set GROK_API_KEY/GROQ_API_KEY/XAI_API_KEY or GEMINI_API_KEY in environment variables.",
      });
    }

    const GROK_KEY = getBestModelKey();
    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    // 1. Try Groq/xAI key first
    if (GROK_KEY && GROK_KEY !== "YOUR_GROK_API_KEY") {
      const isGroq = GROK_KEY.startsWith("gsk_");
      const endpoint = isGroq
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.x.ai/v1/chat/completions";
      const model = isGroq ? "llama-3.3-70b-versatile" : "grok-2-latest";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROK_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...req.body, model }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          return res
            .status(500)
            .json({
              error: "Invalid JSON from provider",
              details: text.substring(0, 200),
            });
        }

        if (!response.ok) {
          if (response.status === 401)
            data.error = { message: "Invalid Groq/xAI API Key." };
          return res.status(response.status).json(data);
        }
        return res.json(data);
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError")
          return res.status(504).json({ error: "Provider Timeout" });
        throw e;
      }
    }

    // 2. Fallback to Gemini
    if (GEMINI_KEY) {
      const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
      const { messages } = req.body;

      const systemInstruction =
        messages.find((m: any) => m.role === "system")?.content || "";
      const userMessages = messages.filter((m: any) => m.role !== "system");

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMessages.map((m: any) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        config: { systemInstruction },
      });

      return res.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: response.text,
            },
          },
        ],
      });
    }

    // 3. No keys found
    return res.status(500).json({
      error:
        "No AI API keys configured. Please set GROK_API_KEY or GEMINI_API_KEY.",
    });
  } catch (error) {
    console.error("[AskMeHow] Proxy Exception:", error);
    res.status(500).json({
      error: "Internal Server Error during proxy",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
