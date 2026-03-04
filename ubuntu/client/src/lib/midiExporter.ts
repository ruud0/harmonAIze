/**
 * Harmony Enhancement MVP — MIDI Export Pipeline (Stage 7 / Week 4)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Export is read-only. Resolves selected_options → full chord data → output MIDI.
 * Constructs: chord track, bass track, merged with original melody track.
 * Uses midi-writer-js for MIDI file construction.
 */

import type { Session, ChordEvent, BassRhythm } from "./types";
import { midiToFullName } from "./midiParser";

// ─── Duration Mapping ─────────────────────────────────────────────────────────

// midi-writer-js duration strings
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
  chordTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: 48 })); // strings

  const resolvedChords = resolveSelectedChords(session);
  for (const chord of resolvedChords) {
    const startTick = ((chord.bar - 1) * 4 + (chord.beat - 1)) * ticksPerBeat;
    const pitchNames = chord.voicing.map(midiToFullName);

    chordTrack.addEvent(
      new Writer.NoteEvent({
        pitch: pitchNames,
        duration: "2", // half note per chord
        velocity: 70,
        startTick: Math.round(startTick),
      })
    );
  }

  // ─── Track 3: Bass Track ────────────────────────────────────────────────────
  const bassTrack = new Writer.Track();
  bassTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: 32 })); // acoustic bass

  for (const chord of resolvedChords) {
    const startTick = ((chord.bar - 1) * 4 + (chord.beat - 1)) * ticksPerBeat;

    if (chord.bassRhythm === "root_sustained") {
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(chord.bassNote)],
          duration: "1",
          velocity: 80,
          startTick: Math.round(startTick),
        })
      );
    } else if (chord.bassRhythm === "root_beat1_fifth_beat3") {
      // Root on beat 1
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(chord.bassNote)],
          duration: "2",
          velocity: 80,
          startTick: Math.round(startTick),
        })
      );
      // Fifth on beat 3
      const fifthNote = chord.bassNote + 7;
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(fifthNote)],
          duration: "2",
          velocity: 70,
          startTick: Math.round(startTick + ticksPerBeat * 2),
        })
      );
    } else {
      // Passing tone
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(chord.bassNote)],
          duration: "1",
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

// ─── Resolve Selections ───────────────────────────────────────────────────────

function resolveSelectedChords(session: Session): ChordEvent[] {
  const allChords: ChordEvent[] = [];

  for (const phrase of session.phrases) {
    const selection = session.selectedOptions[phrase.phraseId];
    if (!selection) {
      // Default to bright mode, option A
      const harmony = session.harmonicOutput.bright.find(
        (h) => h.phraseId === phrase.phraseId
      );
      if (harmony) allChords.push(...harmony.options.A.chords);
      continue;
    }

    const modeOutput = session.harmonicOutput[selection.mode];
    const phraseHarmony = modeOutput.find(
      (h) => h.phraseId === phrase.phraseId
    );
    if (phraseHarmony) {
      allChords.push(...phraseHarmony.options[selection.option].chords);
    }
  }

  // Sort by bar then beat
  return allChords.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
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
