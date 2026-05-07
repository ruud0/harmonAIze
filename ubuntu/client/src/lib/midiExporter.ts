/**
 * Harmony Enhancement MVP — MIDI Export Pipeline (Stage 7 / Week 4)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Export is read-only. Resolves selected_options → full chord data → output MIDI.
 * Constructs: chord track, bass track, merged with original melody track.
 * Uses midi-writer-js for MIDI file construction.
 * Respects timingOverrides and per-mode GM program numbers.
 */

import type { Session, ChordEvent, EmotionalMode } from "./types";
import { midiToFullName } from "./midiParser";

// ─── GM Program Numbers per Mode ──────────────────────────────────────────────

const CHORD_PROGRAMS: Record<EmotionalMode, number> = {
  bright: 48, // String Ensemble 1
  dark: 89,   // Pad 2 (warm)
  calm: 52,   // Choir Aahs
  tense: 82,  // Synth Lead (calliope)
};

const BASS_PROGRAMS: Record<EmotionalMode, number> = {
  bright: 32, // Acoustic Bass
  calm: 32,   // Acoustic Bass
  dark: 38,   // Synth Bass 1
  tense: 38,  // Synth Bass 1
};

// ─── Duration Mapping ─────────────────────────────────────────────────────────

const BEAT_TO_DURATION: Record<number, string> = {
  4: "1",   // whole note
  2: "2",   // half note
  1: "4",   // quarter note
  0.5: "8", // eighth note
};

function beatsToMWJDuration(beats: number): string {
  const rounded = Math.round(beats * 2) / 2;
  return BEAT_TO_DURATION[rounded] ?? "4";
}

// ─── Resolved Chord Entry (includes phrase/mode metadata) ────────────────────

interface ResolvedChordEntry {
  chord: ChordEvent;
  phraseId: string;
  chordIndex: number;
  mode: EmotionalMode;
}

// ─── MIDI Export ──────────────────────────────────────────────────────────────

export async function exportMidi(session: Session): Promise<Blob> {
  // Dynamic import to avoid SSR issues
  const MidiWriter = await import("midi-writer-js");
  const Writer = MidiWriter.default ?? MidiWriter;

  const bpm = session.midiMeta?.tempos[0]?.bpm ?? 120;
  const ticksPerBeat = 128;

  // ─── Track 1: Original Melody ───────────────────────────────────────────────
  const melodyTrack = new Writer.Track();
  melodyTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: 0 }));

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

  // ─── Track 2: Chord Track ───────────────────────────────────────────────────
  const chordTrack = new Writer.Track();
  const resolvedEntries = resolveSelectedChordsWithMode(session);

  let currentChordMode: EmotionalMode | null = null;
  for (const { chord, phraseId, chordIndex, mode } of resolvedEntries) {
    // Emit program change when mode changes
    if (mode !== currentChordMode) {
      chordTrack.addEvent(
        new Writer.ProgramChangeEvent({ instrument: CHORD_PROGRAMS[mode] })
      );
      currentChordMode = mode;
    }

    // Apply timing overrides (never mutate session)
    const override = session.timingOverrides?.[phraseId]?.[chordIndex];
    const bar = override?.bar ?? chord.bar;
    const beat = override?.beat ?? chord.beat;
    const subdivision = override?.subdivision ?? 1;
    const durationBeats = override?.durationBeats ?? 2;
    const pitchOffsets = override?.pitchOffsets ?? [];

    const startTick =
      ((bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25) * ticksPerBeat;

    const voicing = chord.voicing.map((p, i) => p + (pitchOffsets[i + 1] ?? 0));
    const pitchNames = voicing.map(midiToFullName);

    chordTrack.addEvent(
      new Writer.NoteEvent({
        pitch: pitchNames,
        duration: beatsToMWJDuration(durationBeats),
        velocity: 70,
        startTick: Math.round(startTick),
      })
    );
  }

  // ─── Track 3: Bass Track ────────────────────────────────────────────────────
  const bassTrack = new Writer.Track();

  let currentBassMode: EmotionalMode | null = null;
  for (const { chord, phraseId, chordIndex, mode } of resolvedEntries) {
    // Emit program change when mode changes
    if (mode !== currentBassMode) {
      bassTrack.addEvent(
        new Writer.ProgramChangeEvent({ instrument: BASS_PROGRAMS[mode] })
      );
      currentBassMode = mode;
    }

    const override = session.timingOverrides?.[phraseId]?.[chordIndex];
    const bar = override?.bar ?? chord.bar;
    const beat = override?.beat ?? chord.beat;
    const subdivision = override?.subdivision ?? 1;
    const durationBeats = override?.durationBeats ?? 2;
    const pitchOffsets = override?.pitchOffsets ?? [];

    const startTick =
      ((bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25) * ticksPerBeat;

    const bassNote = chord.bassNote + (pitchOffsets[0] ?? 0);

    if (chord.bassRhythm === "root_sustained") {
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(bassNote)],
          duration: beatsToMWJDuration(durationBeats),
          velocity: 80,
          startTick: Math.round(startTick),
        })
      );
    } else if (chord.bassRhythm === "root_beat1_fifth_beat3") {
      const beatDurationTicks = ticksPerBeat;
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(bassNote)],
          duration: "2",
          velocity: 80,
          startTick: Math.round(startTick),
        })
      );
      const fifthNote = bassNote + 7;
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(fifthNote)],
          duration: "2",
          velocity: 70,
          startTick: Math.round(startTick + beatDurationTicks * 2),
        })
      );
    } else {
      // Passing tone
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(bassNote)],
          duration: beatsToMWJDuration(durationBeats),
          velocity: 75,
          startTick: Math.round(startTick),
        })
      );
    }
  }

  // ─── Write MIDI File ────────────────────────────────────────────────────────
  const write = new Writer.Writer([melodyTrack, chordTrack, bassTrack]);
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

// ─── Resolve Selections with Mode ─────────────────────────────────────────────

function resolveSelectedChordsWithMode(session: Session): ResolvedChordEntry[] {
  const result: ResolvedChordEntry[] = [];

  for (const phrase of session.phrases) {
    const selection = session.selectedOptions[phrase.phraseId];
    const mode: EmotionalMode = selection?.mode ?? "bright";
    const optionKey = selection?.option ?? "A";

    const modeOutput = session.harmonicOutput[mode];
    const phraseHarmony = modeOutput.find(
      (h) => h.phraseId === phrase.phraseId
    );
    if (!phraseHarmony) continue;

    const chords = phraseHarmony.options[optionKey].chords;
    chords.forEach((chord, chordIndex) => {
      result.push({ chord, phraseId: phrase.phraseId, chordIndex, mode });
    });
  }

  return result.sort(
    (a, b) => a.chord.bar - b.chord.bar || a.chord.beat - b.chord.beat
  );
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
