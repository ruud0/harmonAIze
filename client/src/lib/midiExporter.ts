/**
 * Harmony Enhancement MVP — MIDI Export Pipeline (Stage 7 / Week 4)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Export is read-only. Resolves selected_options → full chord data → output MIDI.
 * Constructs: chord track, bass track, merged with original melody track.
 * Uses midi-writer-js for MIDI file construction.
 */

import type { Session, ChordEvent, EmotionalMode } from "./types";
import { midiToFullName } from "./midiParser";

// ─── Mode → GM instrument ─────────────────────────────────────────────────────

const MODE_CHORD_INSTRUMENT: Record<EmotionalMode, number> = {
  bright: 48, // String Ensemble 1
  dark:   89, // Pad 2 Warm
  calm:   52, // Choir Aahs
  tense:  82, // Lead 3 Calliope
};

const MODE_BASS_INSTRUMENT: Record<EmotionalMode, number> = {
  bright: 32, // Acoustic Bass
  calm:   32, // Acoustic Bass
  dark:   38, // Synth Bass 1
  tense:  38, // Synth Bass 1
};

// ─── Duration Mapping ─────────────────────────────────────────────────────────

function beatsToMWJDuration(beats: number): string {
  if (beats >= 4) return "1"; // whole note
  if (beats >= 2) return "2"; // half note
  if (beats >= 1) return "4"; // quarter note
  return "8";                 // eighth note
}

// ─── MIDI Export ──────────────────────────────────────────────────────────────

