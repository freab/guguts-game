/**
 * The phone remote for the presentation (app/present ↔ app/present/remote,
 * through api/remote): what a phone can ask, and what the presentation tells
 * the phone about itself. Shared by the API, the presentation and the remote.
 */

/** What the phone can ask the presentation to do. */
export const REMOTE_ACTIONS = ["next", "prev", "xray", "bleat", "first", "hello"] as const;
export type RemoteAction = (typeof REMOTE_ACTIONS)[number];

/** The presentation, as the phone shows it. */
export interface RemoteState {
  slide: number;
  count: number;
  step: number;
  steps: number;
  title: string;
  notes: string[];
  /** The slide's X, if it has one: what it switches, and what the badge says now. */
  xray: { label: string; state: string } | null;
}

/** A room's code: 6 characters, no look-alikes (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function isRoomCode(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length === CODE_LENGTH && [...raw].every((c) => CODE_ALPHABET.includes(c));
}

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Typed on a phone: upper case, no spaces or dashes. */
export function cleanRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").slice(0, CODE_LENGTH);
}

/**
 * How often the presentation checks for the phone's taps (ms): slowly until a
 * phone has said hello, then fast — quick taps, and little database traffic
 * while no phone is paired.
 */
export const PRESENTER_POLL_IDLE_MS = 2000;
export const PRESENTER_POLL_LIVE_MS = 150;
/** How often the phone checks where the presentation is (ms). */
export const PHONE_POLL_MS = 1000;
