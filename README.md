# Dino World

A gentle 3D free-roam dinosaur game for small children, playable in the browser on a tablet, phone or computer.
Pick an egg, hatch a dinosaur, and wander an island: eat, grow, meet other dinosaurs, bounce on mushrooms and
explore caves. No ads, no currency, no health or survival mechanics, and nothing to lose.

## Run

```sh
npm install
npm run dev      # http://localhost:5173 — also served on your LAN, so a tablet on the same Wi-Fi can open it
npm run build    # typecheck + static site in dist/
```

## Controls

- **Touch:** left-thumb joystick to move; one big round button that changes with what's nearby.
- **Keyboard:** WASD or arrow keys to move, Space for the button, Esc to pause.

On the egg screen, tap an egg once to select it (its name is read out), then tap it again or press **Go!**.

## What you can do

- **Grow up.** You hatch small. Eat 3 pieces of food to grow, then 6 more to reach full size. Food glows so it
  stands out, and grows back after a while. Fish live in the water.
- **Meet the dinosaurs.** Walk up to one and say hello for a card with its picture, name and a couple of facts,
  read aloud. There are seven to find (Triceratops, T-Rex, Pterodactyl, Stegosaurus, Brachiosaurus, Plesiosaurus
  and Sea Turtle); the book in the corner keeps track, and finding them all gets a celebration.
- **Hatch babies.** Eggs sit in nests around the island. Hatch one and the baby follows you.
- **Bounce.** Red mushrooms are springy; bounce again without touching the ground to go higher.
- **Explore the caves.** Two caves tunnel into the hills. Touch the big crystal in the middle of each one.

Each playable dinosaur has its own thing when nothing else is in reach:

| Dinosaur    | Button  | What it does |
| ----------- | ------- | ------------ |
| T-Rex       | Roar!   | Tap for a small roar; hold to wind up a big one. The roar rolls out as a shockwave: trees shake and drop fruit, and other dinosaurs call back. A full-power roar knocks over nearby trees and dinosaurs. |
| Triceratops | Charge! | Puts its head down and dashes. Knocks over any dinosaur or tree in the way; they get back up after a few seconds. |
| Pterodactyl | Fly!    | Hold to climb, let go to float down. It can land on treetops and on other dinosaurs' backs and heads, and gets carried along when they walk. A ring on the ground shows where it will land. |

## Voice-over

The spoken lines live in `src/game/voice-lines.json`. Recorded clips for them are generated with ElevenLabs:

1. Put `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env.local` (git-ignored). `ELEVENLABS_MODEL_ID` is optional.
2. Run `npm run voices`.

Only lines whose text changed are regenerated; `npm run voices -- --all` redoes everything and
`npm run voices -- --dry` lists what would be generated. Clips go to `public/audio/voice/`. The voice is used
exactly as saved in ElevenLabs: only the text (and the model, if set) is sent. A line with no clip falls back to
the device's built-in voice.

The text in `voice-lines.json` is what gets *spoken*, so it can be spelled phonetically (for example
"Terodactyl") without changing what's shown on screen.

## Audio

Music, ambience and most effects are synthesised in the browser. Recorded clips (T-Rex roar, footsteps, dinosaur
calls, knock-over sounds, voice-over) are in `public/audio/`; sources and licences are listed in
[`public/audio/CREDITS.md`](public/audio/CREDITS.md).

## How it's built

Vite + TypeScript + Three.js. Every model — dinosaurs, trees, food, terrain, caves — is generated in code, so
there are no model or texture downloads.

```
src/
  main.ts             entry point
  geo.ts              geometry toolkit (organic tubes, blobs, merged vertex-coloured meshes, height grids)
  dino/               dinosaur models (species.ts) and their rig + animation (rig.ts)
  world/              terrain and water, vegetation and props, caves, ambient critters
  game/               game loop and rules (game.ts), dinosaurs and NPC behaviour, food, audio, input, UI
scripts/voices.mjs    ElevenLabs voice-over generator
public/audio/         recorded audio clips
```
