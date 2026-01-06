import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, MessageSquare, Send, Linkedin, Github } from "lucide-react"
import { motion } from "framer-motion"

export function Contact() {
  return (
    <section id="contact" className="py-24 relative overflow-hidden bg-white/40 backdrop-blur-3xl">
      <div className="container mx-auto px-4 max-w-6xl relative z-10">
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <div className="flex flex-col space-y-10">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                >
                    <h2 className="text-4xl md:text-8xl font-bold tracking-tighter mb-8 leading-[0.85] text-slate-900">
                        Let's Engineer <br />
                        <span className="text-gradient">The Future.</span>
                    </h2>
                    <p className="text-slate-500 text-xl font-medium max-w-md leading-relaxed">
                        Currently architecting open-source solutions and open to high-impact technical leadership roles across the globe.
                    </p>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 }}
                    className="space-y-8"
                >
                    <div className="flex items-center gap-6 group cursor-pointer" onClick={() => window.location.href = "mailto:arpitstack@gmail.com"}>
                        <div className="p-5 rounded-3xl bg-white border border-slate-100 shadow-lg group-hover:border-primary/50 group-hover:shadow-primary/5 transition-all duration-300">
                            <Mail className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Response Latency: &lt;24h</p>
                            <span className="text-xl font-bold text-slate-900 group-hover:text-primary transition-colors">arpitstack@gmail.com</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-6 group">
                        <div className="p-5 rounded-3xl bg-white border border-slate-100 shadow-lg transition-all duration-300">
                            <MessageSquare className="h-7 w-7 text-green-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Availability</p>
                            <span className="text-xl font-bold text-slate-900">Open to Strategic Roles</span>
                        </div>
                    </div>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                    className="flex gap-4 pt-6"
                >
                    <Button variant="outline" size="icon" className="rounded-2xl w-14 h-14 border-slate-200 bg-white shadow-sm hover:border-primary/50 hover:shadow-lg transition-all" asChild>
                        <a href="https://github.com/ArpitStack" target="_blank" rel="noreferrer"><Github className="w-6 h-6 text-slate-900" /></a>
                    </Button>
                    <Button variant="outline" size="icon" className="rounded-2xl w-14 h-14 border-slate-200 bg-white shadow-sm hover:border-primary/50 hover:shadow-lg transition-all" asChild>
                        <a href="https://linkedin.com/in/ArpitStack" target="_blank" rel="noreferrer"><Linkedin className="w-6 h-6 text-blue-600" /></a>
                    </Button>
                </motion.div>
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
            >
                <Card className="border-slate-100 shadow-2xl bg-white rounded-[3.5rem] p-6 lg:p-12 overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-primary/[0.03] rounded-full blur-[100px] -z-10" />
                    <CardHeader className="pb-10 px-0">
                        <CardTitle className="text-4xl font-bold tracking-tighter text-slate-900">Direct Transmission</CardTitle>
                        <CardDescription className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-2">Secure encrypted channel active</CardDescription>
                    </CardHeader>
                    <CardContent className="px-0">
                        <form action="https://formsubmit.co/arpitstack@gmail.com" method="POST" className="space-y-8">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-3">
                                    <Label htmlFor="name" className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400 ml-1">Identifier</Label>
                                    <Input id="name" name="name" placeholder="Full Name" required className="rounded-2xl bg-slate-50/50 border-slate-100 focus:border-primary/50 h-14 px-6 text-slate-900 font-bold" />
                                </div>
                                <div className="space-y-3">
                                    <Label htmlFor="email" className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400 ml-1">Endpoint</Label>
                                    <Input id="email" name="email" type="email" placeholder="email@example.com" required className="rounded-2xl bg-slate-50/50 border-slate-100 focus:border-primary/50 h-14 px-6 text-slate-900 font-bold" />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="message" className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400 ml-1">Payload Package</Label>
                                <Textarea id="message" name="message" placeholder="Describe the mission objective..." className="min-h-[160px] rounded-[2rem] bg-slate-50/50 border-slate-100 focus:border-primary/50 resize-none px-6 py-4 text-slate-900 font-bold" required />
                            </div>
                            <Button type="submit" size="lg" className="w-full rounded-[2rem] h-16 text-md font-black uppercase tracking-widest group bg-slate-900 hover:bg-primary transition-all shadow-2xl shadow-slate-900/10 hover:shadow-primary/20">
                                Dispatch Signal <Send className="ml-3 h-5 w-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </motion.div>
         </div>
      </div>

      {/* Background Decor - Extremely Subtle */}
      <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-primary/[0.02] rounded-full blur-[150px] -z-10" />
    </section>
  )
}
