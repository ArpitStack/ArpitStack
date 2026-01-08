import React, { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { Terminal as TerminalIcon } from "lucide-react"

interface TerminalProps {
  onClose?: () => void
}

const COMMANDS: Record<string, string | string[]> = {
  help: [
    "Available commands:",
    "  about          - Learn about ArpitStack",
    "  projects       - List core open-source projects",
    "  secretstack    - Scan current context for secrets",
    "  cloudstack     - Validate cloud configuration",
    "  contact        - Get contact details",
    "  clear          - Clear the terminal",
    "  neofetch       - Display system information",
  ],
  about: "ArpitStack: Innovating Stack of Solutions. Senior Technical Lead specializing in Security & Cloud Architecture.",
  projects: [
    "Core Portfolio:",
    "  - SecretStack (VSCode Security)",
    "  - CloudStack (Multi-Cloud CLI)",
    "  - VaultStack (Encrypted Storage)",
    "  - ScaleStack (EC2 Elastic Scaler)",
  ],
  neofetch: [
    "ArpitStack@Portfolio",
    "-------------------",
    "OS: ArpitStackOS v1.1 (Custom Kernel)",
    "Host: Digital Nomad MBP",
    "Kernel: 6.12.0-arpitstack",
    "Uptime: 7+ years (Experienced Professional)",
    "Packages: Node v20, Go 1.22, Python 3.12, Rust 1.75",
    "Shell: zsh (StackShell)",
    "Resolution: Premium Aesthetic 4K",
    "Focus: Frontend, Backend, GenAI, System Design, Security, Cloud",
  ],
  secretstack: [
    "Initializing ArpitStack Security Engine v2.4...",
    "Scanning project configuration...",
    "Analyzing AST for sensitive patterns...",
    "[██████████] 100% COMPLETE",
    "--------------------------------------",
    "RESULT: 0 EXPOSED SECRETS FOUND",
    "STATUS: SECURE",
    "RECOMMENDATION: Safe to commit!",
  ],
  cloudstack: [
    "Establishing secure tunnel to multi-cloud VPC...",
    "Checking parity for AWS, GCP, and Azure configurations...",
    "SUCCESS: Multi-cloud sync synchronized with 14ms latency.",
  ],
  contact: [
    "Reach out via encrypted channels:",
    "  - Email: arpitstack@gmail.com",
    "  - GitHub: github.com/ArpitStack",
    "  - LinkedIn: linkedin.com/in/ArpitStack",
  ],
}

/**
 * Interactive Terminal component.
 * Allows users to explore ArpitStack through a CLI interface.
 */
export function Terminal({ onClose }: TerminalProps) {
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<string[]>(["Welcome to ArpitStack CLI v1.1", 'Type "help" to see available commands.'])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = input.trim().toLowerCase()
    if (!cmd) return

    setHistory((prev) => [...prev, `> ${input}`])

    if (cmd === "clear") {
      setHistory([])
    } else if (COMMANDS[cmd]) {
      const output = COMMANDS[cmd]
      if (Array.isArray(output)) {
        setHistory((prev) => [...prev, ...output])
      } else {
        setHistory((prev) => [...prev, output])
      }
    } else {
      setHistory((prev) => [...prev, `Command not found: ${cmd}. Type "help" for options.`])
    }

    setInput("")
  }

  return (
    <motion.div
      initial={{ opacity: 0.01, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto border border-slate-200 bg-white/80 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[400px] font-mono text-sm"
    >
      {/* Terminal Title Bar - Studio Console Style */}
      <div className="bg-slate-50 px-4 py-3 flex items-center justify-between border-b border-slate-200">
        <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-slate-200" />
                <div className="w-3 h-3 rounded-full bg-slate-200" />
                <button 
                  onClick={onClose}
                  className="w-3 h-3 rounded-full bg-red-400/80 hover:bg-red-500 transition-colors cursor-pointer" 
                />
            </div>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black flex items-center gap-2">
                <TerminalIcon className="w-3 h-3 text-primary" /> ArpitStack Studio Console -- zsh
            </span>
        </div>
      </div>

      {/* Terminal Content */}
      <div 
        ref={scrollRef}
        className="flex-grow p-6 overflow-y-auto space-y-1 custom-scrollbar bg-white/90"
      >
        {history.map((line, i) => (
          <div key={i} className={line.startsWith(">") ? "text-primary font-bold" : "text-slate-800 font-medium"}>
            {line}
          </div>
        ))}
        
        <form onSubmit={handleCommand} className="flex items-center gap-2 pt-2">
          <span className="text-primary font-bold">➜</span>
          <span className="text-indigo-600">~</span>
          <input
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-grow bg-transparent border-none outline-none text-slate-900 caret-transparent font-bold"
            placeholder=""
          />
          {input === "" && <motion.div animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-2.5 h-5 bg-primary" />}
        </form>
      </div>
    </motion.div>
  )
}
