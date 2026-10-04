import { motion } from "framer-motion"

export function Background() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden bg-background">
      {/* Mesh Gradients - Soft Aurora */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2 }}
        className="absolute top-[-20%] left-[-10%] w-[100%] h-[100%] rounded-full blur-[150px]"
        style={{
          background: "radial-gradient(circle at 20% 30%, rgba(99, 102, 241, 0.2) 0%, transparent 60%)"
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2, delay: 0.5 }}
        className="absolute bottom-[-20%] right-[-10%] w-[100%] h-[100%] rounded-full blur-[150px]"
        style={{
          background: "radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.15) 0%, transparent 60%)"
        }}
      />
      
      {/* Noise Texture - Extremely subtle for light mode */}
      <div 
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Grid Pattern - Very subtle slate grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a08_1px,transparent_1px),linear-gradient(to_bottom,#0f172a08_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]" />
    </div>
  )
}
