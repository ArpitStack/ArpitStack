import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Globe, Terminal, Github, Cloud, Layers } from "lucide-react"
import { motion } from "framer-motion"

const techStack = [
  { name: "JavaScript", icon: <span className="bg-yellow-400 text-black px-1 rounded font-bold">JS</span> },
  { name: "Python", icon: <span className="bg-blue-600 text-white px-1 rounded font-bold">PY</span> },
  { name: "Java", icon: <span className="bg-red-600 text-white px-1 rounded font-bold">JV</span> },
  { name: "Golang", icon: <span className="bg-cyan-500 text-white px-1 rounded font-bold">GO</span> },
  { name: "Docker", icon: <span className="p-1"><Cloud className="w-full h-full" /></span> },
  { name: "Kubernetes", icon: <span className="p-1"><Layers className="w-full h-full" /></span> },
  { name: "AWS", icon: <span className="bg-orange-500 text-white px-1 rounded font-black">AWS</span> },
  { name: "GCP", icon: <span className="bg-blue-500 text-white px-1 rounded font-black">GCP</span> },
  { name: "Azure", icon: <span className="bg-blue-400 text-white px-1 rounded font-black">AZ</span> },
  { name: "Kafka", icon: <span className="bg-slate-800 text-white px-1 rounded font-bold">KF</span> },
  { name: "Hadoop", icon: <span className="bg-yellow-600 text-black px-1 rounded font-bold">HD</span> },
  { name: "Selenium", icon: <span className="bg-green-600 text-white px-1 rounded font-bold">SL</span> },
  { name: "Chromium", icon: <span className="bg-blue-400 text-white px-1 rounded font-bold">CH</span> },
  { name: "Git", icon: <Github className="w-full h-full" /> },
  { name: "VSCode", icon: <span className="bg-blue-600 text-white px-1 rounded font-bold">VS</span> }
]

/**
 * About section component.
 * Showcases technical philosophy, tech stack cluster, and dynamic GitHub statistics.
 */
