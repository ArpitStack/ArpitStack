import * as React from "react"
import {
  User,
  Layout,
  Briefcase,
  Terminal,
  Shield,
  Cloud,
  Github,
  Linkedin,
  Coffee,
  Mail,
  Search,
} from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const runCommand = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center border-b px-3 border-white/5">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <CommandInput placeholder="Type a command or search..." className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-none focus-visible:ring-0" />
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
        <CommandList className="max-h-[300px] overflow-y-auto overflow-x-hidden custom-scrollbar">
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#about")}>
              <User className="mr-2 h-4 w-4 text-primary" />
              <span>About ArpitStack</span>
              <CommandShortcut>G A</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#experience")}>
              <Briefcase className="mr-2 h-4 w-4 text-primary" />
              <span>Professional Impact</span>
              <CommandShortcut>G E</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#work")}>
              <Layout className="mr-2 h-4 w-4 text-primary" />
              <span>Core Innovations</span>
              <CommandShortcut>G W</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator className="bg-white/5" />
          <CommandGroup heading="The Stack (Tools)">
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#work")}>
              <Shield className="mr-2 h-4 w-4 text-red-500" />
              <span>SecretStack Scanner</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#work")}>
              <Cloud className="mr-2 h-4 w-4 text-blue-500" />
              <span>CloudStack CLI</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.scrollTo({ top: document.getElementById('work')?.offsetTop, behavior: 'smooth' }))}>
              <Terminal className="mr-2 h-4 w-4 text-green-500" />
              <span>Interactive Terminal</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator className="bg-white/5" />
          <CommandGroup heading="Connect">
            <CommandItem onSelect={() => runCommand(() => window.open("https://github.com/ArpitStack", "_blank"))}>
              <Github className="mr-2 h-4 w-4" />
              <span>GitHub Profile</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.open("https://linkedin.com/in/ArpitStack", "_blank"))}>
              <Linkedin className="mr-2 h-4 w-4 text-blue-600" />
              <span>LinkedIn</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.open("https://buymeacoffee.com/ArpitStack", "_blank"))}>
              <Coffee className="mr-2 h-4 w-4 text-yellow-500" />
              <span>Buy Me A Coffee</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => window.location.hash = "#contact")}>
              <Mail className="mr-2 h-4 w-4 text-primary" />
              <span>Get in Touch</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
