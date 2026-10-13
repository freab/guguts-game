"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { levaStore } from "leva";
import { audio } from "../audio/audioEngine";
import { trailerFont } from "../fonts";
import { goat } from "../game/goat";
import { tapFrames } from "../game/photo";
import PresentClient from "../present/PresentClient";
import { presentLive, presentStore } from "../present/presentStore";
import type { Shot, Slide } from "../present/slides";
import { ALL_LAYERS, type SceneLayer } from "../scene/sceneLayers";
import { useLoading } from "../scene/bake/loadingStore";

/**
 * The launch trailer (/trailer): the game's own scene, filmed on a timeline
 * (BEATS) by the presentation's camera (present/Director, cinematic), in four
 * acts (the legend, the maze, the heart, the title): every shot moving
 * slowly, joined by soft glides (shots near each other) or cross-dissolves
 * (the long jumps, the old shot fading into the new), the light sinking from
 * golden hour to dusk, a few lines of story (CAPTIONS, in Lexend) and an end
 * card. The music: a file chosen on the page (never uploaded: read from this
 * computer) from a chosen time, or Temesgen's krar.
 *
 * Every frame is composited onto a 1920 × 1080 canvas (the scene, cinema
 * bars, the words): that canvas is what you see, and what Record saves, as
 * an MP4 (WebM where MP4 can't be made).
 */

const W = 1920;
const H = 1080;
/** Cinema bars: the picture at 2.39 : 1. */
const BAR = Math.round((H - W / 2.39) / 2);
const END = 63;

/**
 * Each shot: when it starts (s), the light (leva "Dusk preview"), and how
 * it comes in: a glide of `glide` s from the shot before (they're near each
 * other), or a cross-dissolve (DISSOLVE s). `push`: the camera easing in
 * towards its subject (m/s).
 */
interface Beat {
  at: number;
  shot: Shot;
  dusk: number;
  glide?: number;
  push?: number;
  /** The shot's own movement, slower (< 1) or faster. */
  pace?: number;
  enter?: Slide["enter"];
  /** Characters (the goat, Temesgen) left out of the shot. */
  noCharacters?: boolean;
}
/** Everything but the characters. */
const NO_CHARACTERS = (Object.keys(ALL_LAYERS) as SceneLayer[]).filter((l) => l !== "characters");
const BEATS: Beat[] = [
  // I. The legend
  { at: 0, shot: "sky", dusk: 0.25 },
  { at: 9, shot: "berries", dusk: 0.28, push: 0.06, noCharacters: true },
  // II. The maze
  { at: 14, shot: "aerial", dusk: 0.32, push: 0.35 },
  { at: 19, shot: "corridor", dusk: 0.36 },
  // (In the corridor, turning slowly on the spot, listening: she bleats.)
  { at: 23, shot: "listen", dusk: 0.42, glide: 2.2, pace: 0.45 },
  // III. The heart
  { at: 34, shot: "temesgen", dusk: 0.52, push: 0.06 },
  { at: 40, shot: "lantern", dusk: 0.6, glide: 3, push: 0.05 },
  { at: 44, shot: "goatHero", dusk: 0.66, push: 0.04, enter: "reveal" },
  // IV. The title: the maple at dusk, then rising out of the clearing over the maze (a crane).
  { at: 50, shot: "silhouette", dusk: 0.8, push: 0.1 },
  { at: 53, shot: "orbit", dusk: 0.9, glide: 4.5 },
];
/** A cross-dissolve's length (s). */
const DISSOLVE = 1.3;

