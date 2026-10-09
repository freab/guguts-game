# Audio

All sound runs on one Web Audio graph in **`app/audio/audioEngine.ts`** (the
`audio` singleton). Browsers only allow audio after a user gesture, so
`SceneClient` calls `audio.unlock()` on the first click or key press; nothing
touches the browser before that, so the module is safe on the server.

```
ambience ─ birds ┐
          wind ──┴─ ambience bus (music switch, ducks under the voice) ─┐
footsteps ─ dry ──────────── footstep bus ──────────────────────────────┤
           └─ wet ─ short "maze walls" reverb ──────────────────────────┼─ master ─ compressor ─ out
calls ─ whistle / shout, the goat's bleat ─ calls bus ──────────────────┤
           └─ wet ─ long "across the maze" reverb ──────────────────────┤
voice ─ Gugut's voiceovers ─ voice bus ─────────────────────────────────┤
song ─ Temesgen's kirar, HRTF-panned from where he sits ────────────────┘
```

## What plays

| Sound | Method | Notes |
|-------|--------|-------|
| Birds and wind | ambience | Looped recordings, loudness-matched. The wind swells with `gustAt()` (`scene/wind.ts`). Plays only while the game is running and the music switch (`M`) is on. |
| Footsteps | `footstep(intensity)` | Recorded steps on grass (slow walking, quick running), never the same twice in a row, from `audio/Footsteps.tsx`. Synthesised until they load. |
| Goat call | `goatCall(...)` | Gugut's shout (voiceovers on) or a two-note whistle, then her bleat after the sound's travel time and a 0.25–0.6 s reaction. HRTF-panned, quieter and wetter with distance, muffled behind walls. Returns when she is heard. |
| Heard while calm | `goatBleat(...)` | Her bleat on its own, no call. |
| No voice left | `dryCall()` | A dry, breathy rasp. |
| Drinking | `drink()` | A glass clink, then the cork, gulps and a breath. |
| Seeing / reaching her | `swell(size)` | A synthesised warm chord (D A D F♯ E) that rises, holds and fades, with a high shimmer. `size` 1 on first sight, 1.4 on reaching her. Follows the music switch. |
| Temesgen's song | `playSong`, `playPhrase`, `stopSong` | "Nostalgia" by Temesgen, streamed (about five minutes). `setSongLevel` sets its level by distance and walls (`maze/Temesgen.tsx`); `duckSong` dips it under a bleat or a line; `songEnergy()` drives his strumming. `preloadSong()` starts the download with the level's assets. |
| Gugut's voice | `say`, `hush` | See below. |

## Gugut's voice

`audio.setVoice(on)` follows the player's choice (title screen, Settings).
The sprite `public/audio/voice.webm` and its index `voice.json` load only when
voiceovers are on.

- `say(line, { interrupt, far, duck })` plays one of `line`'s takes (never the
  same one twice running) and returns its length in seconds. It returns
  `null` when it can't play: voiceovers off or not loaded, audio locked, or
  already speaking (unless `interrupt`). `far` adds the long reverb (the call
  shout). `duck` (on by default) dips the ambience to half and the song under
  the line.
- `hush()` stops the current line. `isSpeaking()` and `speaking()` tell what
  is playing.
- Lines (`VoiceLine`): `call`, `murmur`, `parched`, `temesgen`, `hum`,
  `found`, `congrats`. When each is said is in
  [gameplay.md § 9](gameplay.md#9-voiceovers--gamemonologuetsx).

## Building the audio — `scripts/build-audio.mjs`

The source recordings are in `assets-src/` (not served). The script uses
`ffmpeg-static` to cut, level and pack them into `public/audio/`:

| Output | From |
|--------|------|
| `birds.webm` | the liveliest ~90 s of an evening birds recording, made to loop |
| `footsteps.webm` + `.json` | single steps cut from slow and quick grass steps |
| `bleats.webm` + `.json` | single goat bleats |
| `drink.webm` + `.json` | cork, gulps and breath |
| `voice.webm` + `.json` | Gugut's voiceovers from `assets-src/voice` |

```bash
npm run audio
```

builds everything, and

```bash
npm run audio -- voice
```

builds just the voice sprite (any of `birds`, `footsteps`, `bleats`, `drink`,
`voice` can be named).

The `VOICE` table in the script lists each line's takes as
`[file, from s, to s]` (no range = the whole file, silence trimmed). The call
is one recording of four shouts, cut into four takes. Speech is levelled to
−20 dBFS RMS over its voiced part, humming to −25 dBFS, then everything is
packed into one 32 kbps Opus file with a `[start, duration]` index per take.
To add a take, put the file in `assets-src/voice`, add it to `VOICE`, and
rebuild the voice sprite.

The script prints each output's RMS level; the ambience levels go into
`TRACKS` in `audioEngine.ts`.

## Credits

Sound effects are public-domain recordings from BigSoundBank (Joseph Sardin);
see `public/audio/LICENSE.md`. The voice of Gugut is Surafel Yimam. The music
is "Nostalgia" by Temesgen. The in-game list is `ui/CreditsDialog.tsx`, the
same as the main README's Credits.
