"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { preload } from "react-dom";
import QRCode from "qrcode";
import { getPreferences, setPreferences, type Graphics } from "../game/preferences";
import { Leva, levaStore } from "leva";
import { posterFont } from "../fonts";
import { audio, MIX_LAYERS, type MixLayer } from "../audio/audioEngine";
import { goat } from "../game/goat";
import { revealPreview } from "../game/revealPreview";
import { runStore } from "../game/runStore";
import { temesgen } from "../game/temesgen";
import { LEVELS, type Level } from "../maze/levels";
import { formatTime, type LeaderboardResponse } from "../leaderboard/shared";
import { GRAPHICS_LEVELS, graphics as currentGraphics } from "../quality";
import { setMazeConfig } from "../maze/mazeData";
import { applyGraphicsToPanel } from "../quality";
import { setLoading, useLoading } from "../scene/bake/loadingStore";
import { grassMapStore } from "../scene/grass/grassMapStore";
import { sceneLayers } from "../scene/sceneLayers";
import { getPerf } from "../scene/perf/perfStore";
import { perfCalls, perfTris } from "../scene/perf/renderStats";
import { Counter } from "../ui/LoadingOverlay";
import StudioSplash from "../ui/StudioSplash";
import { enterFullscreen, exitFullscreen, fullscreenSupported, useIsFullscreen } from "../ui/fullscreen";
import CullingMap from "./CullingMap";
import { presentLive, presentStore, usePresent } from "./presentStore";
import { PRESENTER_POLL_IDLE_MS, PRESENTER_POLL_LIVE_MS, isRoomCode, newRoomCode, type RemoteAction, type RemoteState } from "../remote/shared";
import { GOLDEN_HOUR, PLAY_URL, PLAYERS, type Readout, type Slide } from "./slides";

// Browser-only, like the game's own (drei's loaders need browser globals).
const Scene = dynamic(() => import("../scene/Scene"), { ssr: false });
const Director = dynamic(() => import("./Director"), { ssr: false });

const LEVEL = LEVELS[0];
const LOGO_SRC = "/logo gugut.svg";

/** The leva path ending in `suffix` (e.g. "Grass.occlusion"). */
function levaPath(suffix: string): string | undefined {
  return Object.keys(levaStore.getData()).find((k) => k === suffix || k.endsWith(`.${suffix}`));
}
function setLeva(suffix: string, value: unknown) {
  const path = levaPath(suffix);
  if (path) levaStore.setValueAtPath(path, value, false);
}
function getLeva(suffix: string): unknown {
  const path = levaPath(suffix);
  return path ? levaStore.get(path) : undefined;
}

/** Her bleat from where she really is (3D, muffled by the walls in between), the song dipping under it as in the game. */
function bleat() {
  const [gx, gz] = goat.position();
  audio.unlock();
  audio.duckSong(4);
  audio.goatBleat(gx, 0.8, gz, presentLive.goatDistance, true);
}

/**
 * The hackathon presentation (/present): the game's own scene as the slides.
 * Each slide is a camera shot in the live maze (present/Director) with words,
 * technique tags, a live readout or an x-ray toggle over it (present/slides).
 * → / Space / Page Down next, ← / Page Up back, X toggles the slide's x-ray,
 * B makes the goat bleat. The last slide is the end: → does nothing there.
 */
