import { useEffect, useState } from "react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, BookOpen, Clock } from "lucide-react"
import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"

interface BlogPost {
  id: number
  title: string
  description: string
  url: string
  cover_image: string
  published_at: string
  tag_list: string[]
  reading_time_minutes: number
}

/**
 * Blog section component.
 * Dynamically fetches and displays the latest articles from Dev.to.
 */
export function Blog() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("https://dev.to/api/articles?username=arpitstack&per_page=3")
      .then(res => res.json())
      .then(data => {
        setPosts(data)
        setLoading(false)
      })
      .catch(err => {
        console.error("Failed to fetch blogs", err)
        setLoading(false)
      })
  }, [])

  return (
    <section id="blog" className="py-24 relative overflow-hidden bg-white/50">
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-7xl font-bold tracking-tighter mb-4 text-slate-900"
          >
            Latest <span className="text-gradient">Insights</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-slate-500 font-medium"
          >
            Engineering deep-dives, architectural patterns, and thoughts on the future of code.
          </motion.p>
        </div>

        {loading ? (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[1,2,3].map(i => (
                    <div key={i} className="h-[400px] rounded-[3rem] bg-slate-50 animate-pulse border border-slate-100 shadow-sm" />
                ))}
             </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {posts.map((post, index) => (
                    <motion.div
                        key={post.id}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: index * 0.1 }}
                    >
                        <Card className="flex flex-col h-full border-slate-100 bg-white shadow-xl rounded-[3rem] overflow-hidden group hover:shadow-2xl hover:border-primary/20 transition-all duration-500">
                            {post.cover_image && (
                                <div className="h-52 overflow-hidden relative">
                                    <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />
                                    <div className="absolute bottom-4 left-6 flex gap-2">
                                        {post.tag_list.slice(0, 2).map(tag => (
                                            <Badge key={tag} className="bg-white/20 backdrop-blur-md border border-white/20 text-[10px] font-black uppercase tracking-widest px-2.5 py-1">
                                                {tag}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <CardHeader className="p-8 pb-4">
                                <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6 font-mono">
                                    <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> {post.reading_time_minutes} MINS</span>
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                    <span>{new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                                <CardTitle className="text-2xl font-bold leading-tight text-slate-900 group-hover:text-primary transition-colors line-clamp-2">
                                    <a href={post.url} target="_blank" rel="noreferrer" className="hover:underline decoration-primary/20 decoration-2 underline-offset-4">{post.title}</a>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-8 flex-grow">
                                <p className="text-slate-500 text-sm line-clamp-3 leading-relaxed font-bold opacity-80">
                                    {post.description}
                                </p>
                            </CardContent>
                            <CardFooter className="p-8 pt-0 mt-6 pt-6 border-t border-slate-50">
                                <Button variant="link" className="p-0 h-auto text-[10px] font-black text-slate-900 group-hover:text-primary transition-colors tracking-[0.2em] uppercase" asChild>
                                    <a href={post.url} target="_blank" rel="noreferrer">
                                        READ FULL ARTICLE <ArrowUpRight className="h-4 w-4 ml-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                    </a>
                                </Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                ))}
            </div>
        )}
         <div className="mt-20 text-center">
            <Button variant="outline" size="lg" className="rounded-full px-12 h-14 font-black border-slate-200 bg-white hover:border-primary/20 hover:bg-primary/5 group shadow-xl hover:shadow-primary/10 transition-all uppercase tracking-widest text-[10px]" asChild>
                <a href="https://dev.to/arpitstack" target="_blank" rel="noreferrer">
                    EXPLORE ALL INSIGHTS <BookOpen className="ml-3 h-4 w-4 group-hover:scale-110 transition-transform text-primary" />
                </a>
            </Button>
         </div>
      </div>

      {/* Background Decor - Extremely Soft */}
      <div className="absolute top-[30%] left-[-10%] w-[400px] h-[400px] bg-primary/[0.03] rounded-full blur-[100px] -z-10" />
    </section>
  )
}

