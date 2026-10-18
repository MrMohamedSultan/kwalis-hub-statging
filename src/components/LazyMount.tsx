import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders `children` only while the block is inside (or near) the viewport.
 *
 * Off-screen blocks collapse to a plain spacer of the last measured height,
 * so a 300-row budget grid keeps a few hundred DOM nodes alive instead of
 * tens of thousands. Layout never shifts because the spacer preserves the
 * exact height the content had when it was last on screen.
 */
export function LazyMount({
  children,
  estimatedHeight = 400,
  rootMargin = "900px 0px",
  className,
}: {
  children: ReactNode;
  estimatedHeight?: number;
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef(estimatedHeight);
  const [visible, setVisible] = useState(true);
  const [height, setHeight] = useState(estimatedHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting) {
          const h = el.getBoundingClientRect().height;
          if (h > 0) heightRef.current = h;
          setHeight(heightRef.current);
        }
        setVisible(entry.isIntersecting);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref} className={className} style={visible ? undefined : { height }}>
      {visible ? children : null}
    </div>
  );
}

/**
 * `true` once the browser has painted the page shell. Use it to defer heavy
 * grids so route navigation isn't blocked by a single huge render.
 */
export function useAfterPaint(delayFrames = 1) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    let left = delayFrames;
    const tick = () => {
      if (left-- <= 0) {
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delayFrames]);
  return ready;
}

export default LazyMount;
