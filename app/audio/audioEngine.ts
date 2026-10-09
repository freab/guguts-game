import { DefaultLoadingManager } from "three/webgpu";
import { gustAt, windNow } from "../scene/wind";

/**
 * The game's sound, on one Web Audio graph:
 *
 *   ambience ─ birds ┐                                 ┐
 *             wind ──┴─ ambience bus (music switch) ───┤
 *   footsteps ─ dry ─────────── footstep bus ──────────┤
 *              └─ wet ─ short "maze walls" reverb ─────┼─ master ─ compressor ─ out
 *   calls ─ Gugut's whistle, the goat's bleat ─ calls bus ┤
 *              └─ wet ─ long "across the maze" reverb ─┘
 *
 * - Ambience: evening birdsong and wind recordings (public/audio), decoded to
 *   buffers and looped gaplessly on the audio clock, each loudness-matched
 *   (measured RMS) before mixing. The wind breathes: slow gusts in level and
 *   brightness (a moving low-pass) and a drift across the stereo field; the
 *   birds wander gently. The footsteps sit just under it.
 * - Footsteps on grass: real recorded steps (public/audio/footsteps.webm, cut
 *   by scripts/build-audio.mjs) — slow steps walking, quick ones running —
 *   never the same one twice in a row, each slightly re-pitched, alternating
 *   left/right, with a touch of short reverb off the maze walls. Until they
 *   load, steps are synthesised (filtered noise: swish, thud, rustle).
 * - Calling the goat (goatCall): Gugut's two-note shepherd's whistle
 *   (synthesised), then — after she has heard it and the sound has crossed the
 *   maze — her bleat (real recordings, public/audio/bleats.webm) from where
 *   she really is: HRTF-panned around the listener (the camera, setListener),
 *   quieter and wetter with distance, muffled when walls stand between. With
 *   no voice left, a dry, breathy rasp instead (dryCall).
 * - Drinking a bottle he finds (drink): a glass clink as he picks it up
 *   (synthesised), then the cork, the gulps and a breath after (a real
 *   recording, public/audio/drink.webm), on the calls bus.
 * - Gugut's voice (say): his voiceovers (public/audio/voice.webm, packed by
 *   scripts/build-audio.mjs, triggered by game/Monologue), centred and dry on
 *   their own bus — one line at a time, the ambience and the song dipping
 *   under it. Only when the player chose voiceovers (setVoice). With them on,
 *   a call is Gugut shouting for her instead of the whistle.
 * - Temesgen's songs (playSong): his recordings in public/audio (the main
 *   one preloaded, the others streamed), played when he's asked, HRTF-panned from where he sits
 *   straight into the master. Its level is set from outside (setSongLevel):
 *   full beside him, fading to silence across the clearing, muffled when walls
 *   stand between.
 * - A gentle compressor on the master glues the mix and prevents clipping.
 *
 * The ambience plays only while the game is running (after the preloader) and
 * the music switch is on; it fades in and out. Browsers allow audio only after
 * a user gesture, so the graph is created by `unlock()` from one; nothing
 * touches the browser before that, so this module is safe on the server.
 */

const MUSIC_KEY = "gugut.music";

/** Ambience tracks, with the RMS they were measured at (dBFS) for loudness matching. */
const TRACKS = [
  { src: "/audio/birds.webm", rmsDb: -28.8, trim: 0 },
  { src: "/audio/wind.webm", rmsDb: -20.1, trim: -2 },
];
/** Level both tracks are matched to before the bus (dBFS RMS). */
const TRACK_TARGET_DB = -24;
/**
 * Bus levels (dB). The footsteps sit under the birds and wind (≈ -36 dBFS
 * together): a step is ≈ -39 dBFS while it sounds, audible but in the
 * background. The reverb send moves with the footsteps, so the echo off the
 * walls stays in proportion to the step.
 */
const AMBIENCE_DB = -13;
const FOOTSTEPS_DB = -18;
const REVERB_SEND_DB = -32;
const FADE_IN = 4;
/** Recorded footsteps: the sprite, and where each step is in it ([start, duration] s). */
const FOOTSTEPS_SRC = "/audio/footsteps.webm";
const FOOTSTEPS_INDEX = "/audio/footsteps.json";
/** Level of a recorded step (they are cut at about -3 dBFS peak). */
const STEP_GAIN = 0.8;
/** Above this intensity the running steps are used. */
const RUN_INTENSITY = 0.75;
const FADE_OUT = 1.2;
/** The goat's bleats: the sprite, and where each is in it ([start, duration] s). */
const BLEATS_SRC = "/audio/bleats.webm";
const BLEATS_INDEX = "/audio/bleats.json";
/** The calls bus (Gugut's whistle and the goat's answer): over the ambience. */
const CALLS_DB = -5;
/**
 * The bleat's distance roll-off (Web Audio "inverse" model): full level
 * within BLEAT_NEAR m, about -15 dB across the maze.
 */
