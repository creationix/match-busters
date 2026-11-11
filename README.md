# Match Busters

A classic match-3 puzzle game that runs in the browser, with shiny Three.js graphics and an optional lightweight Canvas 2D renderer.

**Play it:** https://creationix.github.io/match-busters/

## Ice Lab playtest

Try the separate [Ice Lab prototype](https://creationix.github.io/match-busters/ice-lab/). Its four experiments are unlocked from the start and use their own progress and offline cache. The main game's levels and progress are unchanged; the lab initially inherits your graphics and audio preferences.

Frozen pieces stay anchored and cannot swap, but their colors still count in matches. Matches through or orthogonally beside ice chip one layer per cascade step. Line clears and color bombs also thaw ice; bombs hit a larger 3×3 area. Thick ice takes two hits. Swap any power-up with a normal neighbor to fire it at its destination, double-tap to fire it in place, or swap adjacent power-ups to combine them:

| Pair | Effect |
| --- | --- |
| Bomb + bomb | Hot 5×5 blast, melting both ice layers |
| Bomb + line | Three rows and three columns; one ice hit per cell |
| Line + line | Cross clear, chipping ice along both lines |
| Color bomb + bomb | Pieces of the partner's color become bombs and detonate |
| Color bomb + line | Pieces of the partner's color become line clears |
| Color bomb + color bomb | Clear unfrozen pieces and chip all ice, triggering power-ups |

First Thaw has no starter power-ups and teaches thawing through ordinary matches. Crossfire teaches combinations, Deep Freeze introduces thick ice, and Prism Storm provides an optional color-bomb chain. Starter pairs are bonuses; every ice island can be chipped by regular play. This spike focuses on these mechanics; spreading ice and seeker pieces are future experiments.

## How to play

Drag a piece onto a neighbour (or tap two neighbours) to swap them. Line up three or more of the same shape to clear them. Each shape always has the same colour.

| Match | Creates |
| --- | --- |
| 4 in a row | Line clear: wipes a whole row or column |
| T or L shape | Bomb: clears the surrounding 3x3 area |
| 5 in a row | Colour bomb: clears every piece of its shape |

Power-ups fire when they are matched or caught in another blast. Cascades multiply your score.

There are sixteen levels with three kinds of goal: reach a score in a set number of moves, reach a score against the clock, or collect a number of one shape. Levels 9–16 raise the targets and introduce collection goals for blue doughnuts and red squares.

## Running locally

There is no build step. Serve the folder with any static web server and open it. Three.js and its rendering helpers are vendored in `vendor/three-0.160.0/`, so the game makes no CDN requests. Sound and music are synthesised with the Web Audio API.

On HTTPS (or localhost), the service worker caches the game and all rendering modules on the first visit. Once installation finishes, it can be reopened offline.

## Board layouts

Auto-fit is the default: it expands the 8×8 board along the available screen axis, up to 8×16 or 16×8, while keeping square tiles. The board uses the available play area, and landscape screens put the HUD beside it. The installed app supports both orientations. Settings → Board also offers Classic 8×8, Tall 8×12, and Wide 12×8 (columns × rows).

Dimensions are chosen when a level starts and stay fixed for that run. Rotating the screen resizes the current board without rearranging pieces; the next run fits the new orientation. Board preferences and existing progress are saved. Level goals and move limits stay the same.

## Graphics

Fancy is the default graphics mode and keeps the original shiny 3D renderer. Extreme adds much stronger bloom, animated RGB fringes, brighter power-ups, larger particle bursts, and extra screen shake. Smooth uses the lightweight renderer described below. Choose any mode under Settings → Graphics.

The performance check ignores the first four seconds, unfocused windows, and graphics switching. It only offers a change when at least 80% of frames are slower than 20 FPS in three consecutive three-second windows. Steady 20–30 FPS and occasional stalls do not trigger it. The game pauses and offers one step down: **Extreme → Fancy**, or **Fancy → Smooth**. Each change starts a fresh check, so Fancy gets a chance before suggesting Smooth. You can keep the current mode instead, which suppresses further offers. Choices are saved.

Smooth graphics uses Canvas 2D with cached sprites and fewer particles. It does not import Three.js or create a WebGL context, and settled boards are not redrawn. Power-ups, cascades, scoring, controls, and saved progress work in both modes. Rendering stops while paused or hidden. If WebGL cannot start, the game falls back to Canvas 2D.

## Music

Each run picks one of nine original synthesized songs and loops it until the run ends. Score levels use **Starlight Shuffle** (the original arpeggio, now with a contrasting middle section), **Sunbeam Steps**, and **Moonlit Mosaic**. Timed levels use the faster **Neon Sprint**, **Clockwork Dash**, and **Final Lap**, with driving bass and percussion. Collection levels use the slower **Glass Garden**, **Lantern Study**, and **Quiet Constellations**, with soft bells, spacious phrasing, and gentle harmony.

Each song has a sixteen-bar arrangement, and transitions fade between tracks. Changing levels or retrying selects the next song from that level type's playlist; menus and results return to the relaxed themes. Music pauses with the game, including during graphics-choice dialogs and when the tab is hidden, and resumes the same track when play continues. Everything is generated locally with Web Audio and works offline. The Music setting remains independent of sound effects, and muting music stops scheduling its voices.

## Vendored Three.js

`vendor/three-0.160.0/` contains files from the official [`three@0.160.0` npm package](https://registry.npmjs.org/three/-/three-0.160.0.tgz): `build/three.module.js`, the six helpers imported by `render-3d.js`, and their transitive imports. The upstream MIT license is included in that directory. The only changes to upstream files replace bare `from 'three'` imports with relative paths to `build/three.module.js`.

All imports resolve directly, without import maps, so loading the engine does not require iOS 16.4 or later. When updating Three.js, copy the complete import graph from one release, rewrite bare `three` imports as relative paths to the vendored core, update the imports in `render-3d.js` and the asset paths in `sw.js`, and bump the service worker's `CACHE` version. Keep the core and helpers on the same release.

## Tests

Only the tests need Node.js and Playwright; playing the game requires no package installation.

```sh
npm ci
npx playwright install chromium
npm test
```

The tests cover local module resolution, offline assets and upgrades, swaps and resizing, power-up chains and refills, frame-rate detection, the graphics offer, mode switching, and saved progress. They also verify that smooth mode works with WebGL disabled and that settled boards are not redrawn. To run against WebKit, install it with `npx playwright install webkit` and run `TEST_BROWSER=webkit npm test`. To use an existing Chromium installation, set `CHROMIUM_PATH` to its executable.
