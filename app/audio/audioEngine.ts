/**
 * The game's sound, on one Web Audio graph:
 *
 *   ambience ─ birds ┐                                 ┐
 *             wind ──┴─ ambience bus (music switch) ───┤
 *   footsteps ─ dry ─────────── footstep bus ──────────┼─ master ─ compressor ─ out
 *              └─ wet ─ short "maze walls" reverb ─────┘
 *
 * - Ambience: evening birdsong and wind recordings (public/audio), decoded to
 *   buffers and looped gaplessly on the audio clock, each loudness-matched
 *   (measured RMS) before mixing. The wind breathes: slow gusts in level and
 *   brightness (a moving low-pass) and a drift across the stereo field; the
 *   birds wander gently. It sits well under the footsteps.
 * - Footsteps on grass: real recorded steps (public/audio/footsteps.webm, cut
 *   by scripts/build-audio.mjs) — slow steps walking, quick ones running —
 *   never the same one twice in a row, each slightly re-pitched, alternating
 *   left/right, with a touch of short reverb off the maze walls. Until they
 *   load, steps are synthesised (filtered noise: swish, thud, rustle).
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
/** Bus levels (dB): the ambience sits well under the footsteps. */
const AMBIENCE_DB = -13;
const FOOTSTEPS_DB = -3;
const REVERB_SEND_DB = -17;
const FADE_IN = 4;
/** Recorded footsteps: the sprite, and where each step is in it ([start, duration] s). */
const FOOTSTEPS_SRC = "/audio/footsteps.webm";
const FOOTSTEPS_INDEX = "/audio/footsteps.json";
/** Level of a recorded step (they are cut at about -3 dBFS peak). */
const STEP_GAIN = 0.8;
/** Above this intensity the running steps are used. */
const RUN_INTENSITY = 0.75;
const FADE_OUT = 1.2;

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

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    this.ambience.connect(master);

    this.footsteps = ctx.createGain();
    this.footsteps.gain.value = dbToGain(FOOTSTEPS_DB);
    this.footsteps.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.wallsImpulse(ctx);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = dbToGain(REVERB_SEND_DB);
    this.reverbSend.connect(reverb).connect(master);

    // One second of white noise, reused by every footstep.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    void this.loadTracks(ctx);
    void this.loadSteps(ctx);

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
        const gust = 0.5 + 0.5 * (0.6 * Math.sin(t * 0.19) + 0.4 * Math.sin(t * 0.53 + 1.3));
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
