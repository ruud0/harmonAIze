/**
 * MelodyGrid — Pitch-height timeline visualization
 * Design: Spectral / Frequency-Space Minimalism
 * Renders MIDI notes as colored dots on a pitch × time grid.
 * Phrase boundaries shown as vertical lines.
 * Active chord highlighted with mode color glow.
 */

import React, { useMemo } from "react";
import type { CanonicalNote, Phrase, EmotionalMode } from "@/lib/types";
import { MODE_COLORS } from "@/lib/types";

interface MelodyGridProps {
  notes: CanonicalNote[];
  phrases: Phrase[];
  totalBars: number;
  activeChordBar?: number;
  selectedPhraseId?: string;
  onPhraseClick?: (phraseId: string) => void;
  activeMode?: EmotionalMode;
  className?: string;
}

const GRID_HEIGHT = 120;
const DOT_RADIUS = 4;
const MIN_PITCH = 36;
const MAX_PITCH = 96;
const PITCH_RANGE = MAX_PITCH - MIN_PITCH;

export default function MelodyGrid({
  notes,
  phrases,
  totalBars,
  activeChordBar,
  selectedPhraseId,
  onPhraseClick,
  activeMode = "bright",
  className = "",
}: MelodyGridProps) {
  const width = Math.max(600, totalBars * 40);

  const noteElements = useMemo(() => {
    return notes.map((note) => {
      const x = ((note.bar - 1 + (note.beat - 1) / 4) / totalBars) * width;
      const pitchClamped = Math.max(MIN_PITCH, Math.min(MAX_PITCH, note.pitch));
      const y =
        GRID_HEIGHT -
        ((pitchClamped - MIN_PITCH) / PITCH_RANGE) * (GRID_HEIGHT - 16) -
        8;

      // Find which phrase this note belongs to
      const phrase = phrases.find((p) => p.noteRefs.includes(note.index));
      const isInSelectedPhrase = phrase?.phraseId === selectedPhraseId;
      const modeColor = activeMode ? MODE_COLORS[activeMode] : "#22D3EE";

      const color = isInSelectedPhrase
        ? modeColor
        : note.isPassingTone
        ? "rgba(255,255,255,0.25)"
        : "rgba(255,255,255,0.5)";

      const glowFilter = isInSelectedPhrase
        ? `drop-shadow(0 0 4px ${modeColor}80)`
        : undefined;

      return (
        <circle
          key={note.index}
          cx={x}
          cy={y}
          r={note.beatStrength === "strong" ? DOT_RADIUS + 1 : DOT_RADIUS}
          fill={color}
          style={{ filter: glowFilter }}
          opacity={note.isPassingTone ? 0.4 : 0.9}
        />
      );
    });
  }, [notes, phrases, totalBars, width, selectedPhraseId, activeMode]);

  const phraseRegions = useMemo(() => {
    return phrases.map((phrase) => {
      const x1 = ((phrase.startBar - 1) / totalBars) * width;
      const x2 = (phrase.endBar / totalBars) * width;
      const isSelected = phrase.phraseId === selectedPhraseId;
      const modeColor = MODE_COLORS[activeMode];

      return (
        <g key={phrase.phraseId}>
          {/* Phrase region background */}
          <rect
            x={x1}
            y={0}
            width={x2 - x1}
            height={GRID_HEIGHT}
            fill={isSelected ? `${modeColor}12` : "transparent"}
            stroke={isSelected ? modeColor : "rgba(255,255,255,0.06)"}
            strokeWidth={isSelected ? 1.5 : 1}
            rx={2}
            style={{ cursor: "pointer", transition: "fill 200ms ease" }}
            onClick={() => onPhraseClick?.(phrase.phraseId)}
          />
          {/* Phrase label */}
          <text
            x={x1 + 6}
            y={14}
            fill={isSelected ? modeColor : "rgba(255,255,255,0.3)"}
            fontSize={9}
            fontFamily="Space Mono, monospace"
            style={{ userSelect: "none" }}
          >
            P{parseInt(phrase.phraseId.replace("phrase_", "")) + 1}
          </text>
          {/* Peak flag indicator */}
          {phrase.peakFlag && (
            <circle
              cx={x2 - 8}
              cy={8}
              r={3}
              fill={modeColor}
              opacity={0.7}
            />
          )}
        </g>
      );
    });
  }, [phrases, totalBars, width, selectedPhraseId, activeMode]);

  // Bar number labels
  const barLabels = useMemo(() => {
    const labels = [];
    for (let bar = 1; bar <= totalBars; bar += 2) {
      const x = ((bar - 1) / totalBars) * width;
      labels.push(
        <text
          key={bar}
          x={x + 2}
          y={GRID_HEIGHT - 2}
          fill="rgba(255,255,255,0.2)"
          fontSize={8}
          fontFamily="Space Mono, monospace"
        >
          {bar}
        </text>
      );
    }
    return labels;
  }, [totalBars, width]);

  // Active chord playback indicator
  const playbackIndicator = useMemo(() => {
    if (activeChordBar === undefined) return null;
    const x = ((activeChordBar - 1) / totalBars) * width;
    return (
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={GRID_HEIGHT}
        stroke={MODE_COLORS[activeMode]}
        strokeWidth={1.5}
        opacity={0.8}
        strokeDasharray="4 2"
      />
    );
  }, [activeChordBar, totalBars, width, activeMode]);

  return (
    <div className={`overflow-x-auto pitch-grid rounded-lg ${className}`}>
      <svg
        width={width}
        height={GRID_HEIGHT}
        viewBox={`0 0 ${width} ${GRID_HEIGHT}`}
        style={{ display: "block", minWidth: "100%" }}
      >
        {/* Pitch grid lines (octave markers) */}
        {[48, 60, 72, 84].map((pitch) => {
          const y =
            GRID_HEIGHT -
            ((pitch - MIN_PITCH) / PITCH_RANGE) * (GRID_HEIGHT - 16) -
            8;
          return (
            <line
              key={pitch}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          );
        })}

        {phraseRegions}
        {noteElements}
        {barLabels}
        {playbackIndicator}
      </svg>
    </div>
  );
}
