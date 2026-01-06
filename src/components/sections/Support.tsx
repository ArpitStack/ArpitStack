import { motion } from "framer-motion"
import { Coffee, Heart, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function Support() {
  return (
    <section id="support" className="py-24 relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
          >
            Support My <span className="text-gradient">Open Source</span> Journey
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-muted-foreground"
          >
            If you enjoy my work and want to support the development of developer-first tools, consider showing some love!
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Buy Me A Coffee */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <Card className="h-full border-white/5 bg-white/5 backdrop-blur-xl rounded-[2.5rem] overflow-hidden group hover:border-primary/20 transition-all duration-500">
              <CardContent className="p-10 flex flex-col h-full">
                <div className="p-4 bg-yellow-500/10 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform duration-500">
                  <Coffee className="h-8 w-8 text-yellow-500" />
                </div>
                <h3 className="text-2xl font-bold mb-4">Buy Me A Coffee</h3>
                <p className="text-muted-foreground leading-relaxed mb-8 flex-grow">
                  If you enjoy my work and want to show some love, buying me a coffee is a great way to support my open-source journey! Your support helps me continue building tools that benefit the community.
                </p>
                <Button className="w-full rounded-2xl group/btn" size="lg" asChild>
                  <a href="https://www.buymeacoffee.com/ArpitStack" target="_blank" rel="noopener noreferrer">
                    Buy Me A Coffee <ExternalLink className="ml-2 h-4 w-4 group-hover/btn:translate-x-1 transition-transform" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* GitHub Sponsors */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            <Card className="h-full border-white/5 bg-white/5 backdrop-blur-xl rounded-[2.5rem] overflow-hidden group hover:border-pink-500/20 transition-all duration-500">
              <CardContent className="p-10 flex flex-col h-full">
                <div className="p-4 bg-pink-500/10 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform duration-500">
                  <Heart className="h-8 w-8 text-pink-500" />
                </div>
                <h3 className="text-2xl font-bold mb-4">GitHub Sponsors</h3>
                <p className="text-muted-foreground leading-relaxed mb-8 flex-grow">
                  If you find my open-source projects helpful or just want to show your appreciation for my work, consider becoming a sponsor on GitHub. Your support helps keep these projects alive and evolving.
                </p>
                <Button variant="outline" className="w-full rounded-2xl border-white/10 hover:bg-pink-500/10 hover:text-pink-500 group/btn" size="lg" asChild>
                  <a href="https://github.com/sponsors/ArpitStack" target="_blank" rel="noopener noreferrer">
                    Sponsor on GitHub <ExternalLink className="ml-2 h-4 w-4 group-hover/btn:translate-x-1 transition-transform" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/5 rounded-full blur-[150px] -z-10" />
    </section>
  )
}
