/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Shield, Terminal, AlertTriangle, Zap, Code, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

// API Key is now handled securely on the server
const SYSTEM_PROMPT = `You are AskMeHow, an elite DeFi security analyst.

Expert in:
- Smart contract vulnerabilities
- Flash loan attacks
- MEV (sandwich, frontrun, backrun)
- Rug pulls
- Audit red flags
- Real exploit breakdowns (Ronin, Wormhole, Euler, etc.)

Tone:
- Direct
- No fluff
- Clear explanations
- Step-by-step when needed
- Use real examples
- Never hallucinate unknown exploit details`;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

function colorCodeText(text: string): string {
  return text.replace(/(\bexploit\b|\battack\b|\bvulnerability\b|\bhack\b|\bbreach\b|\bdrain\b|\bcompromised\b|\bmanipulated\b|\bexploited\b)/gi, '<span class="text-red-400 font-semibold">$1</span>')
             .replace(/(\bsolution\b|\bresolution\b|\bfix\b|\bmitigation\b|\bprevention\b|\bsecure\b|\bprotected\b)/gi, '<span class="text-green-400 font-semibold">$1</span>');
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBackendReady, setIsBackendReady] = useState<boolean | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check backend health on mount
    fetch('/api/health')
      .then(res => res.ok ? setIsBackendReady(true) : setIsBackendReady(false))
      .catch(() => setIsBackendReady(false));
  }, []);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userMessage.content }
          ]
        })
      });

      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error("The server returned an invalid response. It might be down or restarting.");
      }

      if (!response.ok) {
        let errorMessage = data.error?.message || data.error || data.message || JSON.stringify(data);
        if (errorMessage === "{}" || !errorMessage) {
          errorMessage = `API Error ${response.status}: The server returned an empty error response. Check your API key or network connection.`;
        }
        throw new Error(errorMessage);
      }

      const aiContent = data.choices?.[0]?.message?.content;
      if (!aiContent) {
        throw new Error("The AI returned an empty response. This might be a model or quota issue.");
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: aiContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred. Check server logs.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const quickPrompts = [
    { label: "Ronin Exploit", text: "Explain the Ronin Bridge exploit step-by-step." },
    { label: "Rug Pull Red Flags", text: "What are the red flags for a potential rug pull?" },
    { label: "Flash Loan Basics", text: "How does a flash loan attack work in DeFi?" },
    { label: "Reentrancy Analysis", text: "Analyze common reentrancy vulnerabilities." }
  ];

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto border-x border-terminal-border relative">
      {/* Header */}
      <header className="p-6 border-b border-terminal-border flex justify-between items-center bg-terminal-bg/90 backdrop-blur-sm z-10">
        <div className="flex flex-col">
          <h1 className="text-terminal-accent text-xl font-bold tracking-widest flex items-center gap-2">
            <Shield className="w-6 h-6" />
            AskMeHow
          </h1>
          <p className="text-[10px] opacity-60 uppercase tracking-tighter">DeFi Security Agent</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            className="text-[10px] text-terminal-accent/50 hover:text-terminal-accent border border-terminal-accent/20 px-2 py-1 rounded transition-colors uppercase tracking-widest"
          >
            Reset Terminal
          </button>
          <div className="flex items-center gap-2 text-terminal-accent text-xs font-bold">
            <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] animate-blink ${
              isBackendReady === true ? 'bg-terminal-accent shadow-terminal-accent' : 
              isBackendReady === false ? 'bg-red-500 shadow-red-500' : 'bg-yellow-500 shadow-yellow-500'
            }`} />
            {isBackendReady === true ? 'SYSTEM ONLINE' : isBackendReady === false ? 'BACKEND OFFLINE' : 'INITIALIZING...'}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-terminal-border scrollbar-track-transparent">
          <AnimatePresence>
            {messages.length === 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center h-full text-center space-y-6 py-12"
              >
                <div className="space-y-2">
                  <span className="text-[10px] text-terminal-accent tracking-[0.2em] uppercase">Threat Intelligence</span>
                  <h2 className="text-3xl font-bold">DEFI SECURITY ANALYST</h2>
                </div>
                <p className="text-sm opacity-70 max-w-md leading-relaxed">
                  I am AskMeHow. I specialize in smart contract vulnerabilities, flash loan exploits, and MEV analysis. How can I assist your security audit today?
                </p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                  {quickPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(prompt.text)}
                      className="text-left p-4 border border-terminal-border hover:border-terminal-accent hover:text-terminal-accent transition-all group"
                    >
                      <div className="text-[10px] opacity-50 mb-1 flex items-center gap-1">
                        {i === 0 && <Zap className="w-3 h-3" />}
                        {i === 1 && <AlertTriangle className="w-3 h-3" />}
                        {i === 2 && <Terminal className="w-3 h-3" />}
                        {i === 3 && <Code className="w-3 h-3" />}
                        0{i + 1}
                      </div>
                      <div className="text-xs font-bold">{prompt.label}</div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`max-w-[85%] p-4 border ${
                  msg.role === 'user' 
                    ? 'bg-terminal-user border-terminal-border' 
                    : 'bg-terminal-ai border-l-2 border-l-terminal-accent border-terminal-border'
                }`}>
                  <div className="text-sm leading-relaxed markdown-body prose prose-invert max-w-none">
                    <ReactMarkdown
                      rehypePlugins={[rehypeRaw]}
                    >{colorCodeText(msg.content)}</ReactMarkdown>
                  </div>
                  <span className="text-[10px] opacity-40 mt-3 block">{msg.timestamp}</span>
                </div>
              </motion.div>
            ))}

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-start"
              >
                <div className="text-[10px] text-terminal-accent uppercase mb-2">Analyzing Threat Vectors<span className="dots" /></div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Error Display */}
        {error && (
          <div className="px-6 py-2 bg-red-950/20 border-y border-red-900/50 text-red-400 text-[10px] text-center">
            {error}
          </div>
        )}

        {/* Input Area */}
        <div className="p-6 border-t border-terminal-border bg-terminal-bg z-10">
          <div className={`flex gap-4 p-2 border transition-colors ${isLoading ? 'opacity-50' : 'bg-terminal-ai border-terminal-border focus-within:border-terminal-accent'}`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter query..."
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent border-none text-sm p-2 focus:ring-0 resize-none outline-none max-h-40"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim()}
              className="p-2 text-terminal-accent hover:scale-110 transition-transform disabled:opacity-30 disabled:hover:scale-100"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
