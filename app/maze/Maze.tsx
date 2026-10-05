"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  dot,
  float,
  length,
  log2,
  max,
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
import { MOBILE } from "../quality";
import { useHeightMap, usePbrSet, type PbrSet } from "../scene/textures/pbrTextures";
import { CELL, WALL_HEIGHT, treeSeed, wallSlabs, type WallSlab } from "./mazeData";
import { WallBatch, type BatchPart } from "./WallBatch";
import { STONE_TILE, wallBulge } from "./wallRelief";
/**
 * The stone texture's mean luminance (linear, measured from the source) and
 * the brightness the walls are lifted to. The texture keeps its own colours —
 * weathered grey-beige blocks in soft lime mortar — gently warmed to the sunset.
 */
const STONE_MEAN_LUMINANCE = 0.1912;
const STONE_BRIGHTNESS = 0.4;
const STONE_WARMTH = new THREE.Color(1, 0.97, 0.9);
const MOSS = new THREE.Color("#4d5a2c");
/**
 * Relief from the stone's height map. Parallax: how deep the mortar joints
 * read (m), and the distances over which it fades out (none beyond, so far
 * walls cost nothing extra). (The bulge is in ./wallRelief, shared with the ivy.)
 */
const PARALLAX_DEPTH = 0.045;
const PARALLAX_NEAR = 4;
const PARALLAX_FAR = 9;
/**
 * Ray-march steps: PARALLAX_STEPS at grazing angles, where the offset is long;
 * as few as PARALLAX_MIN_STEPS looking straight at the wall (or as the effect
 * fades with distance), where it is a fraction of a texel and more steps
 * would land on the same answer.
 */
const PARALLAX_STEPS = 10;
const PARALLAX_MIN_STEPS = 4;
const HEIGHT_SIZE = 512;
/** Wall mesh segments along a long side (0.5 m apart on a 2 m slab) and up. */
const LONG_SEGMENTS = 4;
const HEIGHT_SEGMENTS = 4;
const DIRT = new THREE.Color("#3b3024");
/**
 * Worn edges (walls only): how far in from an exposed edge the wear reaches
 * (m, varied ±50% along the edge), and the band over which the edge reads as
 * rounded rather than knife-sharp (m).
 */
const EDGE_WEAR = 0.11;
const EDGE_ROUND = 0.06;

/**
 * Wall material: old weathered stone (Poly Haven old_stone_wall, KTX2),
 * projected in world space so the stones run on continuously from slab to
 * slab at their real size whatever each box is scaled to. Every wall face is
 * axis-aligned, so the normal map's tangent frame is known exactly (no
 * derivatives). Weathering is painted in from height and a low-frequency read
 * of the same texture: damp dirt and darkening at the base (with the old
 * analytic contact AO), moss in patches, lighter sun-bleached tops.
 * Lambert, like the rest of the matte scene — the stone relief comes from the
 * normal map under the low sun.
 *
 * Relief, from the stone's height map:
 * - parallax occlusion mapping — the texture lookup marches into the height
 *   map along the view ray, so stones stand out and mortar joints sink in,
 *   with real parallax as you move; strongest close up, gone by PARALLAX_FAR;
 * - `displace` (the walls, not the capstones): the mesh is pushed outward by
 *   a blurred read of the same map, so faces bulge, vertical corners wobble
 *   and dead-ends turn irregular. Edges that meet a neighbouring slab only
 *   move along the face they continue (the `joins` attribute), and every
 *   vertex reads the map at its world position, so slabs stay sealed.
 */
