/**
 * Harmony Enhancement MVP — Audio Playback (Tone.js)
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Plays chord progressions for auditioning using Tone.js PolySynth.
 * Three distinct timbres: melodySynth, chordSynth, bassSynth.
 */

import * as Tone from "tone";
import type { ChordEvent } from "./types";
import { midiToFullName } from "./midiParser";

let melodySynth: Tone.PolySynth | null = null;
let chordSynth: Tone.PolySynth | null = null;
let bassSynth: Tone.Synth | null = null;
let isPlaying = false;

function ensureSynths() {
  if (!melodySynth) {
    melodySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
      volume: -6,
    }).toDestination();
  }
  if (!chordSynth) {
    chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.2, sustain: 0.7, release: 1.5 },
      volume: -10,
    }).toDestination();
  }
  if (!bassSynth) {
    bassSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.8 },
      volume: -6,
    }).toDestination();
  }
}

export async function playChordProgression(
  chords: ChordEvent[],
  bpm = 100,
  onChordChange?: (barIndex: number) => void
): Promise<void> {
  if (isPlaying) stopPlayback();

  await Tone.start();
  ensureSynths();

  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * 4;

  isPlaying = true;
  Tone.getTransport().bpm.value = bpm;

  let time = Tone.now() + 0.1;

  chords.forEach((chord, idx) => {
    const chordNotes = chord.voicing.map(midiToFullName);
    const bassNote = midiToFullName(chord.bassNote);
    const duration = barDuration * 0.95; // slight gap between chords

    // Schedule chord
    chordSynth!.triggerAttackRelease(chordNotes, duration, time);

    // Schedule bass
    if (chord.bassRhythm === "root_beat1_fifth_beat3") {
      bassSynth!.triggerAttackRelease(bassNote, beatDuration * 1.8, time);
      const fifthNote = midiToFullName(chord.bassNote + 7);
      bassSynth!.triggerAttackRelease(
        fifthNote,
        beatDuration * 1.8,
        time + beatDuration * 2
      );
    } else {
      bassSynth!.triggerAttackRelease(bassNote, duration, time);
    }

    // Notify UI of chord change
    if (onChordChange) {
      Tone.getDraw().schedule(() => {
        onChordChange(idx);
      }, time);
    }

    time += barDuration;
  });

  // Stop after all chords play
  const totalDuration = chords.length * barDuration + 0.5;
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
  chordSynth!.triggerAttackRelease(chordNotes, durationSec, Tone.now() + 0.05);
  bassSynth!.triggerAttackRelease(
    midiToFullName(chord.bassNote),
    durationSec,
    Tone.now() + 0.05
  );
}

export function stopPlayback(): void {
  if (melodySynth) { melodySynth.dispose(); melodySynth = null; }
  if (chordSynth) { chordSynth.releaseAll(); chordSynth.dispose(); chordSynth = null; }
  if (bassSynth) { bassSynth.dispose(); bassSynth = null; }
  isPlaying = false;
}

export function getIsPlaying(): boolean {
  return isPlaying;
}