const BLEAT_NEAR = 4;
const BLEAT_ROLLOFF = 0.7;
/** How long the goat takes to answer once she hears the call (s, random in range). */
const BLEAT_REACTION: [number, number] = [0.25, 0.6];
const SPEED_OF_SOUND = 343;
/** Gugut drinking: the sprite, and where the cork / gulps / breath are in it ([start, duration] s). */
const DRINK_SRC = "/audio/drink.webm";
const DRINK_INDEX = "/audio/drink.json";
/** When each part of the drink plays, from the pickup (s). */
const DRINK_TIMES = { open: 0.15, gulps: 0.75, breath: 3.35 };
/**
 * Temesgen's songs, in the order he plays them (ui/TemesgenDialog):
 * "Yibellahalla", his main one (preloaded); then, asked for a different song,
 * "Nostalgia", then "Don't do that to me" (streamed when first played).
 */
export type SongTrack = "main" | "nostalgia" | "dont";
export const SONG_ORDER: SongTrack[] = ["main", "nostalgia", "dont"];
const SONG_SRCS: Record<SongTrack, string> = {
  // (Its vocals only: separated from the full mix, which stays alongside.)
  main: `/audio/${encodeURIComponent("Yibellahalla vocals.webm")}`,
  nostalgia: `/audio/${encodeURIComponent("Nostalgia  Learn To Play Krar with Temesgen - temesgen.com.mp3")}`,
  dont: `/audio/${encodeURIComponent("dont do that to me.webm")}`,
};
const SONG_SRC = SONG_SRCS.main;
/** Where each song starts when he plays it (s): the main one skips its intro. */
const SONG_START: Record<SongTrack, number> = { main: 30, nostalgia: 0, dont: 0 };
/** The song right beside him (dB), before setSongLevel's 0..1. */
const SONG_DB = -6;
/** Its echo off the maze walls, relative to the reverb send. */
const SONG_REVERB = 0.5;
/** How far the song dips (gain) while the goat's bleat comes through it. */
const SONG_DUCK = 0.3;
/** Gugut's voiceovers: the sprite, and where each take of each line is in it ([start, duration] s). */
const VOICE_SRC = "/audio/voice.webm";
const VOICE_INDEX = "/audio/voice.json";
/** The voice bus (dB): over the ambience, which dips by VOICE_DUCK (gain) while he speaks. */
const VOICE_DB = -3;
const VOICE_DUCK = 0.5;

/** What Gugut says, by when (game/Monologue): each has a few takes. */
export type VoiceLine = "call" | "murmur" | "parched" | "temesgen" | "hum" | "found" | "congrats";

const dbToGain = (db: number) => Math.pow(10, db / 20);

interface Track {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  level: number;
}

