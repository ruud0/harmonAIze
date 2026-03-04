/**
 * ProcessingStatus — Pipeline stage progress indicator
 * Design: Spectral / Frequency-Space Minimalism
 * Shows scanning-line animation during processing.
 */

import React from "react";
import type { Session } from "@/lib/types";

interface ProcessingStatusProps {
  stage: Session["pipelineStage"];
  message: string;
  filename?: string;
}

const STAGE_LABELS: Partial<Record<Session["pipelineStage"], string>> = {
  parsing: "Parsing MIDI",
  detecting_key: "Detecting Key",
  analyzing_phrases: "Analyzing Phrases",
  generating_harmony: "Generating Harmony",
};

const STAGES: Session["pipelineStage"][] = [
  "parsing",
  "detecting_key",
  "analyzing_phrases",
  "generating_harmony",
];

export default function ProcessingStatus({
  stage,
  message,
  filename,
}: ProcessingStatusProps) {
  const currentIdx = STAGES.indexOf(stage as any);

  return (
    <div className="flex flex-col items-center gap-8 py-12">
      {/* Scanning animation */}
      <div className="relative w-64 h-1 rounded-full overflow-hidden bg-white/5">
        <div
          className="absolute inset-y-0 w-32 rounded-full scan-line"
          style={{ background: "linear-gradient(90deg, transparent, #22D3EE, transparent)" }}
        />
      </div>

      {/* Stage indicators */}
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {STAGES.map((s, i) => {
          const isDone = i < currentIdx;
          const isActive = s === stage;
          return (
            <div key={s} className="flex items-center gap-3">
              <div
                className="w-2 h-2 rounded-full transition-all duration-300"
                style={{
                  background: isDone
                    ? "#34D399"
                    : isActive
                    ? "#22D3EE"
                    : "rgba(255,255,255,0.1)",
                  boxShadow: isActive ? "0 0 8px #22D3EE" : undefined,
                }}
              />
              <span
                className="text-sm font-mono transition-colors duration-300"
                style={{
                  color: isDone
                    ? "rgba(52,211,153,0.7)"
                    : isActive
                    ? "#22D3EE"
                    : "rgba(255,255,255,0.2)",
                  fontFamily: "Space Mono, monospace",
                }}
              >
                {STAGE_LABELS[s]}
              </span>
              {isDone && (
                <span className="text-xs text-white/20 font-mono ml-auto">done</span>
              )}
              {isActive && (
                <span className="text-xs font-mono ml-auto glow-pulse" style={{ color: "#22D3EE" }}>
                  running
                </span>
              )}
            </div>
          );
        })}
      </div>

      {filename && (
        <p className="text-xs text-white/30 font-mono">{filename}</p>
      )}
    </div>
  );
}