function createWallMaterial(stone: PbrSet, height: THREE.Texture, { displace }: { displace: boolean }) {
  const material = new THREE.MeshLambertNodeMaterial();
  const warmth = uniform(STONE_WARMTH);

  // Which world plane each face lies in (walls and caps are box faces), from
  // the box's own face normal: the walls are never rotated (only scaled) and
  // the capstones only tilted a few degrees, so it is the world axis.
  const n = normalGeometry;
  const onTop = abs(n.y).greaterThan(0.5);
  const facesX = abs(n.x).greaterThan(0.5);
  const p = positionWorld;
  // KTX2 isn't flipped on upload (v = 0 is the image top), so v = -height
  // keeps the image upright on the wall.
  const uv = select(
    onTop,
    vec2(p.x, p.z.negate()),
    select(facesX, vec2(p.z, p.y.negate()), vec2(p.x, p.y.negate()))
  ).div(STONE_TILE);
  // Tangent / bitangent of that projection: image right and image up.
  const tangent = select(onTop, vec3(1, 0, 0), select(facesX, vec3(0, 0, 1), vec3(1, 0, 0)));
  const bitangent = select(onTop, vec3(0, 0, 1), vec3(0, 1, 0));

  // Parallax occlusion mapping: walk the view ray into the height map (in
  // uv: u along the tangent, v grows opposite the bitangent) until it dips
  // below the surface, then interpolate between the last two steps. Skipped
  // entirely beyond PARALLAX_FAR. Texture reads in the loop use an explicit
  // mip from the uv derivatives (no implicit derivatives in loops).
  const toEye = cameraPosition.sub(positionWorld);
  const fade = smoothstep(PARALLAX_FAR, PARALLAX_NEAR, length(toEye));
  const view = toEye.normalize();
  const viewUv = vec3(dot(view, tangent), dot(view, bitangent).negate(), dot(view, n));
  const footprint = max(length(uv.dFdx()), length(uv.dFdy())).mul(HEIGHT_SIZE);
  // (Phones skip it: up to 10 extra texture reads on every wall pixel.)
  const surfaceUv = MOBILE ? uv : Fn(() => {
    // Derivatives before any branch (they need uniform control flow).
    const mip = log2(max(footprint, 1)).toVar();
    const depthAt = (at: THREE.Node<"vec2">) => float(1).sub(texture(height, at).level(mip).r);
    const result = uv.toVar();
    If(fade.greaterThan(0.001), () => {
      const grazing = float(1).sub(viewUv.z.abs()).clamp(0, 1);
      const steps = mix(PARALLAX_MIN_STEPS, PARALLAX_STEPS, grazing.mul(fade)).ceil().toVar();
      const stepUv = viewUv.xy.div(viewUv.z.max(0.25)).mul(fade.mul(PARALLAX_DEPTH / STONE_TILE)).div(steps);
      const at = uv.toVar();
      const previous = uv.toVar();
      const layer = float(0).toVar();
      const depth = depthAt(uv).toVar();
      const previousGap = float(0).toVar();
      Loop(PARALLAX_STEPS, ({ i }) => {
        // Stop once the ray is below the surface (or out of steps).
        If(layer.greaterThanEqual(depth).or(float(i).greaterThanEqual(steps)), () => {
          Break();
        });
        previous.assign(at);
        previousGap.assign(depth.sub(layer));
        at.subAssign(stepUv);
        layer.addAssign(float(1).div(steps));
        depth.assign(depthAt(at));
      });
      // Between the last point above the surface and the first below it.
      const gapAfter = depth.sub(layer);
      const w = gapAfter.div(gapAfter.sub(previousGap).min(-1e-4));
      result.assign(mix(at, previous, w.clamp(0, 1)));
    });
    return result;
  })();

  const albedo = texture(stone.map, surfaceUv).rgb;
  const arm = texture(stone.arm, surfaceUv);
  const mapped = texture(stone.normalMap, surfaceUv).xyz.mul(2).sub(1);
  let worldNormal = tangent.mul(mapped.x).add(bitangent.mul(mapped.y)).add(n.mul(mapped.z)).normalize();

  // The texture's own colours, lifted to the wall brightness and warmed.
  const detail = dot(albedo, vec3(0.2126, 0.7152, 0.0722)).div(STONE_MEAN_LUMINANCE);
  const stoneColor = albedo.mul(STONE_BRIGHTNESS / STONE_MEAN_LUMINANCE).mul(warmth);

  // Weathering. A slow, large-scale variation from the same texture read at a
  // low frequency (no noise maths).
  const patch = dot(texture(stone.map, uv.mul(0.137).add(0.31)).rgb, vec3(0.333)).div(0.183).clamp(0, 2); // (the texture's mean RGB)
  const y = p.y;
  const damp = smoothstep(0.75, 0, y).mul(mix(0.55, 1, patch.mul(0.5)));
  const mossy = smoothstep(1.05, 1.45, patch).mul(smoothstep(1.4, 0.2, y).add(smoothstep(1.7, 2.6, y))).clamp(0, 1);
  const bleached = smoothstep(WALL_HEIGHT - 0.5, WALL_HEIGHT + 0.1, y).mul(0.12);

  let color = mix(stoneColor, stoneColor.mul(uniform(DIRT)).mul(2.2), damp.mul(0.75));
  // A little moss low down and on top, in patches.
  color = mix(color, uniform(MOSS).mul(detail.mul(0.6).add(0.4)), mossy.mul(0.35));
  color = color.add(bleached);

  if (displace) {
    const joins = attribute<"vec4">("joins", "vec4"); // -x, +x, -z, +z
    const g = positionGeometry;

    // Worn edges: along every exposed convex edge — the vertical corners at
    // wall ends and turns, and the top edge under the capstones — the
    // proud stones are chipped and abraded (lighter, greyer) and the mortar
    // between them holds dark grime, in a band whose width wanders along the
    // edge; and the light rolls round the corner (the normal bends towards
    // the next face), so box edges read as rounded old stone. Edges where a
    // slab joins its neighbour aren't edges at all, so they get none.
    // Distances in metres from the unit box position and the slab's size
    // (linear across each face, so exact after interpolation).
    const box = attribute<"vec2">("wallBox", "vec2"); // width (x), depth (z)
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
    // Nearest exposed edge on this face, and the way round it.
    const sideEdge = select(facesX, zEdge, xEdge);
    const sideOut = select(facesX, zOut, xOut);
    const edgeDistance = select(onTop, min(xEdge, zEdge), min(sideEdge, toTop));
    const edgeOut = select(
      onTop,
      select(xEdge.lessThan(zEdge), xOut, zOut),
      select(toTop.lessThan(sideEdge), vec3(0, 1, 0), sideOut)
    );
    const reach = mix(0.5, 1.5, patch.mul(0.5).clamp(0, 1)).mul(EDGE_WEAR);
    const wear = smoothstep(reach, reach.mul(0.2), edgeDistance);
    const relief = texture(height, surfaceUv).r; // proud stone 1, deep mortar 0
    const chipped = wear.mul(smoothstep(0.4, 0.7, relief));
    const grime = wear.mul(smoothstep(0.45, 0.2, relief));
    const abraded = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), 0.35).mul(1.3);
    color = mix(color, abraded, chipped.mul(0.6));
    color = color.mul(float(1).sub(grime.mul(0.4)));
    worldNormal = worldNormal.add(edgeOut.mul(smoothstep(EDGE_ROUND, 0, edgeDistance).mul(0.9))).normalize();

    // Displacement: outward along the box face(s) a vertex lies on (both at
    // a corner), not towards a neighbouring slab it joins; never up or down.
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
    material.positionNode = w.add(dir.mul(wallBulge(height, w)));
  }

  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();
  // Contact darkening at the base (as before) and the texture's own AO.
  material.colorNode = color.mul(mix(0.55, 1, smoothstep(0, 0.9, y))).mul(arm.r);
  return material;
}

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
 * Capstones along the top of every wall: flat stones of varied size, height
 * and tilt, with the odd one missing — a crumbling, uneven skyline instead of
 * a ruler-straight edge. Seeded per maze. One matrix per stone.
 */
