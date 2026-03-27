# AskMeHow
Explains DeFi security to the curious

## Overview
AskMeHow is an AI-powered DeFi security analyst that specializes in smart contract vulnerabilities, flash loan attacks, MEV analysis, and security audits.

## Features
- Smart contract vulnerability analysis
- Flash loan attack detection
- MEV (sandwich, frontrun, backrun) analysis
- Rug pull identification
- Audit red flag detection
- Real exploit breakdowns (Ronin, Wormhole, Euler, etc.)

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   Create a `.env` file with your API keys:
   ```bash
   GROK_API_KEY="your_grok_api_key_here"
   # or
   GEMINI_API_KEY="your_gemini_api_key_here"
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser to `http://localhost:3000`

## API Keys
The app supports multiple AI providers:
- **Groq/xAI**: Set `GROK_API_KEY` or `GROQ_API_KEY` or `XAI_API_KEY`
- **Google Gemini**: Set `GEMINI_API_KEY`

You can use either provider or both (the app will prefer Groq/xAI if available).
