"use client";

import { useEffect } from "react";
import { audio, type VoiceLine } from "../audio/audioEngine";
import { playerStore } from "../character/playerStore";
import { runStore } from "./runStore";
import { temesgen } from "./temesgen";

/** How often the triggers are checked (ms). */
const TICK_MS = 250;
/** Walking the maze, he murmurs or hums to himself: first after this many seconds of the run, then every so often (s, random in range). */
const FIRST_WANDER = 40;
const WANDER_EVERY: [number, number] = [60, 120];
/** How often a wandering line is a hum rather than a murmur. */
const HUM_CHANCE = 0.3;
/** …but never this soon (s) after he last said anything. */
const QUIET_AFTER_LINE = 15;
/** Ground speed that counts as walking (m/s). */
const MOVING = 0.3;
/** After the last call, "I'm parched" waits for the goat's answer (s); a dry try waits for the rasp. */
const PARCHED_AFTER_CALL = 3.5;
const PARCHED_AFTER_RASP = 0.6;
/** …and isn't said again for this long (s). */
const PARCHED_AGAIN = 20;
/** A line that has to wait for another to end gives up after this long (s). */
const WAIT_AT_MOST = 8;

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/**
 * Gugut's voiceovers (audio.say), when the player chose them on the title
 * screen. Mounted while a run is on screen; each line has a few takes:
 * - a call: he shouts for her (audioEngine.goatCall, instead of the whistle);
 * - walking the maze: now and then he murmurs or hums to himself;
 * - his last call, or a call with no voice left: he's parched;
 * - catching sight of Temesgen, from a way off (temesgen.seen);
 * - catching sight of her (runStore.sawAt, game/GoatVoice): found her!
 * - reaching her: congratulations.
 * One line at a time: a line that comes up while he's speaking waits for it
 * to end (WAIT_AT_MOST), and the wandering lines give way to everything else.
 */
export default function Monologue() {
  useEffect(() => {
    // Lines waiting to be said: when (performance.now() ms), and until when they still make sense.
    const pending: { line: VoiceLine; at: number; until: number }[] = [];
    const queue = (line: VoiceLine, delay: number) => {
      const at = performance.now() + delay * 1000;
      pending.push({ line, at, until: at + WAIT_AT_MOST * 1000 });
    };
    let lastLineAt = -Infinity; // performance.now() when he last spoke
    let parchedAt = -Infinity;
    let played = 0; // seconds of the run (not paused)
    let nextWander = FIRST_WANDER;
    let congrats: ReturnType<typeof setTimeout> | undefined;

    let run = runStore.get();
    const offRun = runStore.subscribe(() => {
      const prev = run;
      run = runStore.get();
      const now = performance.now();
      // His last call: once she has answered, he feels his dry throat.
      if (run.calledAt !== prev.calledAt && run.calledAt !== 0 && run.calls === 0) {
        queue("parched", PARCHED_AFTER_CALL);
        parchedAt = now;
      }
      // Trying to call with no voice left.
      if (run.dryAt !== prev.dryAt && run.dryAt !== 0 && now - parchedAt > PARCHED_AGAIN * 1000) {
        queue("parched", PARCHED_AFTER_RASP);
        parchedAt = now;
      }
      // There she is (first sight): over anything else.
      if (run.sawAt !== 0 && prev.sawAt === 0) {
        pending.length = 0;
        if (audio.say("found", { interrupt: true })) lastLineAt = now;
      }
      // Reached her: congratulations (after "found her!" if she was reached unseen, round a corner).
      if (run.phase === "won" && prev.phase !== "won") {
        pending.length = 0;
        if (run.sawAt === 0) audio.say("found", { interrupt: true });
        else if (audio.speaking() !== "found") audio.hush();
        // Once "found her!" (if it's still going) has finished.
        const sayCongrats = () => {
          if (audio.isSpeaking()) congrats = setTimeout(sayCongrats, 200);
          else audio.say("congrats");
        };
        congrats = setTimeout(sayCongrats, 300);
      }
    });

    let seen = temesgen.get().seen;
    const offTemesgen = temesgen.subscribe(() => {
      if (temesgen.get().seen && !seen) queue("temesgen", 0);
      seen = temesgen.get().seen;
    });

    const tick = setInterval(() => {
      const now = performance.now();
      const { phase } = runStore.get();
      const live = phase === "running" && !runStore.isPaused();
      if (audio.isSpeaking()) lastLineAt = now;

      // Waiting lines, in order, once he's quiet (none while paused).
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (now > p.until) {
          pending.splice(i--, 1);
          continue;
        }
        if (now < p.at || !live || audio.isSpeaking()) continue;
        if (audio.say(p.line)) lastLineAt = now;
        pending.splice(i--, 1);
        break;
      }

      // Murmuring or humming to himself, walking the maze.
      if (!live) return;
      played += TICK_MS / 1000;
      const quiet = now - lastLineAt > QUIET_AFTER_LINE * 1000;
      const { seated, talking } = temesgen.get();
      if (played >= nextWander && quiet && pending.length === 0 && playerStore.speed > MOVING && !seated && !talking) {
        if (audio.say(Math.random() < HUM_CHANCE ? "hum" : "murmur")) lastLineAt = now;
        nextWander = played + rand(WANDER_EVERY);
      }
    }, TICK_MS);

    return () => {
      offRun();
      offTemesgen();
      clearInterval(tick);
      clearTimeout(congrats);
      audio.hush();
    };
  }, []);

  return null;
}
