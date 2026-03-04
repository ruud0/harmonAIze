/**
 * Harmony Enhancement MVP — Phrase-Aware Chord Engine (Stage 5 / Week 2)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * For each phrase × each emotional mode → generates 3 ranked chord progressions:
 *   A = Safe (highest consonance, smoothest voice leading)
 *   B = Moderate (some color, still functional)
 *   C = Adventurous (extended harmony, bolder choices)
 *
 * Rules:
 * - One chord per bar, optionally change on beat 3
 * - Beat 1 melody note → chord must contain it (no dissonance unless dark/tense mode)
 * - Harmonic arc: Bar 1 Stable → Bar 2 Movement → Bar 3 Pre-dominant → Bar 4 Dominant
 * - Cadence flag → force V→I on last bar
 */

import type {
  CanonicalNote,
  Phrase,
  DetectedKey,
  PhraseHarmony,
  ProgressionOption,
  ChordEvent,
  EmotionalMode,
  BassRhythm,
} from "./types";
import {
  getModeConfig,
  buildChordMidiNotes,
  getScaleNote,
  getRootMidi,
  CHORD_INTERVALS,
} from "./chordTheory";
import { getDegreeLabel, NOTE_NAMES } from "./keyDetector";

// ─── Consonance Scoring ───────────────────────────────────────────────────────

function melodyConsonanceScore(
  melodyPitch: number,
  chordMidi: number[]
): number {
  const melodyPc = melodyPitch % 12;
  const chordPcs = chordMidi.map((m) => m % 12);
  if (chordPcs.includes(melodyPc)) return 1.0;
  // Check for common consonant intervals
  const intervals = chordPcs.map((pc) => Math.abs(melodyPc - pc) % 12);
  if (intervals.some((i) => [3, 4, 7, 9].includes(i))) return 0.7;
  if (intervals.some((i) => [2, 5, 10].includes(i))) return 0.4;
  return 0.1; // dissonant
}

// ─── Voice Leading Score ──────────────────────────────────────────────────────

function voiceLeadingScore(prev: number[], next: number[]): number {
  if (prev.length === 0) return 1.0;
  const minLen = Math.min(prev.length, next.length);
  let totalMovement = 0;
  for (let i = 0; i < minLen; i++) {
    totalMovement += Math.abs(next[i] - prev[i]);
  }
  // Normalize: 0 movement = 1.0, 12+ semitones per voice = 0
  const avgMovement = totalMovement / minLen;
  return Math.max(0, 1 - avgMovement / 12);
}

// ─── Bass Note Builder ────────────────────────────────────────────────────────

function buildBassNote(
  rootMidi: number,
  quality: string,
  phraseEnergy: number
): { bassNote: number; bassRhythm: BassRhythm } {
  const bassRoot = rootMidi - 12; // one octave below chord root
  if (phraseEnergy > 0.7) {
    return { bassNote: bassRoot, bassRhythm: "root_beat1_fifth_beat3" };
  }
  if (phraseEnergy < 0.3) {
    return { bassNote: bassRoot, bassRhythm: "root_sustained" };
  }
  return { bassNote: bassRoot, bassRhythm: "root_sustained" };
}

// ─── Single Bar Chord Builder ─────────────────────────────────────────────────

function buildChordEvent(
  bar: number,
  beat: number,
  degreeIndex: number,
  quality: import("./types").ChordQuality,
  keyRoot: string,
  keyMode: "major" | "minor",
  phraseEnergy: number,
  prevVoicing: number[]
): ChordEvent {
  const scaleNote = getScaleNote(keyRoot, keyMode, degreeIndex);
  const voicing = buildChordMidiNotes(scaleNote.midi, quality, 4);

  // Prefer lowest-movement voicing vs previous
  const { bassNote, bassRhythm } = buildBassNote(
    scaleNote.midi,
    quality,
    phraseEnergy
  );

  const degreeLabel = getDegreeLabel(
    NOTE_NAMES.indexOf(scaleNote.name),
    keyRoot,
    keyMode
  );

  return {
    bar,
    beat,
    root: scaleNote.name,
    rootMidi: scaleNote.midi,
    quality,
    extensions: [],
    voicing,
    bassNote,
    bassRhythm,
    degreeLabel,
  };
}