function capstones(walls: WallSlab[], seed: number): THREE.Matrix4[] {
  const rng = mulberry32(seed * 7919 + 17);
  const out: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  for (const slab of walls) {
    const alongX = slab.w >= slab.d;
    const length = alongX ? slab.w : slab.d;
    const thickness = alongX ? slab.d : slab.w;
    // Junction blocks (as wide as long) get several rows of stones.
    const rows = Math.max(1, Math.round(thickness / 0.64));
    for (let row = 0; row < rows; row++) {
      const across = (row + 0.5) / rows - 0.5;
      let at = -length / 2;
      while (at < length / 2 - 0.05) {
        const size = Math.min(0.45 + rng() * 0.4, length / 2 - at);
        const centre = at + size / 2;
        at += size;
        if (rng() < 0.12) continue; // a missing stone
        const height = 0.09 + rng() * 0.17;
        const depth = (thickness / rows) * (0.9 + rng() * 0.16);
        const ox = alongX ? centre : across * thickness;
        const oz = alongX ? across * thickness : centre;
        dummy.position.set(slab.x + ox + (rng() - 0.5) * 0.04, WALL_HEIGHT + height * 0.32, slab.z + oz + (rng() - 0.5) * 0.04);
        dummy.rotation.set((rng() - 0.5) * 0.12, (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.12);
        dummy.scale.set(alongX ? size * 0.97 : depth, height, alongX ? depth : size * 0.97);
        dummy.updateMatrix();
        out.push(dummy.matrix.clone());
      }
    }
  }
  return out;
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

// Renders the maze: the wall slabs (instanced, a part per shape) and the
// capstones on top, culled in chunks around the camera with one draw per part
// (WallBatch). Purely visual (no physics colliders).
export default function Maze({
  drawDistance,
}: {
  /** Nothing further from the camera than this is drawn (the far plane). */
  drawDistance: number;
}) {
  // Slim wall slabs (thin across the run, full along it) from the shared helper.
  const walls = useMemo(() => wallSlabs(), []);
  const caps = useMemo(() => capstones(walls, treeSeed), [walls]);

  const stone = usePbrSet("wall");
  const height = useHeightMap("wall");
  const wallMaterial = useDisposable(() => createWallMaterial(stone, height, { displace: true }), [stone, height]);
  const capMaterial = useDisposable(() => createWallMaterial(stone, height, { displace: false }), [stone, height]);
  const batch = useDisposable(() => {
    const capMatrices = new Float32Array(caps.length * 16);
    caps.forEach((m, i) => m.toArray(capMatrices, i * 16));
    const parts = [
      ...wallParts(walls, wallMaterial),
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: capMaterial, matrices: capMatrices },
    ];
    // Capstones stand ~0.3 m above the wall; a slab reaches half a cell
    // from its centre, and is seen from the open cell beyond.
    return new WallBatch(parts, WALL_HEIGHT + 0.3, CELL, "Walls");
  }, [walls, caps, wallMaterial, capMaterial]);

  useFrame(({ camera }) => batch.update(camera, drawDistance + CELL, true));

  return <primitive object={batch.group} />;
}
