/**
 * PianoRoll — Interactive drag-to-edit piano roll editor
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Features:
 * - Horizontal note bars (duration-aware)
 * - Drag up/down to change pitch
 * - Drag left/right to shift timing
 * - Red glow on out-of-key notes
 * - Phrase boundary lines
 * - Active playback cursor
 * - Piano keyboard on left edge
 */

import React, { useRef, useState, useCallback, useMemo, useEffect } from "react";
import type { CanonicalNote, Phrase, EmotionalMode, DetectedKey } from "@/lib/types";
import { MODE_COLORS } from "@/lib/types";
import { getScaleDegrees } from "@/lib/keyDetector";

// ─── Layout Constants ─────────────────────────────────────────────────────────

const ROW_HEIGHT = 10;        // px per semitone
const PIANO_WIDTH = 36;       // px for keyboard labels
const BAR_WIDTH = 80;         // px per bar
const MIN_PITCH = 36;         // C2
const MAX_PITCH = 96;         // C6
const PITCH_COUNT = MAX_PITCH - MIN_PITCH;
const GRID_HEIGHT = PITCH_COUNT * ROW_HEIGHT;

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // semitone offsets

// ─── Types ────────────────────────────────────────────────────────────────────

interface DraggingState {
  noteIndex: number;
  startMouseX: number;
  startMouseY: number;
  startBeat: number; // absolute beat position
  startPitch: number;
}

interface PianoRollProps {
  notes: CanonicalNote[];
  phrases: Phrase[];
  totalBars: number;
  detectedKey: DetectedKey;
  activeChordBar?: number;
  selectedPhraseId?: string;
  activeMode?: EmotionalMode;
  onNotesChange?: (notes: CanonicalNote[]) => void;
  onPhraseClick?: (phraseId: string) => void;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pitchToY(pitch: number): number {
  const clamped = Math.max(MIN_PITCH, Math.min(MAX_PITCH - 1, pitch));
  return (MAX_PITCH - 1 - clamped) * ROW_HEIGHT;
}

function yToPitch(y: number): number {
  const pitch = MAX_PITCH - 1 - Math.floor(y / ROW_HEIGHT);
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH - 1, pitch));
}

