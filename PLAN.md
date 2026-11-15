# Island Bomber: build plan

A tiny, silly browser game. The player flies a low poly jet over an island and drops unguided
bombs on anti-air pickup trucks. Bombs are limited, and there is no aiming aid: the player has
to judge the release point from their speed and altitude (projectile motion).

This document is the full brief for building the game. The 3D models already exist and are
exported; do not remodel them.

## 1. What already exists

```
island-bomber/
  PLAN.md                    this file
  assets/
    jet_f16.glb              player jet option 1 (blue)
    jet_f35.glb              player jet option 2 (green)
    jet_f22.glb              player jet option 3 (purple)
    pickup_aa.glb            enemy: pickup truck with anti-air gun
    island.glb               terrain + water + trees
  source/
    island-bomber.blend      Blender source (Blender 5.3), reference only
```

All files are binary glTF 2.0 (`.glb`), no textures, no Draco, flat colour materials only.
Total size is about 535 KB.

## 2. Asset reference

Units are metres. Coordinates below are **three.js / glTF space**: Y is up.
Blender `(x, y, z)` maps to three.js `(x, z, -y)`.

### Jets

| File | Node name | Width (X) | Length (Z) | Height (Y) | Triangles |
|---|---|---|---|---|---|
| `jet_f16.glb` | `LowPolyJet_F16` | 5.05 | 5.95 | 2.49 | 396 |
| `jet_f35.glb` | `LowPolyJet_F35` | 4.60 | 5.55 | 2.00 | 308 |
| `jet_f22.glb` | `LowPolyJet_F22` | 5.20 | 6.75 | 2.23 | 304 |

- **Nose points along +Z.** Wings span X. Up is +Y.
- Origin is the centre of the fuselage. The belly is about 0.4 to 0.7 below the origin.
- There is no landing gear and no moving parts.
- Each jet is one mesh with several materials, so three.js loads it as a `Group` of
  sub-meshes. Treat the loaded `scene` as one object.
- The engine exhaust material is `Jet_Glow` (emissive). It can be pulsed for a thrust effect.

### Anti-air pickup

| File | Node name | Width (X) | Length (Z) | Height (Y) | Triangles |
|---|---|---|---|---|---|
| `pickup_aa.glb` | `LowPolyPickup_AA` | 1.66 | 3.58 | 2.27 | 564 |

- **Front of the truck points along +Z.** Origin is on the ground under the truck's centre,
  so placing it at a terrain point puts the wheels on the ground.
- The gun is fused into the truck mesh, fixed at 35 degrees elevation, aiming forward over
  the cab. It cannot swivel independently. To "aim", rotate the whole truck around Y so its
  front faces the jet. That looks funny, which is fine for this game.
- Muzzle position in truck-local space is about `(0, 2.25, 0.19)`. Spawn tracers there.
- The truck is small next to the island. Scale it up (2x to 3x) in game so it is visible
  from the air. Scale the jet by the same factor to keep them consistent.

### Island

`island.glb` holds three nodes:

| Node name | What it is | Triangles |
|---|---|---|
| `LowPolyIsland` | Terrain grid, X from -110 to 110, Z from -80 to 80 | 4,400 |
| `LowPolyIsland_Water` | Sea surface, X from -130 to 130, Z from -108 to 100 | 160 |
| `LowPolyIsland_Trees` | 90 pines and 25 boulders, one merged mesh | 2,920 |

- **Sea level is Y = 0.** Seabed drops to Y = -7 at the terrain edge.
- Highest peak is about Y = 30, near `(-55, 30, -12)`.
- Land covers roughly X from -85 to 87 and Z from -60 to 57.
- A flat plain sits at **Y = 2**, centred at `(5, 2, 5)`. It is fully flat within a radius
  of 12 and close to flat out to about 25. No trees or boulders within 30 of its centre.
- Mountain centres (X, Z), with rough peak height:

| X | Z | Height |
|---|---|---|
| -58 | -18 | 30 |
| -34 | 20 | 18 |
| -70 | 12 | 15 |
| 60 | -24 | 25 |
| 48 | 24 | 14 |
| 76 | -2 | 12 |
| 2 | -42 | 12 |

