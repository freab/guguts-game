"use client";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  cos,
  float,
  length,
  mix,
  mod,
  positionLocal,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { useDisposable } from "../../hooks/useDisposable";
import { quality } from "../../quality";
import { sun } from "../sunUniforms";
import { WIND_DIRECTION, gustNode, tickWind, windTime } from "../wind";

/** The box of air kept around the camera (half-width, m) and the heights leaves fly at. */
const RADIUS = 10;
const MIN_Y = 0.3;
const MAX_Y = 3.6;
/** How fast they're carried (m/s, random in range) and how big they are (m). */
const SPEED: [number, number] = [2.2, 4.2];
const SIZE: [number, number] = [0.05, 0.09];
/** A leaf flies only in a gust stronger than its own threshold (in this range of the gust). */
const GUST_FROM = 0.62;
const GUST_TO = 0.9;

/**
 * Leaves blown past in the strong gusts (scene/wind) — and the wind clock's
 * tick, every frame, for every material that sways with it.
 *
 * Like the dust, a field of quads that always surrounds the camera (homes
 * wrapped round it, all motion in the vertex shader, one draw): carried
 * downwind, bobbing and tumbling. Each leaf has its own gust threshold, so a
 * gust brings a few and a strong one a flurry; it grows in from nothing as
 * the gust rises, and shrinks away as it drops. A cut-out leaf shape, green to
 * autumn gold, lit by the sun from behind.
 */
export default function GustLeaves() {
  const leaves = useDisposable(() => {
    const count = quality(16, 28, 40);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;

    const s = attribute<"vec4">("seed", "vec4");
    const span = RADIUS * 2;
    const speed = s.x.mul(SPEED[1] - SPEED[0]).add(SPEED[0]);
    const t = windTime.add(s.w.mul(100));
    // Carried downwind, with a sideways wander and a bob.
    const along = vec2(WIND_DIRECTION.x, WIND_DIRECTION.z).mul(windTime.mul(speed));
    const wander = vec2(sin(t.mul(0.9)), cos(t.mul(0.7))).mul(0.6);
    const home = vec3(
      s.x.mul(span).add(along.x).add(wander.x),
      s.z.mul(MAX_Y - MIN_Y).add(sin(t.mul(1.3)).mul(0.35)),
      s.y.mul(span).add(along.y).add(wander.y)
    );
    const world = vec3(
      mod(home.x.sub(cameraPosition.x).add(RADIUS), span).sub(RADIUS).add(cameraPosition.x),
      mod(home.y, MAX_Y - MIN_Y).add(MIN_Y),
      mod(home.z.sub(cameraPosition.z).add(RADIUS), span).sub(RADIUS).add(cameraPosition.z)
    );

    // In only when the gust here beats this leaf's threshold; never right in your eye or at the box edge.
    const threshold = s.w.mul(GUST_TO - GUST_FROM).add(GUST_FROM);
    const blown = smoothstep(threshold, threshold.add(0.06), gustNode(world.xz));
    const distance = length(world.sub(cameraPosition));
    const shown = blown.mul(smoothstep(0.6, 1.4, distance)).mul(smoothstep(RADIUS, RADIUS * 0.7, distance));

    // Tumbling: spin in the view plane, and flip (squash across) as it turns over.
    const spin = t.mul(s.y.mul(4).add(2));
    const flip = abs(cos(t.mul(s.z.mul(3).add(1.5)))).mul(0.85).add(0.15);
    const size = s.z.mul(SIZE[1] - SIZE[0]).add(SIZE[0]).mul(shown);
    const corner = vec2(positionLocal.x.mul(flip), positionLocal.y);
    const turned = vec2(
      corner.x.mul(cos(spin)).sub(corner.y.mul(sin(spin))),
      corner.x.mul(sin(spin)).add(corner.y.mul(cos(spin)))
    );
    const view = cameraViewMatrix.mul(vec4(world, 1));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.vertexNode = cameraProjectionMatrix.mul(view.add(vec4(turned.mul(size), 0, 0)));
    // A leaf: pointed at both ends, widest a little below the middle.
    const y = uv().y;
    const halfWidth = sin(y.mul(Math.PI)).pow(0.8).mul(0.42).mul(float(1).sub(y.mul(0.25)));
    material.opacityNode = smoothstep(halfWidth, halfWidth.sub(0.03), abs(uv().x.sub(0.5)));
    material.alphaTest = 0.5;
    // Green to autumn gold, lit warm by the low sun, a little darker at the midrib.
    const hue = mix(color("#6f8a2e"), color("#c98a2a"), s.y);
    const rib = smoothstep(0, 0.04, abs(uv().x.sub(0.5))).mul(0.25).add(0.75);
    material.colorNode = hue.mul(rib).mul(sun.color.mul(0.55).add(0.25));
    material.fog = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = "Gust leaves";
    return { mesh, dispose: () => (geometry.dispose(), quad.dispose(), material.dispose()) };
  }, []);

  useFrame(() => tickWind());

  return <primitive object={leaves.mesh} />;
}
