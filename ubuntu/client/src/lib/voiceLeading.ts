/**
 * Harmony Enhancement MVP — Voice Leading & Density Logic (Week 3)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * - Score every chord transition by total semitone movement
 * - Pick lowest-movement voicing
 * - Avoid register extremes and muddy low stacking
 * - Match harmony density to melody density
 * - Bass logic: calm=root sustained, active=root+fifth, tension=passing tone
 */

import type {
  PhraseHarmony,
  ProgressionOption,
  ChordEvent,
  Phrase,
  BassRhythm,
} from "./types";
import { CHORD_INTERVALS } from "./chordTheory";

// ─── Register Constraints ─────────────────────────────────────────────────────

const MIN_CHORD_MIDI = 48; // C3 — avoid muddy low stacking
const MAX_CHORD_MIDI = 84; // C6 — avoid extreme high register
const BASS_OCTAVE_MIDI = 36; // C2 — bass register

// ─── Voicing Optimizer ────────────────────────────────────────────────────────

/**
 * Given a chord's MIDI notes, find the best voicing (inversion + octave placement)
 * that minimizes total semitone movement from the previous voicing.
 */
export function optimizeVoicing(
  chordMidi: number[],
  prevVoicing: number[],
  melodyTopNote: number | null
): number[] {
  if (prevVoicing.length === 0) {
    return clampVoicing(chordMidi, melodyTopNote);
  }

  // Generate inversions
  const inversions = generateInversions(chordMidi);
  let bestVoicing = chordMidi;
  let bestCost = Infinity;

  for (const inv of inversions) {
    const clamped = clampVoicing(inv, melodyTopNote);
    const cost = voiceLeadingCost(prevVoicing, clamped);
    if (cost < bestCost) {
      bestCost = cost;
      bestVoicing = clamped;
    }
  }

  return bestVoicing;
}

function generateInversions(notes: number[]): number[][] {
  const inversions: number[][] = [notes];
  for (let i = 1; i < notes.length; i++) {
    const inv = [...notes.slice(i), ...notes.slice(0, i).map((n) => n + 12)];
    inversions.push(inv);
  }
  return inversions;
}

function clampVoicing(notes: number[], melodyTop: number | null): number[] {
  return notes.map((n) => {
    let note = n;
    // Shift into valid register
    while (note < MIN_CHORD_MIDI) note += 12;
    while (note > MAX_CHORD_MIDI) note -= 12;
    // Don't stack above melody
    if (melodyTop !== null && note > melodyTop - 2) note -= 12;
    // Re-clamp after melody adjustment
    while (note < MIN_CHORD_MIDI) note += 12;
    return note;
  });
}

function voiceLeadingCost(prev: number[], next: number[]): number {
  const minLen = Math.min(prev.length, next.length);
  let cost = 0;
  for (let i = 0; i < minLen; i++) {
    cost += Math.abs(next[i] - prev[i]);
  }
  return cost;
}

// ─── Density Matching ─────────────────────────────────────────────────────────

/**
 * Adjust chord complexity based on melody density:
 * - Sparse melody (density < 0.3) → triads + 7ths
 * - Busy melody (density > 0.6) → triads only
 * - High-register melody → don't stack harmony above it
 */
export function applyDensityLogic(
  chords: ChordEvent[],
  phrase: Phrase,
  melodyNotes: Array<{ pitch: number }>
): ChordEvent[] {
  const density = phrase.densityScore;

  // Find highest melody pitch in phrase
  const maxMelodyPitch =
    melodyNotes.length > 0
      ? Math.max(...melodyNotes.map((n) => n.pitch))
      : 72;

  return chords.map((chord) => {
    let voicing = [...chord.voicing];

    if (density > 0.6) {
      // Busy melody → triads only (remove extensions beyond 3 notes)
      voicing = voicing.slice(0, 3);
    } else if (density < 0.3) {
      // Sparse melody → keep full voicing with 7ths
      // Already included in chord generation
    }

    // High-register melody → don't stack harmony above it
    voicing = voicing.filter((note) => note <= maxMelodyPitch - 2);
    if (voicing.length === 0) {
      // Fallback: use root + fifth in lower octave
      voicing = [chord.rootMidi, chord.rootMidi + 7];
    }

    return { ...chord, voicing };
  });
}

