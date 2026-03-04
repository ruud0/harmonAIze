/**
 * Harmony Enhancement MVP — Chord Theory Utilities
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Chord interval definitions, voicing builders, and harmonic arc templates.
 */

import type { ChordQuality, EmotionalMode } from "./types";
import { NOTE_NAMES } from "./keyDetector";

// ─── Chord Interval Maps ──────────────────────────────────────────────────────

export const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDim7: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  major9: [0, 4, 7, 11, 14],
  minor9: [0, 3, 7, 10, 14],
};

// ─── Harmonic Arc Templates per Mode ─────────────────────────────────────────
// Each entry: [bar offset 0–3] → [degree index in scale (0=I, 1=II, etc.), quality]

type DegreeSpec = {
  degree: number; // 0-indexed scale degree
  quality: ChordQuality;
  extensions?: string[];
};

type HarmonicArc = DegreeSpec[][];

// Major scale diatonic qualities
const MAJOR_DIATONIC: ChordQuality[] = [
  "major",    // I
  "minor",    // ii
  "minor",    // iii
  "major",    // IV
  "dominant7",// V7
  "minor",    // vi
  "halfDim7", // vii°
];

// Minor scale diatonic qualities (natural minor)
const MINOR_DIATONIC: ChordQuality[] = [
  "minor",    // i
  "halfDim7", // ii°
  "major",    // III
  "minor",    // iv
  "minor",    // v (natural) / dominant7 (harmonic)
  "major",    // VI
  "major",    // VII
];

// ─── Mode-specific Arc Templates ─────────────────────────────────────────────

// Calm phrase arc (I → IV → I → V)
const CALM_ARC_MAJOR: HarmonicArc = [
  [{ degree: 0, quality: "major" }],
  [{ degree: 3, quality: "major" }],
  [{ degree: 0, quality: "major" }],
  [{ degree: 4, quality: "dominant7" }],
];

const CALM_ARC_MINOR: HarmonicArc = [
  [{ degree: 0, quality: "minor" }],
  [{ degree: 5, quality: "major" }],
  [{ degree: 0, quality: "minor" }],
  [{ degree: 4, quality: "dominant7" }],
];

// Peak phrase arc (I → IV → V7 → I with 7ths/9ths)
const PEAK_ARC_MAJOR: HarmonicArc = [
  [{ degree: 0, quality: "major7" }],
  [{ degree: 3, quality: "major7" }],
  [{ degree: 4, quality: "dominant7" }],
  [{ degree: 0, quality: "add9" }],
];

const PEAK_ARC_MINOR: HarmonicArc = [
  [{ degree: 0, quality: "minor7" }],
  [{ degree: 3, quality: "minor7" }],
  [{ degree: 4, quality: "dominant7" }],
  [{ degree: 0, quality: "minor9" }],
];

// Standard arc: I → IV → pre-dominant → V
const STANDARD_ARC_MAJOR: HarmonicArc = [
  [{ degree: 0, quality: "major" }],
  [{ degree: 3, quality: "major" }],
  [{ degree: 1, quality: "minor" }],
  [{ degree: 4, quality: "dominant7" }],
];

const STANDARD_ARC_MINOR: HarmonicArc = [
  [{ degree: 0, quality: "minor" }],
  [{ degree: 3, quality: "minor" }],
  [{ degree: 1, quality: "halfDim7" }],
  [{ degree: 4, quality: "dominant7" }],
];

// ─── Mode Color Variations ────────────────────────────────────────────────────

// Bright: major tonality, add9s, sus2 for color
// Dark: minor tonality, dim chords, flat-VI flat-VII
// Calm: simple triads, I-IV-I-V
// Tense: dominant 7ths, tritone subs, chromatic movement

export interface ModeArcConfig {
  primaryArc: HarmonicArc;
  peakArc: HarmonicArc;
  colorChords: DegreeSpec[][]; // alternative colorful options for B/C
  preferredExtensions: string[];
  allowDissonance: boolean;
}

