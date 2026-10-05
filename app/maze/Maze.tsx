"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  cameraViewMatrix,
  dot,
  float,
  min,
  mix,
  normalGeometry,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  sign,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { useDisposable } from "../hooks/useDisposable";
import { useHeightMap, usePbrSet, type PbrSet } from "../scene/textures/pbrTextures";
import { CELL, WALL_HEIGHT, wallSlabs, type WallSlab } from "./mazeData";
import { WallBatch, type BatchPart } from "./WallBatch";
import { wallBulge } from "./wallRelief";
/** Metres of wall one repeat of the concrete texture covers (its real size). */
const CONCRETE_TILE = 1.8;
/**
 * The concrete texture's mean linear luminance (measured from the source) and
 * the brightness the walls are lifted to; most of its brown is taken out
 * (CONCRETE_GREY) for the cool grey of cast concrete, faintly warmed by the
 * sunset.
 */
const CONCRETE_MEAN_LUMINANCE = 0.1477;
const CONCRETE_BRIGHTNESS = 0.42;
const CONCRETE_GREY = 0.6;
const CONCRETE_WARMTH = new THREE.Color(1, 0.98, 0.94);
const MOSS = new THREE.Color("#4d5a2c");
const DIRT = new THREE.Color("#3b3024");
/** Wall mesh segments along a long side (0.5 m apart on a 2 m slab) and up. */
const LONG_SEGMENTS = 4;
const HEIGHT_SEGMENTS = 4;
/**
 * Chipped edges: how deep into the face the breaks bite at most (m), the
 * scales of the two noise layers that shape their outline (m per repeat), and
 * the width of the dark step line along each break (m).
 */
const CHIP_DEPTH = 0.15;
const CHIP_NOISE_LARGE = 0.7;
const CHIP_NOISE_SMALL = 0.21;
const CHIP_LIP = 0.012;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Wall material: board-formed concrete (Poly Haven wood_textured_concrete,
 * KTX2) — cast against planks, so it carries their grain, run horizontally
 * like real formwork — projected in world space so it runs on continuously
 * from slab to slab at its real size whatever each box is scaled to. Every
 * wall face is axis-aligned, so the normal map's tangent frame is known
 * exactly (no derivatives). Weathering is painted in from height and a
 * low-frequency read of the same texture: damp dirt and darkening at the
 * base, moss in patches, lighter sun-bleached tops. Lambert, like the rest
 * of the matte scene.
 *
 * Chipped edges, all in this shader (no decal meshes, no extra draws): along
 * every exposed convex edge — the vertical corners at wall ends and turns,
 * and the top edges — the concrete is broken away in a band whose outline is
 * jagged by two layers of noise (the old stone height map, read as broken-
 * chunk shapes), so some stretches are barely touched and others bitten deep.
 * Inside a break the concrete is fresh and rough: lighter, greyer, with its
 * own crumbly detail, and facing out round the corner (the normal tilts
 * towards the next face), with a dark step line along the break's edge —
 * which reads as chunks missing from a crisp cast slab. Edges where a slab
 * joins its neighbour aren't edges at all, so they get none.
 *
 * The slabs are also pushed out very slightly (wallRelief, shared with the
 * ivy) so the long faces aren't ruler-flat. Slab edges that meet a
 * neighbour only move along the face they continue (`joins`), and every
 * vertex reads the map at its world position, so slabs stay sealed.
 */
