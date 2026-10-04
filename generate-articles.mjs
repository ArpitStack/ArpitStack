// Generate static per-article pages at /blog/<slug>/ for SEO
// Each page has unique title, meta, OG tags, canonical, Article JSON-LD, full content
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BLOG_DIR = resolve(__dirname, 'src/content/blog')
const DIST_DIR = resolve(__dirname, 'dist')
const SITE_URL = 'https://arpitstack.com'

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10)
    }
    data[key] = value
  }
  return { data, content: match[2] }
}

// Configure marked for GFM tables
marked.setOptions({ gfm: true, breaks: false })

const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'))
console.log(`Generating ${files.length} article pages...`)

const articles = []

for (const file of files) {
  const slug = basename(file, '.md')
  const raw = readFileSync(resolve(BLOG_DIR, file), 'utf-8')
  const { data, content } = parseFrontmatter(raw)
  
  const htmlContent = marked.parse(content)
  const url = `${SITE_URL}/blog/${slug}/`
  const title = data.title || slug
  const description = data.description || title
  const datePublished = data.date || ''
  const tags = Array.isArray(data.tags) ? data.tags : []
  const readingTime = data.readingTime || Math.ceil(content.split(/\s+/).length / 200)

  articles.push({ slug, title, description, datePublished, tags, readingTime, url })

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: description,
    datePublished: datePublished,
    author: { '@type': 'Person', name: 'Arpit Gupta', url: SITE_URL },
    publisher: { '@type': 'Person', name: 'Arpit Gupta', url: SITE_URL },
    url: url,
    keywords: tags.join(', '),
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/#blog` },
      { '@type': 'ListItem', position: 3, name: title, item: url },
    ],
  }

  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | Arpit Gupta</title>
  <meta name="description" content="${description.replace(/"/g, '&quot;')}" />
  <meta name="author" content="Arpit Gupta" />
  <link rel="canonical" href="${url}" />
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />
  <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="ArpitStack" />
  <meta property="article:published_time" content="${datePublished}" />
  <meta property="article:author" content="Arpit Gupta" />
  ${tags.map(t => `<meta property="article:tag" content="${t}" />`).join('\n  ')}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}" />
  <meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}" />
  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #FAFAF9; color: #1C1917; line-height: 1.7; }
    .container { max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
    nav { border-bottom: 1px solid #e7e5e4; padding: 1rem 1.5rem; max-width: 720px; margin: 0 auto; }
    nav a { color: #1E3A5F; text-decoration: none; font-weight: 500; font-size: 0.95rem; }
    nav a:hover { text-decoration: underline; }
    .meta { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.15em; color: #78716c; margin: 2rem 0 1rem; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-size: 2.25rem; line-height: 1.2; color: #1c1917; margin-bottom: 1rem; }
    .tags { margin: 1rem 0 2rem; }
    .tags span { font-size: 0.75rem; color: #78716c; background: #f5f5f4; border-radius: 0.375rem; padding: 0.25rem 0.5rem; margin-right: 0.5rem; }
    article h2 { font-family: 'Fraunces', Georgia, serif; font-size: 1.5rem; color: #1c1917; margin: 2.5rem 0 1rem; }
    article h3 { font-size: 1.2rem; color: #1c1917; margin: 2rem 0 0.75rem; }
    article p { color: #44403c; margin-bottom: 1.25rem; }
    article ul, article ol { color: #44403c; margin: 0 0 1.25rem 1.5rem; }
    article li { margin-bottom: 0.5rem; }
    article strong { color: #1c1917; }
    article a { color: #1E3A5F; }
    article pre { background: #1c1917; border-radius: 0.5rem; padding: 1.25rem; overflow-x: auto; margin: 1.5rem 0; }
    article pre code { color: #e7e5e4; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; line-height: 1.7; background: transparent; }
    article code { font-family: 'JetBrains Mono', monospace; font-size: 0.875em; }
    article :not(pre) > code { background: #f5f5f4; padding: 0.125rem 0.375rem; border-radius: 0.375rem; }
    article table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
    article th { background: #f5f5f4; font-weight: 600; text-align: left; padding: 0.75rem 1rem; border: 1px solid #e7e5e4; }
    article td { padding: 0.75rem 1rem; border: 1px solid #e7e5e4; color: #57534e; }
    article tr:nth-child(even) td { background: #fafaf9; }
    article hr { border: none; border-top: 1px solid #e7e5e4; margin: 2rem 0; }
    .cta { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #e7e5e4; }
    .cta a { display: inline-block; background: #1E3A5F; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <nav><a href="${SITE_URL}/">&larr; Arpit Gupta</a></nav>
  <div class="container">
    <div class="meta">${readingTime} min read</div>
    <h1>${title}</h1>
    <div class="tags">${tags.map(t => `<span>${t}</span>`).join('')}</div>
    <article>${htmlContent}</article>
    <div class="cta">
      <a href="${SITE_URL}/#blog">More articles</a>
    </div>
  </div>
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-QDHHTLCM0K"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-QDHHTLCM0K');
  </script>
</body>
</html>`

  const dir = resolve(DIST_DIR, 'blog', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'index.html'), pageHtml)
}

// Generate RSS feed
const rssItems = articles.map(a => `    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${a.url}</link>
      <guid>${a.url}</guid>
      <pubDate>${new Date(a.datePublished).toUTCString()}</pubDate>
      <description><![CDATA[${a.description}]]></description>
      ${a.tags.map(t => `<category>${t}</category>`).join('\n      ')}
    </item>`).join('\n')

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ArpitStack Technical Blog</title>
    <link>${SITE_URL}/</link>
    <description>Deep-dive technical articles on distributed systems, AI infrastructure, Kubernetes, and backend engineering by Arpit Gupta.</description>
    <language>en</language>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>`

writeFileSync(resolve(DIST_DIR, 'rss.xml'), rss)
console.log('Generated rss.xml')

// Generate sitemap with all articles
const sitemapUrls = [
  `  <url><loc>${SITE_URL}/</loc><lastmod>2026-10-04</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  ...articles.map(a => `  <url><loc>${a.url}</loc><lastmod>${a.datePublished}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`)
]

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join('\n')}
</urlset>`

writeFileSync(resolve(DIST_DIR, 'sitemap.xml'), sitemap)
console.log(`Generated sitemap.xml with ${sitemapUrls.length} URLs`)

// Save article metadata for Blog.tsx share links
writeFileSync(resolve(__dirname, 'article-urls.json'), JSON.stringify(
  Object.fromEntries(articles.map(a => [a.slug, a.url])), null, 2
))

console.log(`Done: ${articles.length} article pages at /blog/<slug>/`)
