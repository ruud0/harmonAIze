/**
 * Harmony Enhancement MVP — Pipeline Orchestrator
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Wires all stages together into a single async pipeline.
 * Each stage mutates its section of the Session object.
 * Progress callbacks allow the UI to show real-time stage updates.
 */

import type { Session, EmotionalMode, OptionKey, SelectedOption } from "./types";
import { parseMidiFile } from "./midiParser";
import { detectKey } from "./keyDetector";
import { analyzePhrases } from "./phraseAnalyzer";
import { generateAllHarmony } from "./chordEngine";
import { applyVoiceLeadingPass } from "./voiceLeading";

export type ProgressCallback = (stage: Session["pipelineStage"], message: string) => void;

// ─── Full Pipeline ────────────────────────────────────────────────────────────

export async function runPipeline(
  file: File,
  onProgress: ProgressCallback
): Promise<Session> {
  // Stage 1 & 2: Parse MIDI → Canonical Melody + Session
  onProgress("parsing", "Parsing MIDI file...");
  const session = await parseMidiFile(file);

  if (session.melody.length === 0) {
    session.pipelineStage = "error";
    session.errorMessage = "No notes found in MIDI file.";
    return session;
  }

  // Stage 3: Key Detection
  onProgress("detecting_key", "Detecting key...");
  await tick();
  session.detectedKey = detectKey(session.melody);
  session.pipelineStage = "analyzing_phrases";

  // Stage 4: Phrase Analysis
  onProgress("analyzing_phrases", "Analyzing phrase structure...");
  await tick();
  const totalBars = session.midiMeta?.totalBars ?? 16;
  session.phrases = analyzePhrases(session.melody, totalBars);

  if (session.phrases.length === 0) {
    session.pipelineStage = "error";
    session.errorMessage = "Could not detect any phrases in the melody.";
    return session;
  }

  // Stage 5: Harmonic Generation (all 4 modes in sequence)
  onProgress("generating_harmony", "Generating harmonic options...");
  await tick();
  const rawHarmony = generateAllHarmony(
    session.phrases,
    session.melody,
    session.detectedKey!
  );

  // Apply voice leading pass to all modes
  const modes: EmotionalMode[] = ["bright", "dark", "calm", "tense"];
  for (const mode of modes) {
    session.harmonicOutput[mode] = rawHarmony[mode].map((ph, i) => {
      const phrase = session.phrases[i];
      const phraseNotes = phrase.noteRefs.map((idx) => session.melody[idx]);
      return applyVoiceLeadingPass(ph, phrase, phraseNotes);
    });
  }

  // Set default selections: bright mode, option A for all phrases
  for (const phrase of session.phrases) {
    session.selectedOptions[phrase.phraseId] = {
      mode: "bright",
      option: "A",
    };
  }

  session.pipelineStage = "ready";
  onProgress("ready", "Ready");

  return session;
}

// ─── Selection Updates ────────────────────────────────────────────────────────

export function updateSelection(
  session: Session,
  phraseId: string,
  mode: EmotionalMode,
  option: OptionKey
): Session {
  return {
    ...session,
    selectedOptions: {
      ...session.selectedOptions,
      [phraseId]: { mode, option },
    },
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
