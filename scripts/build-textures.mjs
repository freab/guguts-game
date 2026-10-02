// Builds the game's GPU-compressed textures (KTX2 / Basis Universal) from the
// CC0 sources in assets-src/textures into public/textures.
//
//   node scripts/build-textures.mjs
//
// Sources (all CC0, downloaded once into assets-src/textures):
//   Poly Haven  forrest_ground_01 (ground + footpath), bark_brown_02, old_stone_wall
//               (maze walls) (1K JPG: diff, nor_gl, arm)
//   ambientCG   LeafSet027 (1K JPG maple leaf atlas: Color, Opacity, NormalGL)
//   ambientCG   LeafSet017 (1K JPG English ivy leaf atlas: Color, Opacity, NormalGL)
//
// Per map: colour → ETC1S (small), sRGB; ARM → ETC1S linear; normal → UASTC
// (normal-map preset, RDO + Zstandard supercompression — ETC1S smears normals).
// Everything gets mipmaps.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src/textures");
const OUT = path.join(ROOT, "public/textures");

/** Decode any image sharp understands to raw RGBA (the encoder's Node input). */
async function imageDecoder(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const COLOR = {
  isUASTC: false,
  qualityLevel: 200,
  compressionLevel: 2,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
};
const LINEAR = { isUASTC: false, qualityLevel: 180, compressionLevel: 2, isPerceptual: false };
const NORMAL = {
  isUASTC: true,
  isNormalMap: true,
  isPerceptual: false,
  enableRDO: true,
  rdoQualityLevel: 2,
  needSupercompression: true,
};
/** Tiling normal maps are downscaled: 1K normal detail barely shows at game distances, and UASTC is ~4× ETC1S. */
const NORMAL_SIZE = 512;

async function encode(input, options, outName) {
  const ktx2 = await encodeToKTX2(new Uint8Array(input), {
    ...options,
    generateMipmap: true,
    isKTX2File: true,
    imageDecoder,
  });
  await fs.writeFile(path.join(OUT, outName), ktx2);
  const kb = (ktx2.byteLength / 1024).toFixed(0);
  console.log(`  ${outName.padEnd(28)} ${kb.padStart(5)} KB`);
  return ktx2.byteLength;
}

/** A tiling PBR set: <name>_color / _normal / _arm. */
async function pbrSet(source, name) {
  const read = (map) => fs.readFile(path.join(SRC, `${source}_${map}_1k.jpg`));
  return (
    (await encode(await read("diff"), COLOR, `${name}_color.ktx2`)) +
    (await encode(
      await sharp(await read("nor_gl")).resize(NORMAL_SIZE, NORMAL_SIZE).png().toBuffer(),
      NORMAL,
      `${name}_normal.ktx2`
    )) +
    (await encode(await read("arm"), LINEAR, `${name}_arm.ktx2`))
  );
}

/* ---------- maple leaf atlas ---------- */

const LEAF_SRC = path.join(SRC, "LeafSet027/LeafSet027_1K-JPG");
const CELL = 256; // output cell size
/** Source cells [row, col] in the 3×3 LeafSet027 grid. */
const CROWN_CELLS = [
  [1, 1],
  [0, 1],
  [1, 2],
  [2, 0],
];
const LITTER_CELLS = [
  [0, 0],
  [0, 2],
  [1, 0],
  [2, 2],
];

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/**
 * Summer leaves from autumn ones: reds, oranges and yellows (hue 330°–75°)
 * are remapped into yellow-green … green (70°–110°), so the variegation stays
 * but reads as fresh growth instead of autumn colour.
 */
function greenify(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, v] = rgbToHsv(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255);
    let nh = h;
    if (h <= 75) nh = 70 + (h / 75) * 40;
    else if (h >= 330) nh = 70 + ((h - 330) / 30) * 8;
    else continue;
    // Muted: formerly-yellow areas would otherwise come out neon lime.
    const [r, g, b] = hsvToRgb(nh, s * 0.68, v * 0.86);
    rgba[i] = Math.round(r * 255);
    rgba[i + 1] = Math.round(g * 255);
    rgba[i + 2] = Math.round(b * 255);
  }
}

/** One source cell, resized to CELL×CELL raw pixels (`channels` 3 or 4). */
async function cell(file, [row, col], channels) {
  const meta = await sharp(file).metadata();
  const size = Math.floor(meta.width / 3);
  let img = sharp(file).extract({ left: col * size, top: row * size, width: size, height: size }).resize(CELL, CELL);
  img = channels === 4 ? img.ensureAlpha() : img.removeAlpha();
  return img.raw().toBuffer();
}

