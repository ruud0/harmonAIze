/**
 * Harmony Enhancement MVP — Key Detection (Stage 3)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Uses Krumhansl-Schmuckler pitch class profiles to detect key.
 * Scores all 24 keys, returns top 3 with confidence scores.
 * Result is read-only after detection.
 */

import type { CanonicalNote, DetectedKey } from "./types";

// ─── Krumhansl-Schmuckler Profiles ───────────────────────────────────────────

const KS_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const KS_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

// ─── Pitch Class Profile Builder ─────────────────────────────────────────────

function buildPitchClassProfile(notes: CanonicalNote[]): number[] {
  const profile = new Array(12).fill(0);
  for (const note of notes) {
    if (note.isPassingTone) continue; // ignore passing tones for key detection
    const pc = note.pitch % 12;
    // Weight by duration and beat strength
    const strengthWeight =
      note.beatStrength === "strong"
        ? 3
        : note.beatStrength === "secondary"
        ? 2
        : 1;
    profile[pc] += note.durationBeats * strengthWeight;
  }
  return profile;
}

// ─── Pearson Correlation ──────────────────────────────────────────────────────

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

// ─── Main Key Detection ───────────────────────────────────────────────────────

export function detectKey(notes: CanonicalNote[]): DetectedKey {
  const inputProfile = buildPitchClassProfile(notes);

  const scores: Array<{
    root: string;
    mode: "major" | "minor";
    score: number;
  }> = [];

  for (let i = 0; i < 12; i++) {
    // Rotate profile to test each root
    const rotatedMajor = [
      ...KS_MAJOR.slice(i),
      ...KS_MAJOR.slice(0, i),
    ];
    const rotatedMinor = [
      ...KS_MINOR.slice(i),
      ...KS_MINOR.slice(0, i),
    ];

    scores.push({
      root: NOTE_NAMES[i],
      mode: "major",
      score: pearsonCorrelation(inputProfile, rotatedMajor),
    });
    scores.push({
      root: NOTE_NAMES[i],
      mode: "minor",
      score: pearsonCorrelation(inputProfile, rotatedMinor),
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Normalize to 0–1 confidence
  const maxScore = scores[0].score;
  const minScore = scores[scores.length - 1].score;
  const range = maxScore - minScore || 1;

  const normalize = (s: number) => Math.max(0, Math.min(1, (s - minScore) / range));

  const top = scores[0];
  const alternatives = scores.slice(1, 4).map((s) => ({
    root: s.root,
    mode: s.mode,
    confidence: parseFloat(normalize(s.score).toFixed(3)),
  }));

  return {
    root: top.root,
    mode: top.mode,
    confidence: parseFloat(normalize(top.score).toFixed(3)),
    alternatives,
  };
}

// ─── Scale Degree Utilities ───────────────────────────────────────────────────

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

export function getScaleDegrees(
  root: string,
  mode: "major" | "minor"
): number[] {
  const rootPc = NOTE_NAMES.indexOf(root);
  const intervals = mode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  return intervals.map((i) => (rootPc + i) % 12);
}

export function getDegreeLabel(
  chordRootPc: number,
  keyRoot: string,
  keyMode: "major" | "minor"
): string {
  const rootPc = NOTE_NAMES.indexOf(keyRoot);
  const interval = (chordRootPc - rootPc + 12) % 12;
  const degrees = keyMode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const romanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const idx = degrees.indexOf(interval);
  if (idx === -1) return "?";
  return romanNumerals[idx];
}

export { NOTE_NAMES };
