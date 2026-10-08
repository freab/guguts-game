# Gugut & the Goat

**A 3D maze game you play in your browser, inspired by the Ethiopian story of how coffee was found.**

Gugut's goat ran into a maze. Find her before the sun goes down.

---

## The story

There is an old Ethiopian story about **Kaldi**, a goat herder. One day his goats ate red berries from a strange bush, and they danced all night.

In my game, Gugut's goat eats those same berries and runs off into a big stone maze. You play as Gugut, and you have to find her and bring her home before dark.

When you find her, the story finishes like the legend. Gugut takes the berries to the monks on the hill. They roast them in the fire and make a warm drink called **buna**. Today we call it **coffee**.

---

## How to play

Choose **Easy**, **Medium** or **Hard**, then find the goat as fast as you can. The timer starts when you take your first step.

| | Computer | Phone |
|---|---|---|
| Walk | `W` `A` `S` `D` or arrow keys | Left thumb |
| Look around | Mouse | Right thumb |
| Run | Hold `Shift` | Push the stick all the way |
| Call the goat | `C` | Call button |
| Drink / Talk | `E` | Drink / Talk button |
| Pause | `P` | Pause button |

---

## What you can do in the game

- **Every maze is new.** The maze changes each time you play. In the middle there is an open space with a big old tree.
- **Call your goat.** Gugut whistles, and the goat answers. You hear her from the direction she really is. Her bleat sounds quieter when she is far away and muffled when walls are in the way. A small map also shows where she is for a few seconds.
- **Don't run out of voice.** You only have 3 calls. After that Gugut is too thirsty to call. Two water bottles are hidden in the maze. Find one and drink it to get your calls back.
- **Meet Temesgen.** A man named Temesgen sits under the tree, playing the *kirar*, a traditional Ethiopian string instrument.
  - Ask him about your goat. He hasn't seen her, but he offers to play you a song to calm you down.
  - Say yes and you sit on the grass and listen. The music is loud next to him and gets quieter as you walk away.
  - If you listen long enough, you calm down and hear your goat on your own, without using a call.
  - After you find water, he can give you a hint about which way the goat went.
- **Stars and badges.** You get up to 3 stars: the fewer calls you use, the more stars. You can also earn badges, like *Silent tracker* for finding her without calling at all.
- **Leaderboard.** Your best time on each level goes on a world leaderboard.
- **Share your time.** After a run you can make a picture of your time for Instagram, X, Telegram or WhatsApp. You also get your own link that shows your best times.

---

## How I built it

The game runs fully in the web browser. You don't need to install anything.

**Tools:** Next.js, React, three.js (with the new WebGPU graphics), Tailwind CSS and Upstash for the leaderboard.

Some things I'm proud of:

- **Modern browser graphics.** The game uses WebGPU, the newest way for websites to draw 3D graphics. The grass, flowers, ivy on the walls, the tree, the sky and the sunset light are all made with my own shaders.
- **Bringing still 3D scans to life.** The goat and Temesgen started as frozen 3D scans with no skeleton inside, so they can't be animated the usual way. Instead I move parts of the scan directly. The goat breathes and looks around. Temesgen strums his kirar, breathes, looks you in the eye and sways to the music.
- **He plays along with the real song.** While Temesgen's song plays, the game listens to the music. His hand strums and his head nods along with the beat.
- **Sound you can follow.** The goat and the music come from where they really are in the maze. Walls between you and the sound make it muffled, so you can find your way by ear.
- **A story-book loading screen.** The title picture burns away like paper to show the story while the game loads.
- **Works on phones.** On phones the game uses lighter graphics, big touch buttons and a layout that fits a phone screen.
- **Safe sharing.** Your share link can't be used to change your name or post fake times.

---

## Credits

- **Music:** "Nostalgia" by **Temesgen** ([temesgen.com](https://temesgen.com)). All rights belong to the artist.
- **Sound effects:** free (public domain) recordings from [BigSoundBank](https://bigsoundbank.com) by Joseph Sardin: birds, footsteps, goat bleats and drinking.
- **Textures:** free (public domain) textures from [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com).
- **Grass:** based on [FluffyGrass](https://github.com/thebenezer/FluffyGrass) by Ebenezer (MIT license).
- **Fonts:** Jolly Lodger and Geist, from Google Fonts.

---

## Try it on your computer

```bash
cd gugut-maze
npm install
npm run dev
```

Then open <http://localhost:3000>. It works best in a recent version of Chrome or Edge.
