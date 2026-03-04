/**
 * Harmony Enhancement MVP — MIDI Ingestion & Parsing (Stage 1)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Parses raw MIDI → CanonicalNote[] with beat/bar grid alignment.
 * Uses midi-file for robust low-level MIDI parsing (handles Type 0 and Type 1).
 * Everything downstream reads from CanonicalNote[] — nothing re-reads raw MIDI.
 */

import { parseMidi } from "midi-file";
import type { CanonicalNote, BeatStrength, Session } from "./types";
import { createEmptySession } from "./types";

// ─── Beat Strength Assignment (4/4 only) ─────────────────────────────────────

function assignBeatStrength(beat: number, subdivision: number): BeatStrength {
  if (subdivision !== 1) return "passing";
  if (beat === 1) return "strong";
  if (beat === 3) return "secondary";
  return "weak";
}

// ─── Quantization ─────────────────────────────────────────────────────────────

function quantizeToGrid(
  timeSec: number,
  bpm: number,
  subdivisions = 16
): { bar: number; beat: number; subdivision: number } {
  const beatDuration = 60 / bpm;
  const totalBeats = timeSec / beatDuration;
  const gridUnit = 1 / (subdivisions / 4); // 1/16 = 0.25 beats
  const quantizedBeats = Math.round(totalBeats / gridUnit) * gridUnit;

  const bar = Math.floor(quantizedBeats / 4) + 1;
  const beatInBar = quantizedBeats % 4;
  const beat = Math.floor(beatInBar) + 1;
  const subInBeat = (beatInBar % 1) / 0.25;
  const subdivision = Math.round(subInBeat) + 1;

  return {
    bar: Math.max(1, bar),
    beat: Math.min(4, Math.max(1, beat)),
    subdivision: Math.min(4, Math.max(1, subdivision)),
  };
}

// ─── Tick → Seconds conversion ────────────────────────────────────────────────

