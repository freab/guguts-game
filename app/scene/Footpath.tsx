"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import {
  abs,
  float,
  length,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  uniform,
  uv,
} from "three/tsl";
import { CELL, pathNetwork, type PathLink } from "../maze/mazeData";
import { lightmapFactor } from "./bake/lightmap";

/** Height above the ground plane (top at y = 0), clear of z-fighting. */
const PATH_Y = 0.015;
/** The ragged alpha edge lands at ~this fraction of each quad's half-width. */
const EDGE = 0.78;

/**
 * Worn-dirt material for the footpath quads. `radial` shapes a round joint
 * (fading from the centre); otherwise a straight link fading across its width.
 * World-space noise roughens the edge and mottles the colour, so the path
 * reads as trodden earth rather than a painted stripe. Opaque alpha-clip.
 */
function makeDirtMaterial(radial: boolean) {
  const edgeNoise = mx_noise_float(positionWorld.xz.mul(2.5));
  const mottle = mx_noise_float(positionWorld.xz.mul(0.9)).mul(0.5).add(0.5);
  const centred = uv().mul(2).sub(1);
  const edge = radial ? length(centred) : abs(centred.y);

  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = mix(
    uniform(new THREE.Color("#7b6647")),
    uniform(new THREE.Color("#5b4a33")),
    mottle
  ).mul(lightmapFactor); // baked wall shadows + AO
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
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const linkMaterial = useMemo(() => makeDirtMaterial(false), []);
  const jointMaterial = useMemo(() => makeDirtMaterial(true), []);
  useEffect(
    () => () => {
      geometry.dispose();
      linkMaterial.dispose();
      jointMaterial.dispose();
    },
    [geometry, linkMaterial, jointMaterial]
  );

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
