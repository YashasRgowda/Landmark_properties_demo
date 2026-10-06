'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads the page from the server every few seconds while it is on screen,
 * so a WhatsApp reply or a new call shows up without anyone pressing reload.
 */
export function LiveRefresh({ every = 5000, stopAfterMs = 30 * 60_000 }: { every?: number; stopAfterMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > stopAfterMs) return clearInterval(id);
      if (document.visibilityState === 'visible') router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [router, every, stopAfterMs]);
  return null;
}

/** A small "Live" badge, so people know the page updates by itself. */
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-600" />
      </span>
      Live
    </span>
  );
}
