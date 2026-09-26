"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { CELL, pathNetwork, type PathLink } from "../maze/mazeData";
import { createDirtMaterial } from "./materials";

/** Height above the ground plane (top at y = 0), clear of z-fighting. */
const PATH_Y = 0.015;
/** The ragged alpha edge lands at ~this fraction of each quad's half-width. */
const EDGE = 0.78;

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
  const linkMaterial = useMemo(() => createDirtMaterial(false), []);
  const jointMaterial = useMemo(() => createDirtMaterial(true), []);
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
      <instancedMesh
        ref={linksRef}
        args={[geometry, linkMaterial, network.links.length]}
        receiveShadow
      />
      <instancedMesh
        ref={jointsRef}
        args={[geometry, jointMaterial, network.joints.length]}
        receiveShadow
      />
    </group>
  );
}
