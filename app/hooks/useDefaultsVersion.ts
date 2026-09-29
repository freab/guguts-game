"use client";

import { useEffect } from "react";

/**
 * leva keeps the *current* value of every control for the life of the page. Its
 * `store.addData()` re-applies an input's settings (min/max/label) but never its
 * value — `const { type, value, ...rest } = newInputData` in
 * node_modules/leva/src/store.ts drops it on purpose — and the panel is
 * collapsed by default. So editing a default in code and letting the dev server
 * hot-reload shows the *old* numbers: a fix to the light budget looks like it
 * did nothing (that is exactly what happened between 9c2918d and 2916504).
 *
 * Bump `DEFAULTS_VERSION` whenever a default in a leva schema changes: a page
 * that stored an older version reloads itself once — on mount, i.e. on the
 * title screen rather than mid-bake — so the new defaults really apply. A first
 * visit only records the version (nothing stale to correct); a returning visit
 * reloads once per bump.
 */
const DEFAULTS_VERSION = 9;
const KEY = "gugut.levaDefaultsVersion";

export function useDefaultsVersion() {
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored === null) {
      // First visit: there is no stale panel state to correct.
      window.localStorage.setItem(KEY, String(DEFAULTS_VERSION));
      return;
    }
    if (stored === String(DEFAULTS_VERSION)) return;
    window.localStorage.setItem(KEY, String(DEFAULTS_VERSION));
    window.location.reload();
  }, []);
}