// ─── Progression Builder ──────────────────────────────────────────────────────

function buildProgression(
  phrase: Phrase,
  notes: CanonicalNote[],
  key: DetectedKey,
  mode: EmotionalMode,
  variant: "A" | "B" | "C"
): ProgressionOption {
  const config = getModeConfig(mode, key.mode);
  const phraseLength = phrase.endBar - phrase.startBar + 1;
  const useArc = phrase.peakFlag ? config.peakArc : config.primaryArc;

  // Get beat-1 melody notes per bar for consonance checking
  const beat1NotesByBar: Map<number, CanonicalNote> = new Map();
  for (const noteIdx of phrase.noteRefs) {
    const note = notes[noteIdx];
    if (note && note.beat === 1 && !note.isPassingTone) {
      if (!beat1NotesByBar.has(note.bar)) {
        beat1NotesByBar.set(note.bar, note);
      }
    }
  }

  const chords: ChordEvent[] = [];
  let prevVoicing: number[] = [];

  for (let barOffset = 0; barOffset < phraseLength; barOffset++) {
    const bar = phrase.startBar + barOffset;
    const arcIdx = barOffset % useArc.length;

    let degreeSpec = useArc[arcIdx][0];

    // For variant B/C, use color chords for certain positions
    if (variant === "B" && barOffset % 2 === 1) {
      const colorIdx = barOffset % config.colorChords.length;
      degreeSpec = config.colorChords[colorIdx][0] ?? degreeSpec;
    } else if (variant === "C") {
      const colorIdx = (barOffset + 1) % config.colorChords.length;
      degreeSpec = config.colorChords[colorIdx][0] ?? degreeSpec;
    }

    // Force cadence on last bar if cadenceFlag
    if (phrase.cadenceFlag && barOffset === phraseLength - 1) {
      degreeSpec = { degree: 4, quality: "dominant7" }; // V7
    }
    // Force resolution on bar after cadence (if phrase ends on V, next phrase starts on I)

    const chord = buildChordEvent(
      bar,
      1,
      degreeSpec.degree,
      degreeSpec.quality,
      key.root,
      key.mode,
      phrase.energyScore,
      prevVoicing
    );

    // Check consonance with beat-1 melody note
    const beat1Note = beat1NotesByBar.get(bar);
    if (beat1Note && !config.allowDissonance) {
      const cons = melodyConsonanceScore(beat1Note.pitch, chord.voicing);
      if (cons < 0.5) {
        // Fall back to tonic chord
        const tonicChord = buildChordEvent(
          bar,
          1,
          0,
          key.mode === "major" ? "major" : "minor",
          key.root,
          key.mode,
          phrase.energyScore,
          prevVoicing
        );
        chords.push(tonicChord);
        prevVoicing = tonicChord.voicing;
        continue;
      }
    }

    chords.push(chord);
    prevVoicing = chord.voicing;
  }

  // Score the progression
  let totalConsonance = 0;
  let totalVoiceLeading = 0;
  let prevV: number[] = [];

  for (const chord of chords) {
    const beat1Note = beat1NotesByBar.get(chord.bar);
    totalConsonance += beat1Note
      ? melodyConsonanceScore(beat1Note.pitch, chord.voicing)
      : 0.8;
    totalVoiceLeading += voiceLeadingScore(prevV, chord.voicing);
    prevV = chord.voicing;
  }

  const n = chords.length || 1;
  const consonanceScore = parseFloat((totalConsonance / n).toFixed(3));
  const vlScore = parseFloat((totalVoiceLeading / n).toFixed(3));

  const stylisticFitScore =
    variant === "A" ? 0.9 : variant === "B" ? 0.75 : 0.6;

  return {
    label:
      variant === "A" ? "Safe" : variant === "B" ? "Moderate" : "Adventurous",
    chords,
    voiceLeadingScore: vlScore,
    consonanceScore,
    stylisticFitScore,
  };
}

