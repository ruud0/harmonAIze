/**
 * KeyDisplay — Detected key badge with confidence and alternatives
 * Design: Spectral / Frequency-Space Minimalism
 */

import React from "react";
import type { DetectedKey } from "@/lib/types";

interface KeyDisplayProps {
  detectedKey: DetectedKey;
  totalBars: number;
  noteCount: number;
  phraseCount: number;
  bpm: number;
}

export default function KeyDisplay({
  detectedKey,
  totalBars,
  noteCount,
  phraseCount,
  bpm,
}: KeyDisplayProps) {
  return (
    <div className="flex items-center gap-6 px-4 py-3 rounded-xl bg-white/3 border border-white/6">
      {/* Key badge */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-bold"
          style={{ fontFamily: "Space Grotesk, sans-serif", color: "#22D3EE" }}
        >
          {detectedKey.root}
        </span>
        <span className="text-sm text-white/50 capitalize">
          {detectedKey.mode}
        </span>
        <span className="text-xs text-white/25 font-mono ml-1">
          {Math.round(detectedKey.confidence * 100)}% conf
        </span>
      </div>

      <div className="w-px h-8 bg-white/10" />

      {/* Stats */}
      <div className="flex gap-5 text-xs font-mono text-white/40">
        <div className="flex flex-col gap-0.5">
          <span className="text-white/20 text-xs">BPM</span>
          <span className="text-white/60">{Math.round(bpm)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-white/20 text-xs">BARS</span>
          <span className="text-white/60">{totalBars}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-white/20 text-xs">NOTES</span>
          <span className="text-white/60">{noteCount}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-white/20 text-xs">PHRASES</span>
          <span className="text-white/60">{phraseCount}</span>
        </div>
      </div>

      {/* Alternatives */}
      {detectedKey.alternatives.length > 0 && (
        <>
          <div className="w-px h-8 bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/20 font-mono">alt:</span>
            {detectedKey.alternatives.slice(0, 2).map((alt, i) => (
              <span
                key={i}
                className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-white/35"
              >
                {alt.root} {alt.mode}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