// ─── Bass Line Logic ──────────────────────────────────────────────────────────

/**
 * Refine bass notes based on phrase energy:
 * - Calm (energy < 0.4): root on beat 1, sustained
 * - Active (energy 0.4–0.7): root on 1, fifth/octave on 3
 * - Tension (energy > 0.7): passing tone leading to next bar's root
 */
export function refineBassLine(
  chords: ChordEvent[],
  phraseEnergy: number
): ChordEvent[] {
  return chords.map((chord, i) => {
    let bassNote = chord.rootMidi - 12;
    let bassRhythm: BassRhythm = "root_sustained";

    // Ensure bass is in bass register
    while (bassNote > BASS_OCTAVE_MIDI + 12) bassNote -= 12;
    while (bassNote < BASS_OCTAVE_MIDI) bassNote += 12;

    if (phraseEnergy < 0.4) {
      bassRhythm = "root_sustained";
    } else if (phraseEnergy < 0.7) {
      bassRhythm = "root_beat1_fifth_beat3";
    } else {
      // Tension: passing tone (semitone below next bar's root)
      const nextChord = chords[i + 1];
      if (nextChord) {
        bassNote = nextChord.rootMidi - 12 - 1; // semitone below next root
        while (bassNote < BASS_OCTAVE_MIDI) bassNote += 12;
        bassRhythm = "passing_tone";
      } else {
        bassRhythm = "root_beat1_fifth_beat3";
      }
    }

    return { ...chord, bassNote, bassRhythm };
  });
}

// ─── Apply Full Voice Leading Pass ────────────────────────────────────────────

export function applyVoiceLeadingPass(
  phraseHarmony: PhraseHarmony,
  phrase: Phrase,
  melodyNotes: Array<{ pitch: number }>
): PhraseHarmony {
  const maxMelodyPitch =
    melodyNotes.length > 0
      ? Math.max(...melodyNotes.map((n) => n.pitch))
      : null;

  function processOption(opt: ProgressionOption): ProgressionOption {
    let prevVoicing: number[] = [];
    const optimizedChords = opt.chords.map((chord) => {
      const newVoicing = optimizeVoicing(chord.voicing, prevVoicing, maxMelodyPitch);
      prevVoicing = newVoicing;
      return { ...chord, voicing: newVoicing };
    });

    const densityAdjusted = applyDensityLogic(
      optimizedChords,
      phrase,
      melodyNotes
    );
    const bassRefined = refineBassLine(densityAdjusted, phrase.energyScore);

    // Recalculate voice leading score
    let totalVL = 0;
    let prevV: number[] = [];
    for (const chord of bassRefined) {
      if (prevV.length > 0) {
        const minLen = Math.min(prevV.length, chord.voicing.length);
        let cost = 0;
        for (let i = 0; i < minLen; i++) cost += Math.abs(chord.voicing[i] - prevV[i]);
        totalVL += Math.max(0, 1 - cost / (minLen * 12));
      }
      prevV = chord.voicing;
    }
    const vlScore =
      bassRefined.length > 1
        ? parseFloat((totalVL / (bassRefined.length - 1)).toFixed(3))
        : 1.0;

    return { ...opt, chords: bassRefined, voiceLeadingScore: vlScore };
  }

  return {
    ...phraseHarmony,
    options: {
      A: processOption(phraseHarmony.options.A),
      B: processOption(phraseHarmony.options.B),
      C: processOption(phraseHarmony.options.C),
    },
  };
}
