import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/main.css';

import { registerSW } from 'virtual:pwa-register';
import { pdfOpsClient } from './core/pdf/worker-client.js';
import { pdfRenderClient } from './core/render/pdfjs-client.js';
import { FEATURE_PAGES, getFeatureBySlug } from './core/seo/features.js';
import { workspace } from './state/workspace.js';
import { renderHeroDropzone } from './ui/components/HeroDropzone.js';
import { renderOverlays } from './ui/components/Overlays.js';
import { renderPageGrid } from './ui/components/PageGrid.js';
import { renderTopNav } from './ui/components/TopNav.js';
import { renderToolInspector } from './ui/components/ToolInspector.js';
import { ingestFiles } from './ui/interactions/file-ingestion.js';
import { el, mount, sanitizeExternalUrl, svgEl } from './ui/utils/dom.js';

/**
 * Registers the Workbox service worker for full offline capability.
 */
function initOfflineServiceWorker() {
  try {
    registerSW({
      immediate: true,
      onOfflineReady() {
        workspace.showNotice(
          'info',
          'Offline Ready',
          'Poffy is cached locally and ready to work with Wi-Fi turned off.'
        );
      }
    });
  } catch {
    // Service Worker registration can be skipped in unsupported environments
  }
}

/**
 * Bootstraps the Poffy application shell, reactive subscriptions, and global error boundary.
 */
