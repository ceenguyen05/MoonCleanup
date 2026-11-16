// Wall-clock `Date.now()` that refreshes on a slow interval while a component is mounted, so "5 min ago" stays honest
// without any per-frame work. The interval exists only while the component does (the prompt and Settings are rarely open).

import { useEffect, useState } from "react";

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
