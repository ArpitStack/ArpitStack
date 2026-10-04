import { Button } from "@/components/ui/button"
import { ArrowRight, Download } from "lucide-react"

const DRIVE_RESUME_URL = "https://drive.google.com/file/d/1_U4OP4jsgYCidwF0sHUE5xRokxiu8Lxa/view?usp=sharing"

/**
 * Editorial hero: typography carries the page.
 * No animations, no decorative widgets — content is complete in the prerendered HTML.
 */
export function Hero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="flex items-center gap-4 mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500">
            Technical Lead, Gurugram, India
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Open to opportunities
          </span>
        </div>

        <h1 className="font-serif text-6xl md:text-8xl leading-[1.02] text-stone-900 mb-8">
          Arpit Gupta
        </h1>

        <p className="font-serif text-2xl md:text-3xl leading-snug text-stone-800 max-w-3xl mb-8">
          I build distributed systems and platform infrastructure that hold up at scale.
        </p>

        <p className="text-lg text-stone-600 leading-relaxed max-w-2xl mb-4">
          8+ years across startups and enterprises. Currently leading a 12+ engineer
          team at SYMX.AI. Previously at Thales and LambdaTest.
        </p>
        <p className="text-lg text-stone-600 leading-relaxed max-w-2xl mb-10">
          I specialize in IoT observability, Go microservices, and cost-aware platform
          engineering. Based in Gurugram, working with global teams.
        </p>

        <div className="flex flex-wrap gap-4 mb-16">
          <Button size="lg" className="rounded-lg bg-stone-900 text-white hover:bg-stone-800 px-7" asChild>
            <a href="#work">
              View Work
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <Button size="lg" variant="outline" className="rounded-lg px-7 border-stone-300" asChild>
            <a href={DRIVE_RESUME_URL} target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" />
              Resume
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-stone-200 pt-10">
          {[
            { value: "8+", label: "Years Experience" },
            { value: "12+", label: "Engineers Led" },
            { value: "1,500+", label: "IoT Devices (Symbots)" },
            { value: "89%", label: "Fewer Escalations" },
          ].map(stat => (
            <div key={stat.label}>
              <div className="font-serif text-4xl md:text-5xl text-stone-900 mb-2">{stat.value}</div>
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
