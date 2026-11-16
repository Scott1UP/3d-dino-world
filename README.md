# Dino World

A gentle 3D free-roam dinosaur game for small children. Pick an egg, hatch a dinosaur, wander the island,
eat food, bounce on mushrooms, hatch baby dinos and say hello to the other dinosaurs.
No ads, no currency, no health or survival mechanics.

## Run

```sh
npm install
npm run dev      # http://localhost:5173 — also served on your LAN, so a tablet on the same Wi-Fi can open it
npm run build    # static site in dist/
```

## Controls

- **Touch:** left thumb joystick to walk, big round button to eat / say hello / hatch / roar.
- **Keyboard:** WASD or arrow keys to walk, Space to act, Esc to pause.

## Stack

Vite + TypeScript + Three.js. Every model (dinosaurs, trees, food, terrain) is generated in code, so there
are no asset downloads. Sound effects are synthesised with WebAudio.
