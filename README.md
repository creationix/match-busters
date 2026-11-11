# Match Busters

A classic match-3 puzzle game that runs in the browser, with shiny Three.js graphics and an optional lightweight Canvas 2D renderer.

**Play it:** https://creationix.github.io/match-busters/

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

## Graphics

Fancy is the default graphics mode and keeps the original shiny 3D renderer. Extreme adds much stronger bloom, animated RGB fringes, brighter power-ups, larger particle bursts, and extra screen shake. Smooth uses the lightweight renderer described below. Choose any mode under Settings → Graphics.

After startup, if 3D play stays below 30 frames per second for two consecutive two-second windows, the game pauses and offers **Use smooth graphics** or **Keep 3D**. It remembers your choice; choosing Keep 3D suppresses further offers.

Smooth graphics uses Canvas 2D with cached sprites and fewer particles. It does not import Three.js or create a WebGL context, and settled boards are not redrawn. Power-ups, cascades, scoring, controls, and saved progress work in both modes. Rendering stops while paused or hidden. If WebGL cannot start, the game falls back to Canvas 2D.

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
