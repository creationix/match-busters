# Match Busters

A classic match-3 puzzle game that runs in the browser, rendered with Three.js.

**Play it:** https://creationix.github.io/match-busters/

## How to play

Drag a piece onto a neighbour (or tap two neighbours) to swap them. Line up three or more of the same shape to clear them. Each shape always has the same colour.

| Match | Creates |
| --- | --- |
| 4 in a row | Line clear: wipes a whole row or column |
| T or L shape | Bomb: clears the surrounding 3x3 area |
| 5 in a row | Colour bomb: clears every piece of its shape |

Power-ups fire when they are matched or caught in another blast. Cascades multiply your score.

There are eight levels with three kinds of goal: reach a score in a set number of moves, reach a score against the clock, or collect a number of one shape.

## Running locally

There is no build step. Serve the folder with any static web server and open it. Three.js and its rendering helpers are vendored in `vendor/three-0.160.0/`, so the game makes no CDN requests. Sound and music are synthesised with the Web Audio API.

On HTTPS (or localhost), the service worker caches the game and all rendering modules on the first visit. Once installation finishes, it can be reopened offline.

## Graphics

Smooth graphics is enabled by default on touch devices. It renders at one pixel per CSS pixel, uses simpler lighting and models, skips bloom and offscreen multisampling, and reduces particles. Turn it off in Settings to restore the full effects and Retina resolution. The choice is saved with your progress. Rendering stops while paused or hidden.

## Vendored Three.js

`vendor/three-0.160.0/` contains files from the official [`three@0.160.0` npm package](https://registry.npmjs.org/three/-/three-0.160.0.tgz): `build/three.module.js`, the six helpers imported by `index.html`, and their transitive imports. The upstream MIT license is included in that directory. The only changes to upstream files replace bare `from 'three'` imports with relative paths to `build/three.module.js`.

All imports resolve directly, without import maps, so loading the engine does not require iOS 16.4 or later. When updating Three.js, copy the complete import graph from one release, rewrite bare `three` imports as relative paths to the vendored core, update the imports in `index.html` and the asset paths in `sw.js`, and bump the service worker's `CACHE` version. Keep the core and helpers on the same release.

## Tests

Only the tests need Node.js and Playwright; playing the game requires no package installation.

```sh
npm ci
npx playwright install chromium
npm test
```

The tests check local module resolution and offline asset coverage, then exercise startup, a legal swap, offline reload, and migration from the previous service worker under a GitHub Pages-style subpath. They also compare rendering cost between graphics modes, check that pausing stops rendering, and verify that graphics preferences preserve progress. To run against WebKit, install it with `npx playwright install webkit` and run `TEST_BROWSER=webkit npm test`. To use an existing Chromium installation, set `CHROMIUM_PATH` to its executable.