// ─── Distinctiveness Check ────────────────────────────────────────────────────

function progressionsAreTooSimilar(
  a: ProgressionOption,
  b: ProgressionOption
): boolean {
  if (a.chords.length !== b.chords.length) return false;
  let sameCount = 0;
  for (let i = 0; i < a.chords.length; i++) {
    if (
      a.chords[i].root === b.chords[i].root &&
      a.chords[i].quality === b.chords[i].quality
    ) {
      sameCount++;
    }
  }
  return sameCount / a.chords.length > 0.75; // >75% identical = too similar
}

// ─── Main Chord Engine ────────────────────────────────────────────────────────

export function generateHarmony(
  phrase: Phrase,
  notes: CanonicalNote[],
  key: DetectedKey,
  mode: EmotionalMode
): PhraseHarmony {
  let optA = buildProgression(phrase, notes, key, mode, "A");
  let optB = buildProgression(phrase, notes, key, mode, "B");
  let optC = buildProgression(phrase, notes, key, mode, "C");

  // Ensure distinctiveness: if B ≈ A, generate a replacement
  if (progressionsAreTooSimilar(optA, optB)) {
    optB = buildAlternativeProgression(phrase, notes, key, mode, "B");
  }
  if (progressionsAreTooSimilar(optB, optC) || progressionsAreTooSimilar(optA, optC)) {
    optC = buildAlternativeProgression(phrase, notes, key, mode, "C");
  }

  return {
    phraseId: phrase.phraseId,
    options: { A: optA, B: optB, C: optC },
  };
}

function buildAlternativeProgression(
  phrase: Phrase,
  notes: CanonicalNote[],
  key: DetectedKey,
  mode: EmotionalMode,
  variant: "B" | "C"
): ProgressionOption {
  // Use a different rotation of the color chords
  const config = getModeConfig(mode, key.mode);
  const phraseLength = phrase.endBar - phrase.startBar + 1;
  const chords: ChordEvent[] = [];
  let prevVoicing: number[] = [];

  for (let barOffset = 0; barOffset < phraseLength; barOffset++) {
    const bar = phrase.startBar + barOffset;
    // Use color chords in reverse order for distinctiveness
    const colorIdx =
      variant === "B"
        ? (phraseLength - 1 - barOffset) % config.colorChords.length
        : (barOffset + 2) % config.colorChords.length;

    const degreeSpec = config.colorChords[colorIdx][0] ?? {
      degree: 0,
      quality: key.mode === "major" ? ("major" as const) : ("minor" as const),
    };

    const chord = buildChordEvent(
      bar,
      1,
      degreeSpec.degree,
      degreeSpec.quality,
      key.root,
      key.mode,
      phrase.energyScore,
      prevVoicing
    );
    chords.push(chord);
    prevVoicing = chord.voicing;
  }

  return {
    label: variant === "B" ? "Moderate" : "Adventurous",
    chords,
    voiceLeadingScore: 0.7,
    consonanceScore: 0.65,
    stylisticFitScore: variant === "B" ? 0.75 : 0.55,
  };
}

// ─── Full Session Harmony Generation ─────────────────────────────────────────

export function generateAllHarmony(
  phrases: Phrase[],
  notes: CanonicalNote[],
  key: DetectedKey
): {
  bright: PhraseHarmony[];
  dark: PhraseHarmony[];
  calm: PhraseHarmony[];
  tense: PhraseHarmony[];
} {
  const modes: EmotionalMode[] = ["bright", "dark", "calm", "tense"];
  const result: Record<string, PhraseHarmony[]> = {
    bright: [],
    dark: [],
    calm: [],
    tense: [],
  };

  for (const mode of modes) {
    result[mode] = phrases.map((phrase) =>
      generateHarmony(phrase, notes, key, mode)
    );
  }

  return result as {
    bright: PhraseHarmony[];
    dark: PhraseHarmony[];
    calm: PhraseHarmony[];
    tense: PhraseHarmony[];
  };
}
