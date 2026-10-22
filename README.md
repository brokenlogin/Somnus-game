# Somnus

A short first-person liminal-space horror game built with three.js. You are stuck in a dream and have to pass through five places to wake up.

## Run it

```bash
./serve.sh
```

Then open http://localhost:8080. To use a different port, pass it as an argument, for example `./serve.sh 9000`.

There is no build step, and every sound and texture is generated in code. three.js loads from the jsDelivr CDN, so the first load needs an internet connection. The game won't run from `file://`: it has to be served from localhost.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look (click the game to capture the mouse) |
| W A S D | Move |
| Shift | Run (limited stamina) |
| Space | Jump |
| E | Interact: doors, keys, the chest |
| Esc | Pause (look sensitivity is in the pause menu) |

Headphones help: every key plays a faint music-box tune you can follow by ear.

## The dream

1. **The Town That Repeats.** A foggy suburb. Walk off one edge of the map and you come back in on the other side.
2. **A Small, Square World.** A tiny cube-shaped planet. Walk over an edge and gravity turns with you.
3. **The Long Way Down.** A spiral staircase street running far up and down a hollow tower, lined with houses.
4. **Where the Walls Remember.** A pitch-dark labyrinth: one long winding path with no forks, past a few strange rooms. You have a flashlight.
5. **The House Above the Clouds.** A maze-like mansion floating in the night sky. You start on the porch.

In levels 1 to 4 you arrive through a door that shuts and locks behind you. Sometimes it's freestanding, sometimes it's the front door of a house. Find the key, then find the door with light leaking under it.

### Things in the dream

- **Voyer** watches you. It stands half hidden at the edge of your vision and slips away if you stare at it.
- **Disciple** follows you. It's a silhouette that walks in your footsteps, freezes when you look at it, and vanishes if you get close.
- **Chasseur** hunts you. Mostly it waits for the end... though something is standing very still inside the phone booth in the labyrinth. You don't have to open it.

## Dev shortcuts

- `?level=N` starts at level N: 1 to 5, 6 is the fall, 7 is waking up.
- `?nolock` turns off pointer lock and pausing, which is useful in embedded browsers.
- In the console, `__game` is the game object. `__game.step(seconds)` advances the simulation and `__game.pickKey()` gives you the key.

## Layout

```
index.html, style.css     page and overlay UI
src/main.js               game loop, level loading, interaction, ending
src/core/                 input, UI, audio synth, post-processing, textures, collision, player
src/props/                freestanding door, key, building helpers (houses, lamps, trees...)
src/monsters/             Voyer, Disciple, Chasseur
src/levels/               one file per level, plus wake.js for the fall and the ending
```
