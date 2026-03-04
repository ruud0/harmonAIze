/**
 * Harmony Enhancement MVP — Core Type Definitions
 * Design: Spectral / Frequency-Space Minimalism
 * All data flows through the Session object. No stage reaches into another stage's data directly.
 */

// ─── Canonical Note Object ────────────────────────────────────────────────────

export type BeatStrength = "strong" | "secondary" | "weak" | "passing";

export interface CanonicalNote {
  index: number;
  pitch: number; // MIDI note number (0–127)
  velocity: number;
  bar: number; // 1-indexed
  beat: number; // 1-indexed within bar (1–4 in 4/4)
  subdivision: number; // 1-indexed 1/16th position within beat (1–4)
  durationBeats: number; // duration in beats (float)
  beatStrength: BeatStrength;
  isPassingTone: boolean;
}

// ─── Phrase Object ────────────────────────────────────────────────────────────

export interface Phrase {
  phraseId: string;
  startBar: number;
  endBar: number;
  energyScore: number; // 0–1
  densityScore: number; // 0–1
  peakFlag: boolean;
  cadenceFlag: boolean;
  noteRefs: number[]; // indices into session.melody
}

// ─── Chord / Harmony Objects ──────────────────────────────────────────────────

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant7"
  | "major7"
  | "minor7"
  | "halfDim7"
  | "dim7"
  | "sus2"
  | "sus4"
  | "add9"
  | "major9"
  | "minor9";

export type BassRhythm =
  | "root_sustained"
  | "root_beat1_fifth_beat3"
  | "passing_tone";

export interface ChordEvent {
  bar: number;
  beat: number;
  root: string; // note name e.g. "G"
  rootMidi: number; // MIDI note number for root
  quality: ChordQuality;
  extensions: string[]; // e.g. ["7", "9"]
  voicing: number[]; // MIDI note numbers for chord tones
  bassNote: number; // MIDI note number
  bassRhythm: BassRhythm;
  degreeLabel: string; // e.g. "I", "IV", "V7"
}

export interface ProgressionOption {
  label: "Safe" | "Moderate" | "Adventurous";
  chords: ChordEvent[];
  voiceLeadingScore: number; // 0–1 (higher = smoother)
  consonanceScore: number; // 0–1
  stylisticFitScore: number; // 0–1
}

export interface PhraseHarmony {
  phraseId: string;
  options: {
    A: ProgressionOption;
    B: ProgressionOption;
    C: ProgressionOption;
  };
}

// ─── Emotional Modes ─────────────────────────────────────────────────────────

export type EmotionalMode = "bright" | "dark" | "calm" | "tense";
export type OptionKey = "A" | "B" | "C";

export const MODE_COLORS: Record<EmotionalMode, string> = {
  bright: "#22D3EE", // cyan
  dark: "#A78BFA", // violet
  calm: "#34D399", // teal
  tense: "#FB7185", // coral
};

export const MODE_LABELS: Record<EmotionalMode, string> = {
  bright: "Bright",
  dark: "Dark",
  calm: "Calm",
  tense: "Tense",
};

// ─── Session Object ───────────────────────────────────────────────────────────

export interface DetectedKey {
  root: string;
  mode: "major" | "minor";
  confidence: number;
  alternatives: Array<{ root: string; mode: "major" | "minor"; confidence: number }>;
  userOverridden?: boolean;
}

export interface SelectedOption {
  mode: EmotionalMode;
  option: OptionKey;
}

export type PipelineStage =
  | "idle"
  | "parsing"
  | "detecting_key"
  | "analyzing_phrases"
  | "generating_harmony"
  | "ready"
  | "exporting"
  | "error";

export interface Session {
  sessionId: string;
  createdAt: string;
  sourceFile: string;
  pipelineStage: PipelineStage;
  errorMessage?: string;
  detectedKey: DetectedKey | null;
  melody: CanonicalNote[];
  phrases: Phrase[];
  harmonicOutput: {
    bright: PhraseHarmony[];
    dark: PhraseHarmony[];
    calm: PhraseHarmony[];
    tense: PhraseHarmony[];
  };
  selectedOptions: Record<string, SelectedOption>; // keyed by phraseId
  exportReady: boolean;
  // Raw MIDI metadata (not persisted after parsing, kept for display)
  midiMeta: {
    trackCount: number;
    tempos: Array<{ tick: number; bpm: number }>;
    timeSignature: { numerator: number; denominator: number };
    totalBars: number;
    durationSeconds: number;
  } | null;
}

export function createEmptySession(filename: string): Session {
  return {
    sessionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceFile: filename,
    pipelineStage: "idle",
    detectedKey: null,
    melody: [],
    phrases: [],
    harmonicOutput: { bright: [], dark: [], calm: [], tense: [] },
    selectedOptions: {},
    exportReady: false,
    midiMeta: null,
  };
}
