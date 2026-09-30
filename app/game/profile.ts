"use client";

import { useSyncExternalStore } from "react";
import { cleanName } from "../leaderboard/shared";

/**
 * The player, as the leaderboard knows them: a random id made on this device
 * (kept in localStorage — it's what ties their times together) and a display
 * name they can change in Settings. Renaming updates the name on every board.
 */
export interface Profile {
  id: string;
  name: string;
}

const ID_KEY = "gugut.playerId";
const NAME_KEY = "gugut.playerName";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode etc.: kept for this visit only.
  }
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let profile: Profile | null = null;
const listeners = new Set<() => void>();
const EMPTY: Profile = { id: "", name: "" };

function current(): Profile {
  if (profile) return profile;
  let id = read(ID_KEY);
  if (!id) {
    id = newId();
    write(ID_KEY, id);
  }
  let name = cleanName(read(NAME_KEY));
  if (!name) {
    name = `Goatherd ${Math.floor(1000 + Math.random() * 9000)}`;
    write(NAME_KEY, name);
  }
  profile = { id, name };
  return profile;
}

export function getProfile(): Profile {
  return typeof window === "undefined" ? EMPTY : current();
}

/**
 * Change the display name: saved here at once, then on the leaderboard.
 * Resolves with an error message if the leaderboard couldn't be updated
 * (the new name is still used for the next run).
 */
export async function setPlayerName(raw: string): Promise<string | null> {
  const name = cleanName(raw);
  if (!name) return "Please enter a name.";
  const p = current();
  profile = { ...p, name };
  write(NAME_KEY, name);
  listeners.forEach((l) => l());
  try {
    const res = await fetch("/api/player", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: p.id, name }),
    });
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't update the leaderboard.";
    return null;
  } catch {
    return "Couldn't reach the leaderboard — your new name will be used next time.";
  }
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getProfile,
    () => EMPTY
  );
}