/** Lay 8 raw cells out as a 4×2 atlas and return it as PNG bytes. */
async function atlas(cells, channels) {
  const composites = await Promise.all(
    cells.map(async (raw, i) => ({
      input: await sharp(raw, { raw: { width: CELL, height: CELL, channels } }).png().toBuffer(),
      left: (i % 4) * CELL,
      top: Math.floor(i / 4) * CELL,
    }))
  );
  return sharp({ create: { width: CELL * 4, height: CELL * 2, channels, background: { r: 128, g: 128, b: 255, alpha: 0 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * maple_leaves_color (RGBA: colour + opacity) and maple_leaves_normal, 4×2
 * cells: top row = green crown leaves, bottom row = autumn litter leaves.
 */
async function leafAtlas() {
  const color = `${LEAF_SRC}_Color.jpg`;
  const opacity = `${LEAF_SRC}_Opacity.jpg`;
  const normal = `${LEAF_SRC}_NormalGL.jpg`;
  const order = [...CROWN_CELLS, ...LITTER_CELLS];

  const colorCells = [];
  for (const [i, rc] of order.entries()) {
    const rgba = await cell(color, rc, 4);
    const alpha = await sharp(opacity)
      .extract({
        left: rc[1] * Math.floor(1024 / 3),
        top: rc[0] * Math.floor(1024 / 3),
        width: Math.floor(1024 / 3),
        height: Math.floor(1024 / 3),
      })
      .resize(CELL, CELL)
      .greyscale()
      .raw()
      .toBuffer();
    for (let p = 0; p < CELL * CELL; p++) rgba[p * 4 + 3] = alpha[p];
    if (i < CROWN_CELLS.length) greenify(rgba);
    colorCells.push(rgba);
  }
  const normalCells = [];
  for (const rc of order) normalCells.push(await cell(normal, rc, 4));

  const colorAtlas = await atlas(colorCells, 4);
  // PREVIEW=<dir> also writes the colour atlas as a PNG, to check it by eye.
  if (process.env.PREVIEW) await fs.writeFile(path.join(process.env.PREVIEW, "maple_leaves_color.png"), colorAtlas);
  return (
    (await encode(colorAtlas, COLOR, "maple_leaves_color.ktx2")) +
    (await encode(await atlas(normalCells, 4), NORMAL, "maple_leaves_normal.ktx2"))
  );
}

/* ---------- ivy leaf atlas ---------- */

const IVY_SRC = path.join(SRC, "LeafSet017/LeafSet017_1K-JPG");
/**
 * LeafSet017 is 2 columns × 3 rows of ivy leaves (tip up, stem at the bottom).
 * Crop boxes [left, top, width, height] in the 1024² source; 8 atlas cells,
 * so the last two leaves repeat.
 */
const IVY_BOXES = [
  [0, 0, 512, 341],
  [512, 0, 512, 341],
  [0, 341, 512, 342],
  [512, 341, 512, 342],
  // The bottom row starts a little lower: the leaves above reach past y = 683.
  [0, 700, 512, 324],
  [512, 700, 512, 324],
];
const IVY_ORDER = [0, 1, 2, 3, 4, 5, 2, 5];

/** One ivy leaf, fitted (not stretched) into a CELL² square, transparent around it. */
async function ivyCell(file, [left, top, width, height], channels, background) {
  const img = sharp(file)
    .extract({ left, top, width, height })
    .resize(CELL, CELL, { fit: "contain", background });
  return (channels === 4 ? img.ensureAlpha() : img.removeAlpha()).raw().toBuffer();
}

/** ivy_leaves_color (RGBA: colour + opacity) and ivy_leaves_normal, 4×2 cells. */
async function ivyAtlas() {
  const color = `${IVY_SRC}_Color.jpg`;
  const opacity = `${IVY_SRC}_Opacity.jpg`;
  const normal = `${IVY_SRC}_NormalGL.jpg`;
  const colorCells = [];
  const normalCells = [];
  for (const i of IVY_ORDER) {
    const box = IVY_BOXES[i];
    const rgba = await ivyCell(color, box, 4, { r: 0, g: 0, b: 0, alpha: 0 });
    const alpha = await sharp(opacity)
      .extract({ left: box[0], top: box[1], width: box[2], height: box[3] })
      .resize(CELL, CELL, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
      .greyscale()
      .raw()
      .toBuffer();
    for (let p = 0; p < CELL * CELL; p++) rgba[p * 4 + 3] = alpha[p];
    colorCells.push(rgba);
    normalCells.push(await ivyCell(normal, box, 4, { r: 128, g: 128, b: 255, alpha: 1 }));
  }
  const colorAtlas = await atlas(colorCells, 4);
  if (process.env.PREVIEW) await fs.writeFile(path.join(process.env.PREVIEW, "ivy_leaves_color.png"), colorAtlas);
  return (
    (await encode(colorAtlas, COLOR, "ivy_leaves_color.ktx2")) +
    (await encode(await atlas(normalCells, 4), NORMAL, "ivy_leaves_normal.ktx2"))
  );
}

await fs.mkdir(OUT, { recursive: true });
let total = 0;
console.log("ground (forrest_ground_01)");
total += await pbrSet("forrest_ground_01", "ground");
console.log("bark (bark_brown_02)");
total += await pbrSet("bark_brown_02", "bark");
console.log("walls (old_stone_wall)");
total += await pbrSet("old_stone_wall", "wall");
// Its height map, for the walls' parallax and displacement: UASTC (high
// precision — parallax shows compression blocks), half resolution.
total += await encode(
  await sharp(await fs.readFile(path.join(SRC, "old_stone_wall_disp_1k.jpg")))
    .toColourspace("srgb")
    .resize(NORMAL_SIZE, NORMAL_SIZE)
    .png()
    .toBuffer(),
  NORMAL,
  "wall_height.ktx2"
);
console.log("maple leaves (LeafSet027)");
total += await leafAtlas();
console.log("ivy leaves (LeafSet017)");
total += await ivyAtlas();
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