/** The story, in a few short lines (s on screen). `label`: small gold capitals. */
const CAPTIONS: { from: number; to: number; text: string; label?: boolean }[] = [
  { from: 0.8, to: 3.6, text: "GUGUT STUDIOS PRESENTS", label: true },
  { from: 4.8, to: 8.6, text: "In Ethiopia, they say coffee was found by a goat." },
  { from: 9.8, to: 13.4, text: "Today, Gugut’s goat found the berries." },
  { from: 14.8, to: 18.4, text: "…and ran into the maze." },
  { from: 24.6, to: 27.8, text: "Listen." },
  { from: 29.4, to: 33.4, text: "Find her before the sun goes down." },
  { from: 35, to: 39.2, text: "Rest where the krar plays." },
  { from: 46.4, to: 49.4, text: "There she is." },
];
/** Her bleat (s), as "Listen." comes up, the music dipping well under it. */
const BLEAT = { at: 25.4, dip: [24.6, 28.4] as const };
const END_CARD = { from: 55.5, to: END - 1.2 };
/** Without a chosen file: Temesgen's krar, from where the game starts it. */
const DEFAULT_MUSIC = { src: `/audio/${encodeURIComponent("Yibellahalla kirar.webm")}`, from: 30, name: "Temesgen — Yibellahalla (krar)" };
const MUSIC_FADE_OUT = 3;

const SLIDES: Slide[] = BEATS.map((b) => ({
  shot: b.shot,
  title: "",
  lines: [],
  post: true,
  // (A dissolve cuts the camera; the picture blends the shots: see the frame tap.)
  cut: !b.glide,
  glide: b.glide,
  push: b.push,
  pace: b.pace,
  enter: b.enter,
  layers: b.noCharacters ? NO_CHARACTERS : undefined,
  set: [["duskPreview", b.dusk]],
}));

const beatAt = (t: number) => {
  let i = 0;
  while (i + 1 < BEATS.length && BEATS[i + 1].at <= t) i++;
  return i;
};
/** The light at `t`: sinking steadily from each beat's to the next one's. */
const duskAt = (t: number) => {
  const i = beatAt(t);
  const a = BEATS[i];
  const b = BEATS[i + 1];
  if (!b) return a.dusk;
  return a.dusk + (b.dusk - a.dusk) * Math.min(1, (t - a.at) / (b.at - a.at));
};
/** 0 → 1 → 0 over [from, to], with `fade` s at each end. */
const fadeIn = (t: number, from: number, to: number, fade = 0.7) =>
  Math.max(0, Math.min(1, (t - from) / fade, (to - t) / fade));

function setDusk(value: number) {
  const path = Object.keys(levaStore.getData()).find((k) => k === "duskPreview" || k.endsWith(".duskPreview"));
  if (path) levaStore.setValueAtPath(path, value, false);
}

/** "1:23" or "83" → 83 (s); null if it isn't a time. */
function parseTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
}

