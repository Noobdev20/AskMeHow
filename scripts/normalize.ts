import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const GROK_KEY = process.env.GROK_API_KEY || process.env.GROQ_API_KEY || process.env.XAI_API_KEY;

if (!GROK_KEY) {
  console.error("❌ No API key found. Set GROK_API_KEY, GROQ_API_KEY, or XAI_API_KEY in .env");
  process.exit(1);
}

const isGroq = GROK_KEY?.startsWith("gsk_");
const endpoint = isGroq 
  ? 'https://api.groq.com/openai/v1/chat/completions'
  : 'https://api.x.ai/v1/chat/completions';
const model = isGroq ? 'llama-3.3-70b-versatile' : 'grok-2-latest';

const rawPath = path.resolve(process.cwd(), "data", "raw", "articles.json");
const processedDir = path.resolve(process.cwd(), "data", "processed");

if (!fs.existsSync(rawPath)) {
  console.error(`❌ File not found: ${rawPath}`);
  process.exit(1);
}

const articles = JSON.parse(fs.readFileSync(rawPath, "utf-8"));

// Native mode (no external API enrichment)
async function fetchDefiLlamaHacks(): Promise<Map<string, number>> {
  console.log('ℹ️ DefiLlama offline mode engaged; not fetching external loss data.');
  return new Map();
}

async function fetchDuneLossOverrides(): Promise<Map<string, number>> {
  console.log('ℹ️ Dune offline mode engaged; skipping Dune overrides.');
  return new Map();
}

async function fetchSubgraphLossOverrides(): Promise<Map<string, number>> {
  console.log('ℹ️ Subgraph offline mode engaged; skipping subgraph overrides.');
  return new Map();
}

function normalizeLoss(loss: any): number | null {
  if (loss === null || loss === undefined) return null;
  if (typeof loss === 'string') {
    const cleaned = loss.replace(/[$,\s]/g, '');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof loss === 'number') {
    return Number.isFinite(loss) ? loss : null;
  }
  return null;
}

