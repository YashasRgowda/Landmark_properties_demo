'use client';

import { useEffect, useState } from 'react';

/** Seconds since `from`, ticking — for the moments before Meera has answered. */
export function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return <span className="tabular-nums">{s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60} sec`}</span>;
}
