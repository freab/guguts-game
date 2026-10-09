"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import { cameraPosition, float, length, modelWorldMatrix, positionLocal, smoothstep, texture, uv, vec3, vec4 } from "three/tsl";
import { ethiopicFont } from "../fonts";
import { useDisposable } from "../hooks/useDisposable";
import { useHeightMap } from "../scene/textures/pbrTextures";
import { carvingPlace, mulberry32 } from "../game/carving";
import { treeSeed } from "./mazeData";
import { BULGE_CLEARANCE, wallBulge } from "./wallRelief";

/** The word: Gugut, in Ge'ez script. */
const WORD = "ጉጉት";
/** The carving's size on the wall (m) and its height (centre, m). */
const WIDTH = 0.42;
const HEIGHT = 0.2;
const AT_HEIGHT = 1.3;
/** Seen only up close: fully from FADE_NEAR m, gone by FADE_FAR. */
const FADE_NEAR = 3;
const FADE_FAR = 6;

/** The word cut into stone: dark grooves, a lighter worn lip under each, chipped here and there. */
async function carve(canvas: HTMLCanvasElement) {
  const family = ethiopicFont.style.fontFamily;
  try {
    await document.fonts.load(`700 150px ${family}`, WORD);
  } catch {
    // Falls back to whatever Ge'ez face the system has.
  }
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `700 150px ${family}, "Nyala", "Ebrima", "Kefa", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The lit lower lip of the groove, then the groove itself, a little above.
  ctx.fillStyle = "rgba(255, 238, 205, 0.55)";
  ctx.fillText(WORD, w / 2 + 2, h / 2 + 5);
  ctx.fillStyle = "rgba(25, 18, 10, 0.95)";
  ctx.fillText(WORD, w / 2, h / 2);
  // Worn: chip bits away.
  const rng = mulberry32(treeSeed * 31 + 3);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.3 + rng() * 0.6;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 1 + rng() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/**
 * A secret: "ጉጉት" — Gugut — carved, worn, into one wall stone per maze,
 * at eye height. It follows the stone's bulge (as the ivy does) and shows
 * only up close: walk past it in a hurry and you'll never know.
 */
export default function Carving() {
  const place = useMemo(() => carvingPlace(), []);
  const height = useHeightMap("wall");

  const carving = useDisposable(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT, 8, 4);
    const material = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.95 });
    const ink = texture(map, uv());
    // Out with the stone's bulge (and a hair more), so it lies on the surface.
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    material.positionNode = positionLocal.add(vec3(0, 0, wallBulge(height, world).add(BULGE_CLEARANCE * 0.4)));
    material.colorNode = ink.rgb;
    const near = float(1).sub(smoothstep(FADE_NEAR, FADE_FAR, length(cameraPosition.sub(world))));
    material.opacityNode = ink.a.mul(near).mul(0.85);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    mesh.name = "Carving";
    return { mesh, canvas, map, dispose: () => (geometry.dispose(), material.dispose(), map.dispose()) };
  }, [height]);

  useEffect(() => {
    let live = true;
    void carve(carving.canvas).then(() => {
      if (live) carving.map.needsUpdate = true;
    });
    return () => {
      live = false;
    };
  }, [carving]);

  if (!place) return null;
  return <primitive object={carving.mesh} position={[place.x, AT_HEIGHT, place.z]} rotation={[0, place.facing, 0]} />;
}
