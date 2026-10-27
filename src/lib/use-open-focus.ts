import { useEffect, useRef } from "react";

/**
 * Deep link `?open=<id>` (G11) for pages that list records inline: once the
 * row `#<prefix><id>` is rendered, scroll to it and highlight it briefly.
 * Runs once per id.
 */
export function useOpenRowFocus(openId: string | undefined, prefix: string, ready: boolean) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || !ready || done.current === openId) return;
    const el = document.getElementById(`${prefix}${openId}`);
    if (!el) return;
    done.current = openId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const cls = ["ring-2", "ring-brand/60", "bg-brand/15"];
    el.classList.add(...cls);
    const timer = setTimeout(() => el.classList.remove(...cls), 3500);
    return () => clearTimeout(timer);
  });
}