export default function PresentClient({
  slides: SLIDES,
  silentUntil,
}: {
  slides: Slide[];
  /** No ambience and no mix before this slide (only the slides' own moments, e.g. the reveal's swell). */
  silentUntil?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const loaded = useLoading().stage === "ready";
  // 4. Then the wireframe versions of the walls and the tree are drawn a few
  // frames each, unseen, so the first X on those slides doesn't freeze to compile them.
  const [warmed, setWarmed] = useState(false);
  useEffect(() => {
    if (!loaded || warmed) return;
    let cancelled = false;
    const frames = (n: number) => new Promise<void>((done) => {
      const step = () => (n-- <= 0 ? done() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
    (async () => {
      for (const layer of WARM_WIREFRAMES) {
        sceneLayers.setWireframe(layer);
        await frames(4);
      }
      sceneLayers.setWireframe(null);
      await frames(3);
      if (!cancelled) setWarmed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, warmed]);
  const ready = loaded && warmed;
  const { slide: index, step } = usePresent();
  const slide = SLIDES[index];
  // 6. The slides' pictures and the QR code, fetched while the loading screen is up.
  for (const s of SLIDES) for (const image of s.images ?? []) preload(image.src, { as: "image" });
  preload("/qr-play.svg", { as: "image" });
  // The slide on screen, and the one leaving (its text animating out).
  const [notes, setNotes] = useState(false);
  // The phone remote (present/remote): this presentation's code, the pairing card (R), a "connected" toast.
  const [room, setRoom] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [phoneAt, setPhoneAt] = useState(0);
  useEffect(() => {
    let code = "";
    try {
      code = localStorage.getItem(ROOM_KEY) ?? "";
    } catch {
      // Storage blocked: a new code each visit.
    }
    if (!isRoomCode(code)) {
      code = newRoomCode();
      try {
        localStorage.setItem(ROOM_KEY, code);
      } catch {
        // (Not remembered.)
      }
    }
    // (After mount: the code lives in this browser only.)
    const t = window.setTimeout(() => setRoom(code), 0);
    return () => window.clearTimeout(t);
  }, []);
  const [shown, setShown] = useState({ index, step });
  const [leaving, setLeaving] = useState<{ index: number; step: number } | null>(null);
  if (shown.index !== index) {
    setLeaving(shown);
    setShown({ index, step });
  } else if (shown.step !== step) setShown({ index, step });
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);
  const [xray, setXray] = useState(false);
  const xrayRef = useRef(xray);
  useEffect(() => {
    xrayRef.current = xray;
  }, [xray]);
  const saved = useRef<Map<string, unknown>>(new Map());
  // Each slide's leva settings (slide.set), against how they were before the
  // presentation touched them. Only what differs changes, so a setting several
  // slides share (post-processing off) isn't switched back and forth between them.
  const baseline = useRef<Map<string, unknown>>(new Map());
  const applySettings = useCallback((set: readonly (readonly [string, unknown])[]) => {
    const want = new Map(set);
    for (const path of new Set([...baseline.current.keys(), ...want.keys()])) {
      if (!baseline.current.has(path)) baseline.current.set(path, getLeva(path));
      const value = want.has(path) ? want.get(path) : baseline.current.get(path);
      if (getLeva(path) !== value) setLeva(path, value);
    }
  }, []);

  // A fresh Easy maze, the game paused (no walking, no clock) while presenting.
  useEffect(() => {
    presentStore.reset();
    const asked = new URLSearchParams(window.location.search).get("graphics");
    if (asked === "low" || asked === "medium" || asked === "high") setPreferences({ graphics: asked as Graphics });
    applyGraphicsToPanel();
    // 5. Gugut's voice loads with everything else (it's decoded once the audio unlocks), not on the sound slide.
    audio.setVoice(true);
    // 1. No fog in the presentation at all: switching it recompiles every
    // material, so it's set once, as the scene's controls appear (before the
    // loading screen compiles the shaders).
    const fogOff = window.setInterval(() => {
      if (getLeva("fogEnabled") === undefined) return;
      setLeva("fogEnabled", false);
      window.clearInterval(fogOff);
    }, 50);
    setMazeConfig({ cellsW: LEVEL.cellsW, cellsH: LEVEL.cellsH, cell: LEVEL.cell });
    setLoading({ stage: "assets", bakeProgress: 0, sceneHeld: false });
    runStore.setPaused("present", true);
    // The scene mounts only now, on this maze (just after: not a render inside this effect).
    const later = window.setTimeout(() => setMounted(true), 0);
    return () => {
      window.clearTimeout(later);
      window.clearInterval(fogOff);
      runStore.setPaused("present", false);
      runStore.reset();
      audio.setActive(false);
      audio.setMix(null);
      presentStore.reset();
      sceneLayers.reset();
      revealPreview.stop();
      applySettings([]);
      setLeva("fogEnabled", true);
    };
  }, [applySettings]);

  // Sound needs a gesture: the first key or click starts the audio.
  useEffect(() => {
    if (!ready) return;
    const start = () => audio.unlock();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [ready]);

  // What's heard: nothing (but the slides' own moments) before `silentUntil`;
  // on a slide with steps, the step's layers of the mix; otherwise all of it.
  const quiet = silentUntil !== undefined && index < silentUntil;
  useEffect(() => {
    if (!ready) return;
    audio.setActive(!quiet);
  }, [ready, quiet]);
  const mix: readonly MixLayer[] | null = slide.steps?.[step]?.mix ?? slide.mix ?? (quiet ? [] : null);
  const mixKey = mix ? mix.join(",") : "all";
  useEffect(() => {
    if (!ready) return;
    audio.setMix(mixKey === "all" ? null : mixKey ? (mixKey.split(",") as MixLayer[]) : []);
  }, [ready, mixKey]);

  // The sound slide: his song stopped after.
  useEffect(() => {
    if (!ready || !slide.steps?.some((s) => s.mix)) return;
    return () => temesgen.stopSong();
  }, [ready, slide]);
  // Each step's sounds: the song once its layer is in, her bleat every few seconds, his line.
  useEffect(() => {
    const now = slide.steps?.[step];
    if (!ready || !now?.mix) return;
    const timers: number[] = [];
    if (now.mix.includes("song") && temesgen.get().song === "stopped") {
      temesgen.playSong();
      temesgen.standUp();
    }
    let every = 0;
    if (now.mix.includes("goat")) {
      timers.push(window.setTimeout(bleat, 700));
      every = window.setInterval(bleat, 6000);
    }
    const line = now.say;
    if (line) timers.push(window.setTimeout(() => audio.say(line, { interrupt: true }), 600));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(every);
    };
  }, [ready, slide, step]);

  // The x-ray: its controls switched off (remembering how they were), and back.
  const setXrayOn = useCallback((s: Slide, on: boolean) => {
    if (!s.xray) return;
    if (s.xray.wireframe) sceneLayers.setWireframe(on ? s.xray.wireframe : null);
    if (s.xray.wireframeFirst) sceneLayers.setWireframe(on ? null : s.xray.wireframeFirst);
    if (s.xray.lightmap) sceneLayers.setLightmapView(on);
    if (s.xray.limbs) sceneLayers.setLimbView(on);
    if (s.xray.applies) {
      const grids = s.uvGrid ?? [];
      sceneLayers.setUvGrid(on ? grids.filter((g) => g !== s.xray!.applies) : grids);
    }
    for (const [path, off] of s.xray.controls ?? []) {
      if (on) {
        saved.current.set(path, getLeva(path));
        setLeva(path, off);
      } else if (saved.current.has(path)) {
        setLeva(path, saved.current.get(path));
        saved.current.delete(path);
      }
    }
    setXray(on);
  }, []);

  // X pressed: a pulse of light round the screen; the switch lands at its peak.
  const [pulse, setPulse] = useState(0);
  const pressX = useCallback(
    (s: Slide) => {
      if (!s.xray) return;
      setPulse((n) => n + 1);
      const on = !xrayRef.current;
      xrayRef.current = on;
      const at = presentStore.get().slide;
      // (Only if still on the same slide: a quick → shouldn't carry it over.)
      window.setTimeout(() => {
        if (presentStore.get().slide === at) setXrayOn(s, on);
        else xrayRef.current = false;
      }, PULSE_PEAK_MS);
    },
    [setXrayOn]
  );

  // Each slide as it comes up: fog off for the wide shots, and its moment.
  useEffect(() => {
    if (!ready) return;
    sceneLayers.only(slide.layers ?? null, true);
    sceneLayers.setUvGrid(slide.uvGrid ?? [], true);
    sceneLayers.setWireframe(slide.xray?.wireframeFirst ?? null);
    // Every slide: golden hour, and the raw render (post-processing only where a slide asks).
    applySettings([["duskPreview", GOLDEN_HOUR], ["postEnabled", !!slide.post], ...(slide.set ?? [])]);
    let timer = 0;
    if (slide.enter === "song") {
      temesgen.playSong();
      temesgen.standUp(); // (He plays; Gugut doesn't walk over and sit.)
    } else if (slide.enter === "dance") {
      // She dances, as in the game when Gugut stands and watches her (game/goat): the berries at work.
      revealPreview.stop();
      for (let i = 0; i < 110; i++) goat.observe(0.1, true, true);
    } else if (slide.enter === "reveal") {
      // What the game does as Gugut reaches her: the glow, the light, the motes, the swell.
      timer = window.setTimeout(() => {
        revealPreview.start();
        audio.swell(1.4);
      }, 900);
    }
    return () => {
      window.clearTimeout(timer);
      if (slide.enter === "song") temesgen.stopSong();
      if (slide.enter === "dance") goat.observe(0.1, false, false);
      if (slide.enter === "reveal") revealPreview.stop();
      setXrayOn(slide, false);
      sceneLayers.setUvGrid([], true);
      sceneLayers.setWireframe(null);
    };
  }, [ready, slide, setXrayOn, applySettings]);

  // Next / back: through a slide's steps first, then to the next slide (the last is the end).
  const advance = useCallback(
    (by: 1 | -1) => {
      const { slide: at, step: within } = presentStore.get();
      const steps = SLIDES[at].steps?.length ?? 1;
      if (by === 1 && within + 1 < steps) presentStore.setStep(within + 1);
      else if (by === -1 && within > 0) presentStore.setStep(within - 1);
      else if (at + by < SLIDES.length) presentStore.goTo(Math.max(0, at + by));
    },
    [SLIDES]
  );

  // The phone's taps, done as the keys would: checked every 2 s until a
  // phone says hello, then every 150 ms.
  useEffect(() => {
    if (!ready || !room) return;
    let live = true;
    let linked = false;
    let timer = 0;
    const check = async () => {
      try {
        const res = await fetch(`/api/remote?code=${room}&as=presenter`, { cache: "no-store" });
        const { actions = [] } = (await res.json()) as { actions?: RemoteAction[] };
        if (actions.length) linked = true;
        for (const action of live ? actions : []) {
          if (action === "next") advance(1);
          else if (action === "prev") advance(-1);
          else if (action === "first") presentStore.goTo(0);
          else if (action === "xray") pressX(SLIDES[presentStore.get().slide]);
          else if (action === "bleat") bleat();
          else if (action === "hello") {
            setPhoneAt(Date.now());
            setPairing(false);
          }
        }
      } catch {
        // Offline for a moment: the keyboard still works.
      }
      if (live) timer = window.setTimeout(check, linked ? PRESENTER_POLL_LIVE_MS : PRESENTER_POLL_IDLE_MS);
    };
    void check();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [ready, room, advance, pressX, SLIDES]);
  // Where the presentation is, for the phone: sent when it changes.
  useEffect(() => {
    if (!ready || !room) return;
    const state: RemoteState = {
      slide: index,
      count: SLIDES.length,
      step,
      steps: slide.steps?.length ?? 1,
      title: slide.title,
      notes: slide.notes ?? [],
      xray: slide.xray ? { label: slide.xray.label, state: (slide.xray.states ?? ["ON", "OFF"])[xray ? 1 : 0] } : null,
    };
    void fetch("/api/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: room, state }),
    }).catch(() => {});
  }, [ready, room, index, step, xray, slide, SLIDES.length, phoneAt]);
  // The "phone connected" toast, for a few seconds.
  useEffect(() => {
    if (!phoneAt) return;
    const t = window.setTimeout(() => setPhoneAt(0), 3500);
    return () => window.clearTimeout(t);
  }, [phoneAt]);

  // Slide keys (a presentation clicker sends Page Up / Down).
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const at = presentStore.get().slide;
      if (["ArrowRight", "Space", "PageDown", "Enter"].includes(e.code)) advance(1);
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.code)) advance(-1);
      else if (e.code === "Home") presentStore.goTo(0);
      else if (e.code === "KeyX") pressX(SLIDES[at]);
      else if (e.code === "KeyN") setNotes((n) => !n);
      else if (e.code === "KeyR") setPairing((v) => !v);
      else if (e.code === "KeyF") void (document.fullscreenElement ? exitFullscreen() : enterFullscreen());
      else if (e.code === "KeyB") bleat();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, advance, pressX, SLIDES]);

  return (
    <div className={`${posterFont.variable} relative h-full w-full overflow-hidden bg-black text-[#fdf3d4]`}>
      <Leva hidden />
      {mounted && <Scene director={<Director slides={SLIDES} />} maxDpr={MAX_DPR} />}

      {/* Loading: the game's own counter, while the maze is baked and compiled. */}
      {!ready && <Loading room={room} />}

      {/* The slides, over the scene (they also keep clicks off it: no pointer lock). */}
      {ready && (
        <div
          className="absolute inset-0 z-20 select-none"
          onClick={() => advance(1)}
        >
          {[...(leaving ? [leaving] : []), { index, step }].map((v) => (
            <SlideView
              key={v.index}
              slide={SLIDES[v.index]}
              index={v.index}
              step={v.step}
              count={SLIDES.length}
              xray={v.index === index && xray}
              exiting={v.index !== index}
            />
          ))}
        </div>
      )}

      <FullscreenButton />

      {/* While the camera moves: letterbox bars. */}
      {ready && <Letterbox />}
      {/* X: a pulse of warm light round the edges. */}
      {pulse > 0 && <div key={pulse} className="xray-pulse pointer-events-none absolute inset-0 z-[22]" />}
      {/* N: the presenter's notes. */}
      {ready && notes && slide.notes && <Notes notes={slide.notes} index={index} count={SLIDES.length} />}
      {ready && pairing && room && <Pairing room={room} />}
      {phoneAt > 0 && (
        <div className="pointer-events-none absolute top-5 left-1/2 z-[31] -translate-x-1/2 rounded-full bg-[#7fd08a] px-5 py-2 font-semibold text-[#0b0d08]" style={{ animation: "notice-in 300ms ease-out" }}>
          📱 Phone connected
        </div>
      )}

      <StudioSplash />
    </div>
  );
}

const noop = () => {};

/** Where this browser keeps its remote code (the phone stays paired across reloads). */
const ROOM_KEY = "gugut.present.room";

/** The presentation's resolution cap (big screens, projectors): crisp enough, much cheaper than 2×. */
const MAX_DPR = 1.5;
/** The parts with a wireframe x-ray, compiled as wireframe while loading. */
const WARM_WIREFRAMES = ["walls", "tree"] as const;
/** How often the live readouts rewrite their numbers (ms); the song meter more often. */
const READOUT_EVERY = 250;
const METER_EVERY = 80;

const noSubscribe = () => () => {};

/** Fullscreen on / off (also F), top right: dim until hovered. */
function FullscreenButton() {
  const supported = useSyncExternalStore(noSubscribe, fullscreenSupported, () => false);
  const fullscreen = useIsFullscreen();
  if (!supported) return null;
  const label = fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        // (Let go of the focus: Space / Enter are "next", not this button again.)
        e.currentTarget.blur();
        void (fullscreen ? exitFullscreen() : enterFullscreen());
      }}
      className="absolute top-4 right-[1.5vw] z-[26] flex h-10 w-10 items-center justify-center rounded-xl border border-[#fdf3d4]/20 bg-black/60 text-[#fdf3d4] opacity-50 transition-opacity duration-300 hover:opacity-100 focus-visible:opacity-100"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {fullscreen ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
    </button>
  );
}

