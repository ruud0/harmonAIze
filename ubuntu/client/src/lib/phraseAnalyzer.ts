/**
 * Harmony Enhancement MVP — Phrase Analysis Engine (Stage 4 / Week 1)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Detects phrase boundaries using:
 * - Silence ≥ 1 beat
 * - Long note on beat 1
 * - 4-bar repetition patterns
 * - Pitch climax near bar 4 or 8
 * Biases toward 4-bar and 8-bar phrase boundaries.
 *
 * Output per phrase: { phraseId, startBar, endBar, energyScore, densityScore, peakFlag, cadenceFlag, noteRefs }
 */

import type { CanonicalNote, Phrase } from "./types";

// ─── Phrase Detection ─────────────────────────────────────────────────────────

export function analyzePhrases(notes: CanonicalNote[], totalBars: number): Phrase[] {
  if (notes.length === 0) return [];

  // Group notes by bar
  const notesByBar: Map<number, CanonicalNote[]> = new Map();
  for (const note of notes) {
    if (!notesByBar.has(note.bar)) notesByBar.set(note.bar, []);
    notesByBar.get(note.bar)!.push(note);
  }

  // Detect candidate phrase boundaries
  const boundaries = new Set<number>([1]); // always start at bar 1

  // 1. Silence ≥ 1 beat: gap between end of last note in bar N and first note in bar N+1
  for (let bar = 1; bar < totalBars; bar++) {
    const barNotes = notesByBar.get(bar);
    const nextBarNotes = notesByBar.get(bar + 1);
    if (!barNotes || barNotes.length === 0) {
      boundaries.add(bar + 1);
      continue;
    }
    if (!nextBarNotes || nextBarNotes.length === 0) continue;

    const lastNoteEnd =
      barNotes.reduce((max, n) => Math.max(max, n.beat + n.durationBeats - 1), 0);
    const firstNoteStart = nextBarNotes.reduce(
      (min, n) => Math.min(min, n.beat),
      5
    );
    const gap = firstNoteStart + (4 - lastNoteEnd); // gap in beats
    if (gap >= 1) boundaries.add(bar + 1);
  }

  // 2. Long note on beat 1 of a bar (duration ≥ 2 beats) → new phrase starts here
  for (const note of notes) {
    if (note.beat === 1 && note.durationBeats >= 2 && note.bar > 1) {
      boundaries.add(note.bar);
    }
  }

  // 3. Bias toward 4-bar and 8-bar boundaries
  for (let bar = 5; bar <= totalBars; bar += 4) {
    boundaries.add(bar);
  }

  // 4. Pitch climax detection: if highest pitch in melody is near bar 4 or 8 multiples
  const maxPitch = Math.max(...notes.map((n) => n.pitch));
  const climaxNotes = notes.filter((n) => n.pitch >= maxPitch - 2);
  for (const cn of climaxNotes) {
    // Add boundary 1 bar after climax
    if (cn.bar + 1 <= totalBars) boundaries.add(cn.bar + 1);
  }

  // Sort boundaries and build phrase segments
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  // Add end sentinel
  sortedBoundaries.push(totalBars + 1);

  // Build phrase objects
  const phrases: Phrase[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const startBar = sortedBoundaries[i];
    const endBar = sortedBoundaries[i + 1] - 1;

    if (endBar < startBar) continue;

    // Collect notes in this phrase
    const phraseNotes: CanonicalNote[] = [];
    for (let bar = startBar; bar <= endBar; bar++) {
      const bn = notesByBar.get(bar);
      if (bn) phraseNotes.push(...bn);
    }

    if (phraseNotes.length === 0) continue;

    // Energy score: average velocity normalized
    const avgVelocity =
      phraseNotes.reduce((s, n) => s + n.velocity, 0) / phraseNotes.length;
    const energyScore = parseFloat((avgVelocity / 127).toFixed(3));

    // Density score: notes per beat
    const phraseLengthBeats = (endBar - startBar + 1) * 4;
    const densityScore = parseFloat(
      Math.min(1, phraseNotes.length / phraseLengthBeats).toFixed(3)
    );

    // Peak flag: contains the pitch climax
    const phraseMaxPitch = Math.max(...phraseNotes.map((n) => n.pitch));
    const peakFlag = phraseMaxPitch >= maxPitch - 2;

    // Cadence flag: last bar has descending motion
    const lastBarNotes = phraseNotes.filter((n) => n.bar === endBar);
    let cadenceFlag = false;
    if (lastBarNotes.length >= 2) {
      const sorted = [...lastBarNotes].sort((a, b) => a.beat - b.beat);
      const firstPitch = sorted[0].pitch;
      const lastPitch = sorted[sorted.length - 1].pitch;
      cadenceFlag = lastPitch < firstPitch;
    }

    phrases.push({
      phraseId: `phrase_${phrases.length}`,
      startBar,
      endBar,
      energyScore,
      densityScore,
      peakFlag,
      cadenceFlag,
      noteRefs: phraseNotes.map((n) => n.index),
    });
  }

  // Merge very short phrases (< 2 bars) into adjacent ones
  return mergeShorPhrases(phrases);
}

function mergeShorPhrases(phrases: Phrase[]): Phrase[] {
  if (phrases.length <= 1) return phrases;

  const result: Phrase[] = [];
  let i = 0;
  while (i < phrases.length) {
    const p = phrases[i];
    const length = p.endBar - p.startBar + 1;
    if (length < 2 && i < phrases.length - 1) {
      // Merge with next phrase
      const next = phrases[i + 1];
      result.push({
        phraseId: p.phraseId,
        startBar: p.startBar,
        endBar: next.endBar,
        energyScore: (p.energyScore + next.energyScore) / 2,
        densityScore: (p.densityScore + next.densityScore) / 2,
        peakFlag: p.peakFlag || next.peakFlag,
        cadenceFlag: next.cadenceFlag,
        noteRefs: [...p.noteRefs, ...next.noteRefs],
      });
      i += 2;
    } else {
      result.push(p);
      i++;
    }
  }

  // Re-index phrase IDs
  return result.map((p, idx) => ({ ...p, phraseId: `phrase_${idx}` }));
}