export function About() {
  const [githubStats, setGithubStats] = useState({
    followers: 0,
    public_repos: 0,
    stars: 120
  })

  useEffect(() => {
    // Fetch User Stats
    fetch("https://api.github.com/users/ArpitStack")
      .then(res => res.json())
      .then(data => {
        if(data.followers !== undefined) {
            setGithubStats(prev => ({
                ...prev,
                followers: data.followers || 0,
                public_repos: data.public_repos || 0
            }))
        }
      })
      .catch(err => console.error("Failed to fetch Github stats", err))

    // Fetch Star Counts from Repos (Estimate)
    fetch("https://api.github.com/users/ArpitStack/repos?per_page=100")
      .then(res => res.json())
      .then(repos => {
        if (Array.isArray(repos)) {
          const totalStars = repos.reduce((acc, repo) => acc + (repo.stargazers_count || 0), 0);
          setGithubStats(prev => ({
            ...prev,
            stars: totalStars
          }));
        }
      })
      .catch(err => console.error("Failed to fetch repository stars", err));
  }, [])

  return (
    <section id="about" className="py-24 relative overflow-hidden bg-slate-50/50">
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-6xl font-bold tracking-tighter mb-4 text-slate-900"
          >
            About <span className="text-gradient">ArpitStack</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-slate-500 font-medium"
          >
            Senior Technical Lead focusing on scalable backend architecture, cloud-native developer tools, and open-source impact.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {/* Detailed Bio - Tech Card */}
          <Card className="md:col-span-2 md:row-span-2 tech-card p-6 lg:p-10">
             <CardHeader className="pb-4 px-0">
                <CardTitle className="flex items-center gap-3 text-3xl font-bold text-slate-900">
                  <Terminal className="h-8 w-8 text-primary"/> Technical Philosophy
                </CardTitle>
             </CardHeader>
             <CardContent className="space-y-8 px-0">
                <p className="text-xl leading-relaxed text-slate-600 font-medium">
                  I specialize in engineering <span className="text-slate-900 font-bold underline decoration-primary/20">High-Availability Systems</span>, 
                  <span className="text-slate-900 font-bold underline decoration-primary/20"> Distributed Architectures</span>, and 
                  <span className="text-slate-900 font-bold underline decoration-primary/20"> Low-Latency Tools</span>.
                </p>
                <p className="text-slate-500 leading-relaxed font-medium">
                  My mission is to abstract complexity. Whether it's through SecretStack's real-time security scanning or CloudStack's unified CLI, I build tools that empower developers to focus on creation rather than configuration.
                </p>
                
                {/* Tech Ecosystem Cluster */}
                <div className="pt-10 border-t border-slate-50 relative overflow-hidden">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-12 flex items-center gap-3">
                    <span className="w-8 h-px bg-slate-200" /> Technical Ecosystem <span className="text-primary/40">v2.4.9</span>
                  </h4>
                  
                  <div className="relative h-[300px] w-full flex items-center justify-center">
                    {/* Pulsing Center Node */}
                    <div className="absolute w-24 h-24 bg-primary/5 rounded-full blur-2xl animate-pulse" />
                    
                    {/* Floating Tech Icons in a Cluster */}
                    {techStack.map((tech, i) => {
                      const angle = (i / techStack.length) * (Math.PI * 2);
                      const radius = 100 + (i % 2 === 0 ? 30 : -20);
                      const x = Math.cos(angle) * radius;
                      const y = Math.sin(angle) * radius;
                      
                      return (
                        <motion.div 
                          key={tech.name}
                          initial={{ opacity: 0, scale: 0 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.05, type: "spring" }}
                          animate={{ 
                            x: [x, x + Math.random() * 10 - 5, x],
                            y: [y, y + Math.random() * 10 - 5, y]
                          }}
                          style={{ position: 'absolute' }}
                          className="group cursor-pointer"
                        >
                          <div className="relative">
                             <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-lg group-hover:scale-125 group-hover:border-primary group-hover:shadow-primary/20 transition-all duration-500">
                               <span className="grayscale group-hover:grayscale-0 transition-all text-[10px] font-black">{tech.icon}</span>
                             </div>
                             {/* Floating Label on Hover */}
                             <motion.div 
                               initial={{ opacity: 0, y: 10 }}
                               whileHover={{ opacity: 1, y: -20 }}
                               className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-900 text-white text-[8px] font-black rounded uppercase tracking-widest whitespace-nowrap pointer-events-none"
                             >
                               {tech.name}
                             </motion.div>
                          </div>
                        </motion.div>
                      )
                    })}
                    
                    {/* Connecting "Flow" Lines */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.15]">
                      <motion.circle 
                        cx="50%" cy="50%" r="80" 
                        fill="none" stroke="currentColor" strokeWidth="0.5" 
                        strokeDasharray="4 4" 
                        className="text-primary animate-spin-slow"
                      />
                      <motion.circle 
                        cx="50%" cy="50%" r="120" 
                        fill="none" stroke="currentColor" strokeWidth="0.5" 
                        strokeDasharray="8 8" 
                        className="text-indigo-400"
                        animate={{ rotate: -360 }}
                        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                      />
                    </svg>
                  </div>
                </div>
             </CardContent>
          </Card>

          {/* Stats Card */}
          <div className="flex flex-col gap-8">
            <Card className="flex flex-col justify-center items-center p-12 border-none bg-primary rounded-[3rem] text-white shadow-2xl shadow-primary/30 group overflow-hidden relative">
               <div className="relative z-10 text-center">
                 <div className="text-8xl font-black mb-2 font-display tracking-tighter group-hover:scale-110 transition-transform duration-500">7+</div>
                 <div className="text-[10px] uppercase font-black tracking-[0.2em] opacity-80">Years Excellence</div>
               </div>
               <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </Card>

            <Card className="p-10 border-slate-100 bg-white shadow-xl rounded-[3rem] group overflow-hidden relative">
               <CardHeader className="p-0 mb-6">
                 <CardTitle className="text-xl font-bold flex items-center gap-2 text-slate-900"><Globe className="h-6 w-6 text-indigo-500"/> Global Reach</CardTitle>
               </CardHeader>
               <CardContent className="p-0">
                  <p className="font-bold text-xl text-slate-900 mb-1">Based in India</p>
                  <p className="text-slate-500 text-sm mb-6 font-medium">Collaborating with global teams across FAANG and high-growth startups.</p>
                  <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      whileInView={{ width: "100%" }}
                      className="h-full bg-gradient-to-r from-primary to-indigo-500"
                    />
                  </div>
               </CardContent>
            </Card>
          </div>

          {/* Dynamic GitHub Contribution Visualization */}
          <Card className="col-span-1 md:col-span-3 border-slate-100 bg-white shadow-xl rounded-[3rem] overflow-hidden group">
              <CardContent className="p-12 relative">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-10 mb-12">
                      <div className="flex items-center gap-6">
                          <div className="p-5 bg-primary/5 rounded-[2rem] border border-primary/10">
                            <Github className="h-10 w-10 text-primary" />
                          </div>
                          <div>
                              <h3 className="text-3xl font-bold text-slate-900">Open Source Stewardship</h3>
                              <p className="text-sm text-slate-500 font-bold uppercase tracking-widest">899+ contributions in the last cycle</p>
                          </div>
                      </div>
                      
                      <div className="flex gap-12">
                          <div className="text-center">
                              <div className="text-4xl font-black font-mono text-primary leading-none mb-2">{githubStats.public_repos}</div>
                              <div className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400">Repositories</div>
                          </div>
                          <div className="text-center">
                              <div className="text-4xl font-black font-mono text-primary leading-none mb-2">{githubStats.followers}</div>
                              <div className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400">Followers</div>
                          </div>
                          <div className="text-center">
                              <div className="text-4xl font-black font-mono text-indigo-500 leading-none mb-2">~{githubStats.stars}</div>
                              <div className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400">Impact Score</div>
                          </div>
                      </div>
                  </div>
                  
                  {/* Modern Contribution Heatmap - High Contrast for Light Mode */}
                  <div className="w-full">
                      <div className="grid grid-cols-[repeat(52,1fr)] gap-[2px] md:gap-1.5">
                          {Array.from({ length: 52 * 7 }).map((_, i) => {
                              const level = Math.random() > 0.6 ? (Math.random() > 0.8 ? (Math.random() > 0.95 ? 4 : 3) : 2) : 1;
                              const colors = [
                                "bg-slate-50",
                                "bg-primary/10",
                                "bg-primary/30",
                                "bg-primary/60",
                                "bg-primary"
                              ];
                              return (
                                <motion.div 
                                  key={i} 
                                  initial={{ opacity: 0, scale: 0 }}
                                  whileInView={{ opacity: 1, scale: 1 }}
                                  transition={{ delay: (i % 52) * 0.005 }}
                                  viewport={{ once: true }}
                                  className={`aspect-square rounded-[1px] md:rounded-sm ${colors[level]} hover:ring-2 hover:ring-primary hover:z-10 transition-all cursor-crosshair`} 
                                />
                              )
                          })}
                      </div>
                      <div className="flex justify-between items-center mt-6 text-[10px] text-slate-400 font-black tracking-[0.3em] uppercase">
                          <span>January Lifecycle Begin</span>
                          <span>December Performance Peak</span>
                      </div>
                  </div>
              </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
