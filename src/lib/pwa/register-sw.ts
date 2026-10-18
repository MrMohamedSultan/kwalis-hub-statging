// Guarded service-worker registration wrapper. Registers /sw.js only in
// production browser contexts, never inside Lovable preview/iframes/dev.

const SW_PATH = "/sw.js";

function isLovablePreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

async function unregisterMatching(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith(SW_PATH) || url.endsWith("/service-worker.js");
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

/** Runtime caches this build owns. Anything else same-origin is stale. */
const CURRENT_CACHES = ["html-pages-v2", "static-assets-v2", "images-fonts-v2"];
const STALE_CACHE_PREFIXES = ["html-pages", "static-assets", "images-fonts"];

/** Deletes runtime caches left behind by earlier builds (old version suffixes). */
async function purgeStaleRuntimeCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(
          (n) => STALE_CACHE_PREFIXES.some((p) => n.startsWith(p)) && !CURRENT_CACHES.includes(n),
        )
        .map((n) => caches.delete(n)),
    );
  } catch {
    /* ignore */
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const url = new URL(window.location.href);
  const killSwitch = url.searchParams.get("sw") === "off";
  const host = window.location.hostname;

  const refuse = !import.meta.env.PROD || inIframe || isLovablePreviewHost(host) || killSwitch;

  if (refuse) {
    await unregisterMatching();
    await purgeStaleRuntimeCaches();
    return;
  }

  // Drop caches from previous builds before the new worker starts serving.
  await purgeStaleRuntimeCaches();

  // A brand-new worker taking control of an already-loaded page means the
  // document was rendered from the previous build: reload exactly once so the
  // user never sits on a stale shell (guarded against reload loops).
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    void purgeStaleRuntimeCaches().finally(() => window.location.reload());
  });

  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    // Ask the browser to check for a newer worker on every load, so a fixed
    // build reaches returning users without waiting for the 24h SW refresh.
    void reg.update();
  } catch {
    /* registration failure is non-fatal */
  }
}
