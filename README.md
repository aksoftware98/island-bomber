# Island Bomber

Choose **Small island** (the original map) or **Large island** (seven times the dry-land area,
with villages, roads, mountains and a harbour). Large-map levels contain **20, 24 and 28 AI
vehicles**; small-map levels retain 4, 6 and 8. Both islands remain separate assets.

Choose **Jet pilot** or **Ground anti-air** before solo play, or choose your own role in the
online lobby. The host chooses the map, level and difficulty for everyone.

- Jet-only rooms retain Co-op and Bomb race.
- Mixed roles play **Air vs ground** for five minutes. Jets bomb player-controlled ground
  vehicles; gunners shoot down player jets. Player eliminations decide the winning team;
  destroying background AI trucks does not add team kills. Players respawn after four seconds.
- Ground-only rooms play **Defence** together against three AI raiders. Stop six aircraft
  in five minutes. Solo ground defence gives you three minutes and one life. Raiders make
  bombing runs, so keep moving while you shoot.

Ground controls: **W/S** drive forward/reverse, **A/D** steer, **Shift** boost, **mouse** or
**arrow keys / IJKL** aim the turret, hold **Space / left mouse** to fire, **R** reload,
**C** switch between chase and gunner sight, **P / Esc** pause/menu. The gun traverses freely,
elevates from 2° to 83°, holds 30 rounds and reloads automatically when empty (two seconds).
On touch devices the left stick drives, the right **AIM** stick aims, and holding **FIRE** shoots.
On desktop, click the game once to capture the mouse, then move freely without reaching a
window edge. The capture click does not shoot. Press **F**, or use **Fullscreen & capture**, to
enter fullscreen with mouse aiming. **Esc** releases the cursor and pauses/opens the online menu.
Click the game again after resuming to recapture. The sensitivity slider remembers your setting;
**C** switches to a slower precision sight. Keyboard and touch aiming work without mouse capture.
Water, steep slopes and building footprints block driving. Buildings also stop bombs and flak.

Combat audio uses the WAV recordings in `assets/audio`: bomb falls, machine-gun fire and
explosions. Bomb whistles follow each bomb's predicted flight and stop at impact, including
remote players and AI raiders. Distance controls loudness; overlapping gunshots and explosions
are limited and compressed. Solo pause freezes audio with the simulation. Missing recordings
fall back to generated sounds; engine, UI, hit and water sounds remain generated.

The host simulates NPC vehicles, raiders and combat damage. Player vehicle positions and turret
angles are synchronized separately. This remains a casual host-authoritative game, rather than
a dedicated authoritative simulation server.

For development checks, run `npm install` then `npm test` (uses installed Microsoft Edge).
The browser suite checks both maps, all large-map population counts, solo ground controls,
and real two-browser firing, bombing, scoring and respawns. It serves the matching Three.js
files locally during testing to avoid depending on the CDN.

A small, silly browser game about free fall. Fly a low poly jet over an island and drop a limited
number of unguided bombs on anti-air pickup trucks that drive around and shoot back. A bomb keeps
your jet's velocity when you let go and then only gravity acts on it, so you have to release it
before you reach the target, and aim where the truck will be when the bomb lands. Play alone, or
online with up to 3 friends.

## Run it

The models are `.glb` files, which browsers will not load from `file://`, so serve the folder:

```bash
node server.mjs
```

Then open http://localhost:5173. three.js loads from the jsDelivr CDN, so the first load needs an
internet connection. Solo play works from any static file server; online play needs this one,
because it also runs the room relay.

## Play online

1. Run `node server.mjs` on one computer. It prints the address friends on the same network can use.
2. Open the game, choose **Play online**, enter a name and **Create a room**.
3. Friends open the same server's address and join with the 4-letter code, or open the invite link.
4. Everyone picks a jet. The host picks the mode, level and difficulty, then starts.

Friends on other networks need the server to be reachable from the internet, for example through a
tunnel such as `cloudflared tunnel --url http://localhost:5173` or by hosting `server.mjs` somewhere.

- **Co-op:** clear the island together within 5 minutes. Team score.
- **Bomb race:** same trucks, most points in 5 minutes wins.
- Crashing costs 100 points, and you are back in the air with full bombs after 4 seconds.

How it works: the room creator's browser is the host. It drives the trucks, fires the flak and decides
what every bomb hit. Each player flies their own jet and sends its position 15 times a second. Bomb
physics is deterministic, so a drop only sends the release point and velocity, and every screen
computes the same fall. To try it on one computer, open http://localhost:5173/tools/two-players.html,
which shows two copies of the game side by side.

## Difficulty

| | Easy | Normal | Hard |
|---|---|---|---|
| Truck driving speed | 3 m/s | 6 m/s | 10 m/s |
| Flak damage per hit | 12 | 16 | 20 |
| Flak aim | Sloppy | Leads you a bit | Leads you well |
| Jet health | 150 | 100 | 100 |
| Release countdown | Yes | Yes | No |
| Landing marker and arc | Yes | No | No |
| Score multiplier | × 0.5 | × 1 | × 1.5 |

A bomb within 14 m destroys a truck. A near miss within 22 m damages it (it smokes and slows down),
and a second near miss finishes it. Fly through the green ring on the runway, below 35 m, to reload
bombs and repair the jet.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Turn | A / D or Left / Right | Stick left / right |
| Nose down / up | W / S or Up / Down | Stick up / down |
| Faster / slower | Shift or E / Q | + / − |
| Drop bomb | Space | BOMB |
| Bomb cam | C | CAM |
| Physics panel | H | |
| Pause | P or Esc | II |

## What the physics panel shows

- **Manoeuvring:** speed, bank angle φ, turn rate ω = g·tan φ / v, turn radius r = v² / (g·tan φ),
  load factor n = 1 / cos φ, pitch, and climb rate. The jet really turns at the rate shown.
- **Free fall if you drop now:** drop height, forward speed, fall time
  t = (v_y + √(v_y² + 2gh)) / g, throw distance d = v_h·t, wind drift on level 3, and impact speed.
- **Nearest truck:** how far ahead and to the side it is, how far it drives while the bomb falls
  (its speed times the fall time), how far until you should release (distance minus throw, aimed at
  where the truck will be), and how far to steer. On Easy and Normal the same numbers drive a
  countdown bar in the middle of the screen.
- **Last bomb:** live time, height fallen and forward travel while it falls; afterwards, its flight
  time and how far short, long, left or right it landed.

After each bomb lands, a white trail shows its parabola and a dashed yellow line shows where you let
go and how far it travelled.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | Page, HUD and menus |
| `js/main.js` | Game loop, rules, cameras, scoring |
| `js/world.js` | Island, sea, sky, lights, clouds, exact terrain height lookup |
| `js/jet.js` | Flight model |
| `js/bomb.js` | Bomb physics (exact constant-acceleration steps at 120 Hz) and the bomb model |
| `js/enemy.js` | Levels, difficulties, truck driving and aiming, flak |
| `js/net.js` | Online room client |
| `server.mjs` | Static file server and WebSocket room relay, no dependencies |
| `tools/two-players.html` | Two copies of the game side by side, for testing online play |
| `js/effects.js` | Explosions, debris, smoke, splashes, scorch marks |
| `js/hud.js`, `js/input.js`, `js/audio.js` | HUD and radar, keyboard/touch controls, recorded combat audio and generated UI/engine sounds |
| `assets/` | Models exported from Blender |
| `PLAN.md` | The original design brief |

The island is scaled 3× and the jets and trucks 2.5× from the exported models, so the playable
island is about 660 m by 480 m.
