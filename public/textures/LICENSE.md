# Texture credits

All textures here are **CC0 (public domain)**. They were converted to KTX2
(Basis Universal) by `npm run textures` (`scripts/build-textures.mjs`) from
1K JPG sources kept in `assets-src/textures/` (not shipped).

| File | Source |
|---|---|
| `ground_*.ktx2` | Poly Haven, "Forrest Ground 01" — https://polyhaven.com/a/forrest_ground_01 |
| `path_*.ktx2` | Poly Haven, "Park Dirt" — https://polyhaven.com/a/park_dirt |
| `bark_*.ktx2` | Poly Haven, "Bark Brown 02" — https://polyhaven.com/a/bark_brown_02 |
| `ivy_leaves_*.ktx2` | ambientCG, "LeafSet017" — https://ambientcg.com/view?id=LeafSet017 (English ivy) |
| `maple_leaves_*.ktx2` | ambientCG, "LeafSet027" — https://ambientcg.com/view?id=LeafSet027 (4 leaves hue-shifted to summer green, 4 left autumn) |

To rebuild, download the 1K JPG `diff`, `nor_gl` and `arm` maps of the three
Poly Haven sets into `assets-src/textures/`, and unzip `LeafSet027_1K-JPG.zip`
and `LeafSet017_1K-JPG.zip` into `assets-src/textures/LeafSet027/` and
`assets-src/textures/LeafSet017/`.
