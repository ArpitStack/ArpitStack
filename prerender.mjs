// Prerender script: renders the React app to static HTML for SEO.
// Run after `vite build` via: node prerender.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  // Use Vite's SSR pipeline to load the server entry (handles TS, CSS, aliases)
  const vite = await createServer({
    root: __dirname,
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const { render } = await vite.ssrLoadModule('/src/entry-server.tsx')
    const appHtml = render()

    // Read the built client HTML and inject the prerendered content
    const distHtmlPath = resolve(__dirname, 'dist/index.html')
    let html = readFileSync(distHtmlPath, 'utf-8')

    // Replace the empty root div with prerendered content
    // The client bundle will hydrate on top of this.
    html = html.replace(
      /<div id="root"><\/div>/,
      `<div id="root">${appHtml}</div>`,
    )

    writeFileSync(distHtmlPath, html)

    // Inject Blog JSON-LD schema for all 50 articles (SEO + AI indexing)
    try {
      const blogSchema = readFileSync(resolve(__dirname, 'blog-schema.json'), 'utf-8')
      html = html.replace(
        '</head>',
        `  <script type="application/ld+json">\n${blogSchema}\n  </script>\n</head>`
      )
      writeFileSync(distHtmlPath, html)
      console.log('Injected Blog JSON-LD schema (50 articles)')
    } catch (e) {
      console.log('Blog schema injection skipped:', e.message)
    }

    console.log('Prerendered dist/index.html (' + appHtml.length + ' chars of content)')
  } finally {
    await vite.close()
  }
}

main().catch((e) => {
  console.error('Prerender failed:', e)
  process.exit(1)
})
