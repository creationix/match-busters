const assert = require('node:assert/strict');
const { test } = require('node:test');

function audioClock() {
  const oscillators = [], gains = [];
  function param(value = 0) {
    return {
      value,
      setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); this.value = value; },
      linearRampToValueAtTime(value, time) { this.setValueAtTime(value, time); },
      exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.setValueAtTime(value, time); },
      cancelScheduledValues() {},
    };
  }
  function node() { return { disconnected: false, connect() {}, disconnect() { this.disconnected = true; } }; }
  const context = {
    currentTime: 0, state: 'running',
    createGain() { const gain = { ...node(), gain: param(1) }; gains.push(gain); return gain; },
    createOscillator() {
      const osc = { ...node(), frequency: param(),
        start(time) { assert.ok(time >= context.currentTime, 'Notes must not be scheduled in the past'); this.startTime = time; },
        stop(time) { this.endTime = time; },
      };
      oscillators.push(osc); return osc;
    },
    advance(time) {
      this.currentTime = time;
      for (const osc of oscillators) if (!osc.ended && osc.endTime <= time) { osc.ended = true; osc.onended(); }
    },
  };
  return { context, oscillators, gains, destination: node() };
}

test('nine distinct compositions give each level type its own musical pace', async () => {
  const { SONGS } = await import('../music.js');
  assert.equal(new Set(SONGS.map(song => song.title)).size, 9);
  assert.equal(new Set(SONGS.map(song => JSON.stringify(song.bars))).size, 9);
  for (const category of ['score', 'timed', 'collect']) assert.equal(SONGS.filter(song => song.category === category).length, 3);
  const bpms = kind => SONGS.filter(song => song.category === kind).map(song => song.bpm);
  assert.ok(Math.min(...bpms('timed')) > Math.max(...bpms('score')));
  assert.ok(Math.max(...bpms('collect')) < Math.min(...bpms('score')));
  assert.ok(SONGS.filter(song => song.category === 'collect').every(song => song.bars.flat().includes(null)));
});

test('long sessions rotate within the level playlist without immediate repeats', async () => {
  const { createMusicPlayer } = await import('../music.js');
  const { context, destination } = audioClock();
  const player = createMusicPlayer(context, destination), titles = [];
  player.setCategory('timed'); player.setEnabled(true);
  for (let t = 0; t < 110; t += 0.1) {
    context.advance(t); player.tick();
    if (titles.at(-1) !== player.state.title) titles.push(player.state.title);
  }
  assert.ok(titles.length >= 4);
  assert.equal(new Set(titles.slice(0, 3)).size, 3);
  assert.equal(titles[0], titles[3]);
  assert.equal(player.state.category, 'timed');
  player.setCategory('collect');
  const first = player.state.title;
  player.setCategory('collect');
  assert.notEqual(player.state.title, first);
  assert.equal(player.state.category, 'collect');
  assert.ok(player.state.bpm < 90);
});

test('mute, suspended audio, and long tab stalls do not schedule background work or catch-up bursts', async () => {
  const { createMusicPlayer } = await import('../music.js');
  const { context, oscillators, destination } = audioClock();
  const player = createMusicPlayer(context, destination);
  player.setCategory('score'); player.tick();
  assert.equal(oscillators.length, 0);
  player.setEnabled(true); player.tick();
  assert.ok(oscillators.length > 0);
  context.advance(30);
  const beforeStall = oscillators.length;
  player.tick();
  assert.ok(oscillators.length - beforeStall < 12);
  player.setEnabled(false);
  const beforeMute = oscillators.length;
  context.advance(31); player.tick();
  assert.equal(oscillators.length, beforeMute);
  assert.ok(oscillators.every(osc => osc.ended && osc.disconnected));
  player.setEnabled(true);
  context.state = 'suspended'; player.tick();
  assert.equal(oscillators.length, beforeMute);
  context.state = 'running'; player.tick();
  assert.ok(oscillators.length > beforeMute);
});

test('track changes fade out and disconnect old voices rather than accumulating audio nodes', async () => {
  const { createMusicPlayer } = await import('../music.js');
  const { context, oscillators, gains, destination } = audioClock();
  const player = createMusicPlayer(context, destination);
  player.setCategory('collect'); player.setEnabled(true);
  let maxVoices = 0;
  for (let t = 0; t < 150; t += 0.1) {
    context.advance(t); player.tick();
    maxVoices = Math.max(maxVoices, oscillators.filter(osc => !osc.ended).length);
  }
  assert.ok(maxVoices < 24, `Too many simultaneous voices: ${maxVoices}`);
  player.setCategory('timed'); player.tick();
  player.dispose(); context.advance(151);
  assert.ok(oscillators.every(osc => osc.ended && osc.disconnected));
  assert.ok(gains.every(gain => gain.disconnected));
});
