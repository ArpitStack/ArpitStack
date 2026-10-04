const skillGroups = [
  {
    category: "Languages",
    skills: ["Python", "Java", "Go", "TypeScript", "Node.js"],
  },
  {
    category: "Systems and Architecture",
    skills: ["System Design", "Distributed Systems", "Platform Engineering", "Microservices", "Software Observability"],
  },
  {
    category: "Cloud and DevOps",
    skills: ["AWS", "Kubernetes", "Docker", "Cloud Infrastructure"],
  },
  {
    category: "Data and Streaming",
    skills: ["PostgreSQL", "Redis", "Apache Kafka", "Apache Airflow"],
  },
  {
    category: "Web and AI",
    skills: ["React", "NestJS", "Large Language Models (LLM)"],
  },
  {
    category: "Cost Engineering",
    skills: ["Cloud Cost Optimization", "Cost Attribution"],
  },
]

const achievements = [
  "Global CPL Award, Thales (2024)",
  "Extra Miler Awards, Thales (2021, 2023)",
  "2,800+ GitHub contributions across open-source, private, and org repos",
  "Publication: “Formal Modeling of Generalized Sliding Window Protocol”, IJCA (2018)",
  "Blogathon 1.0 and 2.0 winner",
]

/**
 * About: bio + education + achievements on the left, skills by category on the right.
 */
export function About() {
  return (
    <section id="about" className="py-24 md:py-32 border-t border-stone-200">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-16">
          About
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          {/* Left: bio, education, achievements */}
          <div>
            <p className="font-serif text-2xl leading-snug text-stone-800 mb-6">
              Senior Technical Lead with 8+ years building distributed systems and
              platform infrastructure. Currently leading a 12+ engineer team at SYMX.AI.
            </p>
            <p className="text-stone-600 leading-relaxed mb-6">
              I specialize in engineering distributed systems, platform infrastructure,
              and developer tooling. At SYMX.AI I built X-Radar from scratch: a real-time
              IoT observability platform reading data from 1,500+ Symbots on mining
              trucks, cutting customer escalations by 89 percent.
            </p>
            <p className="text-stone-600 leading-relaxed mb-12">
              At Thales I architected Go microservices for CipherTrust Secrets Management
              and won the global CPL Award. I also build open-source tools like SecretStack
              and the CipherTrust SSO plugin. Based in Gurugram, India, working with
              global teams.
            </p>

            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 mb-4">
              Education
            </h3>
            <div className="mb-10">
              <p className="font-medium text-stone-900">B.Tech, Computer Science</p>
              <p className="text-stone-600 text-sm mt-1">
                GL Bajaj Group of Institutions, AKTU (2014–2018) · 85.2% · College Topper · Top 30 in UP
              </p>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 mb-4">
              Recognition
            </h3>
            <ul className="space-y-2.5">
              {achievements.map((a) => (
                <li key={a} className="flex items-start gap-2.5 text-stone-700">
                  <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                  <span className="text-[15px]">{a}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: skills by category */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 mb-6">
              Technical Skills
            </h3>
            <div className="space-y-8">
              {skillGroups.map((group) => (
                <div key={group.category}>
                  <h4 className="font-medium text-stone-900 mb-3">{group.category}</h4>
                  <div className="flex flex-wrap gap-2">
                    {group.skills.map(skill => (
                      <span
                        key={skill}
                        className="text-sm text-stone-700 bg-white border border-stone-200 rounded-md px-3 py-1.5"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
