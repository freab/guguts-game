"use client";

import { useSyncExternalStore } from "react";

/**
 * The player's game preferences, kept on this device (Settings):
 * - `callKey`: the key that calls the goat (a KeyboardEvent.code), C by default;
 * - `captions`: sound captions on screen (which way the goat's bleat came
 *   from), for playing without sound — on by default;
 * - `voice`: Gugut's voiceovers (game/Monologue) — asked on the title
 *   screen, on by default;
 * - `graphics`: Low / Medium / High (app/quality) — asked with the voiceovers;
 *   null until chosen (then the device's default).
 */
export type Graphics = "low" | "medium" | "high";

export interface Preferences {
  callKey: string;
  captions: boolean;
  voice: boolean;
  graphics: Graphics | null;
}

const KEY = "gugut.preferences";
const DEFAULTS: Preferences = { callKey: "KeyC", captions: true, voice: true, graphics: null };

/** Keys the game already uses: these can't call the goat. */
export const RESERVED_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  "KeyM",
  "KeyP",
  "Escape",
  "Tab",
]);

let prefs: Preferences | null = null;
const listeners = new Set<() => void>();

function current(): Preferences {
  if (prefs) return prefs;
  prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Preferences> | null;
    if (saved && typeof saved.callKey === "string" && !RESERVED_KEYS.has(saved.callKey)) prefs.callKey = saved.callKey;
    if (saved && typeof saved.captions === "boolean") prefs.captions = saved.captions;
    if (saved && typeof saved.voice === "boolean") prefs.voice = saved.voice;
    if (saved && (saved.graphics === "low" || saved.graphics === "medium" || saved.graphics === "high")) {
      prefs.graphics = saved.graphics;
    }
  } catch {
    // Storage blocked or garbled: the defaults.
  }
  return prefs;
}

export function getPreferences(): Preferences {
  return typeof window === "undefined" ? DEFAULTS : current();
}

export function setPreferences(next: Partial<Preferences>) {
  prefs = { ...current(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPreferences,
    () => DEFAULTS
  );
}

/** A key code as a short label: "KeyC" → "C", "Digit1" → "1", "Space" → "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code.replace(/(Left|Right)$/, "");
}
