import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

// Load environment variables in this order:
// 1) .env (local/development secrets)
// 2) .env.example (fallback template; useful for local dev without a real .env)
// 3) existing process.env values (e.g., CI/CD, Docker env injection)

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (!process.env.GROK_API_KEY && !process.env.GROQ_API_KEY && !process.env.XAI_API_KEY && !process.env.GEMINI_API_KEY) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), ".env.example") });
  if (result.error) {
    console.warn("[SENTINEL] .env missing and .env.example missing/invalid. Please provide environment variables.");
  } else {
    console.log("[SENTINEL] Loaded .env.example as fallback environment variables.");
  }
}

function hasApiKeys(): boolean {
  return Boolean(
    process.env.GROK_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.GEMINI_API_KEY
  );
}

function getBestModelKey(): string | undefined {
  return process.env.GROK_API_KEY || process.env.GROQ_API_KEY || process.env.XAI_API_KEY;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[SENTINEL] Starting server on Node ${process.version}...`);

  app.use(express.json());
  
  // Catch JSON parsing errors in request body
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.error("[SENTINEL] Request JSON Parse Error:", err.message);
      return res.status(400).json({ error: "Invalid JSON in request", details: err.message });
    }
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "SENTINEL Online", node: process.version, timestamp: new Date().toISOString() });
  });

  // API Proxy Route
  app.post("/api/chat", async (req, res) => {
    console.log("[SENTINEL] POST /api/chat hit");
    try {
      if (!hasApiKeys()) {
        console.error("[SENTINEL] No API keys configured in .env or .env.example.");
        return res.status(500).json({ error: "No AI API keys configured. Set GROK_API_KEY/GROQ_API_KEY/XAI_API_KEY or GEMINI_API_KEY in .env" });
      }

      // 1. Try to find a Groq/xAI key first
      const GROK_KEY = getBestModelKey();
      const GEMINI_KEY = process.env.GEMINI_API_KEY;

      // If we have a Groq/xAI key, use the proxy logic
      if (GROK_KEY && GROK_KEY !== "YOUR_GROK_API_KEY") {
        const isGroq = GROK_KEY.startsWith("gsk_");
        const endpoint = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
        const model = isGroq ? 'llama-3.3-70b-versatile' : 'grok-2-latest';
        
        console.log(`[SENTINEL] Proxying to ${isGroq ? 'Groq' : 'xAI'} | Model: ${model}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROK_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...req.body, model }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          const text = await response.text();
          let data;
          try { data = text ? JSON.parse(text) : {}; } catch (e) {
            return res.status(500).json({ error: "Invalid JSON from provider", details: text.substring(0, 200) });
          }
          
          if (!response.ok) {
            if (response.status === 401) data.error = { message: "Invalid Groq/xAI API Key." };
            return res.status(response.status).json(data);
          }
          return res.json(data);
        } catch (e: any) {
          clearTimeout(timeoutId);
          if (e.name === 'AbortError') return res.status(504).json({ error: "Provider Timeout" });
          throw e;
        }
      } 
      
      // 2. Fallback to Gemini if available
      if (GEMINI_KEY) {
        console.log("[SENTINEL] Using Gemini Fallback");
        const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
        const { messages } = req.body;
        
        // Convert OpenAI messages to Gemini format
        const systemInstruction = messages.find((m: any) => m.role === 'system')?.content || "";
        const userMessages = messages.filter((m: any) => m.role !== 'system');
        
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: userMessages.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          config: { systemInstruction }
        });

        // Convert Gemini response back to OpenAI format for frontend compatibility
        return res.json({
          choices: [{
            message: {
              role: "assistant",
              content: response.text
            }
          }]
        });
      }

      // 3. No keys found
      return res.status(500).json({ error: "No AI API keys configured. Please set GROK_API_KEY or GEMINI_API_KEY." });
    } catch (error) {
      console.error("[SENTINEL] Proxy Exception:", error);
      res.status(500).json({ 
        error: "Internal Server Error during proxy",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SENTINEL Server running on http://localhost:${PORT}`);
  });
}

startServer();
