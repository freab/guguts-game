"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useDisposable } from "../hooks/useDisposable";
import { sunTranslucency } from "../scene/translucency";
import { CELL, WALL_THICKNESS_RATIO, cellAt, cellToWorld, exitPosition, treeSeed, worldToCell } from "./mazeData";

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A coffee leaf, 1 unit long: a pointed ellipse with its midrib raised a
 * little (a shallow V), base at the origin, tip along +Z, facing +Y.
 */
function leafGeometry(): THREE.BufferGeometry {
  const rows = [0, 0.15, 0.35, 0.55, 0.75, 0.92, 1];
  const half = [0.02, 0.17, 0.23, 0.22, 0.16, 0.07, 0];
  const pos: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const z = rows[i];
    const w = half[i];
    pos.push(-w, -w * 0.25, z, 0, 0.02, z, w, -w * 0.25, z); // left edge, midrib, right edge
  }
  const index: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = i * 3;
    const b = a + 3;
    index.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

interface BushParts {
  stems: THREE.BufferGeometry;
  leaves: THREE.Matrix4[];
  leafColors: THREE.Color[];
  cherries: THREE.Matrix4[];
  cherryColors: THREE.Color[];
}

/**
 * The bush itself, procedurally: a few woody stems from the base, each with
 * side branches; glossy leaves in opposite pairs along the branches, and
 * clusters of coffee cherries (mostly ripe red, a few still orange or green)
 * tight against the wood where the leaves join it.
 */
function growBush(seed: number): BushParts {
  const rng = mulberry32(seed);
  const range = (a: number, b: number) => a + rng() * (b - a);
  const stems: THREE.BufferGeometry[] = [];
  const leaves: THREE.Matrix4[] = [];
  const leafColors: THREE.Color[] = [];
  const cherries: THREE.Matrix4[] = [];
  const cherryColors: THREE.Color[] = [];
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);

  const twig = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const length = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(r1, r0, length, 5, 1, true);
    g.translate(0, length / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize()));
    g.translate(from.x, from.y, from.z);
    stems.push(g);
  };

  const stemCount = 6;
  for (let s = 0; s < stemCount; s++) {
    const az = (s / stemCount) * Math.PI * 2 + range(-0.3, 0.3);
    const lean = range(0.15, 0.4);
    const height = range(0.85, 1.25);
    const top = new THREE.Vector3(Math.cos(az) * lean * height, height, Math.sin(az) * lean * height);
    twig(new THREE.Vector3(0, 0, 0), top, 0.018, 0.008);

    // Side branches along the upper two-thirds, drooping a little, alternating sides.
    const branches = 4 + Math.floor(rng() * 3);
    for (let b = 0; b < branches; b++) {
      const t = 0.35 + (b / branches) * 0.6;
      const at = top.clone().multiplyScalar(t);
      const baz = az + (b % 2 === 0 ? 1 : -1) * range(0.9, 1.6);
      const len = range(0.22, 0.38) * (1.1 - t * 0.4);
      const end = at.clone().add(new THREE.Vector3(Math.cos(baz) * len, -len * range(0.05, 0.3), Math.sin(baz) * len));
      twig(at, end, 0.007, 0.003);

      // Leaf pairs at nodes along the branch.
      const dir = end.clone().sub(at).normalize();
      const across = new THREE.Vector3().crossVectors(dir, up).normalize();
      const nodes = 4 + Math.floor(rng() * 2);
      for (let n = 0; n < nodes; n++) {
        const k = (n + 0.6) / nodes;
        const node = at.clone().lerp(end, k);
        for (const side of [-1, 1]) {
          const leafDir = dir.clone().multiplyScalar(0.45).addScaledVector(across, side).normalize();
          leafDir.y -= range(0.1, 0.35); // they hang a little
          leafDir.normalize();
          const size = range(0.1, 0.15) * (1.1 - k * 0.35);
          dummy.position.copy(node);
          dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), leafDir);
          dummy.rotateZ(side * range(0.1, 0.5)); // roll: show the glossy top
          dummy.scale.setScalar(size);
          dummy.updateMatrix();
          leaves.push(dummy.matrix.clone());
          leafColors.push(new THREE.Color().setHSL(range(0.24, 0.29), range(0.45, 0.6), range(0.13, 0.2)));
        }
        // Cherries in the leaf axils on the older (inner) nodes.
        if (k < 0.75 && rng() < 0.55) {
          const cluster = 3 + Math.floor(rng() * 4);
          for (let c = 0; c < cluster; c++) {
            const a = (c / cluster) * Math.PI * 2 + range(-0.4, 0.4);
            const r = range(0.006, 0.009);
            dummy.position
              .copy(node)
              .addScaledVector(across, Math.cos(a) * 0.012)
              .add(new THREE.Vector3(0, Math.sin(a) * 0.01 - 0.006, 0))
              .addScaledVector(dir, range(-0.008, 0.008));
            dummy.rotation.set(range(0, Math.PI), range(0, Math.PI), 0);
            dummy.scale.set(r, r * 1.18, r); // slightly oval
            dummy.updateMatrix();
            cherries.push(dummy.matrix.clone());
            const ripe = rng();
            cherryColors.push(
              ripe < 0.72
                ? new THREE.Color().setHSL(range(0.98, 1.0), range(0.75, 0.85), range(0.25, 0.34)) // ripe red
                : ripe < 0.86
                  ? new THREE.Color().setHSL(range(0.04, 0.07), 0.8, 0.38) // turning orange
                  : new THREE.Color().setHSL(range(0.2, 0.24), 0.55, 0.3) // still green
            );
          }
        }
      }
    }
  }
  const merged = mergeGeometries(stems)!;
  stems.forEach((g) => g.dispose());
  return { stems: merged, leaves, leafColors, cherries, cherryColors };
}

