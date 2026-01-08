import React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { ExternalLink, Github, Layers, ArrowRight, Star, Shield, Cloud, Lock, Zap, BookOpen, Share2 } from "lucide-react"
import { motion } from "framer-motion"
import { Terminal } from "@/components/ui/terminal"


interface Project {
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  icon: React.ReactNode;
  github: string;
  demo?: string;
  gridSize: string;
  problem: string;
  solution: string;
  stack: string[];
  metrics: string[];
  blueprint?: React.ReactNode;
  stars: number;
  forks: number;
}

const projects: Project[] = [
  {
    title: "SecretStack",
    subtitle: "Real-time Secret Scanner for VSCode",
    description: "An intelligent, real-time code scanner for VSCode workspaces, identifying exposed secrets like API keys and tokens before they reach Git.",
    tags: ["TypeScript", "Security", "VSCode API", "Node.js"],
    icon: <Shield className="w-8 h-8 text-red-500" />,
    github: "https://github.com/ArpitStack/secret-stack",
    demo: "https://marketplace.visualstudio.com/items?itemName=ArpitStack.secret-stack",
    gridSize: "md:col-span-2 md:row-span-2",
    problem: "Accidental credential exposure is the #1 cause of cloud breaches. Standard tools are often too slow or run too late in the CI/CD pipeline.",
    solution: "SecretStack shifts security left by scanning in real-time as you type, using advanced AST-based detection to minimize false positives.",
    stack: ["TypeScript", "Rust (Scanner Core)", "VSCode Extension API"],
    metrics: ["10k+ Installs", "99% Accuracy", "Real-time Detection"],
    stars: 124,
    forks: 15,
    blueprint: (
      <svg viewBox="0 0 400 200" className="w-full h-full text-primary opacity-80" fill="none">
        <rect x="20" y="70" width="80" height="60" rx="8" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4"/>
        <text x="60" y="105" textAnchor="middle" fill="currentColor" fontSize="10" className="font-mono">Editor</text>
        <path d="M100 100 L150 100" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrow)"/>
        <rect x="150" y="50" width="100" height="100" rx="12" stroke="currentColor" strokeWidth="2" className="animate-pulse"/>
        <text x="200" y="105" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="bold">Scanner Core</text>
        <path d="M250 100 L300 100" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrow)"/>
        <circle cx="330" cy="100" r="30" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2"/>
        <text x="330" y="105" textAnchor="middle" fill="currentColor" fontSize="10">Alerts</text>
        <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L0,10 L10,5 Z" fill="currentColor"/></marker></defs>
      </svg>
    )
  },
  {
    title: "CloudStack",
    subtitle: "Unified Multi-Cloud CLI",
    description: "Seamlessly manage and validate cloud credentials across AWS, GCP, Azure, and OCI from a single, high-performance interface.",
    tags: ["Go", "Cloud", "CLI", "Security"],
    icon: <Cloud className="w-8 h-8 text-blue-500" />,
    github: "https://github.com/ArpitStack/cloudstack",
    gridSize: "md:col-span-1 md:row-span-2",
    problem: "Context switching between multiple cloud CLIs is cumbersome and leads to configuration drift and security gaps.",
    solution: "A unified binary that abstracts provider differences, offering a consistent syntax for credential management and validation.",
    stack: ["Golang", "Cobra", "Multi-Cloud SDKs"],
    metrics: ["Zero Config Drift", "4x Faster Workflow", "Secure Vault Integrated"],
    stars: 89,
    forks: 8,
    blueprint: (
      <svg viewBox="0 0 400 200" className="w-full h-full text-blue-500 opacity-80" fill="none">
        <rect x="150" y="20" width="100" height="40" rx="8" stroke="currentColor" strokeWidth="2"/>
        <text x="200" y="45" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="bold">CloudStack CLI</text>
        <path d="M200 60 L200 100" stroke="currentColor" strokeWidth="2"/>
        <path d="M100 100 L300 100" stroke="currentColor" strokeWidth="2"/>
        <path d="M100 100 L100 140" stroke="currentColor" strokeWidth="2"/>
        <path d="M200 100 L200 140" stroke="currentColor" strokeWidth="2"/>
        <path d="M300 100 L300 140" stroke="currentColor" strokeWidth="2"/>
        <rect x="70" y="140" width="60" height="30" rx="4" stroke="currentColor" strokeWidth="1"/>
        <text x="100" y="160" textAnchor="middle" fill="currentColor" fontSize="8">AWS</text>
        <rect x="170" y="140" width="60" height="30" rx="4" stroke="currentColor" strokeWidth="1"/>
        <text x="200" y="160" textAnchor="middle" fill="currentColor" fontSize="8">GCP</text>
        <rect x="270" y="140" width="60" height="30" rx="4" stroke="currentColor" strokeWidth="1"/>
        <text x="300" y="160" textAnchor="middle" fill="currentColor" fontSize="8">Azure</text>
      </svg>
    )
  },
  {
    title: "VaultStack",
    subtitle: "Encrypted Password Manager",
    description: "A secure, stunningly designed password vault with military-grade encryption for all your sensitive data.",
    tags: ["React", "Cryptography", "UI/UX"],
    icon: <Lock className="w-8 h-8 text-purple-500" />,
    github: "https://github.com/ArpitStack/vaultstack",
    gridSize: "md:col-span-1 md:row-span-1",
    problem: "Existing password managers are either too complex or visually outdated, discouraging regular security hygiene.",
    solution: "A focus on 'Beauty in Security' - combining AES-256-GCM encryption with a fluid, modern interface.",
    stack: ["React", "Web Crypto API", "TailwindCSS"],
    metrics: ["AES-256 Encryption", "Zero-Knowledge Architecture", "Premium UX"],
    stars: 256,
    forks: 34
  },
  {
    title: "ScaleStack",
    subtitle: "Elastic EC2 Scaling Engine",
    description: "Dynamically scale EC2 instances based on real-time traffic, ensuring high availability during peak demand peaks.",
    tags: ["AWS", "Auto-scaling", "Python"],
    icon: <Zap className="w-8 h-8 text-yellow-500" />,
    github: "https://github.com/ArpitStack/scalestack",
    gridSize: "md:col-span-1 md:row-span-1",
    problem: "Default auto-scaling can be reactive and slow, leading to performance degradation during sudden traffic spikes.",
    solution: "A predictive engine that pre-warm instances based on trend analysis and custom triggers.",
    stack: ["Python", "Boto3", "AWS CloudWatch"],
    metrics: ["-20% Infrastructure Cost", "Zero Downtime", "Predictive Analytics"],
    stars: 67,
    forks: 5
  },
  {
    title: "CheatStack",
    subtitle: "DevOps & Cloud Cheatsheets",
    description: "Quick access to essential commands for Git, Docker, Kubernetes, and major Cloud platforms.",
    tags: ["Documentation", "Community", "Open Source"],
    icon: <BookOpen className="w-8 h-8 text-green-500" />,
    github: "https://github.com/ArpitStack/cheatstack",
    gridSize: "md:col-span-2 md:row-span-1",
    problem: "Developers spend too much time searching for complex commands across fragmented documentation sites.",
    solution: "A community-driven, searchable repository of the most useful commands for every DevOps tool.",
    stack: ["Markdown", "VitePress", "GitHub Actions"],
    metrics: ["Global Contributor Base", "Searchable UI", "Offline Available"],
    stars: 432,
    forks: 89
  }
]

