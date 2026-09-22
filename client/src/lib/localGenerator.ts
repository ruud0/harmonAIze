/**
 * Deterministic music-theory generator, no network required.
 *
 * This is the same generator the Express server falls back to when
 * ANTHROPIC_API_KEY is unset, moved client-side so the app also works as a
 * static build with no backend at all (see lib/generateLoop.ts).
 *
 * Builds a diatonic progression with triad voicings, a root bass pulse, and a
 * scale-tone melodic figure, over nine scale modes.
 */

import type { RawApiNote } from "./harmonaizeTypes";

const PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const KEY_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic major": [0, 2, 4, 7, 9],
  "pentatonic minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

function midiToPitchName(midi: number): string {
  const note = PITCHES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export interface LocalLoop {
  chords: string[];
  notes: RawApiNote[];
}

export function buildLocalLoop(key: string, scale: string, bars: number): LocalLoop {
  const root = KEY_ROOTS[key] ?? 0;
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.major;
  const triadDegrees = [0, 2, 4];
  const progression = [0, 3, 4, 0]; // I-iv-v-I style motion
  const notes: RawApiNote[] = [];
  const chords: string[] = [];

  const isMinorish =
    scale.includes("minor") || scale === "dorian" || scale === "phrygian";

  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length] % intervals.length;
    const chordRootPc = (root + intervals[degree]) % 12;
    chords.push(`${PITCHES[chordRootPc]}${isMinorish ? "m" : ""}`);

    // Chord stabs on beats 0 and 2
    for (const beat of [0, 2]) {
      for (const deg of triadDegrees) {
        const idx = (degree + deg) % intervals.length;
        const midi = 60 + ((root + intervals[idx]) % 12);
        notes.push({ bar, beat, pitch: midiToPitchName(midi), duration: 1, layer: "chords" });
      }
    }

    // Root bass pulse
    notes.push({ bar, beat: 0, pitch: midiToPitchName(36 + chordRootPc), duration: 2, layer: "bass" });
    notes.push({ bar, beat: 2, pitch: midiToPitchName(36 + chordRootPc), duration: 2, layer: "bass" });

    // Simple melodic figure from scale tones
    const melodyDegrees = [0, 1, 2, 4, 2, 1, 0, 4];
    melodyDegrees.forEach((step, i) => {
      const idx = (degree + step) % intervals.length;
      const midi = 72 + ((root + intervals[idx]) % 12);
      notes.push({ bar, beat: i * 0.5, pitch: midiToPitchName(midi), duration: 0.5, layer: "melody" });
    });
  }

  return { chords, notes };
}