function noteToX(bar: number, beat: number, subdivision: number): number {
  const absoluteBeat = (bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25;
  return (absoluteBeat / (4)) * BAR_WIDTH;
}

function durationToWidth(durationBeats: number): number {
  return Math.max(4, durationBeats * (BAR_WIDTH / 4));
}

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(pitch % 12);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PianoRoll({
  notes,
  phrases,
  totalBars,
  detectedKey,
  activeChordBar,
  selectedPhraseId,
  activeMode = "bright",
  onNotesChange,
  onPhraseClick,
  className = "",
}: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [localNotes, setLocalNotes] = useState<CanonicalNote[]>(notes);

  // Sync with prop changes
  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  const modeColor = MODE_COLORS[activeMode];
  const totalWidth = Math.max(totalBars * BAR_WIDTH, 600);

  // Compute scale pitches for in-key detection
  const scalePcs = useMemo(
    () => new Set(getScaleDegrees(detectedKey.root, detectedKey.mode)),
    [detectedKey]
  );

  const isInKey = useCallback(
    (pitch: number) => scalePcs.has(pitch % 12),
    [scalePcs]
  );

  // ─── Drag Handlers ───────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, noteIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const note = localNotes[noteIndex];
      const absoluteBeat = (note.bar - 1) * 4 + (note.beat - 1) + (note.subdivision - 1) * 0.25;
      setDragging({
        noteIndex,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startBeat: absoluteBeat,
        startPitch: note.pitch,
      });
    },
    [localNotes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;

      const dx = e.clientX - dragging.startMouseX;
      const dy = e.clientY - dragging.startMouseY;

      // Beat delta: each BAR_WIDTH px = 4 beats
      const beatDelta = (dx / BAR_WIDTH) * 4;
      const pitchDelta = -Math.round(dy / ROW_HEIGHT);

      const newAbsoluteBeat = Math.max(0, dragging.startBeat + beatDelta);
      const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH - 1, dragging.startPitch + pitchDelta));

      // Convert absolute beat back to bar/beat/subdivision
      const newBar = Math.floor(newAbsoluteBeat / 4) + 1;
      const beatInBar = newAbsoluteBeat % 4;
      const newBeat = Math.floor(beatInBar) + 1;
      const newSubdivision = Math.round((beatInBar % 1) / 0.25) + 1;

      setLocalNotes((prev) =>
        prev.map((note, i) =>
          i === dragging.noteIndex
            ? {
                ...note,
                pitch: newPitch,
                bar: Math.max(1, newBar),
                beat: Math.min(4, Math.max(1, newBeat)),
                subdivision: Math.min(4, Math.max(1, newSubdivision)),
              }
            : note
        )
      );
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      setDragging(null);
      onNotesChange?.(localNotes);
    }
  }, [dragging, localNotes, onNotesChange]);

  // ─── Piano Keyboard ──────────────────────────────────────────────────────

  const pianoKeys = useMemo(() => {
    const keys = [];
    for (let pitch = MAX_PITCH - 1; pitch >= MIN_PITCH; pitch--) {
      const y = (MAX_PITCH - 1 - pitch) * ROW_HEIGHT;
      const isBlack = isBlackKey(pitch);
      const pc = pitch % 12;
      const isC = pc === 0;
      const octave = Math.floor(pitch / 12) - 1;

      keys.push(
        <g key={pitch}>
          <rect
            x={0}
            y={y}
            width={PIANO_WIDTH}
            height={ROW_HEIGHT}
            fill={isBlack ? "#111" : "#1a1a2e"}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5}
          />
          {isC && (
            <text
              x={PIANO_WIDTH - 4}
              y={y + ROW_HEIGHT - 2}
              textAnchor="end"
              fill="rgba(255,255,255,0.25)"
              fontSize={6}
              fontFamily="Space Mono, monospace"
            >
              C{octave}
            </text>
          )}
        </g>
      );
    }
    return keys;
  }, []);

  // ─── Grid Lines ──────────────────────────────────────────────────────────

  const gridLines = useMemo(() => {
    const lines = [];

    // Horizontal pitch rows
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const y = (MAX_PITCH - pitch) * ROW_HEIGHT;
      const isBlack = isBlackKey(pitch);
      const isC = pitch % 12 === 0;
      lines.push(
        <rect
          key={`row-${pitch}`}
          x={0}
          y={y}
          width={totalWidth}
          height={ROW_HEIGHT}
          fill={
            isBlack
              ? "rgba(0,0,0,0.25)"
              : isC
              ? "rgba(255,255,255,0.03)"
              : "transparent"
          }
        />
      );
    }

    // Vertical bar lines
    for (let bar = 0; bar <= totalBars; bar++) {
      const x = bar * BAR_WIDTH;
      const isFourBar = bar % 4 === 0;
      lines.push(
        <line
          key={`bar-${bar}`}
          x1={x}
          y1={0}
          x2={x}
          y2={GRID_HEIGHT}
          stroke={isFourBar ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
          strokeWidth={isFourBar ? 1 : 0.5}
        />
      );
      // Beat subdivisions
      if (bar < totalBars) {
        for (let beat = 1; beat < 4; beat++) {
          const bx = x + beat * (BAR_WIDTH / 4);
          lines.push(
            <line
              key={`beat-${bar}-${beat}`}
              x1={bx}
              y1={0}
              x2={bx}
              y2={GRID_HEIGHT}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth={0.5}
            />
          );
        }
      }
    }

    return lines;
  }, [totalBars, totalWidth]);

  // ─── Phrase Regions ──────────────────────────────────────────────────────

  const phraseRegions = useMemo(() => {
    return phrases.map((phrase) => {
      const x1 = (phrase.startBar - 1) * BAR_WIDTH;
      const x2 = phrase.endBar * BAR_WIDTH;
      const isSelected = phrase.phraseId === selectedPhraseId;
      const phraseNum = parseInt(phrase.phraseId.replace("phrase_", "")) + 1;

      return (
        <g key={phrase.phraseId} onClick={() => onPhraseClick?.(phrase.phraseId)} style={{ cursor: "pointer" }}>
          {isSelected && (
            <rect
              x={x1}
              y={0}
              width={x2 - x1}
              height={GRID_HEIGHT}
              fill={`${modeColor}08`}
              stroke={modeColor}
              strokeWidth={1}
              rx={2}
              opacity={0.6}
            />
          )}
          <line
            x1={x1}
            y1={0}
            x2={x1}
            y2={GRID_HEIGHT}
            stroke={isSelected ? modeColor : "rgba(255,255,255,0.15)"}
            strokeWidth={isSelected ? 1.5 : 1}
            strokeDasharray={isSelected ? "none" : "4 3"}
          />
          <text
            x={x1 + 4}
            y={12}
            fill={isSelected ? modeColor : "rgba(255,255,255,0.2)"}
            fontSize={8}
            fontFamily="Space Mono, monospace"
          >
            P{phraseNum}
          </text>
        </g>
      );
    });
  }, [phrases, selectedPhraseId, modeColor, onPhraseClick]);

  // ─── Note Bars ───────────────────────────────────────────────────────────

  const noteElements = useMemo(() => {
    return localNotes.map((note, i) => {
      const x = noteToX(note.bar, note.beat, note.subdivision);
      const y = pitchToY(note.pitch);
      const w = durationToWidth(note.durationBeats);
      const inKey = isInKey(note.pitch);
      const isDragged = dragging?.noteIndex === i;

      const noteColor = inKey ? modeColor : "#FF4466";
      const noteOpacity = note.isPassingTone ? 0.5 : isDragged ? 1 : 0.85;

      const noteName = NOTE_NAMES[note.pitch % 12];
      const octave = Math.floor(note.pitch / 12) - 1;

      return (
        <g key={note.index} style={{ cursor: "grab" }}>
          {/* Out-of-key red glow */}
          {!inKey && (
            <rect
              x={x - 2}
              y={y - 1}
              width={w + 4}
              height={ROW_HEIGHT + 2}
              rx={3}
              fill="transparent"
              stroke="#FF4466"
              strokeWidth={1}
              opacity={0.4}
              style={{ filter: "blur(2px)" }}
            />
          )}

          {/* Note body */}
          <rect
            x={x}
            y={y + 1}
            width={Math.max(3, w - 1)}
            height={ROW_HEIGHT - 2}
            rx={2}
            fill={noteColor}
            opacity={noteOpacity}
            style={{
              filter: isDragged
                ? `drop-shadow(0 0 6px ${noteColor})`
                : inKey
                ? `drop-shadow(0 0 2px ${noteColor}60)`
                : `drop-shadow(0 0 4px #FF446680)`,
              cursor: "grab",
              transition: isDragged ? "none" : "opacity 100ms ease",
            }}
            onMouseDown={(e) => handleMouseDown(e, i)}
          />

          {/* Note label (only if wide enough) */}
          {w > 20 && (
            <text
              x={x + 3}
              y={y + ROW_HEIGHT - 2}
              fill="rgba(0,0,0,0.7)"
              fontSize={6}
              fontFamily="Space Mono, monospace"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {noteName}{octave}
            </text>
          )}

          {/* Beat strength indicator */}
          {note.beatStrength === "strong" && (
            <rect
              x={x}
              y={y + 1}
              width={3}
              height={ROW_HEIGHT - 2}
              rx={1}
              fill="rgba(255,255,255,0.4)"
              style={{ pointerEvents: "none" }}
            />
          )}
        </g>
      );
    });
  }, [localNotes, dragging, modeColor, isInKey, handleMouseDown]);

  // ─── Playback Cursor ─────────────────────────────────────────────────────

  const playbackCursor = useMemo(() => {
    if (activeChordBar === undefined) return null;
    const x = (activeChordBar - 1) * BAR_WIDTH;
    return (
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={GRID_HEIGHT}
        stroke={modeColor}
        strokeWidth={2}
        opacity={0.9}
        style={{ filter: `drop-shadow(0 0 4px ${modeColor})` }}
      />
    );
  }, [activeChordBar, modeColor]);

  // ─── Bar Number Labels ────────────────────────────────────────────────────

  const barLabels = useMemo(() => {
    const labels = [];
    for (let bar = 1; bar <= totalBars; bar += 2) {
      labels.push(
        <text
          key={bar}
          x={(bar - 1) * BAR_WIDTH + 3}
          y={GRID_HEIGHT - 3}
          fill="rgba(255,255,255,0.15)"
          fontSize={7}
          fontFamily="Space Mono, monospace"
        >
          {bar}
        </text>
      );
    }
    return labels;
  }, [totalBars]);

  // ─── Legend ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Legend */}
      <div className="flex items-center gap-4 px-1 text-xs font-mono text-white/30">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: modeColor, opacity: 0.85 }} />
          <span>In key</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: "#FF4466", opacity: 0.85 }} />
          <span>Out of key</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5" style={{ background: "rgba(255,255,255,0.15)", borderTop: "1px dashed" }} />
          <span>Phrase boundary</span>
        </div>
        <span className="ml-auto opacity-60">Drag notes to edit pitch &amp; timing</span>
      </div>

      {/* Piano roll */}
      <div
        className="overflow-x-auto rounded-lg border border-white/8"
        style={{ background: "#080C14", maxHeight: "320px", overflowY: "auto" }}
        ref={scrollRef}
      >
        <div style={{ display: "flex", width: totalWidth + PIANO_WIDTH }}>
          {/* Piano keyboard */}
          <svg
            width={PIANO_WIDTH}
            height={GRID_HEIGHT}
            style={{ flexShrink: 0, position: "sticky", left: 0, zIndex: 10 }}
          >
            {pianoKeys}
          </svg>

          {/* Note grid */}
          <svg
            width={totalWidth}
            height={GRID_HEIGHT}
            style={{ flexShrink: 0, cursor: dragging ? "grabbing" : "default" }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {gridLines}
            {phraseRegions}
            {noteElements}
            {barLabels}
            {playbackCursor}
          </svg>
        </div>
      </div>
    </div>
  );
}
