# Poffy — Offline PDF Studio

**Poffy** is a 100% client-side, privacy-first, offline-capable PDF studio built with modern JavaScript, WebAssembly, and Web Workers. Every document stays strictly inside your browser's memory—zero files, filenames, or telemetry are ever uploaded to an external server.

---

## Core Capabilities

Poffy provides a unified workspace alongside dedicated, SEO-ready pages for each tool:

| Tool | Route | Capabilities |
|---|---|---|
| **Merge PDF** | `/merge-pdf/` | Combine multiple PDFs sequentially or interleave pages 1-by-1; mix PDFs with images. |
| **Split PDF** | `/split-pdf/` | Split by custom ranges (`1-3, 5, 8-end`), extract selected pages, split every *N* pages, or burst into a `.zip`. |
| **Organize Pages** | `/organize-pdf/` | Drag-and-drop reordering, instant rotation (`90°`/`180°`/`270°`), duplicate, delete, blank page insertion (`A4`, `Letter`, `Legal`), and `MediaBox`/`CropBox` margin cropping. |
| **Watermark PDF** | `/watermark-pdf/` | Customizable text watermarks (center, corners, or diagonal tiled grid with automatic `@pdf-lib/fontkit` Unicode TTF fallback) and aspect-locked `PNG`/`JPG` image stamps. |
| **Page Numbers** | `/page-numbers/` | Dynamic `{n}` and `{total}` templates, custom start number, cover-page skip, header/footer placement, alignment, and margin offsets. |
| **Images to PDF** | `/images-to-pdf/` | Batch convert `JPG`, `PNG`, and `WebP` (decoded via `OffscreenCanvas`) into `A4`, `Letter`, or original-size PDF pages. |
| **PDF to Images** | `/pdf-to-images/` | Rasterize PDF pages to `PNG`, `JPEG`, or `WebP` (`1×`–`3×` scale) off the main thread; exports single image or `.zip`. |
| **Metadata Scrubber** | `/metadata-scrubber/` | Inspect and edit Info dictionary fields (`Title`, `Author`, `Subject`, `Keywords`, `Creator`, `Producer`) or strip all metadata and XMP streams in one click. |
| **Forms & Flatten** | `/flatten-pdf/` | Inspect AcroForm fields (`PDFTextField`, `PDFCheckBox`, `PDFDropdown`, `PDFRadioGroup`), edit values, and flatten forms into static page graphics. |
| **Optimize PDF** | `/optimize-pdf/` | Prune unreferenced/orphan objects, optionally strip metadata, and compress cross-reference/object streams (`useObjectStreams: true`). |

---

## Architecture & Performance

- **Virtual Page Graph:** Reordering, rotating, selecting, duplicating, and cropping mutate lightweight in-memory page descriptors and CSS transforms at 60fps. `pdf-lib` serialization runs only when exporting or splitting.
- **Dedicated Web Workers:**
  - `src/workers/pdf-ops.worker.js` executes `pdf-lib` compilation and `fflate` ZIP packaging off the main thread with zero-copy `ArrayBuffer` transfers.
  - `src/workers/render.worker.js` executes `pdfjs-dist` (`OffscreenCanvas`) thumbnail rendering, high-resolution previews, and image rasterization.
- **Lazy Thumbnail Grid:** Uses `IntersectionObserver` (`rootMargin: '300px'`) with a bounded LRU cache keyed by `${sourceFileId}:${sourcePageIndex}` and aggressive `URL.revokeObjectURL()` cleanup.
- **Full Offline Support:** `vite-plugin-pwa` generates a Workbox service worker precaching all HTML pages, JS/worker chunks, CSS, WebAssembly binaries, CMaps, and local Inter fonts (`public/fonts/Inter-Regular.ttf`).

---

## Security & Privacy Hardening

- **Zero External Runtime Calls:** No CDNs, external font hosts, or analytics. Passes strict `connect-src 'self'` CSP.
- **Strict CSP & HTTP Headers (`public/_headers` & `index.html`):** Enforces `script-src 'self' 'wasm-unsafe-eval'` (no `'unsafe-eval'`), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.
- **Safe DOM & PDF Sandboxing:** UI components build DOM nodes via `createElement` and `textContent` (zero `innerHTML` sinks). `pdfjs-dist` runs with `isEvalSupported: false`, bounded `OffscreenCanvas` dimensions, and bounded page-range / ZIP limits.
- **Responsive Cancellation:** Cooperative `ABORT_JOB` signaling backed by hard `worker.terminate()` fallback and clean worker respawn.
- **Zero Persistent Document Storage:** Uploaded files and metadata never touch `localStorage`, `sessionStorage`, `IndexedDB`, or cookies.

---

## Technology Stack

- **Language:** ES2022+ JavaScript with JSDoc type annotations
- **Build & Styling:** Vite `6.x`, Tailwind CSS `4.x`, `vite-plugin-pwa` (Workbox)
- **PDF & Archive Engines:** `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist`, `fflate`

---

## Getting Started

### Prerequisites
- Node.js `>= 20` and npm `>= 10`

### Installation & Local Development
```bash
npm install
npm run dev
```
*(Note: `npm install` automatically runs `postinstall` (`node scripts/sync-static-assets.mjs`) to sync `Inter-Regular.ttf` and `pdfjs-dist` WASM/CMap/standard-font assets into `public/`.)*

### Production Build & Preview
```bash
npm run build
npm run preview
```
The compiled static site is emitted to `dist/` and is ready to deploy with zero server-side runtime on **Cloudflare Pages** or **Vercel**.

### Regenerating Feature Landing Pages & Sitemap
If you update `src/core/seo/features.js`, regenerate the static feature HTML entry points and `public/sitemap.xml`:
```bash
npm run generate:pages
```

---

## Project Structure

```text
poffy/
├── index.html                    # Main studio shell & SEO metadata
├── vite.config.js                # Vite MPA, Worker & Workbox PWA config
├── package.json
├── public/
│   ├── _headers                  # Security, CSP & static cache headers
│   ├── robots.txt                # Crawler directives
│   ├── sitemap.xml               # Static sitemap for studio & feature routes
│   ├── fonts/                    # Local Inter-Regular.ttf fallback font
│   └── icons/                    # PWA SVG/PNG icons & Open Graph card
├── scripts/
│   ├── sync-static-assets.mjs    # Copies local TTF & pdfjs-dist assets on install
│   ├── generate-icons.mjs        # Generates local PNG icons & OG card
│   └── generate-feature-pages.mjs# Generates feature HTML routes & sitemap
├── <feature-slug>/index.html     # Dedicated static entry pages per PDF feature
└── src/
    ├── main.js                   # App bootstrap, feature routing & footer
    ├── styles/main.css           # Tailwind CSS & Clay design tokens
    ├── state/workspace.js        # Virtual Page Graph & memory monitor
    ├── core/
    │   ├── pdf/                  # Pure DOM-free pdf-lib operations
    │   ├── render/               # pdfjs-dist worker client & LRU cache
    │   ├── seo/                  # Feature catalog & SEO metadata
    │   └── utils/                # Error types, range parser, file I/O, ZIP
    ├── workers/
    │   ├── pdf-ops.worker.js     # Background pdf-lib & fflate worker
    │   └── render.worker.js      # Background pdfjs-dist OffscreenCanvas worker
    └── ui/
        ├── actions/              # Worker job runners & progress handlers
        ├── components/           # TopNav, HeroDropzone, PageGrid, ToolInspector, Overlays
        ├── interactions/         # Drag-and-drop ingestion & sortable grid
        └── utils/dom.js          # Safe DOM creation & URL sanitization helpers
```
