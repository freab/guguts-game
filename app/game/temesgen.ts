"use client";

import { useSyncExternalStore } from "react";
import { audio, SONG_ORDER, type SongTrack } from "../audio/audioEngine";
import { exitPosition, restingSpot } from "../maze/mazeData";
import { sun } from "../scene/sunUniforms";
import { runStore } from "./runStore";

/** Where his song comes from: the kirar on his knee (m). */
const SONG_HEIGHT = 0.6;
/** Seconds of sitting and listening before Gugut is calm enough to hear the goat. */
export const CALM_AFTER = 30;
/** The bars he plays as Gugut comes into the clearing: where in the main song (s), and how long. */
const PHRASE_FROM = 30;
const PHRASE_LENGTH = 7;

/**
 * Temesgen, playing his kirar by the maple (maze/Temesgen):
 * - `near`: Gugut is close by and looking at him — the "Talk" prompt shows
 *   (ui/TalkPrompt), and E / the Talk button start a conversation;
 * - `talking`: the conversation is open (ui/TemesgenDialog; the game is
 *   paused meanwhile);
 * - `song`: his song, asked for in the conversation ("playing"), or a few
 *   bars of it as Gugut comes into the clearing ("phrase") — heard in 3D
 *   from where he sits (maze/Temesgen sets how loud, by distance);
 * - `seated`: Gugut has sat down in front of him to listen (character/Seat);
 *   moving gets him up, and so does the song ending or stopping;
 * - `calm`: how calm sitting and listening has made him (0..1, over
 *   CALM_AFTER s; ui/SeatedHint shows it). At 1 (`calmed`, once a run) he
 *   hears the goat bleat on her own — her direction shows like a call's
 *   answer, without using one (runStore.hearGoat);
 * - `seen`: Gugut has caught sight of him (once a run, from a way off — his
 *   voiceover, game/Monologue).
 */
export interface TemesgenState {
  seen: boolean;
  near: boolean;
  talking: boolean;
  song: "stopped" | "playing" | "phrase";
  seated: boolean;
  calm: number;
  calmed: boolean;
}

const initial: TemesgenState = { seen: false, near: false, talking: false, song: "stopped", seated: false, calm: 0, calmed: false };
let state = initial;
/** Seconds listened so far, sitting (kept if he gets up and sits again). */
let listened = 0;
/** The song he last played this run (SONG_ORDER), null before he has played one. */
let lastSong: SongTrack | null = null;
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
  /** Gugut sees him for the first time. */
  see() {
    if (!state.seen) set({ seen: true });
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
  /** He plays a song (his main one unless told), and Gugut sits down to listen. */
  playSong(track: SongTrack = "main") {
    lastSong = track;
    const spot = restingSpot();
    audio.playSong(spot.x, SONG_HEIGHT, spot.z, () => set({ song: "stopped", seated: false }), track);
    set({ song: "playing", seated: true });
  },
  /** A few bars, as Gugut comes into the clearing (only while he isn't already playing). */
  playPhrase() {
    if (state.song !== "stopped") return;
    const spot = restingSpot();
    audio.playPhrase(spot.x, SONG_HEIGHT, spot.z, PHRASE_FROM, PHRASE_LENGTH, () => {
      if (state.song === "phrase") set({ song: "stopped" });
    });
    set({ song: "phrase" });
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
  /** Each frame: sitting and listening calms him, until he hears the goat. */
  listen(dt: number) {
    if (!state.seated || state.song !== "playing" || state.calmed || runStore.isPaused()) return;
    listened += dt;
    const calm = Math.min(1, listened / CALM_AFTER);
    if (calm >= 1) {
      set({ calm: 1, calmed: true });
      runStore.hearGoat();
    } else if (calm - state.calm >= 0.02) set({ calm });
  },
  /** Has he played Gugut a song this run? (Then, back with him, Gugut can ask for a different one.) */
  hasPlayed: () => lastSong !== null,
  /** The song he last played (null before any). */
  lastSong: () => lastSong,
  /** A different song: the next one in SONG_ORDER after the last, round again after the third. */
  playDifferentSong() {
    const next = SONG_ORDER[(SONG_ORDER.indexOf(lastSong ?? "main") + 1) % SONG_ORDER.length];
    this.playSong(next);
  },
  /** He's gone (the scene unmounted — a new run): no prompt, no conversation, no song, not calm. */
  reset() {
    audio.stopSong();
    listened = 0;
    lastSong = null;
    set(initial);
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

/**
 * Temesgen's hint, once Gugut has found water: which way from the tree the
 * goat went, told by the one landmark every corner of the maze shares — the
 * setting sun. Walking from the tree towards her: is the sun ahead, behind,
 * or on which hand?
 */
export function mazeHint(): string {
  const [gx, gz] = exitPosition();
  const len = Math.hypot(gx, gz) || 1;
  const ahead = { x: gx / len, z: gz / len };
  const s = sun.direction.value;
  const sunLen = Math.hypot(s.x, s.z) || 1;
  const toSun = { x: s.x / sunLen, z: s.z / sunLen };
  // Facing `ahead`, the right hand points to (-ahead.z, ahead.x).
  const front = toSun.x * ahead.x + toSun.z * ahead.z;
  const right = toSun.x * -ahead.z + toSun.z * ahead.x;
  const way =
    front > 0.7
      ? "towards the setting sun"
      : front < -0.7
        ? "away from the setting sun, where the night comes first"
        : right > 0
          ? "with the setting sun on your right hand"
          : "with the setting sun on your left hand";
  return `Water first, and now wisdom? Good. My eyes are old, but my ears are not. This morning I heard a goat bleating far off — ${way}, from this tree. Walk that way, and when the walls turn you back, keep the sun where it was.`;
}