type Listener = () => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private ambience: GainNode | null = null;
  private footsteps: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private tracks: Track[] = [];
  private noise: AudioBuffer | null = null;
  private steps: { buffer: AudioBuffer; walk: [number, number][]; run: [number, number][] } | null = null;
  private lastStep = -1;
  private drift: ReturnType<typeof setInterval> | null = null;
  private foot = 1;
  private calls: GainNode | null = null;
  private farSend: GainNode | null = null;
  private bleats: { buffer: AudioBuffer; index: [number, number][] } | null = null;
  private lastBleat = -1;
  private drinkSounds: { buffer: AudioBuffer; index: Record<"open" | "gulps" | "breath", [number, number]> } | null = null;
  private master: GainNode | null = null;
  /** Between the ambience bus and the master: dips while Gugut speaks. */
  private ambienceDuck: GainNode | null = null;
  private voice: GainNode | null = null;
  private voiceLines: { buffer: AudioBuffer; index: Record<VoiceLine, [number, number][]> } | null = null;
  private voiceLoad: Promise<void> | null = null;
  private voiceOn = false;
  /** ctx time when the line being spoken ends. */
  private voiceUntil = 0;
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceLine: VoiceLine | null = null;
  private readonly lastTake = new Map<VoiceLine, number>();
  private song: {
    element: HTMLAudioElement;
    gain: GainNode;
    envelope: GainNode;
    duck: GainNode;
    muffle: BiquadFilterNode;
    panner: PannerNode;
    analyser: AnalyserNode;
    samples: Float32Array<ArrayBuffer>;
  } | null = null;
  private songEnded: (() => void) | null = null;
  private songStop: ReturnType<typeof setTimeout> | null = null;
  /** The song downloaded whole during the preloader (preloadSong), as a blob URL. */
  private songUrl: string | null = null;
  /** Which of his songs the player is loaded with. */
  private songTrack: SongTrack = "main";
  private songDownload: Promise<void> | null = null;

  private musicOn = true;
  private loadedPreference = false;
  /** The game is running (preloader gone): the ambience may play. */
  private active = false;
  private readonly listeners = new Set<Listener>();

  /* ---------- state ---------- */

  /** Is the music (ambience) switched on? Remembered across visits. */
  isMusicOn(): boolean {
    if (!this.loadedPreference && typeof window !== "undefined") {
      this.loadedPreference = true;
      try {
        this.musicOn = window.localStorage.getItem(MUSIC_KEY) !== "off";
      } catch {
        // Storage blocked: keep the default (on).
      }
    }
    return this.musicOn;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getMusicSnapshot = () => this.isMusicOn();
  getServerMusicSnapshot = () => true;

  /** Switch the music on or off (call from the switch — a user gesture). */
  setMusic(on: boolean) {
    this.isMusicOn();
    this.musicOn = on;
    try {
      window.localStorage.setItem(MUSIC_KEY, on ? "on" : "off");
    } catch {
      // Storage blocked: the choice just won't be remembered.
    }
    this.unlock();
    this.applyAmbience();
    this.listeners.forEach((l) => l());
  }

  toggleMusic() {
    this.setMusic(!this.isMusicOn());
  }

  /** The game started (true) or ended (false): the ambience follows. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.applyAmbience();
    if (!active) this.stopSong();
  }

  /* ---------- graph ---------- */

  /** Create / resume the audio graph. Must first be called from a user gesture. */
  unlock() {
    if (typeof window === "undefined") return;
    if (this.ctx) {
      if (this.ctx.state === "suspended" && document.visibilityState === "visible") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(compressor).connect(ctx.destination);
    this.master = master;

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    this.ambienceDuck = ctx.createGain();
    this.ambience.connect(this.ambienceDuck).connect(master);

    this.voice = ctx.createGain();
    this.voice.gain.value = dbToGain(VOICE_DB);
    this.voice.connect(master);

    this.footsteps = ctx.createGain();
    this.footsteps.gain.value = dbToGain(FOOTSTEPS_DB);
    this.footsteps.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.wallsImpulse(ctx);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = dbToGain(REVERB_SEND_DB);
    this.reverbSend.connect(reverb).connect(master);

    this.calls = ctx.createGain();
    this.calls.gain.value = dbToGain(CALLS_DB);
    this.calls.connect(master);
    const far = ctx.createConvolver();
    far.buffer = this.distanceImpulse(ctx);
    this.farSend = ctx.createGain();
    this.farSend.connect(far).connect(master);

    // One second of white noise, reused by every footstep.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    void this.loadTracks(ctx);
    void this.loadSteps(ctx);
    void this.loadBleats(ctx);
    void this.loadDrink(ctx);
    if (this.voiceOn) void this.loadVoice(ctx);

    // A hidden tab goes quiet (and stops using the audio thread).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void ctx.suspend();
      else void ctx.resume();
    });
  }

  /** Decode the ambience and start it looping (silently — the bus decides). */
  private async loadTracks(ctx: AudioContext) {
    const buffers = await Promise.all(
      TRACKS.map(async (t) => ctx.decodeAudioData(await (await fetch(t.src)).arrayBuffer()))
    );
    const bus = this.ambience!;
    buffers.forEach((buffer, i) => {
      const t = TRACKS[i];
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 18000;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      const level = dbToGain(TRACK_TARGET_DB - t.rmsDb + t.trim);
      gain.gain.value = level;
      const pan = ctx.createStereoPanner();
      source.connect(filter).connect(gain).connect(pan).connect(bus);
      // Offset the loops so their seams never line up.
      source.start(0, buffer.duration * (0.15 + 0.45 * i));
      this.tracks.push({ source, gain, filter, pan, level });
    });
    this.startDrift();
    this.applyAmbience();
  }

  /** Decode the recorded footsteps (the synthesised ones stand in until then). */
  private async loadSteps(ctx: AudioContext) {
    try {
      const [buffer, index] = await Promise.all([
        fetch(FOOTSTEPS_SRC)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b)),
        fetch(FOOTSTEPS_INDEX).then((r) => r.json() as Promise<{ walk: [number, number][]; run: [number, number][] }>),
      ]);
      this.steps = { buffer, walk: index.walk, run: index.run };
    } catch {
      // Keep the synthesised steps.
    }
  }

  /** Decode the goat's bleats. */
  private async loadBleats(ctx: AudioContext) {
    try {
      const [buffer, index] = await Promise.all([
        fetch(BLEATS_SRC)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b)),
        fetch(BLEATS_INDEX).then((r) => r.json() as Promise<[number, number][]>),
      ]);
      this.bleats = { buffer, index };
    } catch {
      // No answer then — the call's map still shows where she is.
    }
  }

  /** Decode the drinking sounds. */
  private async loadDrink(ctx: AudioContext) {
    try {
      const [buffer, index] = await Promise.all([
        fetch(DRINK_SRC)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b)),
        fetch(DRINK_INDEX).then((r) => r.json() as Promise<Record<"open" | "gulps" | "breath", [number, number]>>),
      ]);
      this.drinkSounds = { buffer, index };
    } catch {
      // Just the clink then.
    }
  }

  /** Decode Gugut's voiceovers (once, and only if they're wanted). */
  private loadVoice(ctx: AudioContext): Promise<void> {
    this.voiceLoad ??= (async () => {
      try {
        const [buffer, index] = await Promise.all([
          fetch(VOICE_SRC)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b)),
          fetch(VOICE_INDEX).then((r) => r.json() as Promise<Record<VoiceLine, [number, number][]>>),
        ]);
        this.voiceLines = { buffer, index };
      } catch {
        // No voice then: the game plays as it does with voiceovers off.
      }
    })();
    return this.voiceLoad;
  }

  /** Fade the ambience bus to where the switch and the game say it should be. */
  private applyAmbience() {
    const ctx = this.ctx;
    const bus = this.ambience;
    if (!ctx || !bus) return;
    const on = this.active && this.isMusicOn();
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(on ? dbToGain(AMBIENCE_DB) : 0, now + (on ? FADE_IN : FADE_OUT));
  }

  /** Slow, organic movement in the ambience: wind gusts and drift, birds wandering. */
  private startDrift() {
    if (this.drift) return;
    const t0 = performance.now();
    this.drift = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== "running") return;
      const t = (performance.now() - t0) / 1000;
      const now = ctx.currentTime;
      const [birds, wind] = this.tracks;
      if (wind) {
        // Gusts: layered slow sines; stronger gusts are louder and brighter.
        // (The same gusts the grass, flowers and trees sway in: scene/wind.)
        const gust = gustAt(windNow());
        wind.gain.gain.setTargetAtTime(wind.level * (0.55 + 0.7 * gust), now, 1.5);
        wind.filter.frequency.setTargetAtTime(900 + 5200 * gust * gust, now, 1.5);
        wind.pan.pan.setTargetAtTime(0.4 * Math.sin(t * 0.083 + 0.7), now, 2.5);
      }
      if (birds) {
        birds.gain.gain.setTargetAtTime(birds.level * (0.8 + 0.2 * Math.sin(t * 0.11 + 2.1)), now, 2.5);
        birds.pan.pan.setTargetAtTime(0.25 * Math.sin(t * 0.061), now, 3);
      }
    }, 250);
  }

  /** A short, dark impulse — early reflections off close stone walls. */
  private wallsImpulse(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.45);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        lp += (Math.random() * 2 - 1 - lp) * 0.35; // darken the tail
        // A few discrete early reflections, then a quick diffuse decay.
        const early = [0.011, 0.019, 0.027, 0.041].some((e) => Math.abs(t - e - ch * 0.003) < 0.0006) ? 0.6 : 0;
        d[i] = (lp * Math.exp(-t * 11) + early * Math.exp(-t * 20)) * 0.5;
      }
    }
    return impulse;
  }

  /** A longer, darker tail — a sound carrying across the maze. */
  private distanceImpulse(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 1.6);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        lp += (Math.random() * 2 - 1 - lp) * 0.18;
        // A soft onset (the first reflections arrive late), then a slow decay.
        d[i] = lp * Math.min(1, t / 0.04) * Math.exp(-t * 3.2) * 0.6;
      }
    }
    return impulse;
  }

  /* ---------- calling the goat ---------- */

  /** Where the listener is (the camera) and which way it faces — for the goat's bleat. */
  setListener(x: number, y: number, z: number, forwardX: number, forwardY: number, forwardZ: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = forwardX;
      l.forwardY.value = forwardY;
      l.forwardZ.value = forwardZ;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(forwardX, forwardY, forwardZ, 0, 1, 0);
    }
  }

  /**
   * Gugut calls the goat — a two-note shepherd's whistle — and she answers
   * from (x, y, z): `distance` m away (sets how late, quiet and distant her
   * bleat sounds), `occluded` when walls stand between (muffled). Returns
   * how long (s) until she answers, or null when nothing can play.
   */
  goatCall(x: number, y: number, z: number, distance: number, occluded: boolean): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.calls || ctx.state !== "running") return null;
    // With voiceovers on, Gugut shouts for her; otherwise, his whistle.
    const whistle = this.say("call", { interrupt: true, far: true }) ?? this.whistle(ctx);
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const delay = whistle + distance / SPEED_OF_SOUND + rand(...BLEAT_REACTION);
    this.bleat(ctx, x, y, z, distance, occluded, delay);
    // Now and then she bleats twice.
    if (Math.random() < 0.35) this.bleat(ctx, x, y, z, distance, occluded, delay + rand(0.9, 1.4));
    return this.bleats ? delay : null;
  }

  /**
   * The goat bleats on her own (no call), from (x, y, z) — heard once Gugut
   * is calm (game/temesgen). Returns how long (s) until it's heard, or null
   * when nothing can play.
   */
  goatBleat(x: number, y: number, z: number, distance: number, occluded: boolean): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.calls || ctx.state !== "running" || !this.bleats) return null;
    const delay = 0.3 + distance / SPEED_OF_SOUND;
    this.bleat(ctx, x, y, z, distance, occluded, delay);
    return delay;
  }

  /**
   * A bleat right here, not from anywhere in the maze (the title screen's
   * Konami secret: the goat on the logo). Twice, the second a little higher.
   */
  bleatHere() {
    const ctx = this.ctx;
    if (!ctx || !this.calls || !this.bleats || ctx.state !== "running") return;
    const { buffer, index } = this.bleats;
    for (const [delay, rate] of [
      [0, 1],
      [0.55, 1.12],
    ]) {
      const [offset, duration] = index[Math.floor(Math.random() * index.length)];
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      src.connect(this.calls);
      src.start(ctx.currentTime + delay, offset, duration);
    }
  }

  /** Something wooden landing in the grass (the lantern secret): a soft thud and a rattle of glass. */
  thunk() {
    const ctx = this.ctx;
    if (!ctx || !this.calls || !this.noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const thud = ctx.createBufferSource();
    thud.buffer = this.noise;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 260;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.9, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    thud.connect(low).connect(env).connect(this.calls);
    thud.start(now);
    thud.stop(now + 0.3);
    for (const [freq, at] of [
      [3100, 0.03],
      [4300, 0.09],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.05, now + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.18);
      osc.connect(g).connect(this.calls);
      osc.start(now + at);
      osc.stop(now + at + 0.2);
    }
  }

  /** Gugut tries to call with no voice left: a dry, breathy rasp. */
  dryCall() {
    const ctx = this.ctx;
    if (!ctx || !this.calls || !this.noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(1300, now);
    band.frequency.linearRampToValueAtTime(800, now + 0.4);
    band.Q.value = 1.1;
    // A rough, catching rasp: the breath stutters.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.32, now + 0.04);
    env.gain.setTargetAtTime(0.16, now + 0.08, 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    const rough = ctx.createGain();
    rough.gain.value = 0.6;
    flutter.connect(depth).connect(rough.gain);
    src.connect(band).connect(env).connect(rough).connect(this.calls);
    src.start(now, Math.random() * 0.4);
    src.stop(now + 0.5);
    flutter.start(now);
    flutter.stop(now + 0.5);
  }

  /** The whistle, starting now; returns its length (s). */
  private whistle(ctx: AudioContext): number {
    const now = ctx.currentTime;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(this.calls!);
    if (this.reverbSend) out.connect(this.reverbSend);
    if (this.farSend) {
      const send = ctx.createGain();
      send.gain.value = 0.25;
      out.connect(send).connect(this.farSend);
    }
    // Two notes: a rising call, then a falling one — a little different each time.
    const pitch = rand(0.94, 1.06);
    const notes: [number, number, number, number][] = [
      // [start, length, from Hz, to Hz]
      [0, 0.26, 1650 * pitch, 2350 * pitch],
      [0.34, 0.38, 2300 * pitch, 1500 * pitch],
    ];
    for (const [at, length, from, to] of notes) {
      const t0 = now + at;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(to, t0 + length * 0.85);
      // A lip's waver.
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = rand(5, 7);
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 22;
      vibrato.connect(vibratoDepth).connect(osc.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(1, t0 + 0.035);
      env.gain.setValueAtTime(1, t0 + length - 0.07);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(env).connect(out);
      // The breath around the tone.
      if (this.noise) {
        const breath = ctx.createBufferSource();
        breath.buffer = this.noise;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = (from + to) / 2;
        band.Q.value = 2.5;
        const air = ctx.createGain();
        air.gain.value = 0.12;
        breath.connect(band).connect(air).connect(env);
        breath.start(t0, Math.random() * 0.5);
        breath.stop(t0 + length);
      }
      osc.start(t0);
      osc.stop(t0 + length);
      vibrato.start(t0);
      vibrato.stop(t0 + length);
    }
    return 0.72;
  }

  /** One bleat from (x, y, z), `delay` s from now (never the same one twice running). */
  private bleat(ctx: AudioContext, x: number, y: number, z: number, distance: number, occluded: boolean, delay: number) {
    if (!this.bleats || !this.calls || !this.farSend) return;
    const { buffer, index } = this.bleats;
    let pick = Math.floor(Math.random() * index.length);
    if (index.length > 1 && pick === this.lastBleat) pick = (pick + 1) % index.length;
    this.lastBleat = pick;
    const [offset, duration] = index[pick];
    const t0 = ctx.currentTime + delay;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    // Walls in the way muffle her; distance takes the top off too.
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = (occluded ? 2600 : 12000) / (1 + distance / 40);
    muffle.Q.value = 0.5;
    const panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: BLEAT_NEAR,
      rolloffFactor: BLEAT_ROLLOFF,
      maxDistance: 200,
      positionX: x,
      positionY: y,
      positionZ: z,
    });
    src.connect(muffle).connect(panner);
    panner.connect(this.calls);
    // The farther she is, the more of her you hear as echo off the maze.
    const wet = ctx.createGain();
    wet.gain.value = Math.min(0.9, 0.12 + distance / 45);
    panner.connect(wet).connect(this.farSend);
    src.start(t0, offset, duration);
  }

  /* ---------- the goat found ---------- */

  /**
   * A soft swell of music as Gugut sees the goat (and, bigger, as he reaches
   * her): a warm open chord on detuned triangle voices, its filter opening as
   * it rises, a high shimmer on top, then a long fade. With the music switch.
   */
  swell(size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running" || !this.isMusicOn()) return;
    const now = ctx.currentTime;
    const rise = 1.8 * size;
    const hold = 1.2 * size;
    const fade = 4.5;
    const end = now + rise + hold + fade;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.11 * size, now + rise);
    out.gain.setValueAtTime(0.11 * size, now + rise + hold);
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + rise);
    filter.frequency.exponentialRampToValueAtTime(900, end);
    filter.connect(out).connect(this.master);
    if (this.reverbSend) out.connect(this.reverbSend);
    // D, A, D, F♯, E: open and warm (an add9).
    for (const freq of [146.83, 220, 293.66, 369.99, 659.25]) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const voice = ctx.createGain();
        voice.gain.value = freq > 600 ? 0.12 : 0.22;
        osc.connect(voice).connect(filter);
        osc.start(now);
        osc.stop(end + 0.1);
      }
    }
    // A shimmer: two high sines, faint, entering late.
    for (const freq of [1174.66, 1760]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.025 * size, now + rise * 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(end + 0.1);
    }
  }

  /* ---------- Gugut's voice ---------- */

  /** Voiceovers on or off (the player's choice, on the title screen or in Settings). */
  setVoice(on: boolean) {
    this.voiceOn = on;
    if (!on) this.hush();
    else if (this.ctx) void this.loadVoice(this.ctx);
  }

  /** Is Gugut saying something right now? */
  isSpeaking(): boolean {
    return !!this.ctx && this.ctx.currentTime < this.voiceUntil;
  }

  /** What Gugut is saying right now, if anything. */
  speaking(): VoiceLine | null {
    return this.isSpeaking() ? this.voiceLine : null;
  }

  /**
   * Gugut says one of `line`'s takes (never the same one twice running).
   * Returns how long it lasts (s), or null when it can't play: voiceovers
   * off or not loaded yet, sound locked, or (unless `interrupt`) he's already
   * speaking. `far`: it carries across the maze (a shout). `duck`: the
   * ambience and the song dip under it.
   */
  say(line: VoiceLine, { interrupt = false, far = false, duck = true } = {}): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.voice || !this.voiceOn || !this.voiceLines || ctx.state !== "running") return null;
    if (!interrupt && this.isSpeaking()) return null;
    const takes = this.voiceLines.index[line];
    if (!takes?.length) return null;
    let pick = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && pick === this.lastTake.get(line)) pick = (pick + 1) % takes.length;
    this.lastTake.set(line, pick);
    const [offset, duration] = takes[pick];
    this.hush();
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.voiceLines.buffer;
    src.connect(this.voice);
    if (far && this.farSend) {
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      src.connect(wet).connect(this.farSend);
    }
    src.start(now, offset, duration);
    this.voiceSource = src;
    this.voiceLine = line;
    this.voiceUntil = now + duration;
    if (duck && this.ambienceDuck) {
      const g = this.ambienceDuck.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(VOICE_DUCK, now, 0.12);
      g.setTargetAtTime(1, now + duration, 0.5);
      this.duckSong(duration);
    }
    return duration;
  }

  /** Stop whatever Gugut is saying. */
  hush() {
    const ctx = this.ctx;
    if (!ctx || !this.voiceSource) return;
    try {
      this.voiceSource.stop();
    } catch {
      // Already ended.
    }
    this.voiceSource = null;
    this.voiceUntil = 0;
    if (this.ambienceDuck) {
      const g = this.ambienceDuck.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(1, ctx.currentTime, 0.3);
    }
  }

  /* ---------- drinking ---------- */

  /**
   * Gugut picks up a bottle and drinks: a clink of glass now, then the cork,
   * the gulps and the breath after (DRINK_TIMES).
   */
  drink() {
    const ctx = this.ctx;
    if (!ctx || !this.calls || ctx.state !== "running") return;
    const now = ctx.currentTime;
    // The clink: two glassy partials, a quick ring.
    for (const [freq, level, decay] of [
      [2630, 0.16, 0.35],
      [4180, 0.08, 0.22],
      [6020, 0.04, 0.12],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * (0.97 + Math.random() * 0.06);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(level, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(env).connect(this.calls);
      if (this.reverbSend) env.connect(this.reverbSend);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }
    if (!this.drinkSounds) return;
    const { buffer, index } = this.drinkSounds;
    for (const part of ["open", "gulps", "breath"] as const) {
      const [offset, duration] = index[part];
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = part === "gulps" ? 0.9 : 0.6;
      src.connect(gain).connect(this.calls);
      src.start(now + DRINK_TIMES[part], offset, duration);
    }
  }

  /* ---------- Temesgen's song ---------- */

  /**
   * Downloads the song whole (once) during the preloader, so it starts the
   * instant Temesgen plays instead of buffering from the network. Counted by
   * three's loading manager, so the preloader's counter includes it. Never
   * rejects: if it fails, the song just streams as before.
   */
  preloadSong(): Promise<void> {
    if (!this.songDownload) {
      DefaultLoadingManager.itemStart(SONG_SRC);
      this.songDownload = fetch(SONG_SRC)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          this.songUrl = URL.createObjectURL(blob);
        })
        .catch((err) => {
          console.warn("[gugut] song preload failed, it will stream:", err);
        })
        .finally(() => DefaultLoadingManager.itemEnd(SONG_SRC));
    }
    return this.songDownload;
  }

  /** The song's player and its graph, made on first use (from preloadSong's copy, else streamed). */
  private ensureSong(track: SongTrack = "main") {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    // Another of his songs: the same player and graph, a new source.
    if (this.song && track !== this.songTrack) {
      this.songTrack = track;
      this.song.element.src = this.songSrc(track);
    }
    if (!this.song) {
      this.songTrack = track;
      const element = new Audio(this.songSrc(track));
      element.preload = "auto";
      const source = ctx.createMediaElementSource(element);
      const muffle = ctx.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = 16000;
      muffle.Q.value = 0.5;
      // Distance (setSongLevel), then a phrase's fade in / out, then a dip
      // while the goat's bleat comes through (duckSong).
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const envelope = ctx.createGain();
      const duck = ctx.createGain();
      // Direction only (HRTF): the level is setSongLevel's, so no roll-off here.
      const panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", rolloffFactor: 0 });
      source.connect(muffle).connect(gain).connect(envelope).connect(duck).connect(panner).connect(this.master);
      // Listened to as played (before distance), so Temesgen's hands can follow the music.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      if (this.reverbSend) {
        const wet = ctx.createGain();
        wet.gain.value = SONG_REVERB;
        panner.connect(wet).connect(this.reverbSend);
      }
      element.addEventListener("ended", () => this.songEnded?.());
      this.song = { element, gain, envelope, duck, muffle, panner, analyser, samples: new Float32Array(analyser.fftSize) };
    }
    if (this.songStop) clearTimeout(this.songStop);
    return this.song;
  }

  /** A song's source: the main one from preloadSong's copy when there is one. */
  private songSrc(track: SongTrack): string {
    return track === "main" ? (this.songUrl ?? SONG_SRC) : SONG_SRCS[track];
  }

  private placeSong(x: number, y: number, z: number) {
    const panner = this.song!.panner;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  }

  /**
   * Temesgen starts a song, from its start (SONG_START), at (x, y, z). It starts
   * silent: setSongLevel brings it up as the listener is near. `onEnded` is
   * called when it plays out. `track`: which of his songs.
   */
  playSong(x: number, y: number, z: number, onEnded: () => void, track: SongTrack = "main") {
    const song = this.ensureSong(track);
    if (!song || !this.ctx) return;
    this.placeSong(x, y, z);
    const now = this.ctx.currentTime;
    song.envelope.gain.cancelScheduledValues(now);
    song.envelope.gain.setTargetAtTime(1, now, 0.05);
    this.songEnded = onEnded;
    song.element.currentTime = SONG_START[track];
    void song.element.play().catch(() => {});
  }

  /**
   * A few bars of it — Temesgen idly playing as Gugut comes into the
   * clearing: from `offset` s for `length` s, fading in and out. `onEnded`
   * is called once it has faded.
   */
  playPhrase(x: number, y: number, z: number, offset: number, length: number, onEnded: () => void) {
    const song = this.ensureSong();
    if (!song || !this.ctx) return;
    this.placeSong(x, y, z);
    const now = this.ctx.currentTime;
    const env = song.envelope.gain;
    env.cancelScheduledValues(now);
    env.setValueAtTime(0, now);
    env.linearRampToValueAtTime(1, now + 0.8);
    env.setValueAtTime(1, now + length - 1.2);
    env.linearRampToValueAtTime(0, now + length);
    this.songEnded = onEnded;
    song.element.currentTime = offset;
    void song.element.play().catch(() => {});
    this.songStop = setTimeout(() => {
      song.element.pause();
      this.songEnded = null;
      onEnded();
    }, length * 1000 + 100);
  }

  /**
   * How loud the song is where the listener is (0 = silent … 1 = right beside
   * him) and whether walls stand between (muffled). Eased, so steps don't jump.
   */
  setSongLevel(level: number, occluded: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    const now = ctx.currentTime;
    this.song.gain.gain.setTargetAtTime(level * dbToGain(SONG_DB), now, 0.25);
    this.song.muffle.frequency.setTargetAtTime(occluded ? 1100 : 16000, now, 0.3);
  }

  /** Dip the song for `seconds` (the goat's bleat coming through it), then bring it back. */
  duckSong(seconds: number) {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    const now = ctx.currentTime;
    const duck = this.song.duck.gain;
    duck.cancelScheduledValues(now);
    duck.setTargetAtTime(SONG_DUCK, now, 0.15);
    duck.setTargetAtTime(1, now + seconds, 0.6);
  }

  /**
   * How loud the song is being played right now (RMS of the last few ms, as
   * recorded — not as heard from afar): 0 when it isn't playing. Drives
   * Temesgen's strumming and nodding (maze/Temesgen).
   */
  songEnergy(): number {
    if (!this.song || this.song.element.paused) return 0;
    const { analyser, samples } = this.song;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  /** He stops playing: the song fades out, then stops. */
  stopSong() {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    const { element, gain } = this.song;
    this.songEnded = null;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    if (this.songStop) clearTimeout(this.songStop);
    this.songStop = setTimeout(() => element.pause(), 1000);
  }

  /* ---------- footsteps ---------- */

  /**
   * One footstep on grass. `intensity` 0..1 (walking ≈ 0.45, running = 1)
   * scales loudness and brightness.
   */
  footstep(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.footsteps || !this.reverbSend || !this.noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    this.foot = -this.foot;

    const step = ctx.createGain();
    step.gain.value = 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.foot * rand(0.06, 0.16);
    step.connect(pan);
    pan.connect(this.footsteps);
    pan.connect(this.reverbSend);

    if (this.steps) {
      // A recorded step: walking or running set, never the last one again,
      // slightly re-pitched and levelled by how hard the foot lands.
      const set = intensity >= RUN_INTENSITY ? this.steps.run : this.steps.walk;
      let pick = Math.floor(Math.random() * set.length);
      if (set.length > 1 && pick === this.lastStep) pick = (pick + 1) % set.length;
      this.lastStep = pick;
      const [offset, duration] = set[pick];
      const src = ctx.createBufferSource();
      src.buffer = this.steps.buffer;
      const rate = rand(0.93, 1.07);
      src.playbackRate.value = rate;
      step.gain.value = STEP_GAIN * (0.75 + 0.25 * intensity) * rand(0.88, 1);
      src.connect(step);
      src.start(now, offset, duration);
      return;
    }

    /** A burst of the noise through a filter, with an attack/decay envelope. */
    const burst = (
      type: BiquadFilterType,
      frequency: number,
      q: number,
      peak: number,
      attack: number,
      decay: number,
      delay = 0
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = rand(0.85, 1.15);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const env = ctx.createGain();
      const t0 = now + delay;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      src.connect(filter).connect(env).connect(step);
      src.start(t0, rand(0, 0.5));
      src.stop(t0 + attack + decay + 0.05);
    };

    const level = 0.45 + 0.55 * intensity;
    const bright = 0.85 + 0.35 * intensity;
    // Blades swishing past the foot.
    burst("bandpass", rand(1800, 2900) * bright, 0.9, 0.34 * level, 0.012, rand(0.13, 0.19));
    // The foot landing: a soft, low thud.
    burst("lowpass", rand(260, 380), 0.7, 0.5 * level, 0.004, rand(0.06, 0.09));
    // A faint high rustle trailing off.
    burst("highpass", rand(3600, 5000) * bright, 0.5, 0.08 * level, 0.02, rand(0.2, 0.3), 0.018);
  }
}

export const audio = new AudioEngine();
