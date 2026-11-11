// Original, procedurally synthesized score. No recordings or network assets.
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(note) {
  const match = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!match) throw new Error('Invalid note: ' + note);
  return (Number(match[3]) + 1) * 12 + PITCH[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
const hz = note => 440 * Math.pow(2, (note - 69) / 12);
function phrase(text, stepsPerBar) {
  return text.split('|').map(bar => {
    const steps = [];
    for (const token of bar.trim().split(/\s+/)) {
      const [note, length = '1'] = token.split(':');
      const duration = Number(length);
      if (!Number.isInteger(duration) || duration < 1) throw new Error('Invalid duration: ' + token);
      steps.push(note === '-' ? null : { note: midi(note), length: duration });
      for (let i = 1; i < duration; i++) steps.push(null);
    }
    if (steps.length !== stepsPerBar) throw new Error('Incorrect bar length: ' + bar);
    return steps;
  });
}
function song(title, category, bpm, beats, voice, harmony, a, b) {
  const chords = harmony.split('|').map(chord => chord.trim().split(/\s+/).map(midi));
  const verse = phrase(a, beats * 2), bridge = phrase(b, beats * 2);
  if (verse.length !== 4 || bridge.length !== 4) throw new Error('Songs need four-bar phrases');
  return { title, category, bpm, beats, voice, chords, bars: [...verse, ...verse, ...bridge, ...verse] };
}

export const SONGS = [
  // Keep the original A-minor arpeggio, then give it a contrasting middle section.
  song('Starlight Shuffle', 'score', 100, 4, 'sine',
    'A3 C4 E4 | F3 A3 C4 | C4 E4 G4 | G3 B3 D4',
    'A3 C4 E4 C4 A4 E5 C5 E5 | F3 A3 C4 A3 F4 C5 A4 C5 | C4 E4 G4 E4 C5 G5 E5 G5 | G3 B3 D4 B3 G4 D5 B4 D5',
    'E5:2 A5 G5 E5:2 C5:2 | F5:2 E5 C5 A4:2 C5:2 | G5 E5 C5:2 E5:2 G5:2 | D5:2 B4:2 G4:2 -:2'),
  song('Sunbeam Steps', 'score', 112, 4, 'pluck',
    'D3 F#3 A3 | G3 B3 D4 | B2 D3 F#3 | A2 C#3 E3',
    'F#5:2 A5 F#5 E5:2 D5:2 | G5:2 B5 A5 G5 F#5 E5:2 | F#5 D5 B4:2 D5 F#5 A5:2 | E5:2 C#5:2 A4:2 -:2',
    'A5:2 B5 A5 F#5 E5 D5:2 | B5 A5 G5:2 F#5 G5 A5:2 | F#5:2 D5 F#5 B5 A5 F#5 D5 | E5 F#5 E5 C#5 D5:2 -:2'),
  song('Moonlit Mosaic', 'score', 96, 4, 'warm',
    'E3 G3 B3 | C3 E3 G3 | A2 C3 E3 | B2 D#3 F#3',
    'B4:2 E5:2 G5 F#5 E5:2 | E5:2 D5 C5 G4:2 -:2 | A4 C5 E5:2 G5 E5 C5:2 | F#5:2 D#5:2 B4:2 -:2',
    'G5 B5 A5 G5 F#5 E5 D5:2 | G5:2 E5:2 C5 D5 E5:2 | E5:2 A5 G5 E5 D5 C5:2 | D#5 F#5 B5 A5 F#5 D#5 B4:2'),

  song('Neon Sprint', 'timed', 144, 4, 'pluck',
    'A3 C4 E4 | F3 A3 C4 | D3 F3 A3 | E3 G#3 B3',
    'A4 E5 A5 E5 G5 E5 C5 E5 | A4 C5 F5 A5 G5 F5 E5 C5 | D5 A5 F5 A5 E5 A5 D5 F5 | E5 B5 G#5 B5 E5:2 -:2',
    'C6 B5 A5 E5 G5 E5 A5:2 | A5 G5 F5 C5 E5 C5 F5:2 | F5 E5 D5 A4 C5 A4 D5 F5 | G#5 A5 B5 G#5 E5 B4 E5:2'),
  song('Clockwork Dash', 'timed', 156, 4, 'pulse',
    'D3 F3 A3 | Bb2 D3 F3 | G2 Bb2 D3 | A2 C#3 E3',
    'D5 D5 A5 F5 D5 A4 C5 D5 | F5 F5 Bb5 A5 F5 D5 C5 Bb4 | D5 G5 Bb5 G5 F5 D5 G5:2 | E5 A5 C#6 A5 E5 C#5 A4:2',
    'A5 F5 D5 F5 A5 C6 D6:2 | Bb5 A5 F5 D5 F5 A5 Bb5:2 | G5 D5 Bb4 D5 G5 Bb5 A5 G5 | A5 E5 C#5 E5 G5 E5 D5:2'),
  song('Final Lap', 'timed', 138, 4, 'triangle',
    'E3 G3 B3 | C3 E3 G3 | G2 B2 D3 | D3 F#3 A3',
    'E5 G5 B5 G5 E5:2 D5 E5 | G5 E5 C5 E5 G5 A5 G5:2 | B4 D5 G5 D5 B4 D5 G5 A5 | F#5 A5 D6 A5 F#5 E5 D5:2',
    'B5:2 A5 G5 E5 G5 A5 B5 | C6 B5 A5 G5 E5 G5 A5:2 | D6 B5 G5 B5 A5 G5 D5:2 | A5 F#5 E5 D5 F#5 A5 E5:2'),

  song('Glass Garden', 'collect', 76, 3, 'bell',
    'C3 E3 G3 B3 | F3 A3 C4 E4 | A2 C3 E3 G3 | G2 B2 D3 F3',
    'E5:2 - G5 E5:2 | A5:2 G5 E5 -:2 | C6:2 B5 A5 E5:2 | D5:2 G5:2 -:2',
    'G5:2 B5:2 C6:2 | A5:2 E5 - G5:2 | E5 A5 C6:2 B5 A5 | G5:2 D5:2 -:2'),
  song('Lantern Study', 'collect', 82, 4, 'warm',
    'D3 F3 A3 C4 | G2 B2 D3 A3 | C3 E3 G3 B3 | F3 A3 C4 E4',
    'A4:2 D5:2 F5:2 -:2 | B4:2 A4 G4 D5:2 -:2 | E5:2 G5:2 B5 A5 G5:2 | A5:2 G5 E5 C5:2 -:2',
    'F5:2 E5 D5 A4:2 C5:2 | D5:2 G5:2 A5:2 B5:2 | G5:2 E5:2 D5 E5 G5:2 | E5:2 C5 A4 G4:2 -:2'),
  song('Quiet Constellations', 'collect', 68, 3, 'bell',
    'E3 G3 B3 F#4 | C3 E3 G3 B3 | G2 B2 D3 F#3 | D3 F#3 A3 E4',
    'B4:2 - E5 G5:2 | E5:2 B5:2 -:2 | D5:2 G5 F#5 D5:2 | E5:2 A5:2 -:2',
    'F#5:2 G5 B5 E6:2 | D6:2 B5 G5 E5:2 | B5:2 A5 G5 D5:2 | F#5:2 E5:2 -:2'),
];

export function createMusicPlayer(context, destination) {
  const lists = Object.fromEntries(['score', 'timed', 'collect'].map(kind => [kind, SONGS.filter(song => song.category === kind)]));
  lists.menu = lists.score;
  const cursors = { score: 0, timed: 0, collect: 0, menu: 0 };
  let category = 'menu', selected = null, enabled = false, step = 0, nextTime = 0, bus = null;

  function makeBus(time) {
    const gain = context.createGain(); gain.connect(destination);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(1, time + 0.15);
    return { gain, voices: new Set(), retired: false };
  }
  function retire(time) {
    if (!bus) return;
    const old = bus; bus = null; old.retired = true;
    old.gain.gain.cancelScheduledValues(time);
    old.gain.gain.setValueAtTime(old.gain.gain.value, time);
    old.gain.gain.linearRampToValueAtTime(0, time + 0.18);
    for (const voice of old.voices) voice.osc.stop(Math.min(voice.end, time + 0.2));
    if (!old.voices.size) old.gain.disconnect();
  }
  function oscillator(note, duration, type, volume, time, target, slide = null) {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(hz(note), time);
    if (slide !== null) osc.frequency.exponentialRampToValueAtTime(hz(slide), time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + Math.min(0.018, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain); gain.connect(target.gain);
    const voice = { osc, end: time + duration + 0.02 };
    target.voices.add(voice);
    osc.onended = () => {
      osc.disconnect(); gain.disconnect(); target.voices.delete(voice);
      if (target.retired && !target.voices.size) target.gain.disconnect();
    };
    osc.start(time); osc.stop(voice.end);
  }
  function lead(note, duration, time) {
    const voice = selected.voice;
    const type = voice === 'pluck' || voice === 'warm' || voice === 'pulse' ? 'triangle' : voice === 'bell' ? 'sine' : voice;
    oscillator(note, duration, type, 0.032, time, bus);
    if (voice === 'bell') oscillator(note + 19, duration * 0.55, 'sine', 0.0045, time, bus);
  }
  function choose(time) {
    retire(time);
    const playlist = lists[category];
    selected = playlist[cursors[category]++ % playlist.length];
    step = 0; nextTime = time;
    if (enabled) bus = makeBus(time);
  }
  function schedule(time) {
    const eighth = 30 / selected.bpm, barSteps = selected.beats * 2;
    const bar = Math.floor(step / barSteps), beat = step % barSteps;
    const chord = selected.chords[bar % selected.chords.length];
    const note = selected.bars[bar][beat];
    if (note) {
      const gate = selected.title === 'Starlight Shuffle' ? 1.65 : category === 'timed' ? 0.65 : category === 'collect' ? 1.65 : 1.1;
      lead(note.note, Math.max(0.08, eighth * note.length * gate), time);
    }
    if (beat === 0) {
      oscillator(chord[0] - 12, eighth * (category === 'timed' ? 1.5 : selected.title === 'Starlight Shuffle' ? 7.5 : 6), 'triangle', 0.035, time, bus);
      if (selected.title !== 'Starlight Shuffle' || bar >= 8) {
        for (const pitch of chord.slice(0, 3)) oscillator(pitch, eighth * barSteps * 0.85, 'sine', 0.008, time, bus);
      }
    }
    if (category === 'timed') {
      if (beat % 2 === 0) oscillator(chord[beat % 4 === 0 ? 0 : 2] - 12, eighth * 0.75, 'triangle', 0.022, time, bus);
      if (beat % 4 === 0) oscillator(36, 0.11, 'sine', 0.035, time, bus, 24);
      if (beat % 2 === 1) oscillator(88, 0.025, 'triangle', 0.007, time, bus);
    } else if (category === 'collect' && beat === barSteps - 2 && bar % 2 === 1) {
      oscillator(chord[2] + 12, eighth * 2.5, 'sine', 0.009, time, bus);
    } else if ((category === 'score' || category === 'menu') && selected.title !== 'Starlight Shuffle' && beat % 2 === 1) {
      oscillator(chord[(beat >> 1) % chord.length], eighth * 0.9, 'sine', 0.011, time, bus);
    }
    return eighth;
  }

  return {
    setCategory(kind) {
      category = lists[kind] ? kind : 'score';
      choose(context.currentTime + 0.05);
    },
    setEnabled(value) {
      value = !!value;
      if (enabled === value) return;
      enabled = value;
      if (!enabled) retire(context.currentTime);
      else {
        if (!selected) choose(context.currentTime + 0.05);
        step = 0; nextTime = context.currentTime + 0.05;
        if (!bus) bus = makeBus(nextTime);
      }
    },
    tick(now = context.currentTime) {
      if (!enabled || context.state !== 'running') return;
      if (!selected) choose(now + 0.05);
      if (nextTime < now) nextTime = now + 0.05; // Never queue a backlog after a stalled tab.
      while (nextTime < now + 0.2) {
        nextTime += schedule(nextTime); step++;
        if (step === selected.bars.length * selected.beats * 2) choose(nextTime);
      }
    },
    get state() { return { title: selected && selected.title, category, bpm: selected && selected.bpm, enabled, step }; },
    dispose() { enabled = false; retire(context.currentTime); },
  };
}
