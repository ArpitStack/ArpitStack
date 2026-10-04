import { Layout } from "@/components/layout/Layout"
import { ThemeProvider } from "@/components/theme-provider"
import { About } from "@/components/sections/About"
import { Hero } from "@/components/sections/Hero"
import { Experience } from "@/components/sections/Experience"
import { Work } from "@/components/sections/Work"
import { Blog } from "@/components/sections/Blog"
import { Contact } from "@/components/sections/Contact"

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <Layout>
        <Hero />
        <Experience />
        <Work />
        <About />
        <Blog />
        <Contact />
      </Layout>
    </ThemeProvider>
  )
}
export default App