function bootstrap() {
  const root = document.getElementById('app');
  if (!root) return;

  const activeFeature = getFeatureBySlug(document.documentElement.dataset.feature);
  if (activeFeature) {
    workspace.setActiveTool(activeFeature.tool);
  }

  const navSlot = el('div', { id: 'nav-slot', className: 'sticky top-0 z-30' });
  const overlaysSlot = el('div', { id: 'overlays-slot' });
  const workspaceSlot = el('div', { id: 'workspace-slot', className: 'flex-1' });
  const fileInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'global-file-input',
      type: 'file',
      multiple: true,
      accept: 'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
      className: 'hidden'
    })
  );

  const shell = el(
    'div',
    { className: 'min-h-screen flex flex-col bg-[#fffaf0] text-[#0a0a0a]' },
    navSlot,
    overlaysSlot,
    workspaceSlot,
    el(
      'footer',
      { className: 'border-t border-[#e5e5e5] bg-[#faf5e8] mt-16' },
      el(
        'div',
        { className: 'max-w-[1360px] mx-auto px-4 sm:px-6 py-10 space-y-8' },
        el(
          'div',
          { className: 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-start' },
          el(
            'div',
            { className: 'lg:col-span-4 space-y-3' },
            el(
              'a',
              {
                href: '/',
                className: 'inline-flex items-center gap-2.5 no-underline text-[#0a0a0a]'
              },
              el('span', { className: 'type-title-md text-[#0a0a0a]' }, 'Poffy'),
              el('span', { className: 'badge-pill text-[12px]' }, 'Offline PDF Studio')
            ),
            el(
              'p',
              { className: 'type-body-sm max-w-[36ch]' },
              'Privacy-first PDF tools running 100% in browser memory via WebAssembly and Web Workers.'
            )
          ),
          el(
            'nav',
            { 'aria-label': 'All Offline PDF Tools', className: 'lg:col-span-8 space-y-3' },
            el('p', { className: 'type-caption-upper text-[#6a6a6a]' }, 'PDF Tools Directory'),
            el(
              'ul',
              { className: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2 list-none p-0 m-0' },
              el(
                'li',
                {},
                el(
                  'a',
                  {
                    href: '/',
                    className: `inline-flex items-center gap-2 py-1 text-[14px] no-underline transition-colors ${
                      !activeFeature
                        ? 'font-semibold text-[#0a0a0a]'
                        : 'text-[#3a3a3a] hover:text-[#0a0a0a] hover:underline'
                    }`
                  },
                  el('span', {
                    className: 'w-2 h-2 rounded-full bg-[#0a0a0a] shrink-0',
                    'aria-hidden': 'true'
                  }),
                  'Studio Home'
                )
              ),
              ...FEATURE_PAGES.map((f) => {
                const isCurrent = activeFeature?.slug === f.slug;
                return el(
                  'li',
                  {},
                  el(
                    'a',
                    {
                      href: f.path,
                      'aria-current': isCurrent ? 'page' : undefined,
                      className: `inline-flex items-center gap-2 py-1 text-[14px] no-underline transition-colors ${
                        isCurrent
                          ? 'font-semibold text-[#0a0a0a] underline underline-offset-4'
                          : 'text-[#3a3a3a] hover:text-[#0a0a0a] hover:underline underline-offset-4'
                      }`
                    },
                    el('span', {
                      className: 'w-2 h-2 rounded-full shrink-0 border border-black/10',
                      style: { backgroundColor: f.accent },
                      'aria-hidden': 'true'
                    }),
                    f.shortName
                  )
                );
              })
            )
          )
        ),
        el(
          'div',
          {
            className:
              'pt-6 border-t border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#6a6a6a]'
          },
          el(
            'div',
            { className: 'flex flex-wrap items-center gap-x-3 gap-y-1' },
            el('span', { className: 'font-medium text-[#0a0a0a]' }, 'Poffy — Offline PDF Studio'),
            el('span', { 'aria-hidden': 'true' }, '•'),
            el('span', {}, 'Created by Kholiq Fadhilah')
          ),
          el(
            'div',
            { className: 'flex flex-wrap items-center gap-x-4 gap-y-2' },
            el(
              'span',
              {},
              '100% Client-Side • Zero Telemetry • Built with pdf-lib, pdfjs-dist & fflate'
            ),
            el(
              'a',
              {
                href: sanitizeExternalUrl('https://github.com/fadhilahkholiq/poffy-web') || '#',
                target: '_blank',
                rel: 'noopener noreferrer',
                className:
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f5f0e0] border border-[#e5e5e5] text-[#0a0a0a] font-medium no-underline hover:bg-[#ebe6d6]'
              },
              svgEl(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'currentColor',
                  'aria-hidden': 'true'
                },
                svgEl('path', {
                  d: 'M12 0.5C5.37 0.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.14 3 .4c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.57 22.3 24 17.8 24 12.5 24 5.87 18.63 0.5 12 0.5z'
                })
              ),
              'GitHub'
            )
          )
        )
      )
    ),
    fileInput
  );

  mount(root, shell);

  const openFilePicker = () => {
    fileInput.click();
  };

  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.length) {
      await ingestFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Allow workers to resync sources automatically if hard-terminated via cancel
  const getSources = () => [...workspace.sourceFiles.values()];
  pdfOpsClient.setSourceProvider(getSources);
  pdfRenderClient.setSourceProvider(getSources);

  // Wire aggressive memory cleanup hooks between workspace store and workers
  workspace.onSourceEvict((sourceFileId) => {
    pdfRenderClient.evictSource(sourceFileId);
    pdfOpsClient.evictSource(sourceFileId);
  });
  workspace.onWorkspaceClear(() => {
    pdfRenderClient.clearAll();
    pdfOpsClient.clearAll();
  });

  /** @type {() => void} */
  let cleanupHero = () => {};
  /** @type {() => void} */
  let cleanupGrid = () => {};
  /** @type {boolean|null} */
  let lastHasPages = null;
  /** @type {HTMLElement|null} */
  let gridSlot = null;
  /** @type {HTMLElement|null} */
  let inspectorSlot = null;

  const renderWorkspaceLayout = () => {
    const hasPages = workspace.pages.length > 0;

    if (!hasPages) {
      cleanupGrid();
      cleanupGrid = () => {};
      cleanupHero();
      gridSlot = null;
      inspectorSlot = null;
      cleanupHero = renderHeroDropzone(workspaceSlot, openFilePicker, activeFeature);
      lastHasPages = false;
      return;
    }

    if (lastHasPages !== true) {
      cleanupHero();
      cleanupHero = () => {};
      gridSlot = el('section', {
        id: 'grid-slot',
        className: 'lg:col-span-8 min-w-0',
        'aria-label': 'Workspace pages'
      });
      inspectorSlot = el('section', {
        id: 'inspector-slot',
        className: 'lg:col-span-4 min-w-0',
        'aria-label': 'PDF tools inspector'
      });
      mount(
        workspaceSlot,
        el(
          'main',
          {
            className:
              'max-w-[1360px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start'
          },
          el('h1', { className: 'sr-only' }, 'Poffy — Offline PDF Studio Workspace'),
          gridSlot,
          inspectorSlot
        )
      );
      lastHasPages = true;
    }

    if (gridSlot) {
      cleanupGrid();
      cleanupGrid = renderPageGrid(gridSlot);
    }
    if (inspectorSlot) {
      renderToolInspector(inspectorSlot);
    }
  };

  // Initial render
  renderTopNav(navSlot, openFilePicker);
  renderOverlays(overlaysSlot);
  renderWorkspaceLayout();

  // Granular reactive updates
  workspace.subscribe((topic) => {
    if (topic === 'job' || topic === 'notice' || topic === 'preview') {
      renderOverlays(overlaysSlot);
      if (topic === 'job') renderTopNav(navSlot, openFilePicker);
      return;
    }

    if (topic === 'tool') {
      if (inspectorSlot) {
        renderToolInspector(inspectorSlot);
      }
      return;
    }

    if (topic === 'files' || topic === 'pages') {
      renderTopNav(navSlot, openFilePicker);
      renderOverlays(overlaysSlot);
      renderWorkspaceLayout();
      return;
    }

    renderTopNav(navSlot, openFilePicker);
    renderOverlays(overlaysSlot);
    renderWorkspaceLayout();
  });

  window.addEventListener('online', () => renderTopNav(navSlot, openFilePicker));
  window.addEventListener('offline', () => renderTopNav(navSlot, openFilePicker));

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    workspace.showNotice(
      'error',
      reason?.code === 'ENCRYPTED_PDF' ? 'Encrypted PDF' : 'Unexpected Error',
      reason?.message || 'An unhandled operation failed.'
    );
  });

  window.addEventListener('error', (event) => {
    if (event.message) {
      workspace.showNotice('error', 'Application Error', event.message);
    }
  });

  initOfflineServiceWorker();
}

bootstrap();