/** When the x-ray's switch lands, into the X pulse (ms). */
const PULSE_PEAK_MS = 160;

/** Cinema bars, top and bottom, at presentLive.bars (read on its own loop). */
function Letterbox() {
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const h = `${(presentLive.bars * 7).toFixed(2)}vh`;
      if (top.current) top.current.style.height = h;
      if (bottom.current) bottom.current.style.height = h;
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <>
      <div ref={top} className="pointer-events-none absolute inset-x-0 top-0 z-[15] h-0 bg-black" />
      <div ref={bottom} className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-0 bg-black" />
    </>
  );
}

/** The presenter's notes for this slide (N), small, in the corner. */
function Notes({ notes, index, count }: { notes: string[]; index: number; count: number }) {
  return (
    <div className="pointer-events-none absolute right-[2vw] bottom-[2vh] z-[30] w-[min(26rem,34vw)] rounded-xl border border-[#c9a45c]/40 bg-black/80 p-3 text-sm leading-snug text-[#fdf3d4]/90">
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.25em] text-[#c9a45c]">
        Notes · {index + 1}/{count} · N to hide
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** How long the outgoing slide's text takes to leave (ms); the new one's waits about as long. */
const EXIT_MS = 420;

function Loading({ room }: { room: string | null }) {
  return (
    <div className={`${posterFont.className} absolute inset-0 z-30 bg-black`}>
      <Counter onFull={noop} />
      {room && (
        <div className="absolute bottom-[5vh] left-[6vw] flex items-center gap-4 font-sans text-sm text-[#fdf3d4]/45">
          <PairQr room={room} className="h-20 w-20 rounded-lg bg-[#fdf3d4] p-1.5" />
          <p>
            Scan to pair your phone, or open <b className="text-[#fdf3d4]/70">{remoteAddress()}</b>
            <br />
            and enter <b className="font-mono tracking-[0.2em] text-[#c9a45c]">{room}</b>
          </p>
        </div>
      )}
    </div>
  );
}

/** Where the phone opens the remote: this site's address. */
const remoteAddress = () => `${window.location.host}/present/remote`;

/** Where a phone pairs straight away: the remote, with this presentation's code in the address. */
const pairUrl = (room: string) => `${window.location.origin}/present/remote?code=${room}`;

/** The pairing QR: scanned with a phone's camera, it opens the remote already paired. */
function PairQr({ room, className }: { room: string; className: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(pairUrl(room), { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#0b0d08", light: "#fdf3d4" } })
      .then((s) => live && setSvg(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [room]);
  return (
    <div
      className={`${className} [&>svg]:h-full [&>svg]:w-full`}
      role="img"
      aria-label="QR code to pair your phone"
      // (The library's own SVG output, from our address: nothing from outside.)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The pairing card (R): where to go on the phone, and the code. */
function Pairing({ room }: { room: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[31] flex items-center justify-center bg-black/60">
      <div className="rounded-3xl border border-[#c9a45c]/50 bg-black/90 px-10 py-8 text-center" style={{ animation: "notice-in 300ms ease-out" }}>
        <p className="font-[family-name:var(--font-jolly)] text-5xl leading-none">Phone remote</p>
        <p className="mt-3 text-[#fdf3d4]/70">Scan with your phone&rsquo;s camera:</p>
        <PairQr room={room} className="mx-auto mt-3 h-[min(16rem,32vh)] w-[min(16rem,32vh)] rounded-2xl bg-[#fdf3d4] p-3" />
        <p className="mt-5 text-[#fdf3d4]/70">or open</p>
        <p className="mt-1 text-xl font-semibold">{remoteAddress()}</p>
        <p className="mt-4 text-[#fdf3d4]/70">and enter</p>
        <p className="mt-2 font-mono text-6xl font-bold tracking-[0.3em] text-[#c9a45c]">{room}</p>
        <p className="mt-5 text-xs text-[#fdf3d4]/40">R to close · it closes by itself when the phone connects</p>
      </div>
    </div>
  );
}

function SlideView({
  slide,
  index,
  step,
  count,
  xray,
  exiting,
}: {
  slide: Slide;
  index: number;
  step: number;
  count: number;
  xray: boolean;
  /** Leaving: animating out while the next slide's camera move starts. */
  exiting: boolean;
}) {
  const now = slide.steps?.[step];
  const before = slide.steps?.[step - 1];
  const added = now?.mix && before?.mix ? now.mix.find((l) => !before.mix!.includes(l)) : undefined;
  const map = now?.map ?? slide.map;
  return (
    <div className={`pointer-events-none absolute inset-0 ${exiting ? "slide-exit" : ""}`} style={exiting ? undefined : { animation: "notice-in 600ms ease-out" }}>
      {/* Legible over any shot. */}
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-linear-to-t from-black/80 via-black/40 to-transparent" />

      {slide.qr ? (
        <>
          {/* The end: a big thank-you in the middle, the way to play small in the corner. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55),transparent_70%)]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <h2
              className="slide-rise font-[family-name:var(--font-jolly)] text-[clamp(5rem,17vw,15rem)] leading-[0.85] text-[#fdf3d4] [text-shadow:0_6px_40px_rgba(0,0,0,0.65)]"
              style={{ animationDelay: "200ms" }}
            >
              {slide.title}
            </h2>
            <span className="slide-rise mt-[2vh] h-px w-[min(14rem,30vw)] bg-[#c9a45c]" style={{ animationDelay: "500ms" }} />
            {slide.lines.map((l, i) =>
              i === 0 ? (
                <p
                  key={l}
                  className="slide-rise mt-[2vh] text-[clamp(1rem,1.8vw,1.6rem)] tracking-[0.08em] text-[#fdf3d4]/75 [text-shadow:0_2px_12px_rgba(0,0,0,0.7)]"
                  style={{ animationDelay: "700ms" }}
                >
                  {l}
                </p>
              ) : (
                // The rest: quieter, the game's address picked out in gold.
                <p
                  key={l}
                  className="slide-rise mt-[3vh] max-w-[46rem] text-[clamp(0.95rem,1.35vw,1.25rem)] leading-relaxed text-[#fdf3d4]/70 [text-shadow:0_2px_12px_rgba(0,0,0,0.7)]"
                  style={{ animationDelay: `${950 + i * 150}ms` }}
                >
                  {l.split(/(goat\.gugut\.studio\S*)/).map((part, j) =>
                    j % 2 ? (
                      <b key={j} className="font-semibold whitespace-nowrap text-[#c9a45c]">
                        {part}
                      </b>
                    ) : (
                      part
                    )
                  )}
                </p>
              )
            )}
          </div>
          <PlayQr />
        </>
      ) : slide.logo ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <Image src={LOGO_SRC} alt="Gugut & the Goat" width={317} height={210} priority className="h-auto w-[min(34rem,70vw)] drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]" />
          {slide.lines.map((l) => (
            <p key={l} className="max-w-2xl text-[clamp(1.1rem,2vw,1.6rem)] text-[#fdf3d4]/85 [text-shadow:0_2px_14px_rgba(0,0,0,0.7)]">
              {l}
            </p>
          ))}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 px-[6vw] pb-[7vh]">
          {slide.tags && (
            <div className="slide-rise mb-4 flex flex-wrap gap-2" style={{ animationDelay: "400ms" }}>
              {slide.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[#c9a45c]/60 bg-black/60 px-3 py-1 text-sm uppercase tracking-[0.12em] text-[#c9a45c]">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h2 className="slide-rise font-[family-name:var(--font-jolly)] text-[clamp(2.6rem,6vw,5.5rem)] leading-[0.95] [text-shadow:0_2px_18px_rgba(0,0,0,0.6)]" style={{ animationDelay: "500ms" }}>
            {slide.title}
          </h2>
          <div className="mt-4 flex max-w-3xl flex-col gap-2">
            {(now ? [] : slide.lines).map((l, i) => (
              <p key={l} className="slide-rise text-[clamp(1rem,1.6vw,1.4rem)] leading-snug text-[#fdf3d4]/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.7)]" style={{ animationDelay: `${650 + i * 140}ms` }}>
                {l}
              </p>
            ))}
            {now && (
              <div key={step} className="slide-rise" style={{ animationDelay: step === 0 ? "650ms" : "0ms" }}>
                <p className="text-sm uppercase tracking-[0.2em] text-[#c9a45c]">{step === 0 || !now.mix ? now.label : `+ ${now.label}`}</p>
                <p className="mt-1 text-[clamp(1rem,1.6vw,1.4rem)] leading-snug text-[#fdf3d4]/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.7)]">
                  {now.caption}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {slide.readout && <ReadoutView kind={slide.readout} />}
      {map && (
        <div className="absolute top-1/2 right-[3vw] -translate-y-1/2" style={{ animation: "notice-in 600ms ease-out 200ms both" }}>
          <CullingMap mode={map} size={Math.round(Math.min(window.innerHeight * 0.56, window.innerWidth * 0.34))} />
        </div>
      )}
      {slide.cards && <Cards cards={slide.cards} />}
      {slide.images && <Pictures images={slide.images} />}
      {slide.merge && <Merge {...slide.merge} />}
      {slide.levels && <LevelMazes />}
      {slide.graphics && <GraphicsChoice />}
      {slide.leaderboard && <WorldBoard />}
      {slide.xray?.legend && (
        <div
          className="absolute top-1/2 right-[5vw] flex -translate-y-1/2 flex-col gap-2 rounded-2xl border border-[#fdf3d4]/15 bg-black/70 p-4 transition-opacity duration-500"
          style={{ opacity: xray ? 1 : 0 }}
        >
          {slide.xray.legend.map(([color, label]) => (
            <div key={label} className="flex items-center gap-3 text-[clamp(0.9rem,1.2vw,1.1rem)]">
              <span className="inline-block h-4 w-4 rounded" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      )}
      {now?.mix && <Mixer mix={now.mix} added={added} />}

      {slide.xray && (
        <div className="absolute left-[6vw] rounded-xl border border-[#fdf3d4]/20 bg-black/65 px-4 py-2 text-sm" style={{ top: slide.readout ? "11.5rem" : "1.5rem" }}>
          <span className="text-[#fdf3d4]/60">X-ray · </span>
          {slide.xray.label}:{" "}
          <b key={String(xray)} className={`badge-pop inline-block ${xray ? "text-[#e0523a]" : "text-[#7fd08a]"}`}>{(slide.xray.states ?? ["ON", "OFF"])[xray ? 1 : 0]}</b>
          <span className="ml-2 text-[#fdf3d4]/40">(X)</span>
        </div>
      )}

      <div className="absolute top-6 right-[calc(1.5vw+3.5rem)] text-sm tracking-[0.2em] text-[#fdf3d4]/50 tabular-nums">
        {index + 1} / {count}
      </div>
    </div>
  );
}

/**
 * Pictures on the right, as tilted, framed photo cards rising in one after
 * another: a landscape one large at the back, a portrait one overlapping it in
 * front (a collage); or portraits side by side. A file not added yet (public/…)
 * shows as an empty frame saying what goes there.
 */
function Pictures({ images }: { images: { src: string; caption: string; wide?: boolean }[] }) {
  const wide = images.find((i) => i.wide);
  const tall = images.filter((i) => !i.wide);
  if (wide) {
    return (
      <div className="absolute top-1/2 right-[3vw] h-[66vh] w-[46vw] -translate-y-1/2">
        <div className="absolute top-0 right-0">
          <Picture {...wide} box="h-[min(26vw,44vh)] w-[min(41vw,70vh)]" tilt={2} delay={600} />
        </div>
        {tall[0] && (
          <div className="absolute bottom-0 left-0">
            <Picture {...tall[0]} box="h-[min(34vh,24vw)] w-[min(22.7vh,16vw)]" tilt={-5} delay={900} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="absolute top-1/2 right-[4vw] flex -translate-y-1/2 items-center gap-[2vw]">
      {tall.map((image, i) => (
        <Picture key={image.src} {...image} box="h-[min(42vh,26rem)] w-[min(19vw,18rem)]" tilt={i % 2 ? 3 : -3} delay={600 + i * 250} />
      ))}
    </div>
  );
}

function Picture({ src, caption, box, tilt, delay }: { src: string; caption: string; box: string; tilt: number; delay: number }) {
  const [missing, setMissing] = useState(false);
  return (
    <figure className="slide-rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="rounded-sm bg-[#fdf3d4] p-2.5 pb-3 shadow-[0_14px_60px_rgba(0,0,0,0.65)]" style={{ transform: `rotate(${tilt}deg)` }}>
        <div className={`relative overflow-hidden bg-[#1b1e16] ${box}`}>
          {missing ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#fdf3d4]/60">
              <span className="text-2xl">🖼</span>
              Add this picture at
              <code className="break-all text-[#c9a45c]">public{src}</code>
            </div>
          ) : (
            // (A plain img: the file may not be there yet, and it's shown as it is.)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={caption} className="h-full w-full object-cover" onError={() => setMissing(true)} />
          )}
        </div>
        <figcaption className="mt-2 text-center font-[family-name:var(--font-jolly)] text-xl leading-none text-[#0b0d08]">{caption}</figcaption>
      </div>
    </figure>
  );
}

/** A small maze of this many cells across (a recursive backtracker, like the game's): true = wall. */
function miniMaze(cells: number): boolean[][] {
  const size = cells * 2 + 1;
  const g = Array.from({ length: size }, () => Array<boolean>(size).fill(true));
  const seen = Array.from({ length: cells }, () => Array<boolean>(cells).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  g[1][1] = false;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([dx, dy]) => [x + dx, y + dy, dx, dy] as const)
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cells && ny < cells && !seen[ny][nx]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, dx, dy] = next[Math.floor(Math.random() * next.length)];
    seen[ny][nx] = true;
    g[2 * y + 1 + dy][2 * x + 1 + dx] = false;
    g[2 * ny + 1][2 * nx + 1] = false;
    stack.push([nx, ny]);
  }
  return g;
}

/** The three levels, each a real maze of its size: start (cream) top-left, the goat (gold) bottom-right. */
function LevelMazes() {
  const [mazes] = useState(() => LEVELS.map((level) => ({ level, grid: miniMaze(level.cellsW) })));
  return (
    <div className="absolute top-[13vh] left-1/2 flex -translate-x-1/2 items-end gap-[2.5vw]">
      {mazes.map(({ level, grid }, i) => (
        <MiniMazeCard key={level.id} level={level} grid={grid} delay={600 + i * 300} />
      ))}
    </div>
  );
}

function MiniMazeCard({ level, grid, delay }: { level: Level; grid: boolean[][]; delay: number }) {
  const n = grid.length;
  const [blurbSize, blurbText] = level.blurb.split(" · ");
  return (
    <div className="slide-rise flex flex-col items-center gap-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="rounded-xl border border-[#fdf3d4]/15 bg-black/70 p-3">
        <svg viewBox={`0 0 ${n} ${n}`} className="h-[min(19vw,34vh)] w-[min(19vw,34vh)]" shapeRendering="crispEdges" aria-hidden>
          <rect width={n} height={n} fill="#1b1e16" />
          {grid.flatMap((row, y) => row.map((wall, x) => (wall ? <rect key={`${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill="#7d7464" /> : null)))}
          <rect x={1} y={1} width={1} height={1} fill="#fdf3d4" />
          <rect x={n - 2} y={n - 2} width={1} height={1} fill="#f2c43d" />
        </svg>
      </div>
      <p className="font-[family-name:var(--font-jolly)] text-[clamp(1.8rem,2.6vw,2.6rem)] leading-none">{level.label}</p>
      <p className="-mt-1 text-sm text-[#fdf3d4]/70">
        <b className="text-[#c9a45c]">{blurbSize}</b> · {blurbText}
      </p>
    </div>
  );
}

/** How many of each board's top times the slide shows. */
const BOARD_ROWS = 10;

/** The world leaderboard, live (api/leaderboard): each level's top times and its number of players. */
function WorldBoard() {
  const [boards, setBoards] = useState<(LeaderboardResponse | null)[] | "error" | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(
      LEVELS.map((level) =>
        fetch(`/api/leaderboard?level=${level.id}`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<LeaderboardResponse>) : null))
          .catch(() => null)
      )
    ).then((all) => {
      if (live) setBoards(all.every((b) => !b) ? "error" : all);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="absolute top-[12vh] left-1/2 flex -translate-x-1/2 items-start gap-[1.6vw]">
      {LEVELS.map((level, i) => {
        const board = Array.isArray(boards) ? boards[i] : null;
        return (
          <div
            key={level.id}
            className="slide-rise w-[min(20rem,26vw)] rounded-2xl border border-[#fdf3d4]/15 bg-black/75 p-5"
            style={{ animationDelay: `${600 + i * 220}ms` }}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <p className="font-[family-name:var(--font-jolly)] text-[clamp(1.8rem,2.6vw,2.6rem)] leading-none">{level.label}</p>
              {board && <p className="text-xs uppercase tracking-[0.15em] text-[#c9a45c]">{board.players.toLocaleString()} players</p>}
            </div>
            {board ? (
              <ol className="flex flex-col gap-1">
                {board.entries.slice(0, BOARD_ROWS).map((e) => (
                  <li
                    key={e.rank}
                    className={`flex items-center gap-3 rounded-lg px-2 py-0.5 text-[clamp(0.8rem,1vw,0.95rem)] ${e.rank === 1 ? "bg-[#c9a45c]/20 text-[#f2c43d]" : "text-[#fdf3d4]/85"}`}
                  >
                    <span className="w-5 text-right tabular-nums opacity-70">{e.rank}</span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <b className="tabular-nums">{formatTime(e.timeMs)}</b>
                  </li>
                ))}
                {board.entries.length === 0 && <li className="text-sm text-[#fdf3d4]/50">No times yet: be the first.</li>}
              </ol>
            ) : (
              <p className="text-sm text-[#fdf3d4]/50">{boards === null ? "Loading…" : "The board is unavailable right now."}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The game's graphics chooser: what each level means, the one this presentation runs on lit. */
const GRAPHICS_TEXT: Record<string, string> = {
  low: "Smooth on phones and older laptops",
  medium: "The full look, balanced for most PCs",
  high: "Everything on: more flowers and ivy, sharper light and shadows. For a strong PC",
};

function GraphicsChoice() {
  const [running] = useState(currentGraphics);
  return (
    <div className="absolute top-[16vh] left-1/2 flex -translate-x-1/2 items-stretch gap-[1.6vw]">
      {GRAPHICS_LEVELS.map((level, i) => {
        const on = level === running;
        return (
          <div
            key={level}
            className={`slide-rise flex w-[min(17rem,22vw)] flex-col rounded-2xl border p-5 ${
              on ? "border-[#c9a45c] bg-[#c9a45c]/20 shadow-[0_0_60px_rgba(201,164,92,0.35)]" : "border-[#fdf3d4]/15 bg-black/70"
            }`}
            style={{ animationDelay: `${600 + i * 220}ms` }}
          >
            <p className={`font-[family-name:var(--font-jolly)] text-[clamp(2rem,3vw,3rem)] leading-none ${on ? "text-[#f2c43d]" : ""}`}>
              {level[0].toUpperCase() + level.slice(1)}
            </p>
            <p className="mt-3 flex-1 text-[clamp(0.85rem,1.05vw,1rem)] leading-snug text-[#fdf3d4]/80">{GRAPHICS_TEXT[level]}</p>
            {on && <p className="mt-4 text-xs uppercase tracking-[0.2em] text-[#c9a45c]">● Running now</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Two stories into one game: [card] + [card] = [the game's card, in gold], one after another. */
function Merge({ left, right, result }: { left: [string, string]; right: [string, string]; result: [string, string] }) {
  const card = (name: string, text: string, delay: number, gold = false) => (
    <div
      className={`slide-rise w-[min(18rem,22vw)] rounded-2xl border p-5 ${
        gold ? "border-[#c9a45c] bg-[#c9a45c]/15 shadow-[0_0_60px_rgba(201,164,92,0.35)]" : "border-[#fdf3d4]/15 bg-black/70"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className={`font-[family-name:var(--font-jolly)] text-[clamp(1.6rem,2.3vw,2.4rem)] leading-none ${gold ? "text-[#f2c43d]" : "text-[#fdf3d4]"}`}>{name}</p>
      <p className="mt-3 text-[clamp(0.85rem,1.05vw,1rem)] leading-snug text-[#fdf3d4]/80">{text}</p>
    </div>
  );
  const sign = (s: string, delay: number) => (
    <span className="slide-rise font-[family-name:var(--font-jolly)] text-[clamp(2.5rem,4vw,4rem)] text-[#c9a45c]" style={{ animationDelay: `${delay}ms` }}>
      {s}
    </span>
  );
  return (
    <div className="absolute top-[12vh] left-1/2 flex -translate-x-1/2 items-center gap-[1.6vw]">
      {card(left[0], left[1], 600)}
      {sign("+", 900)}
      {card(right[0], right[1], 1100)}
      {sign("=", 1500)}
      {card(result[0], result[1], 1800, true)}
    </div>
  );
}

/** Technique cards, rising in one after another on the right. */
function Cards({ cards }: { cards: [string, string][] }) {
  return (
    <div className={`absolute top-[14vh] right-[4vw] grid w-[min(48rem,52vw)] gap-3 ${cards.length > 4 ? "grid-cols-3" : "grid-cols-2"}`}>
      {cards.map(([name, text], i) => (
        <div
          key={name}
          className="slide-rise rounded-2xl border border-[#fdf3d4]/15 bg-black/70 p-4"
          style={{ animationDelay: `${750 + i * 160}ms` }}
        >
          <p className="font-[family-name:var(--font-jolly)] text-[clamp(1.3rem,1.8vw,1.8rem)] leading-none text-[#c9a45c]">{name}</p>
          <p className="mt-2 text-[clamp(0.8rem,1vw,0.95rem)] leading-snug text-[#fdf3d4]/80">{text}</p>
        </div>
      ))}
    </div>
  );
}

/** Scan to play: the game on a phone, right now. */
function PlayQr() {
  return (
    <div
      className="slide-rise absolute right-[3vw] bottom-[4vh] flex items-center gap-4 rounded-2xl bg-[#fdf3d4] p-3 pr-5 text-[#0b0d08] shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
      style={{ animationDelay: "1100ms" }}
    >
      <Image src="/qr-play.svg" alt={`QR code: ${PLAY_URL}`} width={120} height={120} unoptimized className="h-[min(7.5rem,14vh)] w-[min(7.5rem,14vh)]" />
      <div>
        <p className="font-[family-name:var(--font-jolly)] text-[clamp(1.4rem,2vw,1.9rem)] leading-none">Scan to play</p>
        <p className="mt-1.5 text-sm font-semibold">{PLAY_URL}</p>
      </div>
    </div>
  );
}

/** The mix's layers, as the sound slide brings them in. */
const MIX_NAMES: Record<MixLayer, [name: string, detail: string]> = {
  wind: ["Wind", "recording · gusts with the grass"],
  birds: ["Birds", "recording · stereo drift"],
  song: ["Temesgen's kirar", "3D · HRTF · distance · walls"],
  goat: ["The goat", "3D · delay · walls · echo"],
  voice: ["Gugut's voice", "dry · centred · ducks the rest"],
};

function Mixer({ mix, added }: { mix: readonly MixLayer[]; added?: MixLayer }) {
  return (
    <div className="absolute top-1/2 right-[5vw] w-[min(24rem,34vw)] -translate-y-1/2 rounded-2xl border border-[#fdf3d4]/15 bg-black/70 p-4">
      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-[#fdf3d4]/50">The mix</p>
      <div className="flex flex-col gap-2">
        {MIX_LAYERS.map((layer, n) => {
          const on = mix.includes(layer);
          const [name, detail] = MIX_NAMES[layer];
          return (
            <div
              key={layer}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-[background-color,opacity] duration-500 ${
                on ? "bg-white/8 opacity-100" : "opacity-35"
              } ${layer === added ? "ring-1 ring-[#c9a45c]" : ""}`}
            >
              <div className="flex h-6 w-8 items-end gap-0.5" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-full w-1.5 origin-bottom rounded-sm ${on ? "bg-[#c9a45c]" : "bg-[#fdf3d4]/30"}`}
                    style={
                      on
                        ? { animation: `mix-bar ${0.6 + ((i * 3 + n * 5) % 7) / 10}s ease-in-out ${-0.23 * i}s infinite` }
                        : { transform: "scaleY(0.15)" }
                    }
                  />
                ))}
              </div>
              <div className="min-w-0">
                <p className="leading-tight">{name}</p>
                <p className="truncate text-xs text-[#fdf3d4]/50">{detail}</p>
              </div>
            </div>
          );
        })}
        <div className="mt-1 flex items-center justify-between border-t border-[#fdf3d4]/15 px-3 pt-3 text-sm">
          <span className="text-[#fdf3d4]/70">Master</span>
          <span className="text-xs text-[#fdf3d4]/50">compressor · Web Audio</span>
        </div>
      </div>
    </div>
  );
}

/** A live number panel, updated on its own loop (no re-renders). */
function ReadoutView({ kind }: { kind: Readout }) {
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = 0;
    const rows = (pairs: [string, string][]) =>
      pairs.map(([k, v]) => `<div class="flex justify-between gap-6"><span class="opacity-60">${k}</span><b class="tabular-nums">${v}</b></div>`).join("");
    let last = 0;
    const tick = () => {
      const el = box.current;
      const now = performance.now();
      if (kind === "compass" && arrow.current) arrow.current.style.transform = `rotate(${presentLive.goatBearing}rad)`;
      if (el && now - last >= (kind === "energy" ? METER_EVERY : READOUT_EVERY)) {
        last = now;
        if (kind === "render") {
          const { frameMs } = getPerf();
          const list: [string, string][] = [
            ["FPS", frameMs > 0 ? Math.round(1000 / frameMs).toString() : "–"],
            ["Draw calls", perfCalls.current.toLocaleString()],
            ["Triangles", perfTris.current.toLocaleString()],
          ];
          if (PLAYERS) list.push(["Players", PLAYERS]);
          el.innerHTML = rows(list);
        } else if (kind === "grass") {
          const { drawnTufts, totalTufts } = grassMapStore;
          const pct = totalTufts ? Math.round((drawnTufts / totalTufts) * 100) : 0;
          el.innerHTML = rows([
            ["Grass tufts drawn", drawnTufts.toLocaleString()],
            ["Of", totalTufts.toLocaleString()],
            ["Drawn", `${pct}%`],
          ]);
        } else if (kind === "energy") {
          const e = Math.min(1, audio.songEnergy() * 6);
          el.innerHTML = `<div class="opacity-60 mb-2">Song energy (live)</div><div class="h-3 w-48 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-[#c9a45c]" style="width:${Math.round(e * 100)}%"></div></div>`;
        } else if (kind === "renderer") {
          const { frameMs } = getPerf();
          const backend = presentLive.webgpu === null ? "…" : presentLive.webgpu ? "WebGPU" : "WebGL 2 (fallback)";
          el.innerHTML = rows([
            ["Renderer", backend],
            ["Graphics", (getPreferences().graphics ?? "medium").replace(/^./, (c) => c.toUpperCase())],
            ["FPS", frameMs > 0 ? Math.round(1000 / frameMs).toString() : "–"],
            ["Draw calls", perfCalls.current.toLocaleString()],
            ["Triangles", perfTris.current.toLocaleString()],
          ]);
        } else if (kind === "compass") {
          el.innerHTML = rows([["Goat", `${presentLive.goatDistance.toFixed(1)} m away`]]);
        }
      }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [kind]);

  return (
    <div className="absolute top-6 left-[6vw] min-w-56 rounded-xl border border-[#fdf3d4]/20 bg-black/65 px-4 py-3 text-base">
      <div ref={box} className="flex flex-col gap-1" />
      {kind === "compass" && (
        <div className="mt-3 flex items-center gap-3">
          <div className="relative h-16 w-16 rounded-full border border-[#fdf3d4]/30">
            <div ref={arrow} className="absolute inset-0 flex justify-center">
              <div className="mt-1 h-0 w-0 border-x-[7px] border-b-[22px] border-x-transparent border-b-[#c9a45c]" />
            </div>
          </div>
          <span className="text-sm opacity-60">Where she is,<br />from where you look</span>
        </div>
      )}
    </div>
  );
}
