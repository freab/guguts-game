"use client";

import { getProfile } from "../game/profile";

const KEY = "gugut.shareId";

/**
 * The link to share: the player's own page (/s/<share id> — their best
 * times, verified by the leaderboard, with a card when it's posted) once
 * they're on the board; otherwise the game itself. The share id is a hash
 * of the secret player id (api/share), remembered on the device.
 */
export async function shareLink(onBoard: boolean): Promise<string> {
  const origin = window.location.origin;
  if (!onBoard) return origin;
  const { id: playerId } = getProfile();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { playerId: string; id: string } | null;
    if (saved?.playerId === playerId) return `${origin}/s/${saved.id}`;
  } catch {
    // Storage blocked or garbled: ask the server again.
  }
  try {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const body = (await res.json()) as { id?: string };
    if (!res.ok || !body.id) return origin;
    try {
      localStorage.setItem(KEY, JSON.stringify({ playerId, id: body.id }));
    } catch {
      // Not remembered; fine.
    }
    return `${origin}/s/${body.id}`;
  } catch {
    return origin;
  }
}
