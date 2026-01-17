import { Layout } from "@/components/layout/Layout"
import { ThemeProvider } from "@/components/theme-provider"
import { About } from "@/components/sections/About"
import { Hero } from "@/components/sections/Hero"
import { Experience } from "@/components/sections/Experience"
import { Work } from "@/components/sections/Work"
import { Blog } from "@/components/sections/Blog"
import { Support } from "@/components/sections/Support"
import { Contact } from "@/components/sections/Contact"

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <Layout>
        <Hero />
        <Work />
        <About />
        <Experience />
        <Blog />
        <Support />
        <Contact />
      </Layout>
    </ThemeProvider>
  )
}
export default App