function buildTickToSecConverter(
  tempoEvents: Array<{ tick: number; bpm: number }>,
  ticksPerBeat: number
) {
  return function tickToSec(targetTick: number): number {
    let sec = 0;
    let lastTick = 0;
    let lastBpm = 120;

    for (const evt of tempoEvents) {
      if (evt.tick >= targetTick) break;
      const deltaTicks = evt.tick - lastTick;
      sec += (deltaTicks / ticksPerBeat) * (60 / lastBpm);
      lastTick = evt.tick;
      lastBpm = evt.bpm;
    }

    const remainingTicks = targetTick - lastTick;
    sec += (remainingTicks / ticksPerBeat) * (60 / lastBpm);
    return sec;
  };
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

export async function parseMidiFile(file: File): Promise<Session> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const midi = parseMidi(uint8);

  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  // ── Collect tempo events ──────────────────────────────────────────────────
  const tempoEvents: Array<{ tick: number; bpm: number }> = [];
  let absoluteTick = 0;

  // Scan all tracks for tempo meta events
  for (const track of midi.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === "setTempo") {
        const bpm = 60_000_000 / (event as any).microsecondsPerBeat;
        tempoEvents.push({ tick, bpm });
      }
    }
  }

  if (tempoEvents.length === 0) {
    tempoEvents.push({ tick: 0, bpm: 120 });
  }
  tempoEvents.sort((a, b) => a.tick - b.tick);

  const primaryBpm = tempoEvents[0]?.bpm ?? 120;
  const tickToSec = buildTickToSecConverter(tempoEvents, ticksPerBeat);

  // ── Collect time signature ────────────────────────────────────────────────
  let numerator = 4;
  let denominator = 4;
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === "timeSignature") {
        numerator = (event as any).numerator ?? 4;
        denominator = (event as any).denominator ?? 4;
        break;
      }
    }
  }

  // ── Collect note events from all tracks ───────────────────────────────────
  interface RawNote {
    pitch: number;
    velocity: number;
    startTick: number;
    endTick: number;
    trackIdx: number;
  }

  const allNotes: RawNote[] = [];

  midi.tracks.forEach((track, trackIdx) => {
    let tick = 0;
    const openNotes = new Map<number, { velocity: number; startTick: number }>();

    for (const event of track) {
      tick += event.deltaTime;

      if (event.type === "noteOn" && (event as any).velocity > 0) {
        openNotes.set((event as any).noteNumber, {
          velocity: (event as any).velocity,
          startTick: tick,
        });
      } else if (
        event.type === "noteOff" ||
        (event.type === "noteOn" && (event as any).velocity === 0)
      ) {
        const noteNum = (event as any).noteNumber;
        const open = openNotes.get(noteNum);
        if (open) {
          allNotes.push({
            pitch: noteNum,
            velocity: open.velocity,
            startTick: open.startTick,
            endTick: tick,
            trackIdx,
          });
          openNotes.delete(noteNum);
        }
      }
    }

    // Close any still-open notes
    openNotes.forEach((open, noteNum) => {
      allNotes.push({
        pitch: noteNum,
        velocity: open.velocity,
        startTick: open.startTick,
        endTick: open.startTick + ticksPerBeat,
        trackIdx,
      });
    });
  });

  if (allNotes.length === 0) {
    throw new Error("No notes found in MIDI file.");
  }

  // ── Select melody track (highest average pitch) ───────────────────────────
  const trackGroups = new Map<number, RawNote[]>();
  for (const note of allNotes) {
    if (!trackGroups.has(note.trackIdx)) trackGroups.set(note.trackIdx, []);
    trackGroups.get(note.trackIdx)!.push(note);
  }

  let melodyTrackIdx = 0;
  let bestAvgPitch = -1;
  trackGroups.forEach((notes, idx) => {
    const avg = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
    if (avg > bestAvgPitch) {
      bestAvgPitch = avg;
      melodyTrackIdx = idx;
    }
  });

  const melodyNotes = (trackGroups.get(melodyTrackIdx) ?? allNotes).sort(
    (a, b) => a.startTick - b.startTick
  );

  // ── Build CanonicalNote[] ─────────────────────────────────────────────────
  const canonicalNotes: CanonicalNote[] = melodyNotes.map((note, i) => {
    const startSec = tickToSec(note.startTick);
    const endSec = tickToSec(note.endTick);
    const durationSec = Math.max(0.01, endSec - startSec);
    const durationBeats = durationSec / (60 / primaryBpm);

    const { bar, beat, subdivision } = quantizeToGrid(startSec, primaryBpm, 16);
    const beatStrength = assignBeatStrength(beat, subdivision);
    const isPassingTone = durationBeats < 0.5;

    return {
      index: i,
      pitch: note.pitch,
      velocity: note.velocity,
      bar,
      beat,
      subdivision,
      durationBeats,
      beatStrength,
      isPassingTone,
    };
  });

  // ── Calculate total bars ──────────────────────────────────────────────────
  const lastNote = canonicalNotes[canonicalNotes.length - 1];
  const totalBars = lastNote
    ? lastNote.bar + Math.ceil(lastNote.durationBeats / 4)
    : 1;

  // ── Duration in seconds ───────────────────────────────────────────────────
  const lastRawNote = melodyNotes[melodyNotes.length - 1];
  const durationSeconds = lastRawNote ? tickToSec(lastRawNote.endTick) : 0;

  // ── Build session ─────────────────────────────────────────────────────────
  const session = createEmptySession(file.name);
  session.melody = canonicalNotes;
  session.midiMeta = {
    trackCount: midi.tracks.length,
    tempos: tempoEvents,
    timeSignature: { numerator, denominator },
    totalBars,
    durationSeconds,
  };
  session.pipelineStage = "detecting_key";

  return session;
}

// ─── Note Name Utilities ──────────────────────────────────────────────────────

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
];

export function midiToNoteName(midi: number): string {
  return NOTE_NAMES[midi % 12];
}

export function noteNameToMidi(name: string, octave = 4): number {
  const idx = NOTE_NAMES.indexOf(name);
  if (idx === -1) throw new Error(`Unknown note name: ${name}`);
  return (octave + 1) * 12 + idx;
}

export function midiToFullName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}