function createWallMaterial(concrete: PbrSet, noise: THREE.Texture) {
  const material = new THREE.MeshLambertNodeMaterial();
  const warmth = uniform(CONCRETE_WARMTH);

  // Which world plane each face lies in, from the box's own face normal (the
  // walls are never rotated, only scaled, so it is the world axis).
  const n = normalGeometry;
  const onTop = abs(n.y).greaterThan(0.5);
  const facesX = abs(n.x).greaterThan(0.5);
  const p = positionWorld;
  const along = select(facesX, p.z, p.x);
  const alongAxis = select(facesX, vec3(0, 0, 1), vec3(1, 0, 0));
  // The plank grain runs down the texture image; on the sides it is turned
  // to run along the wall (u up the wall, v along it). On top, as projected.
  // KTX2 isn't flipped on upload (v = 0 is the image top).
  const uv = select(onTop, vec2(p.x, p.z.negate()), vec2(p.y, along)).div(CONCRETE_TILE);
  // Tangent / bitangent of that projection: image right (+u) and image up (-v).
  const tangent = select(onTop, vec3(1, 0, 0), vec3(0, 1, 0));
  const bitangent = select(onTop, vec3(0, 0, 1), alongAxis.negate());

  const albedo = texture(concrete.map, uv).rgb;
  const arm = texture(concrete.arm, uv);
  const mapped = texture(concrete.normalMap, uv).xyz.mul(2).sub(1);
  let worldNormal = tangent.mul(mapped.x).add(bitangent.mul(mapped.y)).add(n.mul(mapped.z)).normalize();

  // The texture's grain and stains, mostly greyed, lifted to the wall
  // brightness and faintly warmed.
  const luma = dot(albedo, LUMA);
  const detail = luma.div(CONCRETE_MEAN_LUMINANCE);
  const concreteColor = mix(albedo, vec3(luma), CONCRETE_GREY)
    .mul(CONCRETE_BRIGHTNESS / CONCRETE_MEAN_LUMINANCE)
    .mul(warmth);

  // Weathering. A slow, large-scale variation from the same texture read at a
  // low frequency (no noise maths), ~1 on average.
  const patch = dot(texture(concrete.map, uv.mul(0.137).add(0.31)).rgb, LUMA).div(CONCRETE_MEAN_LUMINANCE).clamp(0, 2);
  const y = p.y;
  const damp = smoothstep(0.75, 0, y).mul(mix(0.55, 1, patch.mul(0.5)));
  const mossy = smoothstep(1.05, 1.45, patch).mul(smoothstep(1.4, 0.2, y).add(smoothstep(1.7, 2.6, y))).clamp(0, 1);
  const bleached = smoothstep(WALL_HEIGHT - 0.5, WALL_HEIGHT + 0.1, y).mul(0.1);

  let color = mix(concreteColor, concreteColor.mul(uniform(DIRT)).mul(2.2), damp.mul(0.75));
  // A little moss low down and up top, in patches.
  color = mix(color, uniform(MOSS).mul(detail.mul(0.6).add(0.4)), mossy.mul(0.3));
  color = color.add(bleached);

  // ---- Chipped edges ----
  // Distance (m) from this point to the nearest exposed edge of its face,
  // from the unit box position and the slab's size (linear across each face,
  // so exact after interpolation), and the way out round that edge.
  const joins = attribute<"vec4">("joins", "vec4"); // -x, +x, -z, +z
  const box = attribute<"vec2">("wallBox", "vec2"); // width (x), depth (z)
  const g = positionGeometry;
  const toX = vec2(g.x.add(0.5), float(0.5).sub(g.x)).mul(box.x); // to the -x / +x end
  const toZ = vec2(g.z.add(0.5), float(0.5).sub(g.z)).mul(box.y); // to the -z / +z side
  const toTop = float(0.5).sub(g.y).mul(WALL_HEIGHT);
  const FAR = 100;
  const xNeg = select(joins.x.greaterThan(0.5), float(FAR), toX.x);
  const xPos = select(joins.y.greaterThan(0.5), float(FAR), toX.y);
  const zNeg = select(joins.z.greaterThan(0.5), float(FAR), toZ.x);
  const zPos = select(joins.w.greaterThan(0.5), float(FAR), toZ.y);
  const xEdge = min(xNeg, xPos);
  const zEdge = min(zNeg, zPos);
  const xOut = vec3(select(xPos.lessThan(xNeg), float(1), float(-1)), 0, 0);
  const zOut = vec3(0, 0, select(zPos.lessThan(zNeg), float(1), float(-1)));
  const sideEdge = select(facesX, zEdge, xEdge);
  const sideOut = select(facesX, zOut, xOut);
  const edgeDistance = select(onTop, min(xEdge, zEdge), min(sideEdge, toTop));
  const edgeOut = select(
    onTop,
    select(xEdge.lessThan(zEdge), xOut, zOut),
    select(toTop.lessThan(sideEdge), vec3(0, 1, 0), sideOut)
  );

  // How deep the break reaches here: jagged by two noise layers (blobby
  // broken-chunk shapes), with long stretches more or less damaged.
  const faceUv = select(onTop, vec2(p.x, p.z), vec2(along, p.y));
  const chunks = texture(noise, faceUv.div(CHIP_NOISE_LARGE))
    .r.mul(0.65)
    .add(texture(noise, faceUv.div(CHIP_NOISE_SMALL).add(0.37)).r.mul(0.35));
  const reach = chunks.mul(2.2).sub(0.75).mul(mix(0.5, 1.4, patch.mul(0.5).clamp(0, 1))).mul(CHIP_DEPTH);
  // A crisp, antialiased break line (the outline is what sells it).
  const past = edgeDistance.sub(reach);
  const aa = past.fwidth().max(0.0015);
  const broken = smoothstep(aa, aa.negate(), past);
  // The step down into the break, in shadow: a dark line just inside it.
  const lip = smoothstep(CHIP_LIP, 0, past.negate()).mul(broken);

  // Fresh broken concrete: lighter, greyer, rough and crumbly (the concrete's
  // own detail at a finer scale), facing out round the corner.
  const crumbs = texture(concrete.map, faceUv.mul(2.9)).rgb;
  const freshLuma = dot(crumbs, LUMA).div(CONCRETE_MEAN_LUMINANCE).mul(0.5).add(0.5);
  const fresh = vec3(dot(concreteColor, LUMA)).mul(1.45).mul(freshLuma).mul(vec3(1, 0.99, 0.96));
  color = mix(color, fresh, broken);
  color = color.mul(float(1).sub(lip.mul(0.55)));
  const rough = texture(concrete.normalMap, faceUv.mul(3.3)).xyz.mul(2).sub(1);
  const brokenNormal = n
    .add(edgeOut.mul(0.85))
    .add(tangent.mul(rough.x.mul(1.6)))
    .add(bitangent.mul(rough.y.mul(1.6)))
    .normalize();
  worldNormal = mix(worldNormal, brokenNormal, broken).normalize();

  // ---- Slight bulge (see wallRelief) ----
  // Outward along the box face(s) a vertex lies on (both at a corner), not
  // towards a neighbouring slab it joins; never up or down.
  const sx = sign(g.x);
  const sz = sign(g.z);
  const joinedX = select(sx.greaterThan(0), joins.y, joins.x);
  const joinedZ = select(sz.greaterThan(0), joins.w, joins.z);
  const dir = vec3(
    step(0.499, abs(g.x)).mul(sx).mul(float(1).sub(joinedX)),
    0,
    step(0.499, abs(g.z)).mul(sz).mul(float(1).sub(joinedZ))
  );
  // positionLocal is world space here (instanced, the mesh at the origin).
  const w = positionLocal;
  material.positionNode = w.add(dir.mul(wallBulge(noise, w)));

  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();
  // Contact darkening at the base and the texture's own AO.
  material.colorNode = color.mul(mix(0.55, 1, smoothstep(0, 0.9, y))).mul(arm.r);
  return material;
}

