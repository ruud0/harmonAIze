/**
 * harmonAIze MIDI export
 * Format 1 (multi-track) for full export, Format 0 (single-track) for per-layer zips
 */

import { type HarmNote, PPQ, snapTick, midiToPitchName } from "./harmonaizeTypes";

const BEATS_PER_BAR = 4;

function noteGlobalStartTick(n: HarmNote): number {
  return n.bar * BEATS_PER_BAR * PPQ + n.startTick;
}

// ── Raw MIDI bytes writer ──────────────────────────────────────────────────

function varLen(value: number): number[] {
  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.unshift(0x80 | (value & 0x7f));
    value >>= 7;
  }
  return bytes;
}

function uint16BE(v: number): [number, number] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function uint24BE(v: number): [number, number, number] {
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function uint32BE(v: number): [number, number, number, number] {
  return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

interface MidiEvent {
  tick: number;
  bytes: number[];
}

function buildTrackChunk(events: MidiEvent[], name?: string): Uint8Array {
  // Sort by tick
  events.sort((a, b) => a.tick - b.tick);

  const data: number[] = [];

  // Track name meta event at tick 0
  if (name) {
    const nameBytes = Array.from(new TextEncoder().encode(name));
    data.push(0x00, 0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes);
  }

  let lastTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - lastTick);
    data.push(...varLen(delta), ...ev.bytes);
    lastTick = ev.tick;
  }

  // End of track
  data.push(0x00, 0xff, 0x2f, 0x00);

  const len = data.length;
  return new Uint8Array([
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...uint32BE(len),
    ...data,
  ]);
}

function buildTempoTrack(bpm: number): Uint8Array {
  const usPerBeat = Math.round(60_000_000 / bpm);
  const events: number[] = [
    // Tempo
    0x00, 0xff, 0x51, 0x03, ...uint24BE(usPerBeat),
    // Time sig 4/4
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
    // End of track
    0x00, 0xff, 0x2f, 0x00,
  ];
  const len = events.length;
  return new Uint8Array([0x4d, 0x54, 0x72, 0x6b, ...uint32BE(len), ...events]);
}

function buildNoteEvents(
  notes: HarmNote[],
  channel: number,
  velocity: number
): MidiEvent[] {
  const events: MidiEvent[] = [];
  for (const note of notes) {
    const startTick = snapTick(noteGlobalStartTick(note));
    const endTick = startTick + Math.max(PPQ / 4, note.duration);
    const ch = channel & 0x0f;
    events.push({
      tick: startTick,
      bytes: [0x90 | ch, note.pitch & 0x7f, velocity & 0x7f],
    });
    events.push({
      tick: endTick,
      bytes: [0x80 | ch, note.pitch & 0x7f, 0x00],
    });
  }
  return events;
}

function headerChunk(format: 0 | 1, trackCount: number): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06,  // length = 6
    ...uint16BE(format),
    ...uint16BE(trackCount),
    ...uint16BE(PPQ),
  ]);
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function exportMultiTrackMidi(notes: HarmNote[], bpm: number): Blob {
  const melody = notes.filter((n) => n.layer === "melody");
  const chords = notes.filter((n) => n.layer === "chords");
  const bass = notes.filter((n) => n.layer === "bass");

  const header = headerChunk(1, 4); // 4 tracks: tempo + melody + chords + bass
  const tempoTrack = buildTempoTrack(bpm);
  const melodyTrack = buildTrackChunk(buildNoteEvents(melody, 0, 100), "Melody");
  const chordsTrack = buildTrackChunk(buildNoteEvents(chords, 1, 80), "Chords");
  const bassTrack = buildTrackChunk(buildNoteEvents(bass, 2, 90), "Bass");

  const bytes = concatArrays([header, tempoTrack, melodyTrack, chordsTrack, bassTrack]);
  return new Blob([bytes], { type: "audio/midi" });
}

export function exportSingleLayerMidi(notes: HarmNote[], layer: "melody" | "chords" | "bass", bpm: number): Blob {
  const velocity = layer === "melody" ? 100 : layer === "chords" ? 80 : 90;
  const filtered = notes.filter((n) => n.layer === layer);

  const header = headerChunk(0, 1);
  const tempoEvents: MidiEvent[] = [
    { tick: 0, bytes: [0xff, 0x51, 0x03, ...uint24BE(Math.round(60_000_000 / bpm))] },
    { tick: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] },
  ];
  const noteEvents = buildNoteEvents(filtered, 0, velocity);
  const track = buildTrackChunk([...tempoEvents, ...noteEvents], layer.charAt(0).toUpperCase() + layer.slice(1));

  const bytes = concatArrays([header, track]);
  return new Blob([bytes], { type: "audio/midi" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
