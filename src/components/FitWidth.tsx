// Shrinks a wide block (the budget tables) to the width available, like a
// browser zoom-out, so the page needs no sideways scrolling (client 8/11).
// Scaling uses a transform (layout keeps the natural size), and the outer
// box takes the scaled height. If it would need less than `minScale` it is
// not shrunk at all and scrolls sideways, so text never becomes unreadable.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function FitWidth({
  enabled,
  minScale = 0.62,
  className = "",
  children,
}: {
  enabled: boolean;
  minScale?: number;
  className?: string;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number | null; rtl: boolean }>({
    scale: 1,
    height: null,
    rtl: false,
  });

  useLayoutEffect(() => {
    if (!enabled) {
      setBox({ scale: 1, height: null, rtl: false });
      return;
    }
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const available = o.clientWidth;
      const natural = i.scrollWidth; // transform does not change layout size
      if (!available || !natural) return;
      // too wide even at the smallest scale: keep the real size and scroll
      const fit = available / natural;
      const scale = natural > available && fit >= minScale ? fit : 1;
      const rtl = getComputedStyle(o).direction === "rtl";
      setBox((prev) => {
        const height = scale < 1 ? i.offsetHeight * scale : null;
        return prev.scale === scale && prev.height === height && prev.rtl === rtl
          ? prev
          : { scale, height, rtl };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [enabled, minScale]);

  const scaled = enabled && box.scale < 1;
  return (
    <div
      ref={outer}
      className={`${className} ${scaled ? "overflow-hidden" : "overflow-x-auto"}`}
      style={scaled && box.height != null ? { height: box.height } : undefined}
    >
      <div
        ref={inner}
        className="w-max min-w-full"
        style={
          scaled
            ? {
                transform: `scale(${box.scale})`,
                transformOrigin: box.rtl ? "top right" : "top left",
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