/** A box's index without its bottom face (the walls stand on the ground: never seen). */
function withoutBottom(geometry: THREE.BufferGeometry) {
  // BoxGeometry's faces, in order: +x, -x, +y, -y, +z, -z.
  const bottom = geometry.groups[3];
  const index = Array.from(geometry.index!.array);
  index.splice(bottom.start, bottom.count);
  geometry.setIndex(index);
  geometry.clearGroups();
  return geometry;
}

/**
 * The wall slabs as instanced boxes scaled per slab, one part per shape so a
 * slab is only subdivided where it is long (a 2 m run gets LONG_SEGMENTS
 * along it, its 0.64 m ends none): ~90 triangles a slab, for the
 * displacement. Each slab also records which sides join a neighbouring wall.
 */
function wallParts(walls: WallSlab[], material: THREE.Material): BatchPart[] {
  const isWall = new Set(walls.map((s) => `${s.r},${s.c}`));
  const has = (r: number, c: number) => (isWall.has(`${r},${c}`) ? 1 : 0);
  const groups = new Map<string, WallSlab[]>();
  for (const slab of walls) {
    const key = `${slab.w >= 1 ? LONG_SEGMENTS : 1}x${slab.d >= 1 ? LONG_SEGMENTS : 1}`;
    const list = groups.get(key);
    if (list) list.push(slab);
    else groups.set(key, [slab]);
  }
  const m = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  return [...groups].map(([key, list]) => {
    const [sx, sz] = key.split("x").map(Number);
    const matrices = new Float32Array(list.length * 16);
    const joins = new Float32Array(list.length * 4);
    const boxes = new Float32Array(list.length * 2);
    list.forEach((slab, i) => {
      boxes.set([slab.w, slab.d], i * 2);
      m.compose(position.set(slab.x, WALL_HEIGHT / 2, slab.z), identity, scale.set(slab.w, WALL_HEIGHT, slab.d));
      m.toArray(matrices, i * 16);
      joins.set([has(slab.r, slab.c - 1), has(slab.r, slab.c + 1), has(slab.r - 1, slab.c), has(slab.r + 1, slab.c)], i * 4);
    });
    return {
      geometry: withoutBottom(new THREE.BoxGeometry(1, 1, 1, sx, HEIGHT_SEGMENTS, sz)),
      material,
      matrices,
      attributes: { joins: { itemSize: 4, values: joins }, wallBox: { itemSize: 2, values: boxes } },
    };
  });
}

// Renders the maze: the wall slabs (instanced, a part per shape), culled in
// chunks around the camera with one draw per part (WallBatch). Purely visual
// (no physics colliders).
export default function Maze({
  drawDistance,
}: {
  /** Nothing further from the camera than this is drawn (the far plane). */
  drawDistance: number;
}) {
  // Slim wall slabs (thin across the run, full along it) from the shared helper.
  const walls = useMemo(() => wallSlabs(), []);

  const concrete = usePbrSet("wall");
  // The old stone wall's height map: broken-chunk shapes for the chipped edges.
  const noise = useHeightMap("wall");
  const wallMaterial = useDisposable(() => createWallMaterial(concrete, noise), [concrete, noise]);
  // A slab reaches half a cell from its centre, and is seen from the open
  // cell beyond.
  const batch = useDisposable(
    () => new WallBatch(wallParts(walls, wallMaterial), WALL_HEIGHT, CELL, "Walls"),
    [walls, wallMaterial]
  );

  useFrame(({ camera }) => batch.update(camera, drawDistance + CELL, true));

  return <primitive object={batch.group} />;
}
