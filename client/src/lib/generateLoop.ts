/**
 * Loop generation with graceful degradation.
 *
 * Tries the /api/generate endpoint first, so a locally running server (with or
 * without ANTHROPIC_API_KEY) keeps its Claude-backed path. When no server is
 * reachable — the static GitHub Pages build being the case that matters — it
 * falls back to the local music-theory generator instead of failing.
 */

import { buildLocalLoop } from "./localGenerator";
import type { RawApiNote } from "./harmonaizeTypes";

const API_TIMEOUT_MS = 4000;

export interface GenerateParams {
  key: string;
  scale: string;
  bars: number;
  mood: string;
  bpm: number;
}

export interface GenerateResult {
  chords: string[];
  notes: RawApiNote[];
  /** Which path produced this loop — the UI labels the local one. */
  source: "api" | "local";
}

export async function generateLoop(params: GenerateParams): Promise<GenerateResult> {
  const bars = Math.max(1, Math.min(16, Number(params.bars) || 4));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, bars }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const json = await res.json();
      if (json?.ok && Array.isArray(json.data?.chords) && Array.isArray(json.data?.notes)) {
        return { chords: json.data.chords, notes: json.data.notes, source: "api" };
      }
    }
  } catch {
    // No server on this origin (static deploy), or it timed out. Fall through.
  }

  return { ...buildLocalLoop(params.key, params.scale, bars), source: "local" };
}
