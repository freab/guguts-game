import type { SceneLayer } from "../scene/sceneLayers";
import type { Slide } from "./slides";

/**
 * "How it's made" (app/present): who I am and where the game came from, then
 * the finished scene built back up from nothing, one piece per slide on top
 * of the ones before (scene/sceneLayers), with the baked light and the
 * post-processing switched on when their own slides come — how it plays, the
 * leaderboard, and a QR code to play it.
 *
 * The words on screen are for the audience; what to press is in the notes.
 */

/** No post-processing yet: the raw render, until "The finishing touch". */
const RAW: [string, unknown][] = [["postEnabled", false]];
/** …and no baked light either, until "Sunlight". */
const UNLIT: [string, unknown][] = [...RAW, ["bakedShadow", 0], ["bakedAO", 0]];

/** Everything up to and including `layer`, in the order they're added. */
const ORDER: SceneLayer[] = ["ground", "walls", "sky", "grass", "flowers", "vines", "tree", "characters", "props", "atmosphere"];
const upTo = (layer: SceneLayer): SceneLayer[] => ORDER.slice(0, ORDER.indexOf(layer) + 1);

export const BUILD_SLIDES: Slide[] = [
  {
    shot: "orbit",
    title: "Hi, I'm Freab Mesfin",
    notes: [
      "Hi, I'm Freab Mesfin. Most of you know me as Gugut, from my channel, Gugut's Journey.",
      "I make games under the name Gugut Studios. This is the first one.",
    ],
    lines: ["You might know me as Gugut, from my channel Gugut's Journey.", "Gugut Studios"],
  },
  {
    shot: "top",
    title: "Where it started",
    notes: [
      "I loved The Maze Runner: a giant maze, walls that hide everything, and the only way out is through it.",
      "I wanted to make that feeling: lost between huge walls, racing the clock.",
    ],
    lines: [
      "I grew up loving The Maze Runner. Walls so tall you can't see past them, and the only way out is through.",
      "I wanted to build that feeling.",
    ],
    images: [
      { src: "/inspiration/maze-runner-maze.jpg", caption: "The Maze", wide: true },
      { src: "/inspiration/maze-runner-poster.jpg", caption: "The Maze Runner (2014)" },
    ],
  },
  {
    shot: "goat",
    title: "Two stories, one game",
    enter: "dance",
    notes: [
      "Two things I love: the legend every Ethiopian grows up with, Kaldi and his dancing goats, and The Maze Runner.",
      "Then the question: what if Kaldi's goat ate the berries and ran into a maze like that?",
      "The goat gives you a reason to go in, the maze gives you the challenge, and the timer and the setting sun give you the race.",
    ],
    lines: ["So I asked: what if Kaldi's goat ate those berries and ran into a maze like that?"],
    merge: {
      left: ["Kaldi's goats", "The story we all grew up with: a goat herder finds his goats dancing after eating red berries. That's how buna was discovered."],
      right: ["The Maze Runner", "Giant walls, no way out but through, and the light running out."],
      result: ["Gugut & the Goat", "Gugut's goat eats the same berries and runs into the maze. Bring her home before the sun goes down."],
    },
  },
  {
    shot: "orbit",
    title: "How it's made",
    notes: ["This is Gugut & the Goat, a 3D game in the browser.", "Instead of slides, I'll take the game apart and build it back up, live."],
    lines: ["This is the game, running live.", "Let's take it apart and build it again, piece by piece."],
  },
  {
    shot: "walls",
    title: "1 · The ground",
    notes: ["Everything starts as an empty plane.", "Press X: the UV grid becomes the real ground texture."],
    chapter: "Ground",
    tags: ["UV mapping", "PBR textures"],
    lines: ["Every world starts empty. Just a flat plane, waiting for a texture."],
    layers: upTo("ground"),
    set: UNLIT,
    uvGrid: ["ground"],
    xray: { label: "Ground", applies: "ground", states: ["UV GRID", "TEXTURED"] },
  },
  {
    shot: "top",
    title: "2 · The maze",
    notes: ["New maze every run: recursive backtracker, always solvable.", "Instanced: one draw per wall shape. Press X for solid walls."],
    chapter: "Maze",
    xray: { label: "Walls", wireframeFirst: "walls", states: ["WIREFRAME", "SOLID"] },
    tags: ["Recursive backtracker", "GPU instancing"],
    lines: [
      "Every time you play, the game carves a brand new maze, and there's always a way through.",
      "Every wall, drawn in just a handful of calls.",
    ],
    layers: upTo("walls"),
    set: UNLIT,
    readout: "render",
  },
  {
    shot: "stone",
    title: "3 · Stone",
    notes: ["The stone's height map pushes the wall faces out. They really bulge."],
    chapter: "Stone",
    tags: ["Height-mapped relief", "KTX2 textures"],
    lines: ["Look closely: the walls aren't flat. The stone actually bulges, pushed out by its own height map."],
    layers: upTo("walls"),
    set: UNLIT,
  },
  {
    shot: "lightmap",
    title: "4 · Sunlight",
    notes: ["Shadows are baked while you read the story: a ray per texel to the sun.", "Press X: the actual texture. Red = sun, green = away from walls."],
    chapter: "Light",
    tags: ["Ray-traced lightmap", "Ambient occlusion"],
    lines: [
      "While you're reading the story on the loading screen, the game is quietly tracing rays to the sun.",
      "Every shadow and every dark corner, baked into one texture.",
    ],
    layers: upTo("walls"),
    set: RAW,
    xray: { label: "Lightmap", lightmap: true, states: ["HIDDEN", "SHOWN"] },
  },
  {
    shot: "sky",
    title: "5 · The sky",
    notes: ["Physically based sky, rendered once into a cube map.", "It sets as the clock runs."],
    chapter: "Sky",
    tags: ["Physically based sky", "Sunset"],
    lines: ["A real, physically based sky. As you play, the sun slowly sets and everything turns golden."],
    layers: upTo("sky"),
    set: RAW,
  },
  {
    shot: "grass",
    title: "6 · Grass",
    notes: ["Thousands of tufts, my own shaders, chunked.", "Press X: switch the culling off, watch the count."],
    chapter: "Grass",
    tags: ["Custom shaders", "Culling", "Level of detail"],
    lines: [
      "Thousands of blades, all moving with the wind.",
      "And the grass you can't see isn't drawn at all.",
    ],
    layers: upTo("grass"),
    set: RAW,
    readout: "grass",
    xray: { label: "Culling", controls: [["Grass.occlusion", false]], states: ["ON", "OFF"] },
  },
  {
    shot: "corridor",
    title: "7 · Adey Abeba · አደይ አበባ",
    notes: [
      "Adey Abeba, the yellow Meskel daisy: it blooms across Ethiopia after the rains, around Meskel and the new year.",
      "Thousands of them, eight petals each; far away they turn into simple stars.",
    ],
    chapter: "Adey Abeba",
    tags: ["Instancing", "Level of detail"],
    lines: [
      "Our flower: Adey Abeba, the yellow daisy of Meskel and the new year.",
      "Thousands of them along the paths, swaying in the same wind as the grass.",
    ],
    layers: upTo("flowers"),
    set: RAW,
  },
  {
    shot: "walls",
    title: "8 · Ivy",
    notes: ["Ivy follows the real bumpy wall surface."],
    chapter: "Ivy",
    tags: ["Surface-following placement"],
    lines: ["Ivy climbs the walls, hugging every bump of the stone."],
    layers: upTo("vines"),
    set: RAW,
  },
  {
    shot: "tree",
    title: "9 · The tree",
    notes: ["Built in code from a seed: every maze grows its own.", "Press X for the wireframe."],
    chapter: "Tree",
    tags: ["Procedural tree", "Level of detail"],
    lines: ["The old tree in the middle is grown from code, so every maze gets its own."],
    xray: { label: "Tree", wireframe: "tree", states: ["SOLID", "WIREFRAME"] },
    layers: upTo("tree"),
    set: RAW,
  },
  {
    shot: "temesgenWide",
    title: "10 · Temesgen",
    notes: ["Temesgen plays the kirar. The music is by Temesgen (temesgen.com).", "His hand follows the real song: the game listens to it."],
    chapter: "Temesgen",
    tags: ["Vertex animation", "Web Audio"],
    lines: [
      "Meet Temesgen, playing his kirar under the tree.",
      "His hand follows the real song. The game is listening to the music as it plays.",
    ],
    mix: ["song"],
    layers: upTo("characters"),
    set: RAW,
    readout: "energy",
    enter: "song",
  },
  {
    shot: "temesgen",
    title: "The hardest problem",
    notes: ["He came as a frozen scan: no skeleton.", "The vertex shader decides which body part each vertex is. Press X to see the parts move."],
    chapter: "No skeleton",
    tags: ["No rig", "Vertex shader"],
    lines: [
      "Temesgen and the goat started as frozen 3D scans, with no skeleton and no way to move.",
      "So I taught the shader to find his arms, his head and his chest on its own, and bring them to life.",
    ],
    layers: upTo("characters"),
    set: RAW,
    xray: {
      label: "Moving parts",
      limbs: true,
      states: ["HIDDEN", "SHOWN"],
      legend: [
        ["#f2c43d", "Strumming arm"],
        ["#4dc9f0", "Fretting hand"],
        ["#e0523a", "Head"],
        ["#2e9e52", "Breathing"],
        ["#735cb3", "Swaying body"],
      ],
    },
  },
  {
    shot: "goat",
    title: "11 · The goat",
    notes: ["When you find her: rim light, glow, motes, the music swells.", "All shaders, no real light."],
    chapter: "Goat",
    tags: ["Vertex animation", "Shader effects"],
    lines: [
      "And here she is. She breathes, she looks around.",
      "When you finally find her, the light warms up around her and the music swells.",
    ],
    layers: upTo("characters"),
    enter: "reveal",
  },
  {
    shot: "grass",
    title: "12 · Little things",
    notes: ["Birds, leaves, fireflies, and the secrets: the jebena, the coffee bush."],
    chapter: "Details",
    tags: ["Particles", "Secrets"],
    lines: [
      "Birds overhead, falling leaves, fireflies as it gets dark.",
      "And a few secrets for those who look: a coffee bush, the monks' jebena, hidden water.",
    ],
    layers: upTo("atmosphere"),
    set: RAW,
  },
  {
    shot: "orbit",
    title: "Doing less, every frame",
    notes: ["It has to run on a phone. The rule: never do work twice.", "Walk through the four cards."],
    chapter: "Performance",
    tags: ["Performance"],
    lines: ["All of this has to run on a phone. The secret is never doing the same work twice."],
    set: RAW,
    readout: "render",
    cards: [
      ["Bake it once", "Sunlight and shadows are worked out once, while the game loads. The walls never move, so they never need it again."],
      ["Draw many as one", "All the walls of one shape, all the grass, all the flowers: each drawn in a single call."],
      ["Walls first", "Draw the walls first, and anything hidden behind them is skipped before it costs a thing."],
      ["Smaller textures", "Textures stay compressed on the graphics card: less memory, faster loading."],
    ],
  },
  {
    shot: "spin",
    title: "Only draw what you can see",
    notes: [
      "Step 1, frustum: only what's in view. Watch the map follow the camera.",
      "Step 2, occlusion: rays into each cell. Press X to switch it off.",
    ],
    chapter: "Culling",
    tags: ["Frustum culling", "Occlusion culling"],
    lines: [],
    set: RAW,
    steps: [
      {
        label: "1 · What the camera sees",
        caption: "Only the grass inside the camera's view gets drawn. Everything behind you is skipped. Watch the green follow the camera as it turns.",
        shot: "spin",
        map: "frustum",
      },
      {
        label: "2 · What the walls hide",
        caption: "But in a maze, most of what's in front of you is behind a wall. If the camera can't see it, it isn't drawn: green is drawn, red is hidden.",
        shot: "corridor",
        map: "occlusion",
      },
    ],
    xray: {
      label: "Culling",
      states: ["ON", "OFF"],
      controls: [
        ["Grass.occlusion", false],
        ["Flowers.occlusion", false],
        ["Vines.occlusion", false],
        ["Tree.occlusion", false],
      ],
    },
  },
  {
    shot: "grass",
    title: "And a few more tricks",
    notes: ["Pick two cards, don't read all six."],
    chapter: "More tricks",
    tags: ["Performance"],
    lines: [],
    set: RAW,
    readout: "render",
    cards: [
      ["Less detail far away", "Grass close to you is detailed. Far away, it quietly swaps to simpler versions."],
      ["No stutter", "Every shader is prepared while the game loads, so turning a corner never freezes."],
      ["Fake light, real glow", "The goat's glow is painted by shaders, not a real light, so nothing has to reload."],
      ["Calm wind", "The wind updates 20 times a second, not every frame. Nobody can tell."],
      ["Fits every screen", "Low, Medium and High, from an old phone to a gaming PC."],
      ["A soft shadow", "Gugut's shadow is a simple soft disc, not a full shadow redrawn every frame."],
    ],
  },
  {
    shot: "orbit",
    title: "Built on WebGPU",
    notes: ["three.js WebGPU renderer, shaders in TSL.", "Point at the readout. If it says WebGL 2, that's the automatic fallback."],
    chapter: "WebGPU",
    tags: ["three.js", "WebGPU", "TSL shaders"],
    lines: [
      "It runs on WebGPU, the newest way for the web to draw 3D.",
      "Every shader is written once, and on browsers without WebGPU, it quietly falls back to WebGL.",
    ],
    set: RAW,
    readout: "renderer",
  },
  {
    shot: "soundStage",
    title: "13 · Sound",
    notes: [
      "Pause on Silence for two seconds. Let the room hear nothing.",
      "Then press → to add each layer. Thank Surafel Yimam on the voice step.",
      "B makes the goat bleat any time.",
    ],
    chapter: "Sound",
    tags: ["3D audio", "Web Audio"],
    lines: ["Until now, it's been almost silent. Listen."],
    readout: "compass",
    steps: [
      {
        label: "Silence",
        caption: "The same beautiful scene, with no sound at all. It feels empty.",
        mix: [],
      },
      {
        label: "Wind",
        caption: "A real recording of the wind, gusting with the grass you see moving.",
        mix: ["wind"],
      },
      {
        label: "Birds",
        caption: "Evening birds. Now it feels like a place.",
        mix: ["wind", "birds"],
      },
      {
        label: "Temesgen's kirar",
        caption: "His music comes from where he sits. Turn around, and it stays right there.",
        mix: ["wind", "birds", "song"],
      },
      {
        label: "The goat",
        caption: "Her bleat comes from where she really is, softer when she's far away and muffled behind the walls. That's how you find her.",
        mix: ["wind", "birds", "song", "goat"],
      },
      {
        label: "Gugut's voice",
        caption: "And Gugut himself, voiced by Surafel Yimam.",
        mix: ["wind", "birds", "song", "goat", "voice"],
        say: "murmur",
      },
      {
        label: "All together",
        caption: "Five layers, mixed live. In this game, sound isn't decoration. It's how you play.",
        mix: ["wind", "birds", "song", "goat", "voice"],
      },
    ],
  },
  {
    shot: "orbit",
    title: "14 · The finishing touch",
    notes: ["Bloom, god rays, flare, vignette. Press X for before and after (twice: off, then on)."],
    chapter: "Post FX",
    tags: ["Bloom", "God rays", "Lens flare"],
    lines: ["The last layer: light that glows, rays through the tree, the warmth of a sunset."],
    post: true,
    xray: { label: "Finishing touch", controls: [["postEnabled", false]] },
  },
  {
    shot: "orbit",
    title: "Every dial, live",
    notes: [
      "This is the panel I tuned the whole game with. Every light, colour and effect has a dial.",
      "Try: Tone mapping → exposure, or Post-processing → bloom strength. Changes are live.",
      "Avoid the sun's elevation and azimuth: moving the sun re-bakes all the shadows.",
      "Everything goes back as it was when you leave this slide.",
    ],
    tags: ["leva", "Live tuning"],
    lines: ["Every light, colour and effect in the game has a dial. This is the panel I tuned it all with."],
    post: true,
    panel: true,
  },
  {
    shot: "corridor",
    title: "How to play",
    notes: [
      "First person, in the browser. No time limit: the timer just measures you for the leaderboard.",
      "The core loop: call her, listen, follow the sound. Calls are limited, so you have to think.",
    ],
    lines: ["Gugut's goat is somewhere in the maze. Find her and bring her home before the sun goes down."],
    cards: [
      ["Find her", "Right in your browser. The clock starts with your first step, and your best time goes on the world leaderboard."],
      ["Call her", "Gugut whistles, she answers, and you hear exactly where she is."],
      ["Three calls", "Then Gugut runs dry. Find one of the hidden water bottles to call again."],
      ["Temesgen", "Sit and listen to his music. Calm down long enough, and you'll hear her on your own."],
      ["Stars and badges", "Fewer calls, more stars. Find her without calling once and you're a Silent tracker."],
      ["On your phone", "Walk with one thumb, look with the other, and a big button to call her."],
    ],
  },
  {
    shot: "top",
    title: "Three mazes",
    notes: [
      "Easy is a walk, Medium has more dead ends, Hard is 20 by 20.",
      "And on Hard she doesn't wait for you: call her and she runs.",
    ],
    lines: ["A new maze every time. And on Hard, she won't wait for you: call her, and she runs."],
    levels: true,
  },
  {
    shot: "grass",
    title: "Pick your graphics",
    notes: [
      "First thing you choose: Low, Medium or High. Phones start on Low.",
      "Point at the lit one: that's what this presentation is running on.",
    ],
    lines: ["The first thing you choose, so it runs smoothly on whatever you have."],
    graphics: true,
  },
  {
    shot: "orbit",
    title: "World leaderboard",
    notes: [
      "This is live, right now: real players, real times.",
      "Point at the player counts. Then: can anyone here beat the top time?",
    ],
    lines: ["Real players, real times, live right now. Think you can beat them?"],
    leaderboard: true,
  },
  {
    shot: "intro",
    title: "Thank you",
    notes: ["Thank you! Scan the QR to play now.", "Thanks to Surafel Yimam (voice), Eman Issae (designs), Temesgen (music)."],
    lines: [
      "Gugut & the Goat · by Gugut Studios",
      "Everything you just saw was running live, in real time, inside the game. No videos, no slides. Watch it again at goat.gugut.studio/present",
    ],
    qr: true,
  },
];
