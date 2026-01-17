import { Badge } from "@/components/ui/badge"
import { Calendar, Briefcase } from "lucide-react"
import { motion } from "framer-motion"

const experiences = [
  {
    title: "Technical Lead",
    company: "SYMX.AI",
    period: "2025",
    periodFull: "Jan 2025 - Present",
    description: "Leading security-first developer tools and cloud-native platforms.",
    skills: ["Full Stack", "CI/CD", "React", "Node.js", "Kubernetes", "Distributed Systems"],
    color: "bg-violet-500",
    highlights: ["X-Radar platform", "X-Sanity pipeline", "70% risk reduction"]
  },
  {
    title: "Senior Software Engineer",
    company: "Thales",
    period: "2021",
    periodFull: "Jun 2021 - Jan 2025",
    description: "Digital identity and security solutions for enterprise.",
    skills: ["TypeScript", "Security", "Azure"],
    color: "bg-blue-500",
    highlights: ["500k+ users", "CSM-SSO-Plugin", "Enterprise identity"]
  },
  {
    title: "Software Engineer",
    company: "TurnKey Solutions",
    period: "2020",
    periodFull: "Nov 2020 - May 2021",
    description: "Scalable web solutions and enterprise software.",
    skills: ["React", "Node.js", "Full Stack"],
    color: "bg-emerald-500",
    highlights: ["Global markets", "Remote workflows", "Enterprise suites"]
  },
  {
    title: "Member of Technical Staff",
    company: "LambdaTest",
    period: "2019",
    periodFull: "Nov 2019 - Oct 2020",
    description: "Testing infrastructure and automation tools.",
    skills: ["Groovy", "CI/CD", "Test Automation"],
    color: "bg-orange-500",
    highlights: ["GEB integration", "Cloud testing", "QA tooling"]
  },
  {
    title: "Associate Software Engineer",
    company: "CGI",
    period: "2018",
    periodFull: "Jan 2018 - Oct 2019",
    description: "Enterprise development and business consulting.",
    skills: ["Java", "SQL", "SDLC"],
    color: "bg-slate-500",
    highlights: ["Banking clients", "Enterprise systems", "SDLC mastery"]
  }
]

export function Experience() {
  return (
    <section id="experience" className="py-20 relative overflow-hidden bg-gradient-to-b from-slate-50 to-white">
      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-bold tracking-tighter mb-3 text-slate-900"
          >
            Professional <span className="text-gradient">Journey</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-500 max-w-xl mx-auto"
          >
            7+ years of engineering excellence across security, cloud, and developer tools.
          </motion.p>
        </div>

        {/* Horizontal Timeline - Desktop */}
        <div className="hidden lg:block relative">
          {/* Glowing Timeline Line */}
          <div className="absolute top-[60px] left-0 right-0 h-1 bg-gradient-to-r from-violet-500/20 via-blue-500/40 to-slate-300/20 rounded-full">
            <motion.div 
              initial={{ width: "0%" }}
              whileInView={{ width: "100%" }}
              viewport={{ once: true }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 rounded-full shadow-lg shadow-primary/30"
            />
          </div>
          
          {/* Timeline Nodes */}
          <div className="grid grid-cols-5 gap-4 relative">
            {experiences.map((exp, index) => (
              <motion.div
                key={exp.company}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="relative pt-20 group"
              >
                {/* Timeline Node */}
                <div className="absolute top-[48px] left-1/2 -translate-x-1/2 z-10">
                  <motion.div 
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + index * 0.1, type: "spring" }}
                    className={`w-6 h-6 rounded-full ${exp.color} shadow-lg ring-4 ring-white flex items-center justify-center`}
                  >
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </motion.div>
                  {/* Year Label */}
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs font-black text-slate-400 tracking-widest">
                    {exp.period}
                  </div>
                </div>

                {/* Card */}
                <div className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 h-full">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-2 h-2 rounded-full ${exp.color}`} />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{exp.company}</span>
                  </div>
                  
                  <h3 className="text-sm font-bold text-slate-900 mb-1 leading-tight">{exp.title}</h3>
                  <p className="text-[11px] text-slate-500 mb-3 line-clamp-2">{exp.description}</p>
                  
                  {/* Highlights */}
                  <div className="space-y-1.5 mb-3">
                    {exp.highlights.slice(0, 2).map((h, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                        <div className="w-1 h-1 rounded-full bg-primary/60" />
                        <span className="font-medium">{h}</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Skills */}
                  <div className="flex flex-wrap gap-1">
                    {exp.skills.slice(0, 2).map(skill => (
                      <Badge key={skill} className="text-[8px] font-bold bg-slate-50 border-slate-100 text-slate-400 px-1.5 py-0">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Vertical Timeline - Mobile/Tablet */}
        <div className="lg:hidden space-y-6">
          {experiences.map((exp, index) => (
            <motion.div
              key={exp.company}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="relative pl-8"
            >
              {/* Vertical Line */}
              {index < experiences.length - 1 && (
                <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-gradient-to-b from-primary/40 to-slate-200" />
              )}
              
              {/* Node */}
              <div className={`absolute left-0 top-4 w-6 h-6 rounded-full ${exp.color} shadow-md ring-4 ring-white flex items-center justify-center`}>
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>

              {/* Card */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 hover:shadow-lg transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary/60" />
                    <span className="text-xs font-bold text-slate-900">{exp.company}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                    <Calendar className="w-3 h-3" />
                    {exp.periodFull}
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-slate-900 mb-1">{exp.title}</h3>
                <p className="text-sm text-slate-500 mb-4">{exp.description}</p>
                
                <div className="flex flex-wrap gap-1.5">
                  {exp.skills.map(skill => (
                    <Badge key={skill} className="text-[9px] font-bold bg-slate-50 border-slate-100 text-slate-400 px-2 py-0.5">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/[0.03] rounded-full blur-[100px] -z-10" />
    </section>
  )
}
