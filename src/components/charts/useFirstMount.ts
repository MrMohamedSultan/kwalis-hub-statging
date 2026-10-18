// =====================================================================
// useFirstMount — charts animate on first render only. A chart that
// re-animates every poll/refetch is nauseating, so after the initial
// mount this returns false forever.
// =====================================================================
import { useEffect, useRef } from "react";

export function useFirstMount(): boolean {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return first.current;
}
