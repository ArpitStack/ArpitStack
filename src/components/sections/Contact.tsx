import { Button } from "@/components/ui/button"
import { Mail } from "lucide-react"

/**
 * Contact: simple centered call to action.
 */
export function Contact() {
  return (
    <section id="contact" className="py-24 md:py-32 border-t border-stone-200">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-6">
          Let's talk.
        </h2>
        <p className="text-lg text-stone-600 leading-relaxed mb-10">
          Open to high-impact technical leadership roles. I usually reply within a day.
        </p>

        <Button size="lg" className="rounded-lg bg-stone-900 text-white hover:bg-stone-800 px-8 mb-10" asChild>
          <a href="mailto:arpitstack@gmail.com">
            <Mail className="mr-2 h-4 w-4" />
            arpitstack@gmail.com
          </a>
        </Button>

        <div className="flex items-center justify-center gap-8 text-sm">
          <a
            href="https://www.linkedin.com/in/ArpitStack"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1E3A5F] hover:underline underline-offset-4"
          >
            LinkedIn
          </a>
          <a
            href="https://github.com/ArpitStack"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1E3A5F] hover:underline underline-offset-4"
          >
            GitHub
          </a>
          <a
            href="https://dev.to/ArpitStack"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#1E3A5F] hover:underline underline-offset-4"
          >
            Blog
          </a>
        </div>
      </div>
    </section>
  )
}
