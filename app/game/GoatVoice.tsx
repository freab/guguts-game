"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { audio } from "../audio/audioEngine";
import { WallCollider } from "../character/WallCollider";
import { playerStore } from "../character/playerStore";
import { goat } from "./goat";
import { goatAnswer } from "./goatAnswer";
import { runStore } from "./runStore";

/** The goat's head height (m): where her bleat comes from. */
const BLEAT_HEIGHT = 0.8;
/** When there's no sound (muted, not loaded), how long until she "answers" on screen (s). */
const SILENT_ANSWER_DELAY = 1.2;
/** Hard: she runs this long (s) after her answer is heard, if he's at least FLEE_NEAREST m away. */
const FLEE_AFTER = 0.6;
const FLEE_NEAREST = 4;
/** Seeing her: within SIGHT_RANGE m, in view (SIGHT_CONE), checked every SIGHT_EVERY s. */
const SIGHT_RANGE = 16;
const SIGHT_CONE = 0.85;
const SIGHT_EVERY = 0.2;

const _forward = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * The sound of calling the goat, from inside the Canvas: keeps the audio
 * listener on the camera (so her answer turns as you turn), and on each call
 * (runStore.calledAt) plays Gugut's whistle and her bleat from where she
 * really is — muffled if a wall stands between, later and more distant the
 * farther she is — and posts her answer (game/goatAnswer) for the on-screen
 * direction arc and caption. A call with no voice left (runStore.dryAt) gets
 * a rasp. When Gugut, calmed by Temesgen's song, hears her on her own
 * (runStore.heardAt), her bleat plays the same way without the whistle.
 * It also notices when Gugut first catches sight of her (runStore.seeGoat —
 * his "found her!" voiceover, game/Monologue). On Hard, a moment after she
 * answers a call, she runs (game/goat.flee).
 */
export default function GoatVoice() {
  const camera = useThree((s) => s.camera);
  // The walls, for "is there a wall between us?" (a fresh maze remounts this).
  const walls = useMemo(() => new WallCollider(), []);

  // Catching sight of her: checked now and then (s since the last check).
  const sight = useRef(0);
  useFrame((_, dt) => {
    camera.getWorldDirection(_forward);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, _forward.x, _forward.y, _forward.z);

    // The first time she's in view — close enough, and no wall between.
    sight.current += dt;
    const run = runStore.get();
    if (run.sawAt || run.phase !== "running" || sight.current < SIGHT_EVERY) return;
    sight.current = 0;
    const [gx, gz] = goat.position();
    _dir.set(gx - camera.position.x, BLEAT_HEIGHT - camera.position.y, gz - camera.position.z);
    const distance = _dir.length();
    if (distance > SIGHT_RANGE) return;
    _dir.normalize();
    if (_dir.dot(_forward) > SIGHT_CONE && walls.raycast(camera.position, _dir, distance) >= distance - 0.3) runStore.seeGoat();
  });

  useEffect(() => {
    /** Her answer: `play` sounds it from where she is and says how long until it's heard. */
    const answer = (play: (x: number, y: number, z: number, distance: number, occluded: boolean) => number | null) => {
      const [gx, gz] = goat.position();
      camera.getWorldPosition(_origin);
      _dir.set(gx - _origin.x, BLEAT_HEIGHT - _origin.y, gz - _origin.z);
      const distance = _dir.length();
      _dir.normalize();
      const occluded = walls.raycast(_origin, _dir, distance) < distance - 0.3;
      const delay = play(gx, BLEAT_HEIGHT, gz, distance, occluded) ?? SILENT_ANSWER_DELAY;
      goatAnswer.post({ at: performance.now() + delay * 1000, x: gx, z: gz, distance, occluded });
      return { delay, distance };
    };
    // Hard: she runs a moment after answering — unless he's right there.
    let flight: ReturnType<typeof setTimeout> | undefined;
    let fled = false;
    const fleeAfter = (delay: number, distance: number) => {
      const run = runStore.get();
      if (run.level !== "hard" || distance < FLEE_NEAREST) return;
      clearTimeout(flight);
      flight = setTimeout(() => {
        if (runStore.get().phase !== "running") return;
        if (goat.flee(playerStore.x, playerStore.z) && !fled) {
          fled = true;
          runStore.notify("She heard you — and bolted deeper into the maze. Call less, follow more.");
        }
      }, (delay + FLEE_AFTER) * 1000);
    };
    let { calledAt, dryAt, heardAt } = runStore.get();
    const off = runStore.subscribe(() => {
      const run = runStore.get();
      if (run.calledAt !== calledAt) {
        calledAt = run.calledAt;
        if (calledAt === 0) {
          goatAnswer.post(null); // a new run
          return;
        }
        const { delay, distance } = answer((x, y, z, d, o) => audio.goatCall(x, y, z, d, o));
        fleeAfter(delay, distance);
      }
      if (run.heardAt !== heardAt) {
        heardAt = run.heardAt;
        if (heardAt !== 0) {
          // The song dips so she comes through it.
          audio.duckSong(4);
          answer((x, y, z, d, o) => audio.goatBleat(x, y, z, d, o));
        }
      }
      if (run.dryAt !== dryAt) {
        dryAt = run.dryAt;
        if (dryAt !== 0) audio.dryCall();
      }
    });
    return () => {
      off();
      clearTimeout(flight);
    };
  }, [camera, walls]);

  return null;
}
