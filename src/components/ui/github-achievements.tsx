import { motion } from "framer-motion"

const achievements = [
  {
    name: "Pair Extraordinaire",
    icon: "https://github.githubassets.com/images/modules/profile/achievements/pair-extraordinaire-default.png",
    description: "Co-authored 2+ pull requests"
  },
  {
    name: "YOLO",
    icon: "https://github.githubassets.com/images/modules/profile/achievements/yolo-default.png",
    description: "Merged a pull request without code review"
  },
  {
    name: "Quickdraw",
    icon: "https://github.githubassets.com/images/modules/profile/achievements/quickdraw-default.png",
    description: "Closed an issue within 5 minutes"
  },
  {
    name: "Pull Shark",
    icon: "https://github.githubassets.com/images/modules/profile/achievements/pull-shark-default.png",
    description: "Merged 2+ pull requests",
    count: 2
  }
]

export function GitHubAchievements() {
  return (
    <div className="flex flex-wrap gap-4 mt-8">
      {achievements.map((achievement, idx) => (
        <motion.div
          key={achievement.name}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 + idx * 0.1 }}
          className="group relative"
        >
          <div className="relative">
            <img 
              src={achievement.icon} 
              alt={achievement.name} 
              className="w-12 h-12 md:w-16 md:h-16 transition-transform group-hover:scale-110"
            />
            {achievement.count && (
              <span className="absolute -bottom-1 -right-1 bg-[#F7A072] text-[10px] font-bold px-1.5 py-0.5 rounded-full text-black border-2 border-background">
                x{achievement.count}
              </span>
            )}
          </div>
          
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-popover text-popover-foreground text-xs rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
            <p className="font-bold">{achievement.name}</p>
            <p className="text-[10px] text-muted-foreground">{achievement.description}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