- Terrain material names: `Isle_Sand`, `Isle_Grass`, `Isle_Forest`, `Isle_Rock`,
  `Isle_Snow`, `Isle_Seabed`. Water is `Isle_Water`.
- There is no height map file. Get ground height by raycasting straight down against the
  `LowPolyIsland` node (use `three-mesh-bvh` or cache results; the mesh is small enough that
  a plain `Raycaster` is acceptable for a handful of queries per frame).

## 3. Tech stack

- **three.js** (latest stable) loaded as ES modules from a CDN through an import map.
  No bundler, no framework, no build step.
- `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.
- Plain HTML and CSS for the HUD and menus, layered over the canvas.
- Web Audio API for sound, generated in code (oscillators and noise). No audio files.
- Must run from any static file server. `.glb` files cannot be loaded from `file://`.

Target structure:

```
island-bomber/
  index.html
  css/style.css
  js/main.js           boot, loop, state machine
  js/assets.js         GLB loading and caching
  js/world.js          island, water, sky, lights, terrain height query
  js/jet.js            player flight model and controls
  js/bomb.js           bomb physics, impact, explosions
  js/enemy.js          truck placement, aiming, firing
  js/hud.js            HUD, menus, messages
  js/audio.js          generated sound effects
  assets/              (already present)
```

## 4. Game design

### Core loop

1. Pick a jet (three choices, cosmetic only).
2. The jet spawns over the sea, already flying toward the island.
3. Fly over the island, drop bombs on trucks, avoid flak.
4. Win when every truck is destroyed. Lose when out of bombs with trucks remaining and no
   bomb still in the air, or when the jet's health reaches zero, or when it hits the ground.
5. Show a results screen with a score and a "fly again" button.

### Flight model (keep it arcade simple)

- The jet always moves forward. It cannot stop or hover.
- Throttle sets speed between 25 and 70 m/s. Default 40.
- Left and right bank the jet and turn it (max roll about 60 degrees, turn rate tied to roll).
- Up and down pitch the jet gently, limited to plus or minus 25 degrees. Altitude is clamped
  between 8 and 120 m.
- Flying outside a radius of about 260 from the island centre turns the jet back
  automatically, with a short "wrong way, ace" message.
- Collision with terrain or water ends the run with a big, daft explosion.

Controls:

| Input | Action |
|---|---|
| A / D or Left / Right | Turn |
| W / S or Up / Down | Pitch down / up |
| Shift / Ctrl | Throttle up / down |
| Space | Drop bomb |
| C | Toggle camera (chase / bomb cam) |
| P or Esc | Pause |

Add on-screen touch buttons for mobile: a left stick area and a large BOMB button.

### Bomb physics (the point of the game)

- On release the bomb takes the jet's **full velocity vector** and then is only affected by
  gravity: `g = 9.81 m/s^2` downward. No drag, no wind in the base game.
- Integrate with a fixed time step (for example 1/120 s) so results are frame-rate
  independent and repeatable.
- For level flight the forward travel before impact is `d = v * sqrt(2h / g)`, where `v` is
  speed and `h` is height above the target. The player must release that far before the target.
- Example for the tutorial card: at 40 m/s and 45 m altitude, the bomb falls for about 3.0 s
  and lands about 121 m ahead.
- The bomb rotates to point along its velocity. Build it from primitives in code: a stretched
  sphere or cylinder body with four small fins. No model file is needed.
- Impact is detected by comparing bomb height to terrain height (raycast down) or to sea
  level, whichever is hit first.
- Blast radius 9 m. Any truck inside it is destroyed. Water impacts make a splash and
  count as a miss.
- Minimum 0.5 s between drops.

### Limited bombs

- Bombs available = number of trucks + 2. Level 1 has 4 trucks, so 6 bombs.
- No reloads. The HUD shows remaining bombs as icons.
- Hitting two trucks with one bomb gives a bonus and a ridiculous message.

### Enemies

- Place trucks at level start by picking random points on land, raycasting down, and
  rejecting points where the surface is steeper than about 15 degrees, below Y = 1.5, or
  within 12 m of another truck. Always put at least one on the central plain.
- Align each truck to the terrain normal and give it a random heading.
- A truck notices the jet within 140 m horizontal range. It then turns to face the jet
  (whole truck rotates, slowly, about 60 degrees per second) and fires bursts.