export function getModeConfig(
  mode: EmotionalMode,
  keyMode: "major" | "minor"
): ModeArcConfig {
  const isMajor = keyMode === "major";

  switch (mode) {
    case "bright":
      return {
        primaryArc: isMajor ? STANDARD_ARC_MAJOR : STANDARD_ARC_MINOR,
        peakArc: isMajor ? PEAK_ARC_MAJOR : PEAK_ARC_MINOR,
        colorChords: [
          [{ degree: 5, quality: isMajor ? "minor" : "major" }], // vi/VI
          [{ degree: 1, quality: isMajor ? "minor" : "halfDim7" }], // ii/ii°
          [{ degree: 2, quality: isMajor ? "minor" : "major" }], // iii/III
          [{ degree: 0, quality: "add9" }],
        ],
        preferredExtensions: ["add9", "sus2"],
        allowDissonance: false,
      };

    case "dark":
      return {
        primaryArc: isMajor
          ? [
              [{ degree: 5, quality: "minor" }], // vi
              [{ degree: 3, quality: "major" }], // IV
              [{ degree: 1, quality: "minor" }], // ii
              [{ degree: 4, quality: "dominant7" }], // V7
            ]
          : STANDARD_ARC_MINOR,
        peakArc: isMajor ? PEAK_ARC_MINOR : PEAK_ARC_MINOR,
        colorChords: [
          [{ degree: 6, quality: isMajor ? "halfDim7" : "major" }],
          [{ degree: 2, quality: isMajor ? "minor" : "major" }],
          [{ degree: 0, quality: isMajor ? "minor" : "dim7" }],
          [{ degree: 4, quality: "dominant7" }],
        ],
        preferredExtensions: ["7", "b9"],
        allowDissonance: true,
      };

    case "calm":
      return {
        primaryArc: isMajor ? CALM_ARC_MAJOR : CALM_ARC_MINOR,
        peakArc: isMajor ? STANDARD_ARC_MAJOR : STANDARD_ARC_MINOR,
        colorChords: [
          [{ degree: 0, quality: "sus2" }],
          [{ degree: 3, quality: "add9" }],
          [{ degree: 5, quality: isMajor ? "minor" : "major" }],
          [{ degree: 4, quality: isMajor ? "major" : "dominant7" }],
        ],
        preferredExtensions: ["sus2", "add9"],
        allowDissonance: false,
      };

    case "tense":
      return {
        primaryArc: [
          [{ degree: 0, quality: isMajor ? "major7" : "minor7" }],
          [{ degree: 4, quality: "dominant7" }],
          [{ degree: 1, quality: isMajor ? "minor7" : "halfDim7" }],
          [{ degree: 4, quality: "dominant7" }],
        ],
        peakArc: [
          [{ degree: 0, quality: isMajor ? "major7" : "minor7" }],
          [{ degree: 6, quality: isMajor ? "halfDim7" : "dim7" }],
          [{ degree: 4, quality: "dominant7" }],
          [{ degree: 0, quality: isMajor ? "major" : "minor" }],
        ],
        colorChords: [
          [{ degree: 6, quality: isMajor ? "halfDim7" : "dim7" }],
          [{ degree: 4, quality: "dominant7" }],
          [{ degree: 1, quality: isMajor ? "minor7" : "halfDim7" }],
          [{ degree: 0, quality: isMajor ? "dominant7" : "minor7" }],
        ],
        preferredExtensions: ["7", "b9", "sus4"],
        allowDissonance: true,
      };
  }
}

// ─── Chord Builder ────────────────────────────────────────────────────────────

export function buildChordMidiNotes(
  rootMidi: number,
  quality: ChordQuality,
  octave = 4
): number[] {
  const baseOctave = octave * 12 + 12; // MIDI C4 = 60
  const rootInOctave = baseOctave + (rootMidi % 12);
  return CHORD_INTERVALS[quality].map((interval) => rootInOctave + interval);
}

export function getRootMidi(noteName: string, octave = 3): number {
  const pc = NOTE_NAMES.indexOf(noteName);
  return (octave + 1) * 12 + pc;
}

export function getScaleNote(
  keyRoot: string,
  keyMode: "major" | "minor",
  degreeIndex: number
): { name: string; midi: number } {
  const rootPc = NOTE_NAMES.indexOf(keyRoot);
  const intervals = keyMode === "major"
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  const pc = (rootPc + intervals[degreeIndex % 7]) % 12;
  return {
    name: NOTE_NAMES[pc],
    midi: getRootMidi(NOTE_NAMES[pc], 3),
  };
}

export { MAJOR_DIATONIC, MINOR_DIATONIC };
export type { DegreeSpec, HarmonicArc };
