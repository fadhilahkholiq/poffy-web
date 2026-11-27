import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_PAGES } from '../src/core/seo/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function escAttr(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildFeatureHtml(feature) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: feature.title.replace(/\s*\|\s*Poffy$/, ''),
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires modern browser with WebAssembly and Web Workers',
        description: feature.description,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD'
        },
        featureList: feature.highlights
      },
      {
        '@type': 'FAQPage',
        mainEntity: feature.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.a
          }
        }))
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en" data-feature="${escAttr(feature.slug)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self';"
    />
    <title>${escAttr(feature.title)}</title>
    <meta name="description" content="${escAttr(feature.description)}" />
    <meta name="keywords" content="${escAttr(feature.keywords)}" />
    <meta name="author" content="Poffy" />
    <meta name="application-name" content="Poffy" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Poffy" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:site_name" content="Poffy · Offline PDF Studio" />
    <meta property="og:title" content="${escAttr(feature.title)}" />
    <meta property="og:description" content="${escAttr(feature.description)}" />
    <meta property="og:image" content="/icons/og-card.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escAttr(feature.shortName)} · Poffy Offline PDF Studio" />

    <!-- Twitter / X Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escAttr(feature.title)}" />
    <meta name="twitter:description" content="${escAttr(feature.description)}" />
    <meta name="twitter:image" content="/icons/og-card.png" />
    <meta name="twitter:image:alt" content="${escAttr(feature.shortName)} · Poffy Offline PDF Studio" />

    <link rel="icon" type="image/svg+xml" href="/icons/icon-192.svg" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />

    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    <div id="app"></div>
    <noscript>
      <main style="max-width: 720px; margin: 48px auto; padding: 24px; font-family: system-ui, sans-serif;">
        <h1>${escAttr(feature.headline)}</h1>
        <p>${escAttr(feature.subheadline)}</p>
        <ul>
          ${feature.highlights.map((h) => `<li>${escAttr(h)}</li>`).join('\n          ')}
        </ul>
        <p>Enable JavaScript and WebAssembly to use ${escAttr(feature.shortName)} offline in Poffy.</p>
      </main>
    </noscript>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;
}

function buildSitemap() {
  const urls = [
    { loc: '/', priority: '1.0' },
    ...FEATURE_PAGES.map((f) => ({ loc: f.path, priority: '0.9' }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
}

for (const feature of FEATURE_PAGES) {
  const dir = path.join(rootDir, feature.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildFeatureHtml(feature));
}

fs.writeFileSync(path.join(rootDir, 'public/sitemap.xml'), buildSitemap());
console.log(`Generated ${FEATURE_PAGES.length} feature HTML entry pages and updated public/sitemap.xml.`);
