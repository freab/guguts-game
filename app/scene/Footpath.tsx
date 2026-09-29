"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { abs, float, length, mix, mx_noise_float, positionWorld, smoothstep, uv } from "three/tsl";
import { CELL, pathNetwork, type PathLink } from "../maze/mazeData";
import { lightmapFactor } from "./bake/lightmap";
import { pbrSurface, usePbrSet, type PbrSet } from "./textures/pbrTextures";
import { useDisposable } from "../hooks/useDisposable";

/** Height above the ground plane (top at y = 0), clear of z-fighting. */
const PATH_Y = 0.015;
/** The ragged alpha edge lands at ~this fraction of each quad's half-width. */
const EDGE = 0.78;
/** Metres per dirt texture repeat. */
const DIRT_TILE = 2;

/**
 * Worn-dirt PBR material for the footpath quads (Poly Haven park_dirt, CC0;
 * KTX2), tiled in world space so links and joints join seamlessly. `radial`
 * shapes a round joint (fading from the centre); otherwise a straight link
 * fading across its width. World-space noise roughens the edge and mottles
 * the colour, so the path reads as trodden earth rather than a painted
 * stripe. Opaque alpha-clip.
 */
function makeDirtMaterial(set: PbrSet, radial: boolean) {
  const edgeNoise = mx_noise_float(positionWorld.xz.mul(2.5));
  const mottle = mx_noise_float(positionWorld.xz.mul(0.9)).mul(0.5).add(0.5);
  const centred = uv().mul(2).sub(1);
  const edge = radial ? length(centred) : abs(centred.y);
  const s = pbrSurface(set, positionWorld.xz.div(DIRT_TILE));

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = s.color.mul(mix(float(0.85), float(1.08), mottle)).mul(lightmapFactor); // + baked shadows / AO
  material.normalNode = s.normal;
  material.roughnessNode = s.roughness;
  material.aoNode = s.ao;
  material.opacityNode = float(1).sub(smoothstep(0.55, 1, edge.add(edgeNoise.mul(0.3))));
  material.alphaTest = 0.5;
  return material;
}

/** Write link + joint transforms into the two instanced meshes. */
function layoutPath(
  links: THREE.InstancedMesh,
  joints: THREE.InstancedMesh,
  network: { joints: [number, number][]; links: PathLink[] },
  halfWidth: number
) {
  const width = (2 * halfWidth) / EDGE;
  const dummy = new THREE.Object3D();

  // Links run CELL long between joint centres; quads are laid along x, then
  // turned 90° for links that run along z, so "across" is always uv.y.
  network.links.forEach((link, i) => {
    dummy.position.set(link.x, PATH_Y, link.z);
    dummy.rotation.set(0, link.vertical ? Math.PI / 2 : 0, 0);
    dummy.scale.set(CELL, 1, width);
    dummy.updateMatrix();
    links.setMatrixAt(i, dummy.matrix);
  });
  links.instanceMatrix.needsUpdate = true;
  links.computeBoundingSphere();

  // Round joints at every open cell centre cover corners, junctions and ends.
  dummy.rotation.set(0, 0, 0);
  network.joints.forEach(([x, z], i) => {
    dummy.position.set(x, PATH_Y, z);
    dummy.scale.set(width, 1, width);
    dummy.updateMatrix();
    joints.setMatrixAt(i, dummy.matrix);
  });
  joints.instanceMatrix.needsUpdate = true;
  joints.computeBoundingSphere();
}

/**
 * A dirt footpath down the middle of every corridor, following the maze's
 * walkway network. Two instanced draw calls total, whatever the maze size.
 */
export default function Footpath({
  halfWidth,
  visible,
}: {
  halfWidth: number;
  visible: boolean;
}) {
  const linksRef = useRef<THREE.InstancedMesh>(null);
  const jointsRef = useRef<THREE.InstancedMesh>(null);

  const network = useMemo(() => pathNetwork(), []);
  const geometry = useDisposable(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const dirt = usePbrSet("path");
  const linkMaterial = useDisposable(() => makeDirtMaterial(dirt, false), [dirt]);
  const jointMaterial = useDisposable(() => makeDirtMaterial(dirt, true), [dirt]);

  useLayoutEffect(() => {
    if (linksRef.current && jointsRef.current) {
      layoutPath(linksRef.current, jointsRef.current, network, halfWidth);
    }
  }, [network, halfWidth]);

  return (
    <group visible={visible}>
      {/* Shadows come from the baked lightmap, so no shadow-map sampling. */}
      <instancedMesh ref={linksRef} args={[geometry, linkMaterial, network.links.length]} />
      <instancedMesh ref={jointsRef} args={[geometry, jointMaterial, network.joints.length]} />
    </group>
  );
}