function parseExploitYear(date: any): number | null {
  if (!date || typeof date !== 'string') return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

function isValidExploitRecord(item: any): boolean {
  if (!item || typeof item !== 'object') return false;

  const protocol = String(item.protocol || '').trim();
  if (!protocol || protocol.toLowerCase() === 'unknown') return false;

  const attackType = String(item.attack_type || '').trim();
  if (!attackType || attackType.toLowerCase() === 'unknown') return false;

  const rootCause = String(item.root_cause || '').trim();
  if (!rootCause || rootCause.toLowerCase() === 'unknown') return false;

  const lossUsd = item.loss_usd;
  if (lossUsd === null || lossUsd === undefined || typeof lossUsd !== 'number' || !Number.isFinite(lossUsd) || lossUsd <= 0) {
    return false;
  }

  const year = parseExploitYear(item.date);
  if (year === null || year < 2024) return false;

  return true;
}

function sanitizeExtracted(item: any, canonicalMap: Map<string, any>, overrideMap: Map<string, number>): any {
  const protocol = String(item.protocol || '').trim();
  const date = String(item.date || '').trim();
  const key = `${protocol.toLowerCase()}::${date}`;

  // prefer manual overrides from canonical data if available
  if (canonicalMap.has(key)) {
    return canonicalMap.get(key);
  }

  const extracted: any = {
    protocol: protocol || 'Unknown',
    date: date || null,
    attack_type: String(item.attack_type || '').trim() || 'Unknown',
    root_cause: String(item.root_cause || '').trim() || 'Unknown'
  };

  let loss = normalizeLoss(item.loss_usd);

  // use override map if LLM produced null/0/poor amount
  if ((!loss || loss <= 0) && protocol) {
    const overrideLoss = overrideMap.get(protocol.toLowerCase());
    if (overrideLoss && overrideLoss > 0) {
      loss = overrideLoss;
    }
  }

  // numeric sanity checks: if < 100 and not a realistic DEX bug, set null
  if (loss !== null && loss > 0 && loss < 1000) {
    // small amount may be real, but likely malformed if the protocol name indicates major exploit
    if (protocol && protocol.length > 0) {
      loss = null;
    }
  }

  extracted.loss_usd = loss;
  return extracted;
}


async function extractWithLLM(article: any): Promise<any> {
  const content = `${article.title} ${article.link || ''}`;
  const prompt = `Return ONLY valid JSON. No explanation.

Extract:
- protocol (exact protocol name)
- date (YYYY-MM-DD or null)
- loss_usd (number, in USD, or null if unknown)
- attack_type
- root_cause

Important: If loss_usd is null or unknown, estimate based on the protocol and incident severity.

Text:
${content}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a JSON extraction tool. Return ONLY valid JSON, no markdown, no extra text. For loss amounts, provide numbers (not strings). If unknown, provide best estimate.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.warn(`⚠️  API error for "${article.title}": ${response.status}`);
      return null;
    }

    const data = await response.json();
    const responseContent = data.choices?.[0]?.message?.content;

    if (!responseContent) {
      console.warn(`⚠️  Empty response for "${article.title}"`);
      return null;
    }

    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`⚠️  No JSON found in response for "${article.title}"`);
      return null;
    }

    let extracted = JSON.parse(jsonMatch[0]);

    return extracted;
  } catch (err) {
    console.warn(`⚠️  Error processing "${article.title}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function processArticles() {
  // No external enrichment sources in offline mode.
  const overrideMap = new Map<string, number>();

  const canonicalPath = path.resolve(process.cwd(), "data", "exploits.json");
  let canonicalEntries: any[] = [];
  if (fs.existsSync(canonicalPath)) {
    try {
      canonicalEntries = JSON.parse(fs.readFileSync(canonicalPath, "utf-8"));
    } catch {
      canonicalEntries = [];
    }
  }

  const canonicalMap = new Map<string, any>();
  const filteredCanonicalEntries = canonicalEntries.filter(isValidExploitRecord);
  if (filteredCanonicalEntries.length !== canonicalEntries.length) {
    console.log(`🧹 Filtered out ${canonicalEntries.length - filteredCanonicalEntries.length} existing invalid/old canonical entries`);
  }
  filteredCanonicalEntries.forEach((item: any) => {
    const key = `${String(item.protocol || '').toLowerCase()}::${String(item.date || '')}`;
    canonicalMap.set(key, item);
  });

  console.log(`\n📄 Processing ${articles.length} articles with Grok API + DefiLlama + canonical override...\n`);
  
  const structured = [];

  function isValidExtract(item: any): boolean {
    const requiredFields = [
      'protocol',
      'date',
      'loss_usd',
      'attack_type',
      'root_cause'
    ];

    for (const field of requiredFields) {
      const value = item[field];
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value.trim().toLowerCase() === 'unknown') return false;
      if (field === 'loss_usd' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) return false;
    }

    return true;
  }

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(`[${i + 1}/${articles.length}] Extracting: ${article.title || 'Unknown'}`);
    
    const extractedRaw = await extractWithLLM(article);
    if (!extractedRaw) continue;

    const extracted = sanitizeExtracted(extractedRaw, canonicalMap, overrideMap);
    if (!isValidExtract(extracted)) {
      console.log(`  ⚠️ Skipping incomplete record for protocol=${extracted.protocol || 'N/A'} date=${extracted.date || 'N/A'}`);
      continue;
    }

    structured.push(extracted);
    console.log(`  ✅ Protocol: ${extracted.protocol} | Loss: $${extracted.loss_usd}`);
  }

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(processedDir, "exploits.json"),
    JSON.stringify(structured, null, 2)
  );

  // Merge into main exploits file (no duplicates by protocol + date)
  let canonical: any[] = [];
  if (fs.existsSync(canonicalPath)) {
    try {
      canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf-8"));
    } catch (e) {
      console.warn("Could not parse existing canonical data, starting fresh:", e);
      canonical = [];
    }
  }

  function isCanonicalValid(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    if (!item.protocol || String(item.protocol).trim().toLowerCase() === 'unknown') return false;
    if (!item.date || item.date === null) return false;
    if (!item.attack_type || String(item.attack_type).trim().toLowerCase() === 'unknown') return false;
    if (!item.root_cause || String(item.root_cause).trim().toLowerCase() === 'unknown') return false;
    if (!item.loss_usd || typeof item.loss_usd !== 'number' || !Number.isFinite(item.loss_usd) || item.loss_usd <= 0) return false;
    return true;
  }

  const cleanCanonical = canonical.filter(isCanonicalValid);
  if (cleanCanonical.length !== canonical.length) {
    console.log(`🧹 Removed ${canonical.length - cleanCanonical.length} invalid/unknown canonical entries`);
  }

  const merged = [...cleanCanonical];
  const seen = new Set<string>(cleanCanonical.map((e: any) => `${e.protocol || ''}::${e.date || ''}`));

  structured.forEach((item: any) => {
    const key = `${item.protocol || ''}::${item.date || ''}`;
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
  });

  fs.writeFileSync(canonicalPath, JSON.stringify(merged, null, 2));
  console.log(`✅ Merged ${structured.length} new entries into data/exploits.json (canonical).`);

  console.log(`\n✅ Processed ${structured.length} exploits. Saved to data/processed/exploits.json`);
  console.log("\n👉 You're live:\n");
  structured.forEach(item => {
    console.log(`  Protocol: ${item.protocol}`);
    console.log(`  Loss: $${item.loss_usd || 'Unknown'}`);
    console.log(`  Attack: ${item.attack_type || 'N/A'}\n`);
  });
}

processArticles().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
