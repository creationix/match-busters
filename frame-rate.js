// Ignore startup work, then require two slow windows before interrupting play.
export function createFrameRateMonitor() {
  let warmup, elapsed, frames, slowWindows;
  function reset() { warmup = 2000; elapsed = 0; frames = 0; slowWindows = 0; }
  reset();
  return {
    reset,
    sample(delta) {
      if (!Number.isFinite(delta) || delta <= 0) return false;
      if (warmup > 0) { warmup -= delta; return false; }
      elapsed += delta; frames++;
      if (elapsed < 2000) return false;
      slowWindows = frames * 1000 / elapsed < 30 ? slowWindows + 1 : 0;
      elapsed = 0; frames = 0;
      if (slowWindows < 2) return false;
      reset(); return true;
    },
  };
}
