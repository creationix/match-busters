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

It is a single file, `index.html`, with no build step. Serve the folder with any static web server and open it. Three.js loads from a CDN, so an internet connection is needed. Sound and music are synthesised with the Web Audio API.