/** Beyond this the bush isn't drawn at all (metres, camera to bush). */
const VISIBLE_DISTANCE = 18;

/** Where the bush stands: in the goat's tile, against one of its walls, off to one side. */
function bushPlace(): { x: number; z: number; rotation: number } {
  const [gx, gz] = exitPosition();
  const [r, c] = worldToCell(gx, gz);
  const sides: [number, number][] = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ];
  const [dr, dc] = sides.find(([dr, dc]) => cellAt(r + dr, c + dc) === "wall") ?? [1, 0];
  const inset = CELL / 2 - (CELL * WALL_THICKNESS_RATIO) / 2 - 0.32;
  // Along the wall, a little to the side of the goat.
  const [ax, az] = [dr !== 0 ? 0.38 : 0, dc !== 0 ? 0.38 : 0];
  const [cx, cz] = cellToWorld(r, c);
  return { x: cx + dc * inset + ax, z: cz + dr * inset + az, rotation: Math.atan2(dc, dr) };
}

/**
 * The coffee bush on the goat's tile — the "strange bush" of the story,
 * hung with red cherries. Procedural (no model), three draws, only drawn
 * near the exit (frustum-culled with the rest).
 */
export default function CoffeeBush() {
  const place = useMemo(() => bushPlace(), []);
  const bush = useDisposable(() => {
    const parts = growBush(treeSeed * 31 + 7);

    const stemMaterial = new THREE.MeshLambertNodeMaterial({ color: "#5b4632" });
    const stems = new THREE.Mesh(parts.stems, stemMaterial);

    // Glossy, waxy leaves that glow when the low sun is behind them.
    const leafMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.32, metalness: 0 });
    leafMaterial.emissiveNode = sunTranslucency(0.5).mul(0.35);
    const leafGeo = leafGeometry();
    const leaves = new THREE.InstancedMesh(leafGeo, leafMaterial, parts.leaves.length);
    parts.leaves.forEach((m, i) => {
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, parts.leafColors[i]);
    });

    const cherryMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0 });
    // A smooth low-poly sphere (36 triangles): a cherry is 1.5 cm across.
    const cherryGeo = new THREE.SphereGeometry(1, 6, 4);
    const cherries = new THREE.InstancedMesh(cherryGeo, cherryMaterial, parts.cherries.length);
    parts.cherries.forEach((m, i) => {
      cherries.setMatrixAt(i, m);
      cherries.setColorAt(i, parts.cherryColors[i]);
    });

    const group = new THREE.Group();
    group.name = "Coffee bush";
    for (const m of [stems, leaves, cherries]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    leaves.computeBoundingSphere();
    cherries.computeBoundingSphere();
    const centre = new THREE.Vector3(place.x, 0.6, place.z);
    return {
      group,
      /** Only drawn near the exit (it's a 1 m bush; further off it's lost in the fog). */
      cull(camera: THREE.Camera) {
        const near = camera.position.distanceTo(centre) < VISIBLE_DISTANCE;
        if (group.visible !== near) group.visible = near;
      },
      dispose() {
        parts.stems.dispose();
        leafGeo.dispose();
        cherryGeo.dispose();
        stemMaterial.dispose();
        leafMaterial.dispose();
        cherryMaterial.dispose();
        leaves.dispose();
        cherries.dispose();
      },
    };
  }, [place]);
  useFrame(({ camera }) => bush.cull(camera));

  return <primitive object={bush.group} position={[place.x, 0, place.z]} rotation={[0, place.rotation, 0]} />;
}