/** The best format this browser can record: MP4 (H.264 High + AAC) for X, else WebM. */
function recordingType(): string {
  const types = [
    "video/mp4;codecs=avc1.64002A,mp4a.40.2",
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}

type Phase = "idle" | "playing" | "recording" | "saving" | "done";

/**
 * How sharp: the scene rendered at this many times the screen's pixels and
 * scaled down to 1080p (supersampling: cleaner edges, no shimmering grass).
 * Higher asks more of the GPU; the recording is real time, so pick one that
 * stays smooth.
 */
const QUALITIES = [
  { name: "Standard", scale: 1 },
  { name: "Sharp", scale: 1.5 },
  { name: "Max", scale: 2 },
] as const;
const VIDEO_BITRATE = 40_000_000;
const AUDIO_BITRATE = 256_000;
type Music = NonNullable<ReturnType<typeof audio.playMusic>>;

export default function TrailerClient() {
  const loaded = useLoading().stage === "ready";
  const [phase, setPhase] = useState<Phase>("idle");
  const [savedAs, setSavedAs] = useState("");
  // The music: a file from this computer (an object URL), and where in it to start.
  const [music, setMusic] = useState<{ src: string; name: string } | null>(null);
  const [startText, setStartText] = useState("0:00");
  const [qualityIndex, setQualityIndex] = useState(1);
  // The pixel ratio that renders the screen at the chosen multiple of 1080p (after mount: it reads the window).
  const [dpr, setDpr] = useState<number | undefined>(undefined);
  useEffect(() => {
    const fit = () => setDpr(Math.min(3, (QUALITIES[qualityIndex].scale * H) / Math.max(1, window.innerHeight)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [qualityIndex]);
  const screen = useRef<HTMLCanvasElement>(null);
  const run = useRef({
    startAt: 0,
    slide: -1,
    bled: false,
    dipped: 0,
    dusk: -1,
    music: null as Music | null,
    musicFading: false,
    /** The cross-dissolve under way: when it started (s), or -1. */
    dissolveAt: -1,
  });
  const recorder = useRef<MediaRecorder | null>(null);
  const logo = useMemo(() => {
    if (typeof window === "undefined") return null;
    const img = new Image();
    img.src = "/logo gugut.svg";
    return img;
  }, []);

  // Every frame the scene draws: the timeline moves on, and the picture is composited.
  useEffect(() => {
    const out = screen.current;
    const ctx = out?.getContext("2d");
    // The scene's last frame (for the dissolves), and the shot being dissolved from.
    const shot = document.createElement("canvas");
    const before = document.createElement("canvas");
    shot.width = before.width = W;
    shot.height = before.height = H;
    const shotCtx = shot.getContext("2d");
    const beforeCtx = before.getContext("2d");
    if (!out || !ctx || !shotCtx || !beforeCtx) return;
    // (Scaling the supersampled scene down: the smooth way.)
    shotCtx.imageSmoothingQuality = "high";
    ctx.imageSmoothingQuality = "high";
    const face = trailerFont.style.fontFamily;
    void document.fonts.load(`300 54px ${face}`, "Find her");
    void document.fonts.load(`500 28px ${face}`, "GUGUT");

    tapFrames((scene) => {
      const r = run.current;
      const playing = r.startAt > 0;
      const t = playing ? (performance.now() - r.startAt) / 1000 : 0;

      // The scene, filling the 16:9 picture. (Still the old shot, the frame a beat changes.)
      const s = Math.max(W / scene.width, H / scene.height);
      const sw = W / s;
      const sh = H / s;
      shotCtx.drawImage(scene, (scene.width - sw) / 2, (scene.height - sh) / 2, sw, sh, 0, 0, W, H);

      if (playing) {
        // The shot, the light, her bleat (the music dipping under it).
        const i = beatAt(t);
        if (i !== r.slide) {
          // A dissolve: this last frame of the old shot is held, and faded out over the new one.
          if (r.slide >= 0 && !BEATS[i].glide) {
            beforeCtx.drawImage(shot, 0, 0);
            r.dissolveAt = t;
          }
          r.slide = i;
          presentStore.goTo(i);
        }
        const d = duskAt(t);
        if (Math.abs(d - r.dusk) > 0.004) {
          r.dusk = d;
          setDusk(d);
        }
        if (r.dipped === 0 && t >= BLEAT.dip[0]) {
          r.dipped = 1;
          r.music?.level(0.18, 0.5);
        }
        if (!r.bled && t >= BLEAT.at) {
          r.bled = true;
          // From her side (it pans), but heard clearly: placed 6 m off in her direction, not through the walls.
          const [gx, gz] = goat.position();
          const dx = gx - presentLive.camX;
          const dz = gz - presentLive.camZ;
          const len = Math.hypot(dx, dz) || 1;
          audio.goatBleat(presentLive.camX + (dx / len) * 6, 0.8, presentLive.camZ + (dz / len) * 6, 6, false);
        }
        if (r.dipped === 1 && t >= BLEAT.dip[1]) {
          r.dipped = 2;
          r.music?.level(1, 1.2);
        }
        if (!r.musicFading && t >= END - MUSIC_FADE_OUT) {
          r.musicFading = true;
          r.music?.stop(MUSIC_FADE_OUT);
        }
        if (t >= END) {
          r.startAt = 0;
          if (recorder.current?.state === "recording") {
            recorder.current.stop();
            setPhase("saving");
          } else setPhase("done");
        }
      }

      ctx.drawImage(shot, 0, 0);
      // The old shot over it, fading (and still drifting in a little, so it doesn't freeze).
      const dd = r.dissolveAt >= 0 ? (t - r.dissolveAt) / DISSOLVE : 1;
      if (playing && dd < 1) {
        const a = 0.5 + Math.cos(Math.PI * dd) / 2;
        const z = 1 + 0.025 * dd;
        ctx.globalAlpha = a;
        ctx.drawImage(before, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
        ctx.globalAlpha = 1;
      } else r.dissolveAt = -1;

      // The end card's darkening, then black at the very start and end.
      const card = playing ? fadeIn(t, END_CARD.from, END_CARD.to, 1.2) : 0;
      if (card > 0) {
        ctx.fillStyle = `rgba(8, 7, 4, ${0.55 * card})`;
        ctx.fillRect(0, 0, W, H);
      }
      const black = !playing ? 0 : t < 4 ? 1 : t < 5.4 ? 1 - (t - 4) / 1.4 : t > END - 1.6 ? Math.min(1, (t - (END - 1.6)) / 1.4) : 0;
      if (black > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${black})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Cinema bars.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, BAR);
      ctx.fillRect(0, H - BAR, W, BAR);

      if (!playing) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = (text: string, y: number, size = 26) => {
        ctx.font = `500 ${size}px ${face}`;
        ctx.letterSpacing = `${Math.round(size * 0.36)}px`;
        ctx.fillStyle = "#c9a45c";
        ctx.fillText(text, W / 2, y);
        ctx.letterSpacing = "0px";
      };

      // The story.
      for (const c of CAPTIONS) {
        const a = fadeIn(t, c.from, c.to, 0.8);
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
        ctx.shadowBlur = 20;
        if (c.label) label(c.text, H / 2, 28);
        else {
          ctx.font = `300 54px ${face}`;
          ctx.letterSpacing = "1px";
          ctx.fillStyle = "#fdf3d4";
          // (Rising a touch as it comes in.)
          ctx.fillText(c.text, W / 2, H - BAR - 92 + (1 - a) * 10);
          ctx.letterSpacing = "0px";
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // The end card: the logo, the line, what it is, the win, where to play.
      if (card > 0) {
        ctx.globalAlpha = card;
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 24;
        if (logo?.complete) {
          const lw = 480;
          const lh = (lw * 210) / 317;
          ctx.drawImage(logo, W / 2 - lw / 2, 196, lw, lh);
        }
        ctx.font = `300 50px ${face}`;
        ctx.fillStyle = "#fdf3d4";
        ctx.fillText("Find her before sundown.", W / 2, 560);
        ctx.font = `300 30px ${face}`;
        ctx.fillStyle = "rgba(253, 243, 212, 0.75)";
        ctx.fillText("A free 3D game from Ethiopia", W / 2, 620);
        label("WINNER · STARK HACKATHON", 676, 22);
        ctx.shadowBlur = 0;
        // Where to play, on a gold pill.
        ctx.font = `500 38px ${face}`;
        const where = "goat.gugut.studio";
        const pw = ctx.measureText(where).width + 88;
        ctx.fillStyle = "#c9a45c";
        ctx.beginPath();
        ctx.roundRect(W / 2 - pw / 2, 728, pw, 74, 37);
        ctx.fill();
        ctx.fillStyle = "#2a2312";
        ctx.fillText(where, W / 2, 766);
        ctx.globalAlpha = 1;
      }
    });
    return () => tapFrames(null);
  }, [logo]);

  // Leaving: the music stops, a recording is dropped.
  useEffect(
    () => () => {
      run.current.music?.stop(0.2);
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    []
  );

  const start = (record: boolean) => {
    audio.unlock();
    // The birds and the wind under the music (they follow the music switch).
    if (!audio.isMusicOn()) audio.setMusic(true);
    const r = run.current;
    r.music?.stop(0.2);
    Object.assign(r, { slide: -1, bled: false, dipped: 0, dusk: -1, musicFading: false, dissolveAt: -1 });
    const src = music?.src ?? DEFAULT_MUSIC.src;
    const from = music ? (parseTime(startText) ?? 0) : DEFAULT_MUSIC.from;
    // (A beat for the audio to wake, then from the top.)
    window.setTimeout(() => {
      presentStore.goTo(0);
      r.music = audio.playMusic(src, from, 0.85, 2.5);
      if (record && screen.current) {
        const stream = screen.current.captureStream(60);
        audio.captureStream()?.getAudioTracks().forEach((track) => stream.addTrack(track));
        const type = recordingType();
        const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => {
          const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
          const url = URL.createObjectURL(new Blob(chunks, { type: type.split(";")[0] }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `gugut-and-the-goat-trailer.${ext}`;
          a.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
          setSavedAs(ext);
          setPhase("done");
        };
        rec.start(1000);
        recorder.current = rec;
      }
      r.startAt = performance.now();
      setPhase(record ? "recording" : "playing");
    }, 300);
  };

  const busy = phase === "playing" || phase === "recording" || phase === "saving";
  const startValid = !music || parseTime(startText) !== null;
  return (
    <div className="relative h-full w-full bg-black">
      <PresentClient slides={SLIDES} trailer dpr={dpr} />
      {/* What's recorded is what's shown. */}
      <canvas ref={screen} width={W} height={H} className="pointer-events-none absolute inset-0 z-30 h-full w-full object-contain" />

      {loaded && !busy && (
        <div className="absolute inset-x-0 bottom-6 z-40 flex flex-col items-center gap-3 text-[#fdf3d4]">
          {/* The music: from this computer only (never uploaded), or Temesgen's. */}
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-black/70 px-4 py-2.5 text-sm">
            <label className="cursor-pointer rounded-full border border-[#fdf3d4]/30 px-3 py-1.5 hover:bg-white/10">
              Choose music file
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (music) URL.revokeObjectURL(music.src);
                  setMusic({ src: URL.createObjectURL(file), name: file.name });
                }}
              />
            </label>
            <span className="max-w-[18rem] truncate text-[#fdf3d4]/70">{music?.name ?? DEFAULT_MUSIC.name}</span>
            {music && (
              <label className="flex items-center gap-2">
                <span className="text-[#fdf3d4]/60">Start at</span>
                <input
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  placeholder="1:05"
                  className={`w-16 rounded-md bg-[#111] px-2 py-1 text-center ${startValid ? "" : "outline outline-red-400"}`}
                />
              </label>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/70 p-1 text-sm">
            <span className="px-3 text-[#fdf3d4]/60">Quality</span>
            {QUALITIES.map((q, i) => (
              <button
                key={q.name}
                type="button"
                onClick={() => setQualityIndex(i)}
                className={`rounded-full px-3 py-1.5 ${i === qualityIndex ? "bg-[#c9a45c] text-[#2a2312]" : "hover:bg-white/10"}`}
              >
                {q.name}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" disabled={!startValid} onClick={() => start(false)} className="rounded-full bg-[#fdf3d4] px-6 py-3 font-semibold text-[#2a2312] disabled:opacity-40">
              ▶ Play
            </button>
            <button type="button" disabled={!startValid} onClick={() => start(true)} className="rounded-full bg-[#c9a45c] px-6 py-3 font-semibold text-[#2a2312] disabled:opacity-40">
              ● Record ({END}s)
            </button>
          </div>
          <p className="max-w-xl text-center text-sm text-[#fdf3d4]/60">
            {phase === "done" && savedAs
              ? `Saved as gugut-and-the-goat-trailer.${savedAs} in your downloads.`
              : "Fullscreen first (F11). Watch it once with ▶ Play: if it stutters, pick a lower quality (it records in real time)."}
          </p>
        </div>
      )}
      {phase === "recording" && (
        <div className="absolute top-3 right-3 z-40 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-red-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC
        </div>
      )}
      {phase === "saving" && (
        <div className="absolute inset-x-0 bottom-8 z-40 text-center text-sm text-[#fdf3d4]/70">Saving the video…</div>
      )}
    </div>
  );
}
