// jsdom has no matchMedia or IntersectionObserver, and the page must never reach the real network in tests.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
}
globalThis.fetch = (() => Promise.reject(new Error('network is not available in tests'))) as typeof fetch
