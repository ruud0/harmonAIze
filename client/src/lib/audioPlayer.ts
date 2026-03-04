/**
 * Harmony Enhancement MVP — Audio Playback (Tone.js)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Plays chord progressions for auditioning using Tone.js PolySynth.
 * Keeps it simple: no full DAW, just quick chord previews.
 */

import * as Tone from "tone";
import type { ChordEvent, EmotionalMode } from "./types";
import { midiToFullName } from "./midiParser";

let synth: Tone.PolySynth | null = null;
let bassSynth: Tone.Synth | null = null;
let isPlaying = false;

// ─── Mode-specific synth profiles ─────────────────────────────────────────────

type SynthProfile = {
  oscType: "sine" | "triangle" | "sawtooth" | "square";
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  chordVol: number;
  bassOscType: "sine" | "triangle" | "sawtooth" | "square";
  bassVol: number;
};

const SYNTH_PROFILES: Record<EmotionalMode, SynthProfile> = {
  bright: {
    oscType: "triangle",
    attack: 0.02, decay: 0.1, sustain: 0.55, release: 0.7,
    chordVol: -8,
    bassOscType: "sine",
    bassVol: -6,
  },
  dark: {
    oscType: "sawtooth",
    attack: 0.15, decay: 0.3, sustain: 0.7, release: 1.5,
    chordVol: -10,
    bassOscType: "sawtooth",
    bassVol: -7,
  },
  calm: {
    oscType: "sine",
    attack: 0.3, decay: 0.2, sustain: 0.6, release: 2.0,
    chordVol: -10,
    bassOscType: "sine",
    bassVol: -9,
  },
  tense: {
    oscType: "square",
    attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.3,
    chordVol: -9,
    bassOscType: "triangle",
    bassVol: -5,
  },
};

function ensureSynths() {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.6, release: 0.8 },
      volume: -8,
    }).toDestination();
  }
  if (!bassSynth) {
    bassSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.5 },
      volume: -6,
    }).toDestination();
  }
}

function applyMode(mode: EmotionalMode) {
  const p = SYNTH_PROFILES[mode];
  synth!.set({
    oscillator: { type: p.oscType as any },
    envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
  });
  synth!.volume.value = p.chordVol;
  bassSynth!.set({ oscillator: { type: p.bassOscType as any } });
  bassSynth!.volume.value = p.bassVol;
}

export async function playChordProgression(
  chords: ChordEvent[],
  bpm = 100,
  mode: EmotionalMode = "bright",
  onChordChange?: (barIndex: number) => void
): Promise<void> {
  if (isPlaying) stopPlayback();

  await Tone.start();
  ensureSynths();
  applyMode(mode);

  const beatDuration = 60 / bpm;

  isPlaying = true;
  Tone.getTransport().bpm.value = bpm;

  if (chords.length === 0) return;

  const startTime = Tone.now() + 0.1;
  const firstAbsBeats = (chords[0].bar - 1) * 4 + (chords[0].beat - 1);

  chords.forEach((chord, idx) => {
    const chordNotes = chord.voicing.map(midiToFullName);
    const bassNote = midiToFullName(chord.bassNote);
    const absBeats = (chord.bar - 1) * 4 + (chord.beat - 1);
    const chordTime = startTime + (absBeats - firstAbsBeats) * beatDuration;
    const chordDuration = (chord.durationBeats ?? 4) * beatDuration * 0.95;

    // Schedule chord
    synth!.triggerAttackRelease(chordNotes, chordDuration, chordTime);

    // Schedule bass
    if (chord.bassRhythm === "root_beat1_fifth_beat3" && chord.beat === 1) {
      bassSynth!.triggerAttackRelease(bassNote, beatDuration * 1.8, chordTime);
      const fifthNote = midiToFullName(chord.bassNote + 7);
      bassSynth!.triggerAttackRelease(
        fifthNote,
        beatDuration * 1.8,
        chordTime + beatDuration * 2
      );
    } else {
      bassSynth!.triggerAttackRelease(bassNote, chordDuration, chordTime);
    }

    // Notify UI of chord change
    if (onChordChange) {
      Tone.getDraw().schedule(() => {
        onChordChange(idx);
      }, chordTime);
    }
  });

  // Stop after last chord finishes
  const lastChord = chords[chords.length - 1];
  const lastAbsBeats = (lastChord.bar - 1) * 4 + (lastChord.beat - 1);
  const totalDuration =
    (lastAbsBeats - firstAbsBeats + (lastChord.durationBeats ?? 4)) * beatDuration + 0.5;
  setTimeout(() => {
    isPlaying = false;
  }, totalDuration * 1000);
}

export async function playSingleChord(
  chord: ChordEvent,
  durationSec = 1.5
): Promise<void> {
  await Tone.start();
  ensureSynths();

  const chordNotes = chord.voicing.map(midiToFullName);
  synth!.triggerAttackRelease(chordNotes, durationSec, Tone.now() + 0.05);
  bassSynth!.triggerAttackRelease(
    midiToFullName(chord.bassNote),
    durationSec,
    Tone.now() + 0.05
  );
}

export function stopPlayback(): void {
  if (synth) synth.releaseAll();
  isPlaying = false;
}

export function getIsPlaying(): boolean {
  return isPlaying;
}
