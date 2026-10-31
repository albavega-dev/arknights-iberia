"use client";

import { useEffect } from "react";

function updateScopes(update: (scopes: Set<string>) => void): void {
  const root = document.documentElement;
  const scopes = new Set((root.dataset.hydrated ?? "").split(" ").filter(Boolean));
  update(scopes);
  if (scopes.size) root.dataset.hydrated = [...scopes].join(" ");
  else delete root.dataset.hydrated;
}

/**
 * Adds `scope` to the `data-hydrated` attribute of <html> once the part of the page that renders it has hydrated, so
 * end-to-end tests can wait until clicks and typing reach the event handlers. Suspense boundaries hydrate after the
 * rest of the page, so each one that holds interactive content renders its own marker.
 */
export function HydrationMarker({ scope }: { scope: string }) {
  useEffect(() => {
    updateScopes((scopes) => scopes.add(scope));
    return () => updateScopes((scopes) => scopes.delete(scope));
  }, [scope]);
  return null;
}