/**
 * Project card component for the bento grid.
 * Displays project overview and handles the case study dialog.
 */
function ProjectCard({ project, index }: { project: Project, index: number }) {

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className={`group bento-card relative flex flex-col justify-between overflow-hidden ${project.gridSize}`}
    >
      {/* Blueprint Overlay (Reveals on Hover) */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-700 ease-in-out bg-white/95">
        <div className="absolute inset-0 opacity-[0.03] circuit-pattern" />
        <div className="w-full h-full p-8 flex items-center justify-center scale-90 group-hover:scale-100 transition-transform duration-700">
           {"blueprint" in project ? project.blueprint : (
              <div className="text-primary/10 flex flex-col items-center gap-2">
                <Layers className="w-16 h-16" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em]">System Data Encrypted</span>
              </div>
           )}
        </div>
        <div className="absolute bottom-6 right-8 text-[8px] font-black uppercase tracking-[0.5em] text-primary/20">
          Schematic v{index + 1}.0
        </div>
      </div>

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 shadow-sm group-hover:border-primary/20 group-hover:bg-primary/5 transition-all duration-500">
            {project.icon}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" className="rounded-full w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
              <a href={project.github} target="_blank" rel="noopener noreferrer">
                <Github className="w-4 h-4" />
              </a>
            </Button>
            <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
              <Star className="w-3 h-3 text-yellow-500" />
              <span>{project.stars}</span>
            </div>
          </div>
        </div>
        
        <h3 className="text-2xl font-bold mb-1 text-slate-900 group-hover:text-primary transition-colors">{project.title}</h3>
        <p className="text-xs text-primary font-black mb-3 uppercase tracking-[0.2em]">{project.subtitle}</p>
        <p className="text-sm text-slate-500 line-clamp-3 leading-relaxed font-medium">
          {project.description}
        </p>
      </div>

      <div className="mt-8 flex items-center justify-between relative z-10">
        <div className="flex gap-1">
          {project.tags.slice(0, 2).map(tag => (
            <Badge key={tag} className="text-[9px] font-black uppercase tracking-tighter bg-slate-50 border-slate-100 text-slate-400">
              {tag}
            </Badge>
          ))}
        </div>
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="link" className="p-0 h-auto text-xs font-black text-slate-900 group-hover:text-primary transition-colors tracking-widest">
              CASE STUDY <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-5xl bg-white/95 backdrop-blur-3xl border-slate-100 p-0 overflow-hidden rounded-[3rem] shadow-2xl">
            <div className="grid md:grid-cols-5 h-full">
              {/* Sidebar Info */}
              <div className="md:col-span-2 p-10 bg-gradient-to-br from-primary/10 via-background to-transparent border-r border-white/5 flex flex-col justify-between">
                <div className="space-y-8">
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="p-2 rounded-lg bg-primary/20 text-primary">
                        {project.icon}
                      </div>
                      <Badge variant="outline" className="border-primary/20 text-primary">{project.tags[0]}</Badge>
                    </div>
                    <h2 className="text-4xl font-bold mb-2 tracking-tighter">{project.title}</h2>
                    <p className="text-muted-foreground text-sm uppercase font-black tracking-widest opacity-60">{project.subtitle}</p>
                  </div>
                  
                  <div className="space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                       The Challenge
                    </h4>
                    <p className="text-muted-foreground leading-relaxed text-sm">{project.problem}</p>
                  </div>

                   <div className="space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-green-500 flex items-center gap-2">
                       Deliverables
                    </h4>
                    <div className="grid gap-2">
                      {project.metrics.map(metric => (
                        <div key={metric} className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                           <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                           {metric}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-8">
                   <Button className="flex-1 rounded-xl font-bold" asChild>
                    <a href={project.github} target="_blank" rel="noopener noreferrer">
                      <Github className="w-4 h-4 mr-2" /> Source
                    </a>
                  </Button>
                  {project.demo && (
                    <Button variant="outline" className="flex-1 rounded-xl font-bold border-white/10" asChild>
                       <a href={project.demo} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-2" /> Demo
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Main Content & Blueprints */}
              <div className="md:col-span-3 p-10 space-y-10 overflow-y-auto max-h-[80vh] custom-scrollbar">
                <div className="space-y-4">
                   <h4 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">Platform Architecture</h4>
                   <div className="aspect-video w-full rounded-2xl bg-white/5 border border-white/5 overflow-hidden relative flex items-center justify-center group/blueprint">
                      {"blueprint" in project ? project.blueprint : (
                        <div className="text-muted-foreground/20 italic flex flex-col items-center gap-2">
                          <Layers className="w-12 h-12" />
                          <span>Confidential Architecture</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent flex items-end p-6 opacity-0 group-hover/blueprint:opacity-100 transition-opacity">
                        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Internal System Schematic v1.4</p>
                      </div>
                   </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-[0.2em] text-primary">Strategic Solution</h4>
                  <p className="text-muted-foreground leading-relaxed italic border-l-2 border-primary/20 pl-6 text-lg">
                    "{project.solution}"
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="p-6 rounded-2xl bg-white/5 border border-white/5">
                      <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Tech Stack</h5>
                      <div className="flex flex-wrap gap-2">
                        {project.stack.map(tech => (
                          <Badge key={tech} variant="secondary" className="px-3 py-0.5 text-[9px] font-bold bg-white/10 text-foreground border-none">
                            {tech}
                          </Badge>
                        ))}
                      </div>
                   </div>
                   <div className="p-6 rounded-2xl bg-primary text-white">
                      <h5 className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-4">Core Focus</h5>
                      <div className="flex items-center gap-2">
                         <Share2 className="w-5 h-5" />
                         <span className="font-bold text-sm tracking-tight underline decoration-white/30">Distributed Intelligence</span>
                      </div>
                   </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </motion.div>
  );
}

/**
 * Work section component.
 * Showcases innovations, projects, and an interactive terminal.
 */
export function Work() {
  return (
    <section id="work" className="py-24 relative overflow-hidden bg-white/50">
      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
          <div className="max-w-3xl">
            <motion.h2 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-4xl md:text-7xl font-bold tracking-tighter mb-4 text-slate-900"
            >
              The <span className="text-gradient">Innovations</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-slate-500 max-w-2xl font-medium"
            >
              Architecting the next generation of cloud-native developer tools at ArpitStack.
            </motion.p>
          </div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="flex items-center gap-4 px-6 py-3 bg-white border border-slate-200 shadow-sm rounded-2xl"
          >
            <div className="flex -space-x-3">
               {[1,2,3].map(i => (
                 <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-primary/5 flex items-center justify-center text-[10px] font-black text-primary">
                    {String.fromCharCode(64 + i)}
                 </div>
               ))}
            </div>
            <div className="text-xs">
              <span className="font-black text-primary uppercase tracking-tighter">10k+ Verified</span>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[8px]">Global Tool Installs</p>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 auto-rows-[350px]">
          {/* Terminal Feature - Large Block */}
          <div className="md:col-span-2 md:row-span-2 relative group flex flex-col justify-end p-1 overflow-hidden rounded-[3rem] bg-white border border-slate-100 shadow-2xl hover:shadow-primary/5 transition-all duration-500">
             <div className="absolute top-10 left-10 z-20 pointer-events-none">
                <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary mb-6 p-2 px-6 rounded-xl uppercase font-black tracking-widest text-[10px] shadow-sm">ArpitStack CLI v1.1</Badge>
                <h3 className="text-5xl font-bold tracking-tighter mb-3 text-slate-900 leading-none">Interactive Terminal</h3>
                <p className="text-slate-500 text-sm font-bold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Secure Sandbox Environment Active
                </p>
             </div>
             <div className="relative z-10 w-full p-4 lg:p-8">
                <Terminal />
             </div>
             <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />
          </div>

          {projects.map((project, index) => (
            <ProjectCard key={project.title} project={project} index={index} />
          ))}
        </div>
      </div>
      
      {/* Decorative Circles - Softer for Light Aura */}
      <div className="absolute top-1/2 left-0 w-96 h-96 bg-primary/5 rounded-full blur-[120px] -z-10" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[150px] -z-10" />
    </section>
  )
}
