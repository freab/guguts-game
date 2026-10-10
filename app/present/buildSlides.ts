import type { SceneLayer } from "../scene/sceneLayers";
import type { Slide } from "./slides";

/**
 * "How it's made" (app/present): the finished scene first, then built back up
 * from nothing, one piece per slide on top of the ones before (scene/
 * sceneLayers), with the baked light and the post-processing switched on
 * when their own slides come — and, to end, a QR code to play it.
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
    title: "How it's made",
    lines: ["This is Gugut & the Goat.", "Let's build it from nothing, one piece at a time."],
    clear: true,
  },
  {
    shot: "walls",
    title: "1 · The ground",
    chapter: "Ground",
    tags: ["UV mapping", "PBR textures"],
    lines: [
      "An empty world: a flat plane, shown here with its UVs as a test grid (red across, green along).",
      "Press X to apply the texture.",
    ],
    clear: true,
    layers: upTo("ground"),
    set: UNLIT,
    uvGrid: ["ground"],
    xray: { label: "Ground", applies: "ground", states: ["UV GRID", "TEXTURED"] },
  },
  {
    shot: "top",
    title: "2 · The maze",
    chapter: "Maze",
    xray: { label: "Walls", wireframeFirst: "walls", states: ["WIREFRAME", "SOLID"] },
    tags: ["Recursive backtracker", "GPU instancing", "6 m chunks"],
    lines: [
      "A recursive backtracker carves a new maze every run, always with a way through.",
      "Each wall shape is one instanced draw, in chunks the camera can skip. Here as wireframe: press X for the solid walls.",
    ],
    clear: true,
    layers: upTo("walls"),
    set: UNLIT,
    readout: "render",
  },
  {
    shot: "stone",
    title: "3 · Stone",
    chapter: "Stone",
    tags: ["Height-mapped relief", "KTX2 textures"],
    lines: ["The wall faces really bulge: each vertex is pushed out by the stone's height map."],
    clear: true,
    layers: upTo("walls"),
    set: UNLIT,
  },
  {
    shot: "lightmap",
    title: "4 · Sunlight",
    chapter: "Light",
    tags: ["CPU ray-traced lightmap", "Ambient occlusion"],
    lines: [
      "Shadows and dark corners, baked into a texture: a ray per ground texel traced to the sun, while you read the loading story.",
      "Press X to see the texture itself: red is sunlight, green is open ground away from the walls.",
    ],
    clear: true,
    layers: upTo("walls"),
    set: RAW,
    xray: { label: "Lightmap texture", lightmap: true, states: ["HIDDEN", "SHOWN"] },
  },
  {
    shot: "sky",
    title: "5 · The sky",
    chapter: "Sky",
    tags: ["Physically based sky", "Baked cube map", "Sunset"],
    lines: [
      "A physically based sky with clouds, rendered once into a cube map so it costs nothing per frame.",
      "As the clock runs, the sun sets and the light warms and fades.",
    ],
    layers: upTo("sky"),
    set: RAW,
  },
  {
    shot: "grass",
    title: "6 · Grass",
    chapter: "Grass",
    tags: ["WebGPU", "Custom TSL shaders", "Occlusion culling", "LOD"],
    lines: [
      "Thousands of tufts in chunks, with my own shader for the wind and the colour.",
      "Chunks hidden behind walls aren't drawn at all. Press X to draw them anyway.",
    ],
    layers: upTo("grass"),
    set: RAW,
    readout: "grass",
    xray: { label: "Occlusion culling", controls: [["Grass.occlusion", false]] },
  },
  {
    shot: "corridor",
    title: "7 · Flowers",
    chapter: "Flowers",
    tags: ["Instanced", "Custom shader"],
    lines: ["Wildflowers along the paths, swaying in the same wind."],
    layers: upTo("flowers"),
    set: RAW,
  },
  {
    shot: "walls",
    title: "8 · Ivy",
    chapter: "Ivy",
    tags: ["Surface-following placement"],
    lines: ["Ivy that grows on the walls' real, bumpy surface, not floating off it."],
    clear: true,
    layers: upTo("vines"),
    set: RAW,
  },
  {
    shot: "tree",
    title: "9 · The tree",
    chapter: "Tree",
    tags: ["Procedural tree", "Culling + LOD"],
    lines: [
      "The maple is built in code from a seed, so every maze grows its own. Its leaves are culled and simplified with distance.",
      "Press X to see it as wireframe.",
    ],
    xray: { label: "Tree", wireframe: "tree", states: ["SOLID", "WIREFRAME"] },
    layers: upTo("tree"),
    set: RAW,
  },
  {
    shot: "temesgenWide",
    title: "10 · Temesgen",
    chapter: "Temesgen",
    tags: ["Vertex-shader animation", "Web Audio AnalyserNode"],
    lines: [
      "A still 3D scan with no skeleton: the vertex shader moves his arm, his head, his breath.",
      "He listens to the real song as it plays, and strums along with it. Music: Temesgen.",
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
    chapter: "No skeleton",
    tags: ["No rig, no bones", "Capsule masks", "Vertex shader"],
    lines: [
      "Temesgen and the goat came as frozen 3D scans: one solid mesh, no skeleton, nothing to animate the usual way.",
      "So the vertex shader works out which part of him each vertex is, from where it sits in the scan, and moves just that part. Press X to see the parts.",
    ],
    layers: upTo("characters"),
    set: RAW,
    xray: {
      label: "Moving parts",
      limbs: true,
      states: ["HIDDEN", "SHOWN"],
      legend: [
        ["#f2c43d", "Strumming forearm"],
        ["#4dc9f0", "Fretting hand"],
        ["#e0523a", "Head: turns, nods"],
        ["#2e9e52", "Chest: breathing"],
        ["#735cb3", "Upper body: sways"],
      ],
    },
  },
  {
    shot: "goat",
    title: "11 · The goat",
    chapter: "Goat",
    tags: ["Vertex-shader animation", "Additive TSL shaders"],
    lines: [
      "A still scan too: the vertex shader makes her breathe and look round.",
      "When you find her: a rim light on her fur, a warm pool and a shaft of light, motes drifting up, and the music swells. All shader-driven, no real light, so nothing recompiles.",
    ],
    // (Post-processing on early, here: the reveal's glow blooms, as in the game.)
    layers: upTo("characters"),
    enter: "reveal",
  },
  {
    shot: "grass",
    title: "12 · Little things",
    chapter: "Details",
    tags: ["Particles", "Secrets"],
    lines: [
      "Birds, gusts of falling leaves, fireflies at dusk.",
      "And the secrets: the coffee bush, the monks' jebena, the water bottles.",
    ],
    layers: upTo("atmosphere"),
    set: RAW,
  },
  {
    shot: "orbit",
    title: "Doing less, every frame",
    chapter: "Performance",
    tags: ["Performance"],
    lines: ["A maze full of grass, ivy and a living tree has to run on a phone. The trick is never doing work twice."],
    clear: true,
    set: RAW,
    readout: "render",
    cards: [
      ["Bake it once", "The sunlight, the shade and the sun's shadow map are worked out once while loading. The walls never move, so they're never redrawn into it."],
      ["Instancing", "Each wall shape, each kind of grass tuft and flower is one draw call for all of them, not one per object."],
      ["Walls drawn first", "Grass hidden behind a wall fails the depth test instead of being shaded and then painted over."],
      ["Compressed textures", "KTX2 textures stay compressed on the GPU: less memory, faster loading."],
    ],
  },
  {
    shot: "spin",
    title: "Culling: what you can't see isn't drawn",
    chapter: "Culling",
    tags: ["Frustum culling", "Occlusion culling", "Grid ray walk (DDA)", "8-frame hold"],
    lines: [],
    set: RAW,
    steps: [
      {
        label: "1 · Frustum culling",
        caption: "Only what's inside the camera's view (the blue wedge) is drawn. Green chunks are in view; striped grey ones are skipped before they reach the GPU. Watch the green follow the camera as it turns.",
        shot: "spin",
        map: "frustum",
      },
      {
        label: "2 · Occlusion culling",
        caption: "In a maze, most of what's in view is behind a wall. A ray walks the grid from the camera into each cell: green gets through, red stops at a wall, and those chunks aren't drawn either. Press X to switch it off.",
        shot: "corridor",
        map: "occlusion",
      },
    ],
    xray: {
      label: "Occlusion culling",
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
    chapter: "More tricks",
    tags: ["Performance"],
    lines: [],
    set: RAW,
    readout: "render",
    cards: [
      ["Level of detail", "Every grass tuft comes in three versions (132, 64 and 32 vertices), picked by how far away it is."],
      ["Compile while loading", "Every shader is compiled behind the loading screen, so turning a corner never stutters."],
      ["Light without lights", "The goat's glow is drawn by shaders, not a real light, which would make every material recompile."],
      ["Wind at 20 fps", "The wind that sways the grass and the trees updates 20 times a second, not every frame."],
      ["Capped resolution", "The pixel ratio is capped, and Low, Medium and High fit every device from phone to gaming PC."],
      ["A blob for a shadow", "Gugut's shadow is a soft disc on the ground, not a shadow map redrawn every frame."],
    ],
  },
  {
    shot: "orbit",
    title: "Built on WebGPU",
    chapter: "WebGPU",
    tags: ["three.js WebGPURenderer", "TSL shaders", "WGSL", "WebGL 2 fallback"],
    lines: [
      "The game runs on three.js's WebGPU renderer, the new way browsers draw 3D. Every shader is written once in TSL and compiled to WGSL.",
      "Less CPU work per draw, and every pipeline is compiled while the loading screen is up, so nothing stutters when you turn a corner. No WebGPU? It falls back to WebGL 2 on its own.",
    ],
    clear: true,
    set: RAW,
    readout: "renderer",
  },
  {
    shot: "soundStage",
    title: "13 · Sound, layer by layer",
    chapter: "Sound",
    tags: ["Web Audio", "HRTF panning", "Occlusion low-pass", "Reverb", "Ducking", "Compressor"],
    lines: ["Until now, silence. Press → to add each layer of the mix."],
    readout: "compass",
    steps: [
      {
        label: "Silence",
        caption: "The whole scene, with no sound at all. Flat.",
        mix: [],
      },
      {
        label: "Wind",
        caption: "A real recording, looped without a seam. It gusts with the same wind that moves the grass: louder and brighter in a gust, drifting left and right.",
        mix: ["wind"],
      },
      {
        label: "Birds",
        caption: "Evening birdsong, loudness-matched to the wind, wandering slowly across the stereo field. Now it feels like a place.",
        mix: ["wind", "birds"],
      },
      {
        label: "Temesgen's kirar",
        caption: "His song comes from where he sits, in 3D (HRTF). As the view turns, it stays put. Walk away and it fades; walls muffle it.",
        mix: ["wind", "birds", "song"],
      },
      {
        label: "The goat",
        caption: "Her bleat, from where she really is in the maze: delayed by the distance, muffled by the walls, with a long echo across it. The song dips under her.",
        mix: ["wind", "birds", "song", "goat"],
      },
      {
        label: "Gugut's voice",
        caption: "His thoughts (voiced by Surafel Yimam), dry and in the centre of your head. Everything else dips under him.",
        mix: ["wind", "birds", "song", "goat", "voice"],
        say: "murmur",
      },
      {
        label: "The mix",
        caption: "Five layers on one Web Audio graph, glued by a compressor. Sound is how you find her.",
        mix: ["wind", "birds", "song", "goat", "voice"],
      },
    ],
  },
  {
    shot: "orbit",
    title: "14 · The finishing touch",
    chapter: "Post FX",
    tags: ["Bloom", "God rays", "Lens flare", "Vignette"],
    lines: ["Post-processing turns the render into a sunset: bloom, god rays through the tree, a lens flare. Press X for before and after."],
    clear: true,
    xray: { label: "Post-processing", controls: [["postEnabled", false]] },
  },
  {
    shot: "intro",
    title: "Thank you",
    lines: ["Gugut & the Goat · by Gugut Studios"],
    qr: true,
  },
];
