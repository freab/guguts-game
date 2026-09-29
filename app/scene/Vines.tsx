"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls, folder, monitor } from "leva";
import { playerStore } from "../character/playerStore";
import { useDisposable } from "../hooks/useDisposable";
import { useLeafAtlas, usePbrSet } from "./textures/pbrTextures";
import { vineFaces } from "./vines/vineLayout";
import { VineField } from "./vines/VineField";
import { createVineMaterials } from "./vines/vineMaterials";

/** Written every frame, read by the leva monitor. */
const stats = { drawn: "" };

/**
 * Ivy climbing the maze walls: procedural vines (vines/vineLayout.ts) — woody
 * stems climbing every wall face, climbers spreading sideways off them, curling
 * tendrils — with instanced PBR ivy leaves along them, all in the grass's
 * colours. Streamed in chunks around the player and culled with the rest of
 * the vegetation (vines/VineField.ts).
 */
export default function Vines({
  viewDistance,
}: {
  /** The scene's view distance: no ivy is drawn beyond it. */
  viewDistance: number;
}) {
  const { show, coverage, leafDensity, leafSize, maxHeight, seed, brightness, wind, occlusion } = useControls(
    "Game",
    {
      Vines: folder(
        {
          show: { value: true, label: "Show ivy" },
          coverage: { value: 1, min: 0, max: 1, step: 0.05, label: "Faces with vines" },
          leafDensity: { value: 14, min: 2, max: 30, step: 1, label: "Leaves / m" },
          leafSize: { value: 1, min: 0.4, max: 2, step: 0.05, label: "Leaf size" },
          maxHeight: { value: 0.95, min: 0.2, max: 1, step: 0.05, label: "Max height" },
          brightness: { value: 1.1, min: 0.3, max: 2.5, step: 0.05, label: "Brightness" },
          wind: { value: 1, min: 0, max: 3, step: 0.1, label: "Flutter" },
          occlusion: { value: true, label: "Occlusion culling" },
          seed: { value: 1, min: 0, max: 9999, step: 1, label: "Seed" },
          Drawn: monitor(() => stats.drawn, { graph: false, interval: 300 }),
        },
        { collapsed: true }
      ),
    }
  );

  const bark = usePbrSet("bark");
  const ivy = useLeafAtlas("ivy_leaves");
  const materials = useDisposable(() => createVineMaterials(ivy, bark), [ivy, bark]);

  const faces = useMemo(() => vineFaces(coverage, seed), [coverage, seed]);
  const field = useDisposable(
    () => new VineField(faces, { leafDensity, leafSize, maxHeight }, materials),
    [faces, leafDensity, leafSize, maxHeight, materials]
  );

  useEffect(() => {
    materials.setLook({ brightness, wind });
  }, [materials, brightness, wind]);

  useFrame(({ camera }, delta) => {
    materials.advance(delta);
    const { x, z } = playerStore;
    field.update(camera, x, z, show ? viewDistance : -1, occlusion);
    stats.drawn = `${field.leavesDrawn} / ${field.leavesBuilt} leaves · ${field.chunksDrawn} drawn / ${field.chunksBuilt} built chunks`;
  });

  return show ? <primitive object={field.group} /> : null;
}
