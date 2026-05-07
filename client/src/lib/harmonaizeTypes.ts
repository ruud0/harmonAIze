// ── harmonAIze core types ──────────────────────────────────────────────────

export const PPQ = 96; // pulses per quarter note

export interface HarmNote {
  id: string;
  /** 0-indexed bar number */
  bar: number;
  /** tick within the bar (0 to 4*PPQ-1) */
  startTick: number;
  /** MIDI pitch 21-108 */
  pitch: number;
  /** duration in ticks */
  duration: number;
  /** layer */
  layer: "melody" | "chords" | "bass";
  /** velocity 0-127 */
  velocity: number;
}

export interface GeneratedLoop {
  key: string;
  scale: string;
  bars: number;
  bpm: number;
  mood: string;
  chords: string[];
  notes: HarmNote[];
}

export interface RawApiNote {
  bar: number;
  beat: number; // 0.0-3.75
  pitch: string; // e.g. "A4"
  duration: number; // in quarter notes
  layer: "melody" | "chords" | "bass";
}

// MIDI pitch names for conversion
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function pitchNameToMidi(name: string): number {
  const m = name.match(/^([A-G]#?)(\d+)$/);
  if (!m) return 60;
  const noteIdx = PITCH_NAMES.indexOf(m[1]);
  const octave = parseInt(m[2]);
  return (octave + 1) * 12 + noteIdx;
}

export function midiToPitchName(midi: number): string {
  const note = PITCH_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/** Scale definitions — intervals from root in semitones */
export const SCALE_INTERVALS: Record<string, number[]> = {
  major:        [0, 2, 4, 5, 7, 9, 11],
  minor:        [0, 2, 3, 5, 7, 8, 10],
  dorian:       [0, 2, 3, 5, 7, 9, 10],
  phrygian:     [0, 1, 3, 5, 7, 8, 10],
  lydian:       [0, 2, 4, 6, 7, 9, 11],
  mixolydian:   [0, 2, 4, 5, 7, 9, 10],
  locrian:      [0, 1, 3, 5, 6, 8, 10],
  "pentatonic major": [0, 2, 4, 7, 9],
  "pentatonic minor": [0, 3, 5, 7, 10],
  blues:        [0, 3, 5, 6, 7, 10],
  chromatic:    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const KEY_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
  E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
  Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** Returns set of MIDI pitches (mod 12) that are in the key/scale */
export function getInKeyPitches(key: string, scale: string): Set<number> {
  const root = KEY_ROOTS[key] ?? 0;
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.major;
  return new Set(intervals.map((i) => (root + i) % 12));
}

export function isInKey(pitch: number, inKeySet: Set<number>): boolean {
  return inKeySet.has(pitch % 12);
}

/** Convert raw API notes to HarmNote[] */
export function rawNotesToHarmNotes(raw: RawApiNote[]): HarmNote[] {
  return raw.map((n, i) => ({
    id: `n${i}_${Date.now()}`,
    bar: n.bar,
    startTick: Math.round(n.beat * PPQ),
    pitch: pitchNameToMidi(n.pitch),
    duration: Math.max(PPQ / 4, Math.round(n.duration * PPQ)),
    layer: n.layer,
    velocity: n.layer === "chords" ? 80 : n.layer === "bass" ? 90 : 100,
  }));
}

/** Snap tick to nearest 1/16 (PPQ/4) */
export function snapTick(tick: number): number {
  const grid = PPQ / 4;
  return Math.round(tick / grid) * grid;
}