- Tracers are small glowing boxes travelling at 120 m/s with no gravity. Trucks aim at the
  jet's current position with no lead, so a turning or fast jet is rarely hit. Each hit
  removes 10 health out of 100.
- Trucks do not drive around in the base game.
- A destroyed truck launches upward spinning, bounces once, and leaves a scorch decal and
  a smoke column.

### Difficulty levels

| Level | Trucks | Bombs | Flak range | Notes |
|---|---|---|---|---|
| 1 | 4 | 6 | 100 m | Trucks only on the plain and beaches |
| 2 | 6 | 8 | 140 m | Trucks also in foothills |
| 3 | 8 | 9 | 160 m | Light crosswind shown by a wind sock arrow in the HUD |

### HUD

- Top left: speed (m/s), altitude above ground (m), height above sea (m).
- Top right: bombs left (icons), trucks left, health bar.
- Centre bottom: short, funny status messages that fade out.
- **No bomb sight and no predicted impact marker by default.** Offer a "training wheels"
  toggle in the menu that draws the predicted impact point; using it halves the score.
- A one-screen "how bombs work" card before the first flight, with the formula above and
  the worked example.

### Camera

- Default: chase camera behind and above the jet, smoothed, looking slightly down so the
  ground ahead is visible.
- Bomb cam: when a bomb is released, a small picture-in-picture view (or full view while C
  is held) follows the bomb down.

### Tone and humour

- Bright sky gradient, soft fog toward the horizon, cartoon puff clouds made of merged spheres.
- Explosions are chunky low poly spheres that scale up and fade, plus flying debris cubes.
- Messages on events, for example on a miss: "The fish are furious." On a double kill:
  "Two for one. Physics teacher is proud." On a crash: "The mountain did not move."
- Trucks honk (a short square-wave beep) when a bomb lands near them but misses.
- Keep all text short. No gore, no real-world references.

### Scoring

- 100 per truck, 150 extra for a double kill, 50 per unused bomb, 1 per health point left.
- Halved if training wheels were on. Store the best score per level in `localStorage`.

## 5. Rendering notes

- Use `MeshStandardMaterial` as loaded, set `flatShading = true` on every material after
  loading so the low poly look is crisp.
- One `DirectionalLight` (sun, with shadows enabled only for jet, trucks and bombs) plus a
  `HemisphereLight` for sky and ground fill.
- Animate the water by gently offsetting the `LowPolyIsland_Water` vertices in Y with a sine
  wave, or leave it static if performance matters.
- Scene background colour should match the fog colour.
- Cap the device pixel ratio at 2. Target 60 fps on a mid-range laptop.

## 6. Build order

1. Static page, import map, renderer, resize handling, render loop with fixed-step update.
2. Load `island.glb`, add lights, sky and fog. Orbit camera for a visual check.
3. Terrain height query by raycast, with a small cache.
4. Load a jet, implement the flight model, chase camera and world bounds.
5. Bomb release, physics, impact detection, explosion and splash effects.
6. Truck placement, destruction, win condition, bomb counter and lose condition.
7. Truck aiming, tracers, jet health, crash detection.
8. HUD, menus, jet select, tutorial card, results screen, pause.
9. Sound, messages, bomb cam, training wheels toggle.
10. Levels 2 and 3, scoring, `localStorage`, touch controls.

## 7. Acceptance checks

- All five `.glb` files load with no console errors and appear at the right scale and
  orientation (jet nose leads its direction of travel, truck wheels on the ground).
- A bomb dropped in level flight at 40 m/s from 45 m above flat ground lands 121 m ahead,
  within 2 m, at any frame rate.
- Bombs cannot be dropped once the counter reaches zero, and the game ends correctly in
  each win and lose case.
- Trucks are never placed in water, on steep slopes, or overlapping each other.
- The game is playable with keyboard only and with touch only.
- No network requests other than the three.js CDN modules and the local assets.

## 8. Running locally

```bash
bunx serve .
```

Then open the printed local address in a browser.

## 9. Out of scope for the first version

- Multiplayer, saved progress beyond best scores, and additional islands.
- Driving trucks, a separately rotating gun turret, landing and take-off.
- Any change to the exported models. If a model change is needed, edit
  `source/island-bomber.blend` and re-export with the same file names and axes.
