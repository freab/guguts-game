"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { audio } from "../audio/audioEngine";
import { WallCollider } from "../character/WallCollider";
import { exitPosition } from "../maze/mazeData";
import { goatAnswer } from "./goatAnswer";
import { runStore } from "./runStore";

/** The goat's head height (m): where her bleat comes from. */
const BLEAT_HEIGHT = 0.8;
/** When there's no sound (muted, not loaded), how long until she "answers" on screen (s). */
const SILENT_ANSWER_DELAY = 1.2;

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
 * a rasp.
 */
export default function GoatVoice() {
  const camera = useThree((s) => s.camera);
  // The walls, for "is there a wall between us?" (a fresh maze remounts this).
  const walls = useMemo(() => new WallCollider(), []);

  useFrame(() => {
    camera.getWorldDirection(_forward);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, _forward.x, _forward.y, _forward.z);
  });

  useEffect(() => {
    let { calledAt, dryAt } = runStore.get();
    return runStore.subscribe(() => {
      const run = runStore.get();
      if (run.calledAt !== calledAt) {
        calledAt = run.calledAt;
        if (calledAt === 0) {
          goatAnswer.post(null); // a new run
          return;
        }
        const [gx, gz] = exitPosition();
        camera.getWorldPosition(_origin);
        _dir.set(gx - _origin.x, BLEAT_HEIGHT - _origin.y, gz - _origin.z);
        const distance = _dir.length();
        _dir.normalize();
        const occluded = walls.raycast(_origin, _dir, distance) < distance - 0.3;
        const delay = audio.goatCall(gx, BLEAT_HEIGHT, gz, distance, occluded) ?? SILENT_ANSWER_DELAY;
        goatAnswer.post({ at: performance.now() + delay * 1000, x: gx, z: gz, distance, occluded });
      }
      if (run.dryAt !== dryAt) {
        dryAt = run.dryAt;
        if (dryAt !== 0) audio.dryCall();
      }
    });
  }, [camera, walls]);

  return null;
}
