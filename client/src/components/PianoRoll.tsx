/**
 * PianoRoll — Interactive drag-to-edit piano roll editor
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Features:
 * - Horizontal note bars (duration-aware)
 * - Drag up/down to change pitch
 * - Drag left/right to shift timing
 * - Drag right edge to resize note duration
 * - Click empty space to add a note
 * - Right-click a note to delete it
 * - Chord notes overlaid from selected progression
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
const RESIZE_EDGE = 6;        // px from right edge to trigger resize

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChordDisplayNote {
  pitch: number;
  bar: number;
  beat: number;
  subdivision: number;
  durationBeats: number;
  isBass?: boolean;
}

interface DraggingState {
  noteIndex: number;
  startMouseX: number;
  startMouseY: number;
  startBeat: number;
  startPitch: number;
  startDuration: number;
  mode: "move" | "resize";
}

interface HoverState {
  noteIndex: number;
  isRightEdge: boolean;
}

interface PianoRollProps {
  notes: CanonicalNote[];
  phrases: Phrase[];
  totalBars: number;
  detectedKey: DetectedKey;
  activeChordBar?: number;
  selectedPhraseId?: string;
  activeMode?: EmotionalMode;
  chordNotes?: ChordDisplayNote[];
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
  return (absoluteBeat / 4) * BAR_WIDTH;
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
  chordNotes = [],
  onNotesChange,
  onPhraseClick,
  className = "",
}: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const [localNotes, setLocalNotes] = useState<CanonicalNote[]>(notes);

  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  const modeColor = MODE_COLORS[activeMode];
  const totalWidth = Math.max(totalBars * BAR_WIDTH, 600);

  const scalePcs = useMemo(
    () => new Set(getScaleDegrees(detectedKey.root, detectedKey.mode)),
    [detectedKey]
  );

  const isInKey = useCallback(
    (pitch: number) => scalePcs.has(pitch % 12),
    [scalePcs]
  );

  // ─── Drag / Resize Handlers ───────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, noteIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const note = localNotes[noteIndex];
      const absoluteBeat = (note.bar - 1) * 4 + (note.beat - 1) + (note.subdivision - 1) * 0.25;

      const noteX = noteToX(note.bar, note.beat, note.subdivision);
      const noteW = durationToWidth(note.durationBeats);
      const svgRect = svgRef.current?.getBoundingClientRect();
      const mouseXInSvg = svgRect ? e.clientX - svgRect.left : 0;
      const isRightEdge = mouseXInSvg >= noteX + noteW - RESIZE_EDGE;

      setDragging({
        noteIndex,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startBeat: absoluteBeat,
        startPitch: note.pitch,
        startDuration: note.durationBeats,
        mode: isRightEdge ? "resize" : "move",
      });
    },
    [localNotes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragging) {
        const dx = e.clientX - dragging.startMouseX;

        if (dragging.mode === "resize") {
          const beatsDelta = (dx / BAR_WIDTH) * 4;
          const newDuration = Math.max(0.25, dragging.startDuration + beatsDelta);
          setLocalNotes((prev) =>
            prev.map((note, i) =>
              i === dragging.noteIndex ? { ...note, durationBeats: newDuration } : note
            )
          );
        } else {
          const dy = e.clientY - dragging.startMouseY;
          const beatDelta = (dx / BAR_WIDTH) * 4;
          const pitchDelta = -Math.round(dy / ROW_HEIGHT);
          const newAbsoluteBeat = Math.max(0, dragging.startBeat + beatDelta);
          const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH - 1, dragging.startPitch + pitchDelta));
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
        }
        return;
      }

      // Hover detection for resize cursor
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left;
      const mouseY = e.clientY - svgRect.top;

      let found: HoverState | null = null;
      for (let i = 0; i < localNotes.length; i++) {
        const note = localNotes[i];
        const nx = noteToX(note.bar, note.beat, note.subdivision);
        const ny = pitchToY(note.pitch);
        const nw = durationToWidth(note.durationBeats);
        if (mouseX >= nx && mouseX <= nx + nw && mouseY >= ny && mouseY <= ny + ROW_HEIGHT) {
          found = { noteIndex: i, isRightEdge: mouseX >= nx + nw - RESIZE_EDGE };
          break;
        }
      }
      setHoverState(found);
    },
    [dragging, localNotes]
  );

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      setDragging(null);
      onNotesChange?.(localNotes);
    }
  }, [dragging, localNotes, onNotesChange]);

  // ─── Click empty space to add note ───────────────────────────────────────

  const handleGridClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (dragging) return;
      // Only add if clicking empty space (not on a note rect)
      const target = e.target as SVGElement;
      if (target.dataset.noteIndex !== undefined) return;

      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left;
      const mouseY = e.clientY - svgRect.top;

      // Check if click lands on any existing note
      for (const note of localNotes) {
        const nx = noteToX(note.bar, note.beat, note.subdivision);
        const ny = pitchToY(note.pitch);
        const nw = durationToWidth(note.durationBeats);
        if (mouseX >= nx && mouseX <= nx + nw && mouseY >= ny && mouseY <= ny + ROW_HEIGHT) {
          return; // clicked on a note, don't add
        }
      }

      const pitch = yToPitch(mouseY);
      const absoluteBeat = (mouseX / BAR_WIDTH) * 4;
      const bar = Math.max(1, Math.floor(absoluteBeat / 4) + 1);
      const beatInBar = absoluteBeat % 4;
      const beat = Math.min(4, Math.max(1, Math.floor(beatInBar) + 1));
      const subdivision = Math.min(4, Math.max(1, Math.round((beatInBar % 1) / 0.25) + 1));

      const newNote: CanonicalNote = {
        index: localNotes.length,
        pitch,
        velocity: 80,
        bar,
        beat,
        subdivision,
        durationBeats: 1,
        beatStrength: "secondary",
        isPassingTone: false,
      };

      const updated = [...localNotes, newNote];
      setLocalNotes(updated);
      onNotesChange?.(updated);
    },
    [dragging, localNotes, onNotesChange]
  );

  // ─── Right-click note to delete ──────────────────────────────────────────

  const handleNoteRightClick = useCallback(
    (e: React.MouseEvent, noteIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const updated = localNotes.filter((_, i) => i !== noteIndex);
      setLocalNotes(updated);
      onNotesChange?.(updated);
    },
    [localNotes, onNotesChange]
  );

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
          fill={isBlack ? "rgba(0,0,0,0.25)" : isC ? "rgba(255,255,255,0.03)" : "transparent"}
        />
      );
    }

    for (let bar = 0; bar <= totalBars; bar++) {
      const x = bar * BAR_WIDTH;
      const isFourBar = bar % 4 === 0;
      lines.push(
        <line
          key={`bar-${bar}`}
          x1={x} y1={0} x2={x} y2={GRID_HEIGHT}
          stroke={isFourBar ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
          strokeWidth={isFourBar ? 1 : 0.5}
        />
      );
      if (bar < totalBars) {
        for (let beat = 1; beat < 4; beat++) {
          const bx = x + beat * (BAR_WIDTH / 4);
          lines.push(
            <line
              key={`beat-${bar}-${beat}`}
              x1={bx} y1={0} x2={bx} y2={GRID_HEIGHT}
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
              x={x1} y={0} width={x2 - x1} height={GRID_HEIGHT}
              fill={`${modeColor}08`}
              stroke={modeColor}
              strokeWidth={1}
              rx={2}
              opacity={0.6}
            />
          )}
          <line
            x1={x1} y1={0} x2={x1} y2={GRID_HEIGHT}
            stroke={isSelected ? modeColor : "rgba(255,255,255,0.15)"}
            strokeWidth={isSelected ? 1.5 : 1}
            strokeDasharray={isSelected ? "none" : "4 3"}
          />
          <text
            x={x1 + 4} y={12}
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

  // ─── Chord Notes (from selected progression) ─────────────────────────────

  const chordNoteElements = useMemo(() => {
    return chordNotes.map((cn, i) => {
      const x = noteToX(cn.bar, cn.beat, cn.subdivision);
      const y = pitchToY(cn.pitch);
      const w = durationToWidth(cn.durationBeats);
      const color = cn.isBass ? "#F59E0B" : modeColor; // amber for bass, mode color for chords

      return (
        <rect
          key={`chord-${i}`}
          x={x}
          y={y + 1}
          width={Math.max(3, w - 1)}
          height={ROW_HEIGHT - 2}
          rx={2}
          fill={color}
          opacity={0.25}
          style={{ pointerEvents: "none" }}
        />
      );
    });
  }, [chordNotes, modeColor]);

  // ─── Note Bars ───────────────────────────────────────────────────────────

  const noteElements = useMemo(() => {
    return localNotes.map((note, i) => {
      const x = noteToX(note.bar, note.beat, note.subdivision);
      const y = pitchToY(note.pitch);
      const w = durationToWidth(note.durationBeats);
      const inKey = isInKey(note.pitch);
      const isDragged = dragging?.noteIndex === i;
      const isHovered = hoverState?.noteIndex === i;
      const showResizeCursor = isHovered && hoverState?.isRightEdge;

      const noteColor = inKey ? modeColor : "#FF4466";
      const noteOpacity = note.isPassingTone ? 0.5 : isDragged ? 1 : 0.85;
      const noteName = NOTE_NAMES[note.pitch % 12];
      const octave = Math.floor(note.pitch / 12) - 1;

      return (
        <g key={note.index} style={{ cursor: showResizeCursor ? "ew-resize" : "grab" }}>
          {!inKey && (
            <rect
              x={x - 2} y={y - 1} width={w + 4} height={ROW_HEIGHT + 2}
              rx={3}
              fill="transparent"
              stroke="#FF4466"
              strokeWidth={1}
              opacity={0.4}
              style={{ filter: "blur(2px)" }}
            />
          )}

          <rect
            x={x} y={y + 1}
            width={Math.max(3, w - 1)}
            height={ROW_HEIGHT - 2}
            rx={2}
            fill={noteColor}
            opacity={noteOpacity}
            data-note-index={i}
            style={{
              filter: isDragged
                ? `drop-shadow(0 0 6px ${noteColor})`
                : inKey
                ? `drop-shadow(0 0 2px ${noteColor}60)`
                : `drop-shadow(0 0 4px #FF446680)`,
              cursor: showResizeCursor ? "ew-resize" : "grab",
              transition: isDragged ? "none" : "opacity 100ms ease",
            }}
            onMouseDown={(e) => handleMouseDown(e, i)}
            onContextMenu={(e) => handleNoteRightClick(e, i)}
          />

          {w > 20 && (
            <text
              x={x + 3} y={y + ROW_HEIGHT - 2}
              fill="rgba(0,0,0,0.7)"
              fontSize={6}
              fontFamily="Space Mono, monospace"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {noteName}{octave}
            </text>
          )}

          {note.beatStrength === "strong" && (
            <rect
              x={x} y={y + 1} width={3} height={ROW_HEIGHT - 2}
              rx={1}
              fill="rgba(255,255,255,0.4)"
              style={{ pointerEvents: "none" }}
            />
          )}
        </g>
      );
    });
  }, [localNotes, dragging, hoverState, modeColor, isInKey, handleMouseDown, handleNoteRightClick]);

  // ─── Playback Cursor ─────────────────────────────────────────────────────

  const playbackCursor = useMemo(() => {
    if (activeChordBar === undefined) return null;
    const x = (activeChordBar - 1) * BAR_WIDTH;
    return (
      <line
        x1={x} y1={0} x2={x} y2={GRID_HEIGHT}
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

  // ─── Cursor style ─────────────────────────────────────────────────────────

  const svgCursor = dragging
    ? dragging.mode === "resize" ? "ew-resize" : "grabbing"
    : hoverState?.isRightEdge
    ? "ew-resize"
    : hoverState
    ? "grab"
    : "crosshair";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Legend */}
      <div className="flex items-center gap-4 px-1 text-xs font-mono text-white/30">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: modeColor, opacity: 0.85 }} />
          <span>Melody</span>
        </div>
        {chordNotes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm" style={{ background: modeColor, opacity: 0.25 }} />
            <span>Chords</span>
          </div>
        )}
        {chordNotes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm" style={{ background: "#F59E0B", opacity: 0.25 }} />
            <span>Bass</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: "#FF4466", opacity: 0.85 }} />
          <span>Out of key</span>
        </div>
        <span className="ml-auto opacity-60">Drag to move · drag right edge to resize · click to add · right-click to delete</span>
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
            ref={svgRef}
            width={totalWidth}
            height={GRID_HEIGHT}
            style={{ flexShrink: 0, cursor: svgCursor }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); setHoverState(null); }}
            onClick={handleGridClick}
          >
            {gridLines}
            {phraseRegions}
            {chordNoteElements}
            {noteElements}
            {barLabels}
            {playbackCursor}
          </svg>
        </div>
      </div>
    </div>
  );
}
