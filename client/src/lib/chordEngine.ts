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
  ChordRhythmPattern,
} from "./types";
import {
  getModeConfig,
  buildChordMidiNotes,
  getScaleNote,
  getRootMidi,
  CHORD_INTERVALS,
  type DegreeSpec,
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
    durationBeats: 4,
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
  const energyScore = phrase.energyScore;

  const rhythmPattern: ChordRhythmPattern =
    energyScore < 0.3 ? "slow" : energyScore > 0.7 ? "active" : "standard";

  // Build melody note position maps
  const beat1NotesByBar = new Map<number, CanonicalNote>();
  const beat3NotesByBar = new Map<number, CanonicalNote>(); // non-passing beat-3 notes
  const beat3RawByBar = new Map<number, CanonicalNote>();   // all beat-3 notes

  for (const noteIdx of phrase.noteRefs) {
    const note = notes[noteIdx];
    if (!note) continue;
    if (note.beat === 1 && !note.isPassingTone && !beat1NotesByBar.has(note.bar)) {
      beat1NotesByBar.set(note.bar, note);
    }
    if (note.beat === 3) {
      if (!beat3RawByBar.has(note.bar)) beat3RawByBar.set(note.bar, note);
      if (!note.isPassingTone && !beat3NotesByBar.has(note.bar)) {
        beat3NotesByBar.set(note.bar, note);
      }
    }
  }

  const chords: ChordEvent[] = [];
  let prevVoicing: number[] = [];

  // Pick degree spec from arc; arcIndex allows beat-level granularity
  const pickDegreeSpec = (arcIndex: number, barOff: number): DegreeSpec => {
    const idx = arcIndex % useArc.length;
    let spec = useArc[idx][0];
    if (variant === "B" && barOff % 2 === 1) {
      spec = config.colorChords[barOff % config.colorChords.length][0] ?? spec;
    } else if (variant === "C") {
      spec = config.colorChords[(barOff + 1) % config.colorChords.length][0] ?? spec;
    }
    if (phrase.cadenceFlag && barOff === phraseLength - 1) {
      spec = { degree: 4, quality: "dominant7" };
    }
    return spec;
  };

  // Build a chord event; falls back to tonic if dissonant with melody note
  const makeChord = (
    bar: number,
    beat: number,
    spec: DegreeSpec,
    beatNote: CanonicalNote | undefined
  ): ChordEvent => {
    const chord = buildChordEvent(
      bar, beat, spec.degree, spec.quality, key.root, key.mode, energyScore, prevVoicing
    );
    if (beatNote && !config.allowDissonance) {
      if (melodyConsonanceScore(beatNote.pitch, chord.voicing) < 0.5) {
        return buildChordEvent(
          bar, beat, 0,
          key.mode === "major" ? "major" : "minor",
          key.root, key.mode, energyScore, prevVoicing
        );
      }
    }
    return chord;
  };

  if (rhythmPattern === "slow") {
    // One chord every 2 bars
    let barOffset = 0;
    while (barOffset < phraseLength) {
      const bar = phrase.startBar + barOffset;
      const chord = makeChord(bar, 1, pickDegreeSpec(barOffset, barOffset), beat1NotesByBar.get(bar));
      chords.push({ ...chord, durationBeats: 4 });
      prevVoicing = chord.voicing;
      barOffset += 2;
    }
  } else if (rhythmPattern === "standard") {
    // One chord per bar; optional beat-3 chord when melody note is not in chord
    for (let barOffset = 0; barOffset < phraseLength; barOffset++) {
      const bar = phrase.startBar + barOffset;
      const chord = makeChord(bar, 1, pickDegreeSpec(barOffset, barOffset), beat1NotesByBar.get(bar));
      chords.push({ ...chord, durationBeats: 4 });
      prevVoicing = chord.voicing;

      const beat3Note = beat3NotesByBar.get(bar);
      if (beat3Note && melodyConsonanceScore(beat3Note.pitch, chord.voicing) < 0.7) {
        const chord3 = makeChord(bar, 3, pickDegreeSpec(barOffset + 1, barOffset), beat3Note);
        chords.push({ ...chord3, durationBeats: 2 });
        prevVoicing = chord3.voicing;
      }
    }
  } else {
    // active: beats 1 and 3 per bar; skip beat-3 only when its melody note is a passing tone
    for (let barOffset = 0; barOffset < phraseLength; barOffset++) {
      const bar = phrase.startBar + barOffset;
      const chord1 = makeChord(bar, 1, pickDegreeSpec(barOffset * 2, barOffset), beat1NotesByBar.get(bar));
      chords.push({ ...chord1, durationBeats: 4 });
      prevVoicing = chord1.voicing;

      const beat3Raw = beat3RawByBar.get(bar);
      if (!beat3Raw || !beat3Raw.isPassingTone) {
        const chord3 = makeChord(bar, 3, pickDegreeSpec(barOffset * 2 + 1, barOffset), beat3NotesByBar.get(bar));
        if (chord3.root !== chord1.root || chord3.quality !== chord1.quality) {
          chords.push({ ...chord3, durationBeats: 2 });
          prevVoicing = chord3.voicing;
        }
      }
    }
  }

  // Compute actual durationBeats from absolute beat positions
  for (let i = 0; i < chords.length; i++) {
    const curr = chords[i];
    const next = chords[i + 1];
    if (next) {
      const currAbs = (curr.bar - 1) * 4 + (curr.beat - 1);
      const nextAbs = (next.bar - 1) * 4 + (next.beat - 1);
      chords[i] = { ...curr, durationBeats: Math.max(1, nextAbs - currAbs) };
    } else {
      const phraseEndAbs = phrase.endBar * 4;
      const currAbs = (curr.bar - 1) * 4 + (curr.beat - 1);
      chords[i] = { ...curr, durationBeats: Math.max(1, phraseEndAbs - currAbs) };
    }
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
  const stylisticFitScore = variant === "A" ? 0.9 : variant === "B" ? 0.75 : 0.6;

  return {
    label: variant === "A" ? "Safe" : variant === "B" ? "Moderate" : "Adventurous",
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

  const rhythmPattern: ChordRhythmPattern =
    phrase.energyScore < 0.3 ? "slow" : phrase.energyScore > 0.7 ? "active" : "standard";

  return {
    phraseId: phrase.phraseId,
    chordRhythmPattern: rhythmPattern,
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
  const config = getModeConfig(mode, key.mode);
  const phraseLength = phrase.endBar - phrase.startBar + 1;
  const chords: ChordEvent[] = [];
  let prevVoicing: number[] = [];

  const step = phrase.energyScore < 0.3 ? 2 : 1;

  for (let barOffset = 0; barOffset < phraseLength; barOffset += step) {
    const bar = phrase.startBar + barOffset;
    const colorIdx =
      variant === "B"
        ? (phraseLength - 1 - barOffset) % config.colorChords.length
        : (barOffset + 2) % config.colorChords.length;

    const degreeSpec = config.colorChords[colorIdx][0] ?? {
      degree: 0,
      quality: key.mode === "major" ? ("major" as const) : ("minor" as const),
    };

    const chord = buildChordEvent(
      bar, 1, degreeSpec.degree, degreeSpec.quality,
      key.root, key.mode, phrase.energyScore, prevVoicing
    );
    chords.push({ ...chord, durationBeats: step * 4 });
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
