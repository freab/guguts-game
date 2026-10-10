"use client";

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three/webgpu";
import { WALL_HEIGHT } from "../maze/mazeData";
import { sceneLayers, useSceneLayers, type SceneLayer } from "./sceneLayers";

/**
 * How a part comes on (in app/present; in the game they're all just there):
 * - "rise": up out of the ground (the walls);
 * - "grow": stretching up from flat (grass, flowers, ivy);
 * - "sprout": growing from nothing where it stands, at the origin (the tree);
 * - "none": it just appears.
 */
export type Entrance = "rise" | "grow" | "sprout" | "none";

const SECONDS: Record<Entrance, number> = { rise: 2.2, grow: 2.4, sprout: 3, none: 0 };
/** Ease out with a small overshoot: a part arrives, goes a touch past, and settles. */
const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1) - 1;
  return 1 + 2.2 * x ** 3 + 1.2 * x ** 2;
};

/**
 * One part of the scene (scene/sceneLayers): drawn or not, animating in as
 * it comes on, and drawn as wireframe when asked (app/present's x-ray).
 */
export default function LayerGroup({ layer, entrance = "none", children }: { layer: SceneLayer; entrance?: Entrance; children: ReactNode }) {
  const show = useSceneLayers()[layer];
  const group = useRef<THREE.Group>(null);
  const wire = useRef(false);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const since = sceneLayers.shownAt(layer);
    const now = performance.now();
    // (Waiting for the camera to land: not yet.)
    g.visible = show && now >= since;
    const p = since && SECONDS[entrance] ? ease((now - since) / 1000 / SECONDS[entrance]) : 1;
    // (Never quite 0: a zero scale can't be inverted.)
    const s = Math.max(p, 0.001);
    // (The walls don't overshoot: rising past the ground would show a gap under them.)
    if (entrance === "rise") g.position.y = -(1 - Math.min(p, 1)) * (WALL_HEIGHT + 0.3);
    else if (entrance === "grow") g.scale.y = s;
    else if (entrance === "sprout") g.scale.setScalar(s);

    // Wireframe: every material in the part, switched (and recompiled) once.
    const want = sceneLayers.debug().wireframe === layer;
    if (want !== wire.current) {
      wire.current = want;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          (m as THREE.Material & { wireframe?: boolean }).wireframe = want;
          m.needsUpdate = true;
        }
      });
    }
  });

  return (
    <group ref={group} visible={show}>
      {children}
    </group>
  );
}
