import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_PAGES } from '../src/core/seo/features.js';
import {
  ABOUT_HIGHLIGHTS,
  DISCLAIMER_SECTIONS,
  HOW_IT_WORKS_STEPS,
  INFO_PAGES,
  PRIVACY_SECTIONS,
  TECH_STACK_ITEMS
} from '../src/core/seo/info-pages.js';

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

function buildInfoNoscriptBody(page) {
  if (page.slug === 'about') {
    return `
        <section>
          <h2>Core Pillars</h2>
          <ul>
            ${ABOUT_HIGHLIGHTS.map((h) => `<li><strong>${escAttr(h.title)}:</strong> ${escAttr(h.description)}</li>`).join('\n            ')}
          </ul>
        </section>
        <section>
          <h2>How Poffy Works</h2>
          <ol>
            ${HOW_IT_WORKS_STEPS.map((s) => `<li><strong>${escAttr(s.title)}:</strong> ${escAttr(s.detail)}</li>`).join('\n            ')}
          </ol>
        </section>
        <section>
          <h2>The Technology Behind Poffy</h2>
          <ul>
            ${TECH_STACK_ITEMS.map((t) => `<li><strong>${escAttr(t.name)} (${escAttr(t.role)}):</strong> ${escAttr(t.detail)}</li>`).join('\n            ')}
          </ul>
        </section>`;
  }

  const sections = page.slug === 'disclaimer' ? DISCLAIMER_SECTIONS : PRIVACY_SECTIONS;
  return sections
    .map(
      (sec) => `
        <section>
          <h2>${escAttr(sec.title)}</h2>
          ${sec.paragraphs.map((p) => `<p>${escAttr(p)}</p>`).join('\n          ')}
          ${
            sec.bullets?.length
              ? `<ul>${sec.bullets.map((b) => `<li>${escAttr(b)}</li>`).join('')}</ul>`
              : ''
          }
        </section>`
    )
    .join('\n');
}

function buildInfoHtml(page) {
  const graph = [
    {
      '@type': page.schemaType || 'WebPage',
      name: page.title.replace(/\s*\|\s*Poffy(?:\s+Offline PDF Studio)?$/, ''),
      url: page.path,
      description: page.description,
      inLanguage: 'en',
      isPartOf: {
        '@type': 'WebSite',
        name: 'Poffy — Offline PDF Studio',
        url: '/'
      }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Studio Home',
          item: '/'
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: page.navLabel,
          item: page.path
        }
      ]
    }
  ];

  if (page.slug === 'about') {
    graph.push({
      '@type': 'WebApplication',
      name: 'Poffy — Offline PDF Studio',
      url: '/',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires modern browser with WebAssembly and Web Workers',
      description: page.description,
      author: {
        '@type': 'Person',
        name: 'Kholiq Fadhilah'
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      },
      featureList: TECH_STACK_ITEMS.map((t) => `${t.name}: ${t.role}`)
    });
  }

  if (page.faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: page.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.a
        }
      }))
    });
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': graph
  };

  return `<!DOCTYPE html>
<html lang="en" data-page="${escAttr(page.slug)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self';"
    />
    <title>${escAttr(page.title)}</title>
    <meta name="description" content="${escAttr(page.description)}" />
    <meta name="keywords" content="${escAttr(page.keywords)}" />
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
    <meta property="og:title" content="${escAttr(page.title)}" />
    <meta property="og:description" content="${escAttr(page.description)}" />
    <meta property="og:image" content="/icons/og-card.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escAttr(page.headline)} · Poffy Offline PDF Studio" />

    <!-- Twitter / X Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escAttr(page.title)}" />
    <meta name="twitter:description" content="${escAttr(page.description)}" />
    <meta name="twitter:image" content="/icons/og-card.png" />
    <meta name="twitter:image:alt" content="${escAttr(page.headline)} · Poffy Offline PDF Studio" />

    <link rel="icon" type="image/svg+xml" href="/icons/icon-192.svg" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />

    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body>
    <div id="app"></div>
    <noscript>
      <main style="max-width: 720px; margin: 48px auto; padding: 24px; font-family: system-ui, sans-serif;">
        <h1>${escAttr(page.headline)}</h1>
        <p>${escAttr(page.subheadline)}</p>
        ${buildInfoNoscriptBody(page)}
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
    ...FEATURE_PAGES.map((f) => ({ loc: f.path, priority: '0.9' })),
    ...INFO_PAGES.map((p) => ({ loc: p.path, priority: '0.6' }))
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

for (const page of INFO_PAGES) {
  const dir = path.join(rootDir, page.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildInfoHtml(page));
}

fs.writeFileSync(path.join(rootDir, 'public/sitemap.xml'), buildSitemap());
console.log(
  `Generated ${FEATURE_PAGES.length} feature pages, ${INFO_PAGES.length} info pages, and updated public/sitemap.xml.`
);