export async function exportMidi(session: Session): Promise<Blob> {
  // Dynamic import to avoid SSR issues
  const MidiWriter = await import("midi-writer-js");
  const Writer = MidiWriter.default ?? MidiWriter;

  const ticksPerBeat = 128;

  // ─── Track 1: Original Melody ───────────────────────────────────────────────
  const melodyTrack = new Writer.Track();
  melodyTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: 0 })); // Acoustic Grand Piano

  for (const note of session.melody) {
    const startTick =
      ((note.bar - 1) * 4 + (note.beat - 1) + (note.subdivision - 1) * 0.25) *
      ticksPerBeat;
    const durationTicks = Math.round(note.durationBeats * ticksPerBeat);

    melodyTrack.addEvent(
      new Writer.NoteEvent({
        pitch: [midiToFullName(note.pitch)],
        duration: beatsToMWJDuration(note.durationBeats),
        velocity: note.velocity,
        startTick: Math.round(startTick),
      })
    );
  }

  // ─── Resolve phrases with mode info ─────────────────────────────────────────
  const phraseGroups = resolveChordsByPhrase(session);

  // Sort phrase groups by first chord's position
  const sortedGroups = [...phraseGroups].sort((a, b) => {
    const aFirst = a.chords[0];
    const bFirst = b.chords[0];
    if (!aFirst) return 1;
    if (!bFirst) return -1;
    return aFirst.bar !== bFirst.bar ? aFirst.bar - bFirst.bar : aFirst.beat - bFirst.beat;
  });

  // ─── Track 2: Single chord track with per-phrase program changes ─────────────
  const chordTrack = new Writer.Track();
  let lastChordMode: EmotionalMode | null = null;

  for (const { phraseId, mode, chords } of sortedGroups) {
    if (chords.length === 0) continue;

    // Apply program change before first chord of phrase if mode changed
    if (mode !== lastChordMode) {
      chordTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: MODE_CHORD_INSTRUMENT[mode] }));
      lastChordMode = mode;
    }

    chords.forEach((chord, chordIndex) => {
      const override = session.timingOverrides?.[phraseId]?.[chordIndex];
      const bar = override?.bar ?? chord.bar;
      const beat = override?.beat ?? chord.beat;
      const subdivision = override?.subdivision ?? 1;
      const durationBeats = override?.durationBeats ?? (chord.durationBeats ?? 4);
      const pitchOffsets = override?.pitchOffsets ?? [];
      const voicing = chord.voicing.map((p, i) => p + (pitchOffsets[i] ?? 0));

      const startTick =
        ((bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25) * ticksPerBeat;

      chordTrack.addEvent(
        new Writer.NoteEvent({
          pitch: voicing.map(midiToFullName),
          duration: beatsToMWJDuration(durationBeats),
          velocity: 70,
          startTick: Math.round(startTick),
        })
      );
    });
  }

  // ─── Track 3: Single bass track with per-phrase program changes ──────────────
  const bassTrack = new Writer.Track();
  let lastBassMode: EmotionalMode | null = null;

  for (const { phraseId, mode, chords } of sortedGroups) {
    if (chords.length === 0) continue;

    // Apply program change before first bass note of phrase if mode changed
    if (mode !== lastBassMode) {
      bassTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: MODE_BASS_INSTRUMENT[mode] }));
      lastBassMode = mode;
    }

    chords.forEach((chord, chordIndex) => {
      const override = session.timingOverrides?.[phraseId]?.[chordIndex];
      const bar = override?.bar ?? chord.bar;
      const beat = override?.beat ?? chord.beat;
      const subdivision = override?.subdivision ?? 1;
      const durationBeats = override?.durationBeats ?? (chord.durationBeats ?? 4);

      const startTick =
        ((bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25) * ticksPerBeat;

      if (chord.bassRhythm === "root_sustained") {
        bassTrack.addEvent(
          new Writer.NoteEvent({
            pitch: [midiToFullName(chord.bassNote)],
            duration: beatsToMWJDuration(durationBeats),
            velocity: 80,
            startTick: Math.round(startTick),
          })
        );
      } else if (chord.bassRhythm === "root_beat1_fifth_beat3" && beat === 1) {
        bassTrack.addEvent(
          new Writer.NoteEvent({
            pitch: [midiToFullName(chord.bassNote)],
            duration: "2",
            velocity: 80,
            startTick: Math.round(startTick),
          })
        );
        bassTrack.addEvent(
          new Writer.NoteEvent({
            pitch: [midiToFullName(chord.bassNote + 7)],
            duration: "2",
            velocity: 70,
            startTick: Math.round(startTick + 128 * 2),
          })
        );
      } else {
        bassTrack.addEvent(
          new Writer.NoteEvent({
            pitch: [midiToFullName(chord.bassNote)],
            duration: beatsToMWJDuration(durationBeats),
            velocity: chord.bassRhythm === "passing_tone" ? 75 : 80,
            startTick: Math.round(startTick),
          })
        );
      }
    });
  }

  // ─── Write MIDI File ────────────────────────────────────────────────────────
  const allTracks = [melodyTrack, chordTrack, bassTrack];
  const write = new Writer.Writer(allTracks);
  const dataUri = write.dataUri();

  // Convert data URI to Blob
  const base64 = dataUri.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: "audio/midi" });
}

// ─── Resolve Selections ───────────────────────────────────────────────────────

function resolveChordsByPhrase(
  session: Session
): Array<{ phraseId: string; mode: EmotionalMode; chords: ChordEvent[] }> {
  return session.phrases
    .map((phrase) => {
      const selection = session.selectedOptions[phrase.phraseId];
      const mode: EmotionalMode = selection?.mode ?? "bright";
      const option = selection?.option ?? "A";
      const phraseHarmony = session.harmonicOutput[mode].find(
        (h) => h.phraseId === phrase.phraseId
      );
      return { phraseId: phrase.phraseId, mode, chords: phraseHarmony?.options[option].chords ?? [] };
    })
    .filter(({ chords }) => chords.length > 0);
}

// ─── Session Serialization ────────────────────────────────────────────────────

export function serializeSession(session: Session): string {
  return JSON.stringify(session, null, 2);
}

export function deserializeSession(json: string): Session {
  return JSON.parse(json) as Session;
}

export function downloadSession(session: Session): void {
  const json = serializeSession(session);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `harmony-session-${session.sessionId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
