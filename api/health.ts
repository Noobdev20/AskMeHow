import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    status: "AskMeHow Online",
    node: process.version,
    timestamp: new Date().toISOString(),
  });
}
