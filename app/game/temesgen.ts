"use client";

import { useSyncExternalStore } from "react";
import { audio } from "../audio/audioEngine";
import { restingSpot } from "../maze/mazeData";
import { runStore } from "./runStore";

/** Where his song comes from: the kirar on his knee (m). */
const SONG_HEIGHT = 0.6;

/**
 * Temesgen, playing his kirar by the maple (maze/Temesgen):
 * - `near`: Gugut is close by and looking at him — the "Talk" prompt shows
 *   (ui/TalkPrompt), and E / the Talk button start a conversation;
 * - `talking`: the conversation is open (ui/TemesgenDialog; the game is
 *   paused meanwhile);
 * - `song`: whether he's playing his song — asked for in the conversation,
 *   heard in 3D from where he sits (maze/Temesgen sets how loud, by distance);
 * - `seated`: Gugut has sat down in front of him to listen (character/Seat);
 *   moving gets him up, and so does the song ending or stopping.
 */
export interface TemesgenState {
  near: boolean;
  talking: boolean;
  song: "stopped" | "playing";
  seated: boolean;
}

let state: TemesgenState = { near: false, talking: false, song: "stopped", seated: false };
const listeners = new Set<() => void>();
const set = (next: Partial<TemesgenState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const temesgen = {
  get: () => state,
  setNear(near: boolean) {
    if (state.near !== near) set({ near });
  },
  /** Start talking to him (if he's in front of Gugut and the run is on). */
  talk(): boolean {
    const { phase } = runStore.get();
    if (!state.near || state.talking || (phase !== "armed" && phase !== "running") || runStore.isPaused()) return false;
    set({ talking: true });
    return true;
  },
  endTalk() {
    if (state.talking) set({ talking: false });
  },
  /** He plays his song, from the start, and Gugut sits down to listen. */
  playSong() {
    const spot = restingSpot();
    audio.playSong(spot.x, SONG_HEIGHT, spot.z, () => set({ song: "stopped", seated: false }));
    set({ song: "playing", seated: true });
  },
  /** He stops playing (Gugut gets up). */
  stopSong() {
    audio.stopSong();
    if (state.song !== "stopped" || state.seated) set({ song: "stopped", seated: false });
  },
  /** Gugut sits back down to listen (while the song plays). */
  sit() {
    if (state.song === "playing" && !state.seated) set({ seated: true });
  },
  /** Gugut gets up (the song plays on behind him). */
  standUp() {
    if (state.seated) set({ seated: false });
  },
  /** He's gone (the scene unmounted): no prompt, no conversation, no song. */
  reset() {
    audio.stopSong();
    set({ near: false, talking: false, song: "stopped", seated: false });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useTemesgen(): TemesgenState {
  return useSyncExternalStore(temesgen.subscribe, temesgen.get, temesgen.get);
}
