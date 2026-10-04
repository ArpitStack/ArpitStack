import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowRight, BookOpen, Link2, Check } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  tags: string[]
  readingTime: number
  content: string
}

// Minimal frontmatter parser (avoids Node-only deps like gray-matter in the browser bundle)
function parseFrontmatter(raw: string): { data: Record<string, any>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }
  const data: Record<string, any> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value: any = line.slice(idx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // Simple array: ["a", "b"]
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    } else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10)
    }
    data[key] = value
  }
  return { data, content: match[2] }
}

// Load all markdown posts at build time
const postModules = import.meta.glob<string>("/src/content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

function loadPosts(): BlogPost[] {
  return Object.entries(postModules)
    .map(([path, raw]) => {
      const { data, content } = parseFrontmatter(raw)
      const slug = path.split("/").pop()?.replace(".md", "") ?? ""
      return {
        slug,
        title: data.title ?? slug,
        description: data.description ?? "",
        date: data.date ?? "",
        tags: data.tags ?? [],
        readingTime: data.readingTime ?? 5,
        content,
      } as BlogPost
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

/**
 * Blog — markdown posts from src/content/blog/, rendered on arpitstack.com.
 * Editorial styling only; loading and reader logic unchanged.
 */
export function Blog() {
  const [posts] = useState<BlogPost[]>(loadPosts)
  const [activePost, setActivePost] = useState<BlogPost | null>(null)
  const [copied, setCopied] = useState(false)

  // Deep linking: open post from URL hash like #blog/post-slug
  useEffect(() => {
    const openFromHash = () => {
      const hash = window.location.hash
      const match = hash.match(/^#blog\/([a-z0-9-]+)$/)
      if (match) {
        const post = loadPosts().find(p => p.slug === match[1])
        if (post) setActivePost(post)
      }
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  // Update URL hash when opening/closing a post (shareable link)
  const openPost = (post: BlogPost) => {
    setActivePost(post)
    setCopied(false)
    window.history.pushState(null, '', `#blog/${post.slug}`)
  }
  const closePost = () => {
    setActivePost(null)
    setCopied(false)
    window.history.pushState(null, '', window.location.pathname)
  }

  // Lock body scroll when a post is open
  useEffect(() => {
    document.body.style.overflow = activePost ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [activePost])

  return (
    <section id="blog" className="py-24 md:py-32 border-t border-stone-200">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-4xl mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
            Writing
          </h2>
          <p className="text-lg text-stone-600 max-w-2xl">
            Engineering deep-dives, architectural patterns, and notes from building systems in production.
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            New posts are on the way. Check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <article
                key={post.slug}
                onClick={() => openPost(post)}
                className="flex flex-col border border-stone-200 rounded-lg bg-white p-7 cursor-pointer hover:border-stone-400 transition-colors"
              >
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500 mb-4">
                  {post.readingTime} min read
                </div>
                <h3 className="font-serif text-xl leading-snug text-stone-900 mb-3">
                  {post.title}
                </h3>
                <p className="text-[15px] text-stone-600 leading-relaxed mb-5 flex-grow">
                  {post.description}
                </p>
                <div className="flex flex-wrap gap-2 mb-5">
                  {post.tags.slice(0, 3).map(tag => (
                    <span
                      key={tag}
                      className="text-xs text-stone-500 bg-stone-100 rounded-md px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-sm font-medium text-[#1E3A5F] inline-flex items-center">
                  Read article <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </span>
              </article>
            ))}
          </div>
        )}

        {/* Full-post reader dialog */}
        <Dialog open={!!activePost} onOpenChange={(open) => !open && closePost()}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto rounded-lg">
            {activePost && (
              <>
                <DialogHeader className="text-left pb-5 border-b border-stone-200">
                  <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500 mb-3">
                    {activePost.readingTime} min read
                  </div>
                  <DialogTitle className="font-serif text-3xl md:text-4xl leading-tight text-stone-900">
                    {activePost.title}
                  </DialogTitle>
                  <div className="flex gap-2 mt-4 flex-wrap items-center">
                    {activePost.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-xs text-stone-500 bg-stone-100 rounded-md px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => {
                        const url = `https://arpitstack.com/blog/${activePost.slug}/`
                        navigator.clipboard.writeText(url)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-[#1E3A5F] border border-stone-200 hover:border-[#1E3A5F] rounded-md px-3 py-1.5 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-green-600" />
                          <span className="text-green-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="w-4 h-4" />
                          <span>Copy link</span>
                        </>
                      )}
                    </button>
                  </div>
                </DialogHeader>
                <article className="prose prose-stone max-w-none pt-6
                  prose-headings:font-serif prose-headings:text-stone-900
                  prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
                  prose-p:text-stone-700 prose-p:leading-relaxed
                  prose-strong:text-stone-900
                  prose-ul:text-stone-700 prose-li:marker:text-stone-400
                  prose-code:text-stone-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                  prose-hr:border-stone-200 prose-a:text-[#1E3A5F]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activePost.content}</ReactMarkdown>
                </article>
              </>
            )}
          </DialogContent>
        </Dialog>

        <div className="mt-14 text-center">
          <Button variant="outline" className="rounded-lg border-stone-300" asChild>
            <a href="https://dev.to/ArpitStack" target="_blank" rel="noreferrer">
              More on dev.to <BookOpen className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}
