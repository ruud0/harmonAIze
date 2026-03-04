/**
 * Harmony Enhancement MVP — MIDI Export Pipeline (Stage 7 / Week 4)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Export is read-only. Resolves selected_options → full chord data → output MIDI.
 * Constructs: chord track, bass track, merged with original melody track.
 * Uses midi-writer-js for MIDI file construction.
 */

import type { Session, ChordEvent, BassRhythm, EmotionalMode } from "./types";
import { midiToFullName } from "./midiParser";

// ─── Mode → GM instrument ─────────────────────────────────────────────────────

const MODE_CHORD_INSTRUMENT: Record<EmotionalMode, number> = {
  bright: 4,   // Electric Piano 1 (Rhodes)
  dark:   48,  // String Ensemble 1
  calm:   89,  // Pad 2 Warm
  tense:  62,  // Brass Section
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

  // ─── Tracks 2+: One chord track per emotional mode used ─────────────────────
  const phraseGroups = resolveChordsByPhrase(session);
  const chordTracksByMode = new Map<EmotionalMode, typeof melodyTrack>();

  for (const { mode, chords } of phraseGroups) {
    if (!chordTracksByMode.has(mode)) {
      const track = new Writer.Track();
      track.addEvent(new Writer.ProgramChangeEvent({ instrument: MODE_CHORD_INSTRUMENT[mode] }));
      chordTracksByMode.set(mode, track);
    }
    const chordTrack = chordTracksByMode.get(mode)!;
    for (const chord of chords) {
      const startTick = ((chord.bar - 1) * 4 + (chord.beat - 1)) * ticksPerBeat;
      chordTrack.addEvent(
        new Writer.NoteEvent({
          pitch: chord.voicing.map(midiToFullName),
          duration: beatsToMWJDuration(chord.durationBeats ?? 4),
          velocity: 70,
          startTick: Math.round(startTick),
        })
      );
    }
  }

  // ─── Bass Track (all phrases combined) ──────────────────────────────────────
  const bassTrack = new Writer.Track();
  bassTrack.addEvent(new Writer.ProgramChangeEvent({ instrument: 32 })); // acoustic bass

  const allChordsForBass = phraseGroups
    .flatMap((g) => g.chords)
    .sort((a, b) => a.bar - b.bar || a.beat - b.beat);

  for (const chord of allChordsForBass) {
    const startTick = ((chord.bar - 1) * 4 + (chord.beat - 1)) * ticksPerBeat;

    if (chord.bassRhythm === "root_sustained") {
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(chord.bassNote)],
          duration: beatsToMWJDuration(chord.durationBeats ?? 4),
          velocity: 80,
          startTick: Math.round(startTick),
        })
      );
    } else if (chord.bassRhythm === "root_beat1_fifth_beat3" && chord.beat === 1) {
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
          startTick: Math.round(startTick + ticksPerBeat * 2),
        })
      );
    } else {
      bassTrack.addEvent(
        new Writer.NoteEvent({
          pitch: [midiToFullName(chord.bassNote)],
          duration: beatsToMWJDuration(chord.durationBeats ?? 2),
          velocity: chord.bassRhythm === "passing_tone" ? 75 : 80,
          startTick: Math.round(startTick),
        })
      );
    }
  }

  // ─── Write MIDI File ────────────────────────────────────────────────────────
  const allTracks = [melodyTrack, ...Array.from(chordTracksByMode.values()), bassTrack];
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
): Array<{ mode: EmotionalMode; chords: ChordEvent[] }> {
  return session.phrases
    .map((phrase) => {
      const selection = session.selectedOptions[phrase.phraseId];
      const mode: EmotionalMode = selection?.mode ?? "bright";
      const option = selection?.option ?? "A";
      const phraseHarmony = session.harmonicOutput[mode].find(
        (h) => h.phraseId === phrase.phraseId
      );
      return { mode, chords: phraseHarmony?.options[option].chords ?? [] };
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
