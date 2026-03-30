import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load environment variables in this order:
// 1) .env (local/development secrets)
// 2) .env.example (fallback template; useful for local dev without a real .env)
// 3) existing process.env values (e.g., CI/CD, Docker env injection)

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (!process.env.GROK_API_KEY && !process.env.GROQ_API_KEY && !process.env.XAI_API_KEY && !process.env.GEMINI_API_KEY) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), ".env.example") });
  if (result.error) {
    console.warn("[AskMeHow] .env missing and .env.example missing/invalid. Please provide environment variables.");
  } else {
    console.log("[AskMeHow] Loaded .env.example as fallback environment variables.");
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

function formatExploitItem(item: any, idx: number): string {
  const lines = [
    `${idx + 1}. ${item.title || 'Unknown exploit'} (${item.date || 'unknown date'})`,
    `Protocol: ${item.protocol || 'N/A'}`,
    `Type: ${Array.isArray(item.type) ? item.type.join(', ') : item.type || 'N/A'}`,
    `Impact USD: ${item.impact_usd ? `$${item.impact_usd.toLocaleString()}` : 'N/A'}`,
    `Root Cause: ${Array.isArray(item.root_cause) ? item.root_cause.join('; ') : item.root_cause || 'N/A'}`,
    `Summary: ${item.summary || 'N/A'}`,
    `Tags: ${Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || 'N/A'}`,
    ''
  ];
  return lines.join('\n');
}

function getExploitContext(): string {
  try {
    const jsonPath = path.resolve(process.cwd(), "data", "exploits.json");
    if (fs.existsSync(jsonPath)) {
      const jsonRaw = fs.readFileSync(jsonPath, "utf-8");
      const jsonData = JSON.parse(jsonRaw);
      if (Array.isArray(jsonData) && jsonData.length > 0) {
        return jsonData.map((item, index) => formatExploitItem(item, index)).join('\n');
      }
    }
  } catch (e) {
    console.warn("[AskMeHow] Could not load exploits.json:", e);
  }

  // Fallback to raw_exploits.txt if JSON unavailable or invalid
  try {
    const exploitPath = path.resolve(process.cwd(), "data", "raw_exploits.txt");
    if (fs.existsSync(exploitPath)) {
      return fs.readFileSync(exploitPath, "utf-8");
    }
  } catch (e) {
    console.warn("[AskMeHow] Could not load raw_exploits.txt:", e);
  }

  return "";
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[AskMeHow] Starting server on Node ${process.version}...`);

  app.use(express.json());
  
  // Catch JSON parsing errors in request body
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.error("[AskMeHow] Request JSON Parse Error:", err.message);
      return res.status(400).json({ error: "Invalid JSON in request", details: err.message });
    }
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "AskMeHow Online", node: process.version, timestamp: new Date().toISOString() });
  });

  // API Proxy Route
  app.post("/api/chat", async (req, res) => {
    console.log("[AskMeHow] POST /api/chat hit");
    try {
      if (!hasApiKeys()) {
        console.error("[AskMeHow] No API keys configured in .env or .env.example.");
        return res.status(500).json({ error: "No AI API keys configured. Set GROK_API_KEY/GROQ_API_KEY/XAI_API_KEY or GEMINI_API_KEY in .env" });
      }

      // 1. Try to find a Groq/xAI key first
      const GROK_KEY = getBestModelKey();
      const GEMINI_KEY = process.env.GEMINI_API_KEY;
      const exploitData = getExploitContext();

      // Build enhanced messages with exploit context
      const { messages } = req.body;
      const enhancedMessages = [
        {
          role: "system",
          content: `You are AskMeHow, an elite DeFi security analyst. NEVER mention your training data cutoff, knowledge limitations, or outdated information.

CRITICAL GUIDELINES:
- Do NOT say "my training data only goes up to 2023" or similar phrases.
- Do NOT reference outdated knowledge or suggest checking external sources for recent events.
- Do NOT write "According to our database"; instead, answer directly using context as facts.
- For 2024-2026 DeFi exploit questions, use the data below as the authoritative reference.
- If a question is outside the available exploit records, provide reasoned security analysis and best practices without claiming you can’t answer.

RECENT DeFi EXPLOITS & INCIDENTS (2024-2026):
${exploitData}

Expertise Areas:
- Smart contract vulnerabilities
- Flash loan attacks
- MEV (sandwich, frontrun, backrun)
- Rug pulls
- Audit red flags
- Real exploit analysis

Be direct, clear, and natural.`
        },
        ...messages.filter((m: any) => m.role !== "system")
      ];

      // If we have a Groq/xAI key, use the proxy logic
      if (GROK_KEY && GROK_KEY !== "YOUR_GROK_API_KEY") {
        const isGroq = GROK_KEY.startsWith("gsk_");
        const endpoint = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
        const model = isGroq ? 'llama-3.3-70b-versatile' : 'grok-2-latest';
        
        console.log(`[AskMeHow] Proxying to ${isGroq ? 'Groq' : 'xAI'} | Model: ${model}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROK_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...req.body, messages: enhancedMessages, model }),
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
      
      // 2. No other keys available
      return res.status(500).json({ error: "No AI API keys configured. Please set GROK_API_KEY/GROQ_API_KEY/XAI_API_KEY in .env" });
    } catch (error) {
      console.error("[AskMeHow] Proxy Exception:", error);
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
    console.log(`AskMeHow Server running on http://localhost:${PORT}`);
  });
}

startServer();
