"use client";

import { useEffect, useRef, useState } from "react";
import {
  MeshBasicNodeMaterial,
  QuadMesh,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGPURenderer,
  type Texture,
} from "three/webgpu";
import { clamp, float, mix, mx_fractal_noise_float, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";

/** How long the noise dissolve from the first image to the second takes. */
export const DISSOLVE_MS = 1600;

/** Smooth in, smooth out. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Full-screen canvas behind the title screen and preloader: draws `fromSrc`
 * (cover-fitted), and when `dissolved` turns true, burns it away along a
 * fractal-noise front with a glowing ember edge to reveal `toSrc`. Renders
 * only while something changes (the dissolve, a resize), so it costs nothing
 * while the game loads behind it. Until the renderer is up — or if it never
 * comes up — the same images sit underneath as CSS backgrounds, cross-fading.
 */
export default function DissolveCanvas({
  fromSrc,
  toSrc,
  dissolved,
  onDissolved,
}: {
  fromSrc: string;
  toSrc: string;
  dissolved: boolean;
  /** Called once the burn has fully revealed `toSrc`. */
  onDissolved?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  // Read by the render loop; `go` is set once the renderer is ready.
  const dissolvedRef = useRef(dissolved);
  const goRef = useRef<(() => void) | null>(null);
  const onDissolvedRef = useRef(onDissolved);
  useEffect(() => {
    onDissolvedRef.current = onDissolved;
  }, [onDissolved]);

  useEffect(() => {
    dissolvedRef.current = dissolved;
    if (goRef.current) {
      goRef.current();
      return;
    }
    if (!dissolved) return;
    // Renderer not up (yet): the CSS cross-fade plays instead. If the
    // renderer comes up meanwhile, its own burn reports when it ends.
    const t = setTimeout(() => {
      if (!goRef.current) onDissolvedRef.current?.();
    }, DISSOLVE_MS);
    return () => clearTimeout(t);
  }, [dissolved]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let raf = 0;

    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const progress = uniform(0);
    /** Screen width / height. */
    const aspect = uniform(1);
    /** Scales screen UVs into the image's so it covers the screen. */
    const cover = uniform(new Vector2(1, 1));

    const material = new MeshBasicNodeMaterial();
    material.toneMapped = false;
    const quad = new QuadMesh(material);
    const textures: Texture[] = [];
    let imageAspect = 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      aspect.value = w / h;
      cover.value.set(...(aspect.value > imageAspect ? [1, imageAspect / aspect.value] : [aspect.value / imageAspect, 1]) as [number, number]);
    };
    const draw = () => quad.render(renderer);

    // Eases `progress` towards the current target, drawing each frame.
    let shown = dissolvedRef.current ? 1 : 0;
    let last = 0;
    const tick = (now: number) => {
      const target = dissolvedRef.current ? 1 : 0;
      // Capped per frame: the scene mounting behind can stall the main thread,
      // and the burn should still play out rather than skip to the end.
      const step = last ? Math.min(now - last, 50) / DISSOLVE_MS : 0;
      last = now;
      shown = target > shown ? Math.min(target, shown + step) : Math.max(target, shown - step);
      progress.value = ease(shown);
      draw();
      raf = shown === target ? 0 : requestAnimationFrame(tick);
      if (raf) return;
      last = 0;
      if (target === 1) onDissolvedRef.current?.();
    };
    const go = () => {
      // Back to the title screen happens behind a faded-out overlay: no reverse burn.
      if (!dissolvedRef.current) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
        shown = 0;
        progress.value = 0;
        draw();
        return;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onResize = () => {
      resize();
      if (!raf) draw();
    };

    (async () => {
      const loader = new TextureLoader();
      const [from, to] = await Promise.all([loader.loadAsync(fromSrc), loader.loadAsync(toSrc), renderer.init()]);
      if (disposed) {
        from.dispose();
        to.dispose();
        return;
      }
      for (const t of [from, to]) t.colorSpace = SRGBColorSpace;
      textures.push(from, to);
      const img = from.image as { width: number; height: number };
      imageAspect = img.width / img.height;

      // QuadMesh's uv runs top-down (v = 0 at the top); image textures bottom-up.
      const screen = vec2(uv().x, float(1).sub(uv().y));
      const imgUv = screen.sub(0.5).mul(cover).add(0.5);
      // Noise in square screen units, so the blotches aren't stretched.
      const p = vec3(screen.x.mul(aspect), screen.y, 0).mul(2.6);
      const noise = mx_fractal_noise_float(p, 4, 2, 0.5, 1).mul(0.62).add(0.5);
      // Bias: the burn opens from the middle of the screen outwards.
      const centre = vec2(screen.x.sub(0.5).mul(aspect), screen.y.sub(0.5)).length();
      // Remapped from its measured spread (~0.27..0.73) to 0..1, so the burn
      // fills the whole duration instead of its middle third.
      const n = clamp(noise.mul(0.75).add(centre.mul(0.35)).sub(0.27).div(0.46), 0, 1);

      const edge = 0.09;
      const front = mix(float(-edge), float(1 + edge), progress);
      // 1 where the first image still stands.
      // A slightly feathered edge: a hard one shimmers (aliases) as it moves.
      const keep = smoothstep(front, front.add(0.03), n);
      // The band just ahead of the front: charred, then glowing.
      const band = keep.mul(float(1).sub(smoothstep(0, edge, n.sub(front))));
      const glow = band.mul(band).mul(band);

      const a = texture(from, imgUv).rgb.mul(float(1).sub(band.mul(0.65)));
      const b = texture(to, imgUv).rgb;
      const ember = vec3(1.0, 0.55, 0.18).mul(glow.mul(3.2)).add(vec3(1.0, 0.9, 0.6).mul(glow.mul(glow).mul(4)));
      material.colorNode = vec4(mix(b, a, keep).add(ember), 1);
      material.needsUpdate = true;

      resize();
      window.addEventListener("resize", onResize);
      goRef.current = go;
      if (dissolvedRef.current) go();
      else draw();
      setLive(true);
    })().catch((err) => {
      // Stays on the CSS fallback.
      console.warn("Preloader canvas unavailable:", err);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      goRef.current = null;
      window.removeEventListener("resize", onResize);
      textures.forEach((t) => t.dispose());
      material.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    };
  }, [fromSrc, toSrc]);

  const bg = "absolute inset-0 bg-cover bg-center transition-opacity ease-in-out";
  return (
    <div className="absolute inset-0 bg-[#0b0d08]">
      <div className={bg} style={{ backgroundImage: `url("${toSrc}")` }} />
      <div
        className={bg}
        style={{
          backgroundImage: `url("${fromSrc}")`,
          opacity: dissolved ? 0 : 1,
          transitionDuration: `${DISSOLVE_MS}ms`,
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
