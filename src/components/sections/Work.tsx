import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ExternalLink, Github, ArrowRight } from "lucide-react"

interface Project {
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  github: string;
  demo?: string;
  gridSize: string;
  problem: string;
  solution: string;
  stack: string[];
  metrics: string[];
  stars: number;
  forks: number;
}

const projects: Project[] = [
  {
    title: "CostReveal",
    subtitle: "Cost attribution for AI, cloud, and API spend",
    description: "Independent research project that reads the bills of AI, cloud, and API providers and attributes every dollar of spend to the team, feature, or customer behind it. No SDK, no code changes.",
    tags: ["Cost Attribution", "NestJS", "React"],
    github: "https://costreveal.com",
    demo: "https://costreveal.com",
    gridSize: "md:col-span-1",
    problem: "Cloud and AI bills arrive as lump sums. Finance sees the total, but nobody knows which team, feature, or customer caused the spend.",
    solution: "Read provider bills directly and attribute every dollar to the team, feature, or customer behind it, with a confidence figure and the unexplained remainder stated openly.",
    stack: ["Node.js", "NestJS", "PostgreSQL", "Redis", "React", "Docker"],
    metrics: ["No SDK, no code changes", "Team / feature / customer attribution", "SOC2-aligned (not certified)"],
    stars: 0,
    forks: 0
  },
  {
    title: "SecretStack",
    subtitle: "VS Code extension for exposed secrets",
    description: "Open-source VS Code extension that scans codebases for exposed secrets (API keys, passwords, tokens) and raises real-time alerts with customisable detection rules.",
    tags: ["Security", "VS Code", "Open Source"],
    github: "https://github.com/ArpitStack/secret-stack",
    gridSize: "md:col-span-1",
    problem: "Developers accidentally commit API keys, passwords, and tokens to version control, creating serious security exposure.",
    solution: "A VS Code extension that scans codebases in real time and raises alerts with customisable detection rules, before secrets reach version control.",
    stack: ["TypeScript", "VS Code Extension API"],
    metrics: ["Real-time secret scanning", "Customisable detection rules", "Open source"],
    stars: 0,
    forks: 0
  },
  {
    title: "CipherTrust Secrets Manager SSO Plugin",
    subtitle: "Enterprise SSO automation · ThalesGroup",
    description: "Open-source Chromium extension published under the ThalesGroup GitHub org. Automates SSO configuration between CipherTrust Manager and Akeyless, cutting enterprise setup time from 30 minutes to under 30 seconds.",
    tags: ["Security", "SSO", "Chrome Extension"],
    github: "https://github.com/ThalesGroup/csm-sso-plugin",
    gridSize: "md:col-span-1",
    problem: "Enterprise SSO setup between CipherTrust Manager and Akeyless was manual, slow, and error-prone.",
    solution: "A Chromium extension that automates the full SSO configuration flow, cutting setup time from 30 minutes to under 30 seconds.",
    stack: ["Go", "JavaScript", "Chrome Extensions API", "OAuth", "SSO"],
    metrics: ["30 min to under 30 sec setup", "Published under ThalesGroup", "Built at Thales"],
    stars: 0,
    forks: 0
  }
]

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="flex flex-col border border-stone-200 rounded-lg bg-white p-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-serif text-2xl text-stone-900 leading-tight mb-1.5">
            {project.title}
          </h3>
          <p className="text-sm text-stone-500">{project.subtitle}</p>
        </div>
        <a
          href={project.github}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-900 hover:border-stone-400 transition-colors"
          aria-label={`${project.title} on GitHub`}
        >
          <Github className="w-4 h-4" />
        </a>
      </div>

      <p className="text-stone-600 leading-relaxed mb-6 flex-grow">
        {project.description}
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {project.stack.map(tech => (
          <span
            key={tech}
            className="text-xs font-medium text-stone-600 bg-stone-100 rounded-md px-2.5 py-1"
          >
            {tech}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4 pt-5 border-t border-stone-100">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="link" className="p-0 h-auto text-sm font-medium text-[#1E3A5F]">
              Details <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg">
            <DialogHeader className="text-left pb-4 border-b border-stone-200">
              <DialogTitle className="font-serif text-3xl text-stone-900">
                {project.title}
              </DialogTitle>
              <p className="text-sm text-stone-500 mt-1">{project.subtitle}</p>
            </DialogHeader>
            <div className="pt-6 space-y-8">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-stone-500 mb-2">
                  Problem
                </h4>
                <p className="text-stone-700 leading-relaxed">{project.problem}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-stone-500 mb-2">
                  Solution
                </h4>
                <p className="text-stone-700 leading-relaxed">{project.solution}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-stone-500 mb-3">
                  Highlights
                </h4>
                <ul className="space-y-1.5">
                  {project.metrics.map(metric => (
                    <li key={metric} className="flex items-start gap-2.5 text-stone-700">
                      <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                      <span className="text-[15px]">{metric}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-3 pt-2">
                <Button className="rounded-lg bg-stone-900 hover:bg-stone-800" asChild>
                  <a href={project.github} target="_blank" rel="noopener noreferrer">
                    <Github className="w-4 h-4 mr-2" /> Source
                  </a>
                </Button>
                {project.demo && (
                  <Button variant="outline" className="rounded-lg" asChild>
                    <a href={project.demo} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" /> Live Site
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </article>
  )
}

/**
 * Work: three projects as clean bordered cards.
 */
export function Work() {
  return (
    <section id="work" className="py-24 md:py-32 border-t border-stone-200">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-4xl mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
            Selected Work
          </h2>
          <p className="text-lg text-stone-600 max-w-2xl">
            Platforms, tools and open source, built to solve real problems.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {projects.map((project) => (
            <ProjectCard key={project.title} project={project} />
          ))}
        </div>
      </div>
    </section>
  )
}
