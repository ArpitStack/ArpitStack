const experiences = [
  {
    title: "Technical Lead",
    company: "SYMX.AI",
    period: "2025",
    periodFull: "Jan 2025 - Present",
    description: "Leading a 12+ engineer team building X-Radar, a real-time IoT observability platform reading data from 1,500+ Symbots on mining trucks, and Control Room for live fleet tracking.",
    skills: ["Python", "Streamlit", "AWS Kinesis", "Airflow", "React", "Distributed Systems"],
    color: "bg-violet-500",
    highlights: ["X-Radar built from scratch", "89% fewer customer escalations", "12+ engineer team"]
  },
  {
    title: "Senior Software Engineer",
    company: "Thales Group",
    period: "2021",
    periodFull: "Jun 2021 - Jan 2025",
    description: "Architected 5 Go microservices for CipherTrust Secrets Management on Kubernetes; integrated CipherTrust with Akeyless. Won the global Thales CPL Award.",
    skills: ["Go", "Kubernetes", "Microservices", "Security"],
    color: "bg-blue-500",
    highlights: ["Global Thales CPL Award", "400+ test suite, 135 critical bugs caught", "SSO setup in under 30 seconds"]
  },
  {
    title: "Software Engineer",
    company: "TurnKey Solutions",
    period: "2020",
    periodFull: "Nov 2020 - May 2021",
    description: "Built Node.js backend services for RainierAEV, an ML-driven autonomous testing platform for enterprise ERP systems including Workday, SAP, and Oracle.",
    skills: ["Node.js", "Backend"],
    color: "bg-emerald-500",
    highlights: ["Caterpillar Workday deployment", "ML-driven test platform"]
  },
  {
    title: "Member of Technical Staff",
    company: "TestMu, formerly LambdaTest",
    period: "2019",
    periodFull: "Nov 2019 - Oct 2020",
    description: "One of the first 30 employees. Built integrations with 15+ Selenium, Playwright, and Cypress frameworks; published a Java Maven plugin to Maven Central.",
    skills: ["Java", "Test Automation", "Integrations"],
    color: "bg-orange-500",
    highlights: ["First 30 employees", "Maven Central plugin", "GEB contributor"]
  },
  {
    title: "Associate Software Engineer",
    company: "CGI Group",
    period: "2018",
    periodFull: "Jan 2018 - Oct 2019",
    description: "Java feature development and bug fixes for Bell Canada's telecom systems.",
    skills: ["Java"],
    color: "bg-slate-500",
    highlights: ["Bell Canada telecom systems"]
  }
]

/**
 * Experience: clean chronological list. No timeline graphics, no animations.
 */
export function Experience() {
  return (
    <section id="experience" className="py-24 md:py-32 border-t border-stone-200">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
          Experience
        </h2>
        <p className="text-lg text-stone-600 mb-16 max-w-2xl">
          8+ years of engineering across distributed systems, platform infrastructure, and security.
        </p>

        <div>
          {experiences.map((exp, index) => (
            <article
              key={exp.company}
              className={index > 0 ? "border-t border-stone-200 pt-10 mt-10" : ""}
            >
              <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-serif text-2xl text-stone-900">{exp.company}</h3>
                  <p className="text-base font-medium text-stone-700 mt-1">{exp.title}</p>
                </div>
                <p className="text-sm text-stone-500 whitespace-nowrap font-mono">
                  {exp.periodFull}
                </p>
              </div>

              <p className="text-stone-600 leading-relaxed mb-5 max-w-3xl">
                {exp.description}
              </p>

              <ul className="space-y-1.5 mb-5">
                {exp.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-stone-700">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                    <span className="text-[15px]">{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2">
                {exp.skills.map(skill => (
                  <span
                    key={skill}
                    className="text-xs font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-md px-2.5 py-1"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
