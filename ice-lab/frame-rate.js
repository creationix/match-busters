// A puzzle remains playable at 20–30 FPS. Only offer a change for sustained,
// consistently slow frames, rather than an average pulled down by brief stalls.
export function createFrameRateMonitor() {
  let warmup, elapsed, frames, slowFrames, slowWindows;
  function reset() { warmup = 4000; elapsed = 0; frames = 0; slowFrames = 0; slowWindows = 0; }
  reset();
  return {
    reset,
    sample(delta) {
      if (!Number.isFinite(delta) || delta <= 0) return false;
      if (warmup > 0) { warmup -= delta; return false; }
      elapsed += delta; frames++;
      if (delta > 1000 / 20) slowFrames++;
      if (elapsed < 3000) return false;
      slowWindows = slowFrames / frames >= 0.8 ? slowWindows + 1 : 0;
      elapsed = 0; frames = 0; slowFrames = 0;
      if (slowWindows < 3) return false;
      reset(); return true;
    },
  };
}
