import { Button } from "@/components/ui/button"
import { ArrowRight, Github, Linkedin, ExternalLink, Download } from "lucide-react"
import { motion } from "framer-motion"
import { GitHubAchievements } from "@/components/ui/github-achievements"

/**
 * Hero section component for the portfolio.
 * Displays the introduction, holographic system core, and key call-to-action buttons.
 */
export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      <div className="container mx-auto px-4 z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-12 text-center md:text-left">
          <div className="flex-1 space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10 mb-4 shadow-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-xs font-bold text-primary tracking-tight">Available for Strategic Technical Leadership</span>
               </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
            >
              <h1 className="text-6xl md:text-8xl font-bold tracking-tighter leading-[0.9] mb-6 text-slate-900">
                Hello, I'm <br />
                <span className="text-gradient">Arpit Gupta</span>
              </h1>
              <p className="text-2xl md:text-3xl font-medium text-slate-600 max-w-2xl leading-tight">
                Innovating <span className="text-slate-900 border-b-2 border-primary/20">Stack of Solutions</span> to drive impactful, scalable technology.
              </p>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="text-lg text-slate-500 max-w-xl leading-relaxed font-medium"
            >
              Architecting high-performance <span className="text-slate-900">Cloud Infrastructure</span> and 
              <span className="text-slate-900"> Distributed Systems</span> for global impact. 
              Founder of <span className="text-primary font-black uppercase tracking-widest text-xs">ArpitStack</span>.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="flex flex-wrap gap-3 items-center justify-center md:justify-start"
            >
              <Button 
                size="lg" 
                className="group rounded-2xl px-6 h-12 text-sm font-bold shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all"
                asChild
              >
                <a href="#work">
                  View Projects
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              </Button>
              <Button 
                variant="outline"
                size="lg" 
                className="group rounded-2xl px-6 h-12 text-sm font-bold border-slate-200 bg-white/80 backdrop-blur-sm hover:border-primary/50 transition-all"
                asChild
              >
                <a href="/resume.pdf" download>
                  <Download className="mr-2 h-4 w-4" />
                  Resume
                </a>
              </Button>
              <div className="flex gap-3">
                <Button variant="outline" size="icon" className="rounded-2xl w-14 h-14 border-slate-200 bg-white/50 backdrop-blur-sm hover:border-primary/50 transition-colors" asChild>
                  <a href="https://github.com/ArpitStack" target="_blank" rel="noopener noreferrer">
                    <Github className="h-6 w-6 text-slate-900" />
                  </a>
                </Button>
                <Button variant="outline" size="icon" className="rounded-2xl w-14 h-14 border-slate-200 bg-white/50 backdrop-blur-sm hover:border-primary/50 transition-colors" asChild>
                  <a href="https://linkedin.com/in/ArpitStack" target="_blank" rel="noopener noreferrer">
                    <Linkedin className="h-6 w-6 text-blue-600" />
                  </a>
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.4 }}
            >
              <GitHubAchievements />
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex-1 relative w-full max-w-[550px] aspect-square group"
          >
            {/* Holographic System Core */}
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Background Glow */}
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 via-indigo-500/10 to-transparent rounded-full blur-[120px] animate-pulse" />
              
              {/* Rotating Stack Layers */}
              <div className="relative w-full h-full preserve-3d">
                {/* Layer 3: Application (Top) */}
                <motion.div
                  animate={{ 
                    y: [0, -20, 0],
                    rotateZ: [0, 5, 0],
                    rotateX: [45, 40, 45]
                  }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 flex items-center justify-center z-30"
                >
                  <div className="w-72 h-44 bg-white/60 backdrop-blur-2xl rounded-3xl border border-white shadow-2xl flex flex-col p-6 overflow-hidden">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Application Layer</span>
                    </div>
                    <div className="space-y-3 font-mono text-[10px] text-slate-600">
                      <div className="flex justify-between"><span>Endpoint</span> <span className="text-primary">/api/v1/innovate</span></div>
                      <div className="flex justify-between"><span>Status</span> <span className="text-green-600">PRODUCTION</span></div>
                      <div className="flex justify-between"><span>Latency</span> <span className="text-indigo-500">14ms</span></div>
                    </div>
                    <div className="mt-auto pt-4 border-t border-slate-100 flex justify-between items-center text-[9px] font-bold text-primary">
                      <span>ARPITSTACK CORE</span>
                      <ExternalLink className="w-3 h-3" />
                    </div>
                  </div>
                </motion.div>

                {/* Layer 2: Infrastructure (Middle) */}
                <motion.div
                  animate={{ 
                    y: [100, 80, 100],
                    rotateZ: [0, -5, 0],
                    rotateX: [45, 50, 45]
                  }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute inset-0 flex items-center justify-center z-20"
                >
                  <div className="w-[320px] h-48 bg-white/40 backdrop-blur-xl rounded-3xl border border-white/50 shadow-xl p-6 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Infrastructure Fabric</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-xl bg-slate-50/50 border border-slate-100 font-mono text-[8px] space-y-1">
                        <div className="text-slate-400">CLUSTER_ID</div>
                        <div className="font-bold text-slate-900">STACK-X-99</div>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-50/50 border border-slate-100 font-mono text-[8px] space-y-1">
                        <div className="text-slate-400">NODES_ACTIVE</div>
                        <div className="font-bold text-primary">1,204</div>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Layer 1: Hardware/Network (Base) */}
                <motion.div
                  animate={{ 
                    y: [200, 190, 200],
                    rotateZ: [0, 2, 0],
                    rotateX: [45, 48, 45]
                  }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                  className="absolute inset-0 flex items-center justify-center z-10"
                >
                  <div className="w-[360px] h-52 bg-slate-100/30 backdrop-blur-md rounded-3xl border border-slate-200/50 shadow-lg p-6 relative overflow-hidden group-hover:bg-primary/5 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-slate-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Global Foundation</span>
                    </div>
                    {/* Animated Circuitry Lines */}
                    <div className="absolute inset-0 opacity-[0.1] circuit-pattern" />
                    <div className="relative z-10 flex gap-4 mt-4">
                       {[1,2,3,4,5].map(i => (
                         <div key={i} className="h-20 w-1 bg-slate-200 rounded-full overflow-hidden">
                           <motion.div 
                              animate={{ y: [-80, 80] }}
                              transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                              className="h-full w-full bg-primary"
                           />
                         </div>
                       ))}
                    </div>
                  </div>
                </motion.div>
                
                {/* Connecting "Buses" (Vertical Lines) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[200px] h-[300px] border-x border-dashed border-primary/20 rotateX-[45deg] scale-x-[1.5]" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Dynamic Circuitry Background Overlay */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden opacity-30">
        <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <motion.path
            d="M 100,0 L 100,200 L 200,300 L 200,500 L 300,600"
            fill="none"
            stroke="url(#circuit-grad)"
            strokeWidth="0.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.2 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
          <motion.path
            d="M 900,1000 L 900,800 L 800,700 L 800,500 L 700,400"
            fill="none"
            stroke="url(#circuit-grad)"
            strokeWidth="0.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.2 }}
            transition={{ duration: 4, delay: 2, repeat: Infinity, ease: "linear" }}
          />
          <defs>
            <linearGradient id="circuit-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
              <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </section>
  )
}
