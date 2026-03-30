import fs from 'fs'
import path from 'path'

export default async function handler(req, res) {
  const userQuery = req.body.query

  // 1. Load exploit context from JSON + fallback to plain text
  let contextData = '';
  const jsonFile = path.join(process.cwd(), 'data', 'exploits.json');
  if (fs.existsSync(jsonFile)) {
    try {
      const jsonRaw = fs.readFileSync(jsonFile, 'utf-8');
      const jsonData = JSON.parse(jsonRaw);
      if (Array.isArray(jsonData)) {
        contextData = jsonData.map((item, idx) => {
          const type = Array.isArray(item.type) ? item.type.join(', ') : item.type || 'N/A';
          const rootCause = Array.isArray(item.root_cause) ? item.root_cause.join('; ') : item.root_cause || 'N/A';
          const tags = Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || 'N/A';
          const impact = item.impact_usd ? `$${Number(item.impact_usd).toLocaleString()}` : 'N/A';
          return `${idx + 1}. ${item.title || 'Unknown'} (${item.date || 'N/A'})\nProtocol: ${item.protocol || 'N/A'}\nType: ${type}\nImpact: ${impact}\nRoot Cause: ${rootCause}\nSummary: ${item.summary || 'N/A'}\nTags: ${tags}\n`;
        }).join('\n');
      }
    } catch (e) {
      console.warn('[AskMeHow] analyze.ts could not parse exploits.json', e);
    }
  }

  if (!contextData) {
    const filePath = path.join(process.cwd(), 'data', 'raw_exploits.txt');
    if (fs.existsSync(filePath)) {
      contextData = fs.readFileSync(filePath, 'utf-8');
    }
  }

  // 2. Build the prompt with the context data
  const prompt = `You are a DeFi security analyst.
Use the context below if relevant:

${contextData}

Analyze the user's query and return:
- Exploit Type:
- Root Cause:
- Impact:
- Severity:

User Query:
${userQuery}
`

  // 3. Send the prompt to your backend chat API
  const response = await fetch(`http://localhost:3000/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const result = await response.json()
  res.status(200).json(result)
}