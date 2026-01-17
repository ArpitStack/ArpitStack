import React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { ExternalLink, Github, Layers, ArrowRight, Star, Shield, Cloud, Lock, Zap, Share2, CheckCircle2 } from "lucide-react"
import { motion } from "framer-motion"
import { Terminal } from "@/components/ui/terminal"
import { ArchitectureViewer, XRadarHLD, XRadarLLD, CSMSSOPluginHLD, CSMSSOPluginLLD, XSanityHLD, XSanityLLD } from "@/components/ui/architecture-diagrams"


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
    title: "X-Radar",
    subtitle: "Unified Monitoring Platform",
    description: "Real-time visibility across firmware, software, and sensor streams for SymX.AI.",
    tags: ["Monitoring", "Anomaly Detection", "Airflow", "Postgres", "Python"],
    icon: <Zap className="w-6 h-6 text-yellow-500" />,
    github: "https://github.com/symboticware/x-radar",
    gridSize: "md:col-span-1",
    problem: "Fragmented monitoring across different engineering teams led to slower debugging and decision-making.",
    solution: "A unified platform supporting live Airflow tracking, sensor diagnostics, and on-the-fly anomaly detection.",
    stack: ["Python", "Streamlit", "AWS", "Athena", "DynamoDB", "PostgreSQL"],
    metrics: ["14+ Feature Modules", "Real-time Alerts", "Multi-tenant Auth"],
    blueprint: <ArchitectureViewer hld={<XRadarHLD />} lld={<XRadarLLD />} />,
    stars: 156,
    forks: 22
  },
  {
    title: "X-Sanity",
    subtitle: "Sanity Testing Pipeline",
    description: "Automated testing framework ensuring system integrity across firmware and cloud layers.",
    tags: ["Testing", "DevOps", "Python", "Docker"],
    icon: <CheckCircle2 className="w-6 h-6 text-green-500" />,
    github: "https://github.com/ArpitStack/x-sanity",
    gridSize: "md:col-span-1",
    problem: "Manual sanity checks for complex hardware-software integrations were slow and prone to human error.",
    solution: "An automated pipeline that triggers on deployment, validating core functionality across the entire stack.",
    stack: ["Python", "Docker", "AWS", "Jenkins", "pytest"],
    metrics: ["100% Core Coverage", "Parallel Execution", "CI/CD Integration"],
    blueprint: <ArchitectureViewer hld={<XSanityHLD />} lld={<XSanityLLD />} />,
    stars: 92,
    forks: 14
  },
  {
    title: "CSM SSO Plugin",
    subtitle: "Enterprise SSO Automation",
    description: "Automates SSO setup between CipherTrust Manager and Akeyless at Thales.",
    tags: ["Security", "SSO", "Go", "Chrome Extension"],
    icon: <Lock className="w-6 h-6 text-blue-500" />,
    github: "https://github.com/ThalesGroup/csm-sso-plugin",
    gridSize: "md:col-span-1",
    problem: "Manual SSO configuration between security platforms was error-prone and time-consuming.",
    solution: "A browser extension + Go backend that automates JWT auth, access roles, and CSM tile configuration.",
    stack: ["Go", "JavaScript", "Chrome Extension API", "JWT/JWKS"],
    metrics: ["500k+ Users", "95% Time Reduction", "12 API Endpoints"],
    blueprint: <ArchitectureViewer hld={<CSMSSOPluginHLD />} lld={<CSMSSOPluginLLD />} />,
    stars: 89,
    forks: 12
  },
  {
    title: "SecretStack",
    subtitle: "VSCode Secret Scanner",
    description: "Real-time scanner preventing API keys and tokens from being committed.",
    tags: ["Security", "VSCode", "Go"],
    icon: <Shield className="w-6 h-6 text-red-500" />,
    github: "https://github.com/ArpitStack/secret-stack",
    gridSize: "md:col-span-1",
    problem: "Developers inadvertently commit secrets to repositories, leading to severe security breaches.",
    solution: "A real-time scanner that identifies and locks down secrets before they are committed, with easy manual triggers.",
    stack: ["Go", "VSCode Extension API"],
    metrics: ["10k+ Installs", "High Accuracy", "Open Source"],
    stars: 245,
    forks: 48
  },
  {
    title: "CloudStack",
    subtitle: "Multi-Cloud CLI",
    description: "Unified CLI for AWS, GCP, and Azure with zero installation.",
    tags: ["Cloud", "CLI", "Go"],
    icon: <Cloud className="w-6 h-6 text-indigo-500" />,
    github: "https://github.com/ArpitStack/cloudstack",
    gridSize: "md:col-span-1",
    problem: "Managing multiple cloud environments requires switching between various CLI tools and configurations.",
    solution: "A unified CLI supporting AWS, GCP, and Azure, allowing developers to manage all resources from one place.",
    stack: ["Go", "AWS SDK", "GCP SDK", "Azure SDK"],
    metrics: ["Unified Interface", "No Install Reqd", "Fast Operations"],
    stars: 112,
    forks: 18
  },
  {
    title: "GEB Integration",
    subtitle: "Browser Automation Framework",
    description: "LambdaTest tunnel integration with GEB for robust cross-browser testing.",
    tags: ["Testing", "Automation", "Groovy"],
    icon: <Layers className="w-6 h-6 text-emerald-500" />,
    github: "https://github.com/ArpitStack/geb-lambdatest",
    gridSize: "md:col-span-1",
    problem: "Cross-browser testing for GEB-based projects lacked seamless tunnel integration with cloud grids.",
    solution: "An integration layer that simplifies tunnel setup for GEB, enabling easy scaling of browser tests on LambdaTest.",
    stack: ["Groovy", "LambdaTest API", "GEB"],
    metrics: ["Official Contributor", "Simplified Testing", "Cloud Scale"],
    stars: 67,
    forks: 9
  }
]

/**
 * Project card component for the bento grid.
 * Displays project overview and handles the case study dialog.
 */
function ProjectCard({ project, index }: { project: Project, index: number }) {

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl bg-white border border-slate-200/80 p-4 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 ${project.gridSize}`}
    >
      {/* Top Row: Icon + Stars */}
      <div>
        <div className="flex justify-between items-start mb-3">
          <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 group-hover:border-primary/20 group-hover:bg-primary/5 transition-all">
            {project.icon}
          </div>
          <div className="flex items-center gap-1.5">
            <a href={project.github} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <Github className="w-3.5 h-3.5 text-slate-400" />
            </a>
            <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-100">
              <Star className="w-2.5 h-2.5 text-yellow-500" />
              <span>{project.stars}</span>
            </div>
          </div>
        </div>
        
        {/* Title + Description */}
        <h3 className="text-base font-bold text-slate-900 group-hover:text-primary transition-colors leading-tight">{project.title}</h3>
        <p className="text-[10px] text-primary/70 font-bold mb-2 uppercase tracking-wider">{project.subtitle}</p>
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
          {project.description}
        </p>
      </div>

      {/* Footer: Tags + Action */}
      <div className="mt-3 flex items-center justify-between pt-3 border-t border-slate-100">
        <div className="flex gap-1">
          {project.tags.slice(0, 2).map(tag => (
            <Badge key={tag} className="text-[8px] font-bold uppercase tracking-tight bg-slate-50 border-slate-100/80 text-slate-400 px-1.5 py-0">
              {tag}
            </Badge>
          ))}
        </div>
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="p-0 h-auto text-[10px] font-bold text-slate-400 hover:text-primary transition-colors">
              Details <ArrowRight className="w-3 h-3 ml-1" />
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
              Driving innovation across firmware, cloud security, and developer tools.
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

        {/* Compact Grid Layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[200px]">
          {/* Terminal Feature - Compact */}
          <div className="sm:col-span-2 lg:col-span-2 lg:row-span-2 relative group flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 shadow-xl hover:shadow-primary/20 transition-all duration-500">
             <div className="p-5 relative z-20">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-primary/20 border-primary/30 text-primary text-[8px] px-2 py-0.5 rounded-md uppercase font-black tracking-widest">CLI v1.1</Badge>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-white leading-tight">Interactive Terminal</h3>
                <p className="text-slate-400 text-xs font-medium mt-1">Try: help, neofetch, secretstack</p>
             </div>
             <div className="relative z-10 flex-1 px-3 pb-3">
                <Terminal />
             </div>
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
