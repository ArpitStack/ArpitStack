import { useState, useEffect } from "react"
import { Menu, X, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const DRIVE_RESUME_URL = "https://drive.google.com/file/d/1_U4OP4jsgYCidwF0sHUE5xRokxiu8Lxa/view?usp=sharing"

const navLinks = [
  { name: "Experience", href: "#experience" },
  { name: "Work", href: "#work" },
  { name: "Writing", href: "#blog" },
  { name: "About", href: "#about" },
  { name: "Contact", href: "#contact" },
]

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed top-0 w-full z-50 bg-[#FAFAF9]/95 backdrop-blur-sm transition-border",
        isScrolled && "border-b border-stone-200"
      )}
    >
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-[#1C1917] flex items-center justify-center font-serif font-bold text-sm text-[#FAFAF9]">
            AG
          </span>
          <span className="font-serif text-xl text-stone-900">
            ArpitStack
          </span>
        </a>

        {/* Desktop */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
            >
              {link.name}
            </a>
          ))}
          <Button variant="outline" size="sm" className="rounded-lg border-stone-300 ml-2" asChild>
            <a href={DRIVE_RESUME_URL} target="_blank" rel="noopener noreferrer">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Resume
            </a>
          </Button>
        </nav>

        {/* Mobile */}
        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {isOpen && (
        <nav className="md:hidden border-t border-stone-200 bg-[#FAFAF9] px-6 py-4">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-base font-medium text-stone-700 hover:text-stone-900 py-2.5 border-b border-stone-100 last:border-0"
              >
                {link.name}
              </a>
            ))}
            <a
              href={DRIVE_RESUME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium text-[#1E3A5F] py-2.5 inline-flex items-center"
            >
              <Download className="w-4 h-4 mr-2" />
              Resume
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}
