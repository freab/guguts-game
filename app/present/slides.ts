import type { MixLayer, VoiceLine } from "../audio/audioEngine";
import type { SceneLayer, UvSurface } from "../scene/sceneLayers";
import type { CullingMode } from "./CullingMap";

/**
 * What a slide of the presentation (app/present, the deck in
 * present/buildSlides) can be. Each is a camera shot in
 * the live scene (present/Director), words over it, and optionally a live
 * readout, an x-ray toggle (X) or something that happens as it comes up.
 */

/** Where the camera is (present/Director shotPose). */
export type Shot =
  | "orbit"
  | "goat"
  | "corridor"
  | "top"
  | "walls"
  | "grass"
  | "lightmap"
  | "temesgen"
  | "temesgenWide"
  | "listen"
  | "intro"
  | "sky"
  | "tree"
  | "stone"
  | "soundStage"
  | "spin";

/** A live readout in the corner. */
export type Readout = "render" | "grass" | "energy" | "compass" | "renderer";

/** What X toggles: leva controls set to `off` and back, a part as wireframe, or the lightmap itself. */
export interface XRay {
  label: string;
  /** A leva path suffix (e.g. "Grass.occlusion"), and the value that switches the thing off. */
  controls?: [path: string, off: unknown][];
  /** X draws this part of the scene as wireframe. */
  wireframe?: SceneLayer;
  /** This part of the scene starts as wireframe; X makes it solid. */
  wireframeFirst?: SceneLayer;
  /** Lay the baked lightmap texture over the ground. */
  lightmap?: boolean;
  /** Colour Temesgen by the parts his vertex shader moves. */
  limbs?: boolean;
  /** Apply this surface's texture (a sweep across), replacing its UV grid. */
  applies?: UvSurface;
  /** What the colours mean, shown while X is on: [colour, label]. */
  legend?: [color: string, label: string][];
  /** What the badge says: normally, and with X on (default "ON" / "OFF"). */
  states?: [normal: string, xray: string];
}


/** One press within a slide: a layer of the mix (the sound slide), or a part of an idea (culling). */
export interface Step {
  label: string;
  caption: string;
  /** The layers of the mix heard at this step. */
  mix?: MixLayer[];
  /** A line Gugut says as the step comes up. */
  say?: VoiceLine;
  /** Its own camera shot (the camera glides there). */
  shot?: Shot;
  /** Its own culling map. */
  map?: CullingMode;
}

export interface Slide {
  shot: Shot;
  title: string;
  /** Technique tags. */
  tags?: string[];
  lines: string[];
  /** Fog off: for shots that look across the whole maze. */
  clear?: boolean;
  readout?: Readout;
  xray?: XRay;
  /** As the slide comes up: Temesgen plays, or the goat's found-her glow. */
  enter?: "song" | "reveal";
  /** The title slide: the logo instead of a title. */
  logo?: boolean;
  /** Show only these parts of the scene (scene/sceneLayers); everything when left out. */
  layers?: SceneLayer[];
  /** Surfaces shown as their UV test grid (until X applies one: XRay.applies). */
  uvGrid?: UvSurface[];
  /** Leva controls set while the slide is up (path suffix, value), put back after. */
  set?: [path: string, value: unknown][];
  /** Steps within the slide, one per press (the sound slide's mix, layer by layer). */
  steps?: Step[];
  /** The layers of the mix heard on this slide (otherwise: all, or none while the deck is silent). */
  mix?: MixLayer[];
  /** This slide's place in the build (the strip along the top). */
  chapter?: string;
  /** A QR code to play the game, on a phone: big, in the middle. */
  qr?: boolean;
  /** The culling map (present/CullingMap): the maze from above, live, explaining one kind of culling. */
  map?: CullingMode;
  /** Technique cards: [name, what it does]. */
  cards?: [name: string, text: string][];
}

/** The game's address, as the QR code on the last slide (public/qr-play.svg) has it. */
export const PLAY_URL = "goat.gugut.studio";

/** Players so far — fill in before presenting (shown on "By the numbers" when set). */
export const PLAYERS = "";
