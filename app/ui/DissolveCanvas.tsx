"use client";

import { useEffect, useRef, useState } from "react";
import {
  HalfFloatType,
  MeshBasicNodeMaterial,
  NoBlending,
  QuadMesh,
  RenderTarget,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGPURenderer,
  type Texture,
} from "three/webgpu";
import {
  clamp,
  float,
  mix,
  mx_fractal_noise_float,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

/** How long each noise dissolve takes. */
export const DISSOLVE_MS = 1600;

/**
 * 0: `fromSrc` (title screen). 1: burned through to `toSrc` (the story).
 * 2: `toSrc` burned away too, to transparent (the game behind shows).
 */
export type DissolveStage = 0 | 1 | 2;

/** Smooth in, smooth out. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The canvas behind the title screen and preloader — filling its box (the
 * whole screen, or a band across the top on portrait phones): draws `fromSrc`
 * (cover-fitted); moving `stage` forward burns the current image away along
 * a fractal-noise front with a glowing ember edge — to `toSrc` (stage 1),
 * then to nothing (stage 2). Moving back jumps there instantly (it happens
 * behind a hidden overlay). Renders only while something changes (a burn, a
 * resize), so it costs nothing while the game loads behind it. Until the
 * renderer is up — or if it never comes up — the same images sit underneath
 * as CSS backgrounds, cross-fading.
 *
 * `mode="in"` runs the second burn the other way, for the outro (ui/OutroStory):
 * at stage 1 the canvas is clear (the game shows), and moving to stage 2 burns
 * `toSrc` *in* over it, along the same noise front with the same ember edge.
 */
export default function DissolveCanvas({
  fromSrc,
  toSrc,
  stage,
  onDissolved,
  mode = "out",
}: {
  fromSrc: string;
  toSrc: string;
  stage: DissolveStage;
  /** "out": the images burn away (the preloader). "in": `toSrc` burns in from nothing (stage 1 → 2). */
  mode?: "out" | "in";
  /** Called once a burn forward has finished, with the stage it reached. */
  onDissolved?: (stage: DissolveStage) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  // Read by the render loop; `go` is set once the renderer is ready.
  const stageRef = useRef(stage);
  const goRef = useRef<(() => void) | null>(null);
  const onDissolvedRef = useRef(onDissolved);
  useEffect(() => {
    onDissolvedRef.current = onDissolved;
  }, [onDissolved]);

  useEffect(() => {
    const prev = stageRef.current;
    stageRef.current = stage;
    if (goRef.current) {
      goRef.current();
      return;
    }
    if (stage <= prev) return;
    // Renderer not up (yet): the CSS cross-fade plays instead. If the
    // renderer comes up meanwhile, its own burn reports when it ends.
    const t = setTimeout(() => {
      if (!goRef.current) onDissolvedRef.current?.(stage);
    }, DISSOLVE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let raf = 0;

    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    /** 0..2: the first burn over 0..1, the second over 1..2. */
    const progress = uniform(0);
    /** Screen width / height. */
    const aspect = uniform(1);
    /** Scales screen UVs into the image's so it covers the screen. */
    const cover = uniform(new Vector2(1, 1));

    // Writes premultiplied colour + alpha straight into the (transparent) canvas.
    const material = new MeshBasicNodeMaterial({ blending: NoBlending });
    material.toneMapped = false;
    const quad = new QuadMesh(material);
    const textures: Texture[] = [];
    let imageAspect = 1;

    // The two burn fields (fractal noise, 4 octaves each) are rendered once
    // into a small texture — R and G — and only re-baked on resize: per pixel
    // per frame, the burn is then a texture read instead of eight noise
    // evaluations at full (HiDPI) resolution. The fields are smooth, so a
    // ~512 px bake upscales without visible loss.
    const fieldTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    const bakeMaterial = new MeshBasicNodeMaterial({ blending: NoBlending });
    bakeMaterial.toneMapped = false;
    const bakeQuad = new QuadMesh(bakeMaterial);
    let bakeReady = false;
    const bake = () => {
      if (!bakeReady) return;
      const h = Math.min(512, Math.max(1, canvas.clientHeight));
      fieldTarget.setSize(Math.max(1, Math.round(h * aspect.value)), h);
      renderer.setRenderTarget(fieldTarget);
      bakeQuad.render(renderer);
      renderer.setRenderTarget(null);
    };

    // Sized to its box (it fills its parent), not the window.
    const resize = () => {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      renderer.setSize(w, h, false);
      aspect.value = w / h;
      cover.value.set(...(aspect.value > imageAspect ? [1, imageAspect / aspect.value] : [aspect.value / imageAspect, 1]) as [number, number]);
      bake();
    };
    const draw = () => quad.render(renderer);

    // Moves `shown` towards the current stage, easing within each burn,
    // drawing each frame.
    let shown: number = stageRef.current;
    let last = 0;
    const setProgress = () => {
      const whole = Math.min(Math.floor(shown), 1);
      progress.value = whole + ease(shown - whole);
    };
    const tick = (now: number) => {
      const target = stageRef.current;
      // Capped per frame, so one long stall doesn't make the burn skip ahead;
      // real time down to 10 fps (the Enter burn runs while the scene renders).
      const step = last ? Math.min(now - last, 100) / DISSOLVE_MS : 0;
      last = now;
      shown = Math.min(target, shown + step);
      setProgress();
      draw();
      raf = shown === target ? 0 : requestAnimationFrame(tick);
      if (raf) return;
      last = 0;
      onDissolvedRef.current?.(target);
    };
    const go = () => {
      // Backwards (back to the title screen, or a restart) happens behind a
      // hidden overlay: jump, no reverse burn.
      if (stageRef.current < shown) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
        shown = stageRef.current;
        setProgress();
        draw();
        return;
      }
      if (!raf && stageRef.current > shown) raf = requestAnimationFrame(tick);
    };

    const onResize = () => {
      resize();
      if (!raf) draw();
    };
    const observer = new ResizeObserver(() => goRef.current && onResize());

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
      // Bias: each burn opens from the middle of the screen outwards.
      const centre = vec2(screen.x.sub(0.5).mul(aspect), screen.y.sub(0.5)).length();
      /** The burn field: 0..1, burned first where lowest. */
      const field = (offset: Node<"vec3">) => {
        const noise = mx_fractal_noise_float(p.add(offset), 4, 2, 0.5, 1).mul(0.62).add(0.5);
        // Remapped from its measured spread (~0.27..0.73) to 0..1, so the burn
        // fills the whole duration instead of its middle third.
        return clamp(noise.mul(0.75).add(centre.mul(0.35)).sub(0.27).div(0.46), 0, 1);
      };

      const edge = 0.09;
      /** One burn at 0..1 `t`: what still stands (1), and its ember glow. */
      const burn = (n: Node<"float">, t: Node<"float">) => {
        const front = mix(float(-edge), float(1 + edge), t);
        // A slightly feathered edge: a hard one shimmers (aliases) as it moves.
        const keep = smoothstep(front, front.add(0.03), n);
        // The band just ahead of the front: charred, then glowing.
        const band = keep.mul(float(1).sub(smoothstep(0, edge, n.sub(front))));
        const glow = band.mul(band).mul(band);
        const ember = vec3(1.0, 0.55, 0.18).mul(glow.mul(3.2)).add(vec3(1.0, 0.9, 0.6).mul(glow.mul(glow).mul(4)));
        return { keep, band, glow, ember };
      };
      // The second burn uses another patch of noise, so it doesn't retrace the
      // first. (Baked and read back with the same quad uv, so the field's
      // orientation in the texture doesn't matter.)
      bakeMaterial.colorNode = vec4(field(vec3(0, 0, 0)), field(vec3(7.3, 2.1, 0)), 0, 1);
      bakeReady = true;
      const fields = texture(fieldTarget.texture, uv());
      const first = burn(fields.r, clamp(progress, 0, 1));
      const second = burn(fields.g, clamp(progress.sub(1), 0, 1));

      const a = texture(from, imgUv).rgb.mul(float(1).sub(first.band.mul(0.65)));
      const b = texture(to, imgUv).rgb.mul(float(1).sub(second.band.mul(0.65)));
      const image = mix(b, a, first.keep).add(first.ember);
      // Premultiplied: what stands of the image, plus the ember light.
      const alpha = clamp(second.keep.add(second.glow), 0, 1);
      if (mode === "in") {
        // What the second burn has burned through is where the image now stands.
        const shownIn = float(1).sub(second.keep);
        material.colorNode = vec4(b.mul(shownIn).add(second.ember), clamp(shownIn.add(second.glow), 0, 1));
      } else {
        material.colorNode = vec4(image.mul(second.keep).add(second.ember), alpha);
      }
      material.needsUpdate = true;

      resize();
      observer.observe(canvas);
      goRef.current = go;
      setProgress();
      draw();
      go();
      setLive(true);
    })().catch((err) => {
      // Stays on the CSS fallback.
      console.warn("Preloader canvas unavailable:", err);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      goRef.current = null;
      observer.disconnect();
      textures.forEach((t) => t.dispose());
      material.dispose();
      bakeMaterial.dispose();
      fieldTarget.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    };
  }, [fromSrc, toSrc, mode]);

  // The CSS fallback: cross-fades, then fades out at stage 2. Once the canvas
  // is live it does the burning, so the fallback just gets out of the way.
  const fade = { transitionDuration: live ? "0ms" : `${DISSOLVE_MS}ms` };
  const bg = "absolute inset-0 bg-cover bg-center transition-opacity ease-in-out";
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 bg-[#0b0d08] transition-opacity ease-in-out"
        style={{ ...fade, opacity: (mode === "in" ? stage === 2 : stage !== 2) ? 1 : 0 }}
      >
        <div className={bg} style={{ backgroundImage: `url("${toSrc}")` }} />
        <div
          className={bg}
          style={{ backgroundImage: `url("${fromSrc}")`, opacity: stage === 0 ? 1 : 0, transitionDuration: `${DISSOLVE_MS}ms` }}
        />
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
