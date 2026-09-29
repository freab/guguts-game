import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * True while the URL hash is `#<route>` (e.g. `/#debug`). Live: editing the
 * hash in the address bar toggles it without a reload. Always false on the
 * server.
 */
export function useHashRoute(route: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash === `#${route}`,
    () => false
  );
}
