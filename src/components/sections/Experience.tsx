import { Badge } from "@/components/ui/badge"
import { Calendar, CheckCircle2, Award, Building2 } from "lucide-react"
import { motion } from "framer-motion"

const experiences = [
  {
    title: "Senior Technical Lead",
    company: "ThalesGroup (Digital Identity & Security)",
    period: "Jan 2025 - Present",
    description: "Leading the architectural evolution of security-first developer tools and cloud-native plugins.",
    skills: ["Cloud Security", "Distributed Systems", "AuthN/AuthZ", "Go", "Kubernetes"],
    color: "from-blue-500/20 to-cyan-500/20",
    metrics: [
      "Engineered CSM-SSO-Plugin scaling to 500k+ enterprise users.",
      "Reduced secret exposure risk by 70% via automated scanning integration.",
      "Architected low-latency microservices handling 10k+ requests/sec."
    ]
  },
  {
    title: "Full Stack Engineer & Open Source Lead",
    company: "ArpitStack Collective",
    period: "Jan 2022 - Dec 2024",
    description: "Founded and scaled the ArpitStack open-source collective, building tools used by 10k+ developers.",
    skills: ["TypeScript", "Rust", "AWS", "Infrastructure as Code", "Python"],
    color: "from-purple-500/20 to-pink-500/20",
    metrics: [
      "Built SecretStack: 10k+ VSCode installs with 4.9/5 star rating.",
      "Developed CloudStack CLI, reducing provider context-switching by 60%.",
      "Mentored 20+ contributors across various open-source initiatives."
    ]
  },
  {
    title: "Software Engineer",
    company: "Distributed Systems Group",
    period: "June 2020 - Dec 2021",
    description: "Focused on high-performance backend systems and automated infrastructure orchestration.",
    skills: ["Java", "Kafka", "Docker", "GCP", "Microservices"],
    color: "from-orange-500/20 to-red-500/20",
    metrics: [
      "Optimized data pipeline throughput by 40% using Apache Kafka.",
      "Implemented automated CI/CD reducing deployment time by 50%.",
      "Architected elastic scaling engine for EC2 instances using Python."
    ]
  }
]

export function Experience() {
  return (
    <section id="experience" className="py-24 relative overflow-hidden bg-white/30 backdrop-blur-3xl">
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mb-16">
          <motion.h2 
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-6xl font-bold tracking-tighter mb-4 text-slate-900"
          >
            Professional <span className="text-gradient">Impact</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-slate-500 font-medium"
          >
            A track record of engineering scalable solutions and leading technical innovation at scale.
          </motion.p>
        </div>

        <div className="relative">
          {/* Vertical Timeline Line - Softer for Light Aura */}
          <div className="absolute left-0 md:left-1/2 top-0 bottom-0 w-[1px] bg-slate-200 transform -translate-x-1/2 hidden md:block" />

          <div className="space-y-16">
            {experiences.map((exp, index) => (
              <motion.div
                key={exp.company}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`relative flex flex-col md:flex-row gap-8 ${
                  index % 2 === 0 ? "md:flex-row-reverse" : ""
                }`}
              >
                {/* Timeline Dot */}
                <div className="absolute left-[-8px] md:left-1/2 transform md:-translate-x-1/2 mt-8 z-20">
                    <div className="w-4 h-4 rounded-full bg-primary shadow-lg shadow-primary/40 ring-4 ring-white animate-pulse" />
                </div>

                {/* Content Card - Tech Card Stylng */}
                <div className="md:w-1/2">
                   <div className="tech-card p-8 md:p-10 group">
                      <div className="absolute inset-0 opacity-[0.03] circuit-pattern pointer-events-none" />
                      
                      <div className="relative z-10">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                           <div>
                              <h3 className="text-2xl font-bold mb-1 text-slate-900">{exp.title}</h3>
                              <div className="flex items-center gap-2 text-primary font-black text-xs uppercase tracking-[0.2em]">
                                 <Building2 className="w-4 h-4 text-primary/60" /> {exp.company}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] bg-slate-50 px-4 py-2 rounded-full border border-slate-100 text-slate-400">
                              <Calendar className="w-3 h-3" /> {exp.period}
                           </div>
                        </div>

                        <p className="text-slate-500 leading-relaxed mb-8 italic font-medium">
                          "{exp.description}"
                        </p>

                        <div className="space-y-6 mb-10">
                           <h4 className="text-[10px] uppercase font-black tracking-[0.3em] text-slate-400 flex items-center gap-3">
                             <Award className="w-3 h-3 text-primary/60" /> Technical Impact Portfolio
                           </h4>
                           <div className="grid gap-4">
                              {exp.metrics.map((metric, i) => (
                                <div key={metric} className="space-y-2">
                                   <div className="flex gap-4 items-start">
                                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                                      <span className="text-sm font-bold text-slate-600 leading-tight">{metric}</span>
                                   </div>
                                   {/* Subtle Impact Meter for the first few metrics */}
                                   {i < 2 && (
                                     <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden ml-8">
                                       <motion.div 
                                         initial={{ width: 0 }}
                                         whileInView={{ width: 80 + Math.random() * 20 + "%" }}
                                         transition={{ duration: 1.5, delay: 0.5 + i * 0.2 }}
                                         className="h-full bg-primary/40"
                                       />
                                     </div>
                                   )}
                                </div>
                              ))}
                           </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-6 border-t border-slate-50">
                           {exp.skills.map(skill => (
                             <Badge key={skill} className="bg-slate-50 border-slate-100 text-[8px] font-black uppercase tracking-widest px-3 py-1 text-slate-400 hover:text-primary hover:border-primary/20 transition-all">
                                {skill}
                             </Badge>
                           ))}
                        </div>
                      </div>
                   </div>
                </div>
                
                {/* Visual Spacer for Desktop */}
                <div className="hidden md:block md:w-1/2" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Background Decor - Extremely Soft */}
      <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] bg-primary/[0.03] rounded-full blur-[120px] -z-10" />
      <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] bg-blue-500/[0.03] rounded-full blur-[120px] -z-10" />
    </section>
  )
}
