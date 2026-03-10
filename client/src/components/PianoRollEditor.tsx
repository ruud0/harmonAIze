/**
 * PianoRollEditor — Canvas-based chord timing editor
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Allows moving, resizing, and retuning chord/bass events per phrase.
 * Writes changes to session.timingOverrides.
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import * as Tone from "tone";
import type { Session, ChordEvent, EmotionalMode, TimingOverride } from "@/lib/types";
import { getScaleDegrees } from "@/lib/keyDetector";
import { playChordProgression, stopPlayback } from "@/lib/audioPlayer";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 10;
const MIN_PITCH = 24; // C2
const MAX_PITCH = 84; // C6
const PITCH_RANGE = MAX_PITCH - MIN_PITCH + 1; // 61
const CANVAS_HEIGHT = PITCH_RANGE * ROW_HEIGHT; // 610
const LABEL_WIDTH = 36; // px for C-note labels on left

// ─── Types ────────────────────────────────────────────────────────────────────

type EditMode = "move" | "resize" | "pitch";
type ZoomMode = "overview" | "detail";

interface ResolvedChord {
  phraseId: string;
  chordIndex: number;
  mode: EmotionalMode;
  bar: number;
  beat: number;
  subdivision: number;
  durationBeats: number;
  voicing: number[];
  bassNote: number;
  absBeats: number;
  hasOverride: boolean;
}

interface HitResult {
  found: true;
  phraseId: string;
  chordIndex: number;
  noteSubIndex: number; // -1 = bass, 0+ = voicing index
  absBeats: number;
  durationBeats: number;
  pitch: number;
  isRightEdge: boolean;
}

interface DragState {
  editMode: EditMode;
  phraseId: string;
  chordIndex: number;
  noteSubIndex: number;
  startClientX: number;
  startClientY: number;
  startAbsBeats: number;
  startDurationBeats: number;
  startPitch: number;
  pixelsPerBeat: number;
  scrollBeat: number;
  shiftHeld: boolean;
  // Live preview pitch offsets while dragging in pitch mode
  previewPitchDelta: number;
  previewBeatsDelta: number;
}

interface ContextMenuState {
  screenX: number;
  screenY: number;
  phraseId: string;
  chordIndex: number;
}

interface PianoRollEditorProps {
  session: Session;
  onSessionUpdate: (updated: Session) => void;
  onClose: () => void;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function pitchToY(pitch: number): number {
  return (MAX_PITCH - pitch) * ROW_HEIGHT;
}

function absBeatsToX(absBeats: number, scrollBeat: number, ppb: number): number {
  return LABEL_WIDTH + (absBeats - scrollBeat) * ppb;
}

function xToAbsBeats(x: number, scrollBeat: number, ppb: number): number {
  return scrollBeat + (x - LABEL_WIDTH) / ppb;
}

function snapBeats(beats: number, shiftHeld: boolean): number {
  const snap = shiftHeld ? 0.5 : 0.25;
  return Math.round(beats / snap) * snap;
}

function absBeatsToPosition(absBeats: number): { bar: number; beat: number; subdivision: number } {
  const clamped = Math.max(0, absBeats);
  const bar = Math.floor(clamped / 4) + 1;
  const beatInBar = clamped % 4;
  const beat = Math.floor(beatInBar) + 1;
  const rawSub = Math.round((beatInBar % 1) / 0.25) + 1;
  return { bar, beat, subdivision: Math.min(4, Math.max(1, rawSub)) };
}

function positionToAbsBeats(bar: number, beat: number, subdivision: number): number {
  return (bar - 1) * 4 + (beat - 1) + (subdivision - 1) * 0.25;
}

function resolveChords(session: Session): ResolvedChord[] {
  const result: ResolvedChord[] = [];
  for (const phrase of session.phrases) {
    const sel = session.selectedOptions[phrase.phraseId];
    const mode: EmotionalMode = sel?.mode ?? "bright";
    const option = sel?.option ?? "A";
    const phraseHarmony = session.harmonicOutput[mode].find(
      (h) => h.phraseId === phrase.phraseId
    );
    if (!phraseHarmony) continue;

    const chords = phraseHarmony.options[option].chords;
    chords.forEach((chord, chordIndex) => {
      const override = session.timingOverrides?.[phrase.phraseId]?.[chordIndex];
      const bar = override?.bar ?? chord.bar;
      const beat = override?.beat ?? chord.beat;
      const subdivision = override?.subdivision ?? 1;
      const durationBeats = override?.durationBeats ?? (chord.durationBeats ?? 4);
      const pitchOffsets = override?.pitchOffsets ?? [];
      const voicing = chord.voicing.map((p, i) => p + (pitchOffsets[i] ?? 0));
      const absBeats = positionToAbsBeats(bar, beat, subdivision);

      result.push({
        phraseId: phrase.phraseId,
        chordIndex,
        mode,
        bar,
        beat,
        subdivision,
        durationBeats,
        voicing,
        bassNote: chord.bassNote,
        absBeats,
        hasOverride: !!override,
      });
    });
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PianoRollEditor({
  session,
  onSessionUpdate,
  onClose,
}: PianoRollEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs for imperative rendering (avoid stale closures in draw)
  const dragRef = useRef<DragState | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playheadBeatsRef = useRef<number>(-1);
  const isPlayingRef = useRef(false);

  // React state for UI
  const [editMode, setEditMode] = useState<EditMode>("move");
  const [zoomMode, setZoomMode] = useState<ZoomMode>("overview");
  const [scrollBeat, setScrollBeat] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [activeChordKey, setActiveChordKey] = useState<string | null>(null);
  // Force redraw counter when drag updates happen
  const [drawTick, setDrawTick] = useState(0);

  const totalBars = session.midiMeta?.totalBars ?? 16;
  const bpm = session.midiMeta?.tempos[0]?.bpm ?? 120;

  const scaleDegrees = useMemo(() => {
    if (!session.detectedKey) return new Set<number>();
    return new Set(getScaleDegrees(session.detectedKey.root, session.detectedKey.mode));
  }, [session.detectedKey]);

  const resolvedChords = useMemo(() => resolveChords(session), [session]);

  // ─── Zoom ───────────────────────────────────────────────────────────────────
  const visibleBeats = zoomMode === "detail" ? 16 : totalBars * 4;
  const pixelsPerBeat = Math.max(1, (canvasWidth - LABEL_WIDTH) / visibleBeats);

  // ─── Resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      setCanvasWidth(entries[0].contentRect.width || 800);
    });
    ro.observe(containerRef.current);
    setCanvasWidth(containerRef.current.clientWidth || 800);
    return () => ro.disconnect();
  }, []);

  // ─── Main canvas draw ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drag = dragRef.current;
    const w = canvas.width;

    ctx.clearRect(0, 0, w, CANVAS_HEIGHT);

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, CANVAS_HEIGHT);

    // Label column
    ctx.fillStyle = "#0a1628";
    ctx.fillRect(0, 0, LABEL_WIDTH, CANVAS_HEIGHT);

    // ─── Pitch rows ──────────────────────────────────────────────────────────
    for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
      const y = pitchToY(p);
      const pc = p % 12;
      const isScale = scaleDegrees.has(pc);
      const isC = pc === 0;

      ctx.fillStyle = isScale ? "#1e293b" : "#0f172a";
      ctx.fillRect(LABEL_WIDTH, y, w - LABEL_WIDTH, ROW_HEIGHT);

      // Row divider
      ctx.strokeStyle = isC ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
      ctx.lineWidth = isC ? 0.75 : 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      // C note label
      if (isC) {
        const octave = Math.floor(p / 12) - 1;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "8px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`C${octave}`, LABEL_WIDTH - 3, y + ROW_HEIGHT - 2);
      }
    }

    // ─── Vertical grid lines ─────────────────────────────────────────────────
    const totalBeats = totalBars * 4;
    for (let sixteenth = 0; sixteenth <= totalBeats * 4; sixteenth++) {
      const absBeats = sixteenth / 4;
      const x = absBeatsToX(absBeats, scrollBeat, pixelsPerBeat);
      if (x < LABEL_WIDTH - 1 || x > w + 1) continue;

      const isBeat = sixteenth % 4 === 0;
      const isBar = sixteenth % 16 === 0;

      if (isBar) {
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
        // Bar number label
        const barNum = Math.floor(absBeats / 4) + 1;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`${barNum}`, x + 2, 10);
      } else if (isBeat) {
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.025)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
    }

    // ─── Melody notes (white, read-only) ─────────────────────────────────────
    for (const note of session.melody) {
      const absBeats = positionToAbsBeats(note.bar, note.beat, note.subdivision);
      const nx = absBeatsToX(absBeats, scrollBeat, pixelsPerBeat);
      const nw = Math.max(2, note.durationBeats * pixelsPerBeat - 1);
      const ny = pitchToY(note.pitch);
      if (nx + nw < LABEL_WIDTH || nx > w) continue;

      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(nx, ny + 1, nw, ROW_HEIGHT - 2);

      if (!scaleDegrees.has(note.pitch % 12)) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(nx, ny + 1, nw, ROW_HEIGHT - 2);
      }
    }
    ctx.globalAlpha = 1;

    // ─── Chord and bass notes ─────────────────────────────────────────────────
    for (const rc of resolvedChords) {
      // Apply drag preview if this is the dragged chord
      let displayBar = rc.bar;
      let displayBeat = rc.beat;
      let displaySubdivision = rc.subdivision;
      let displayDuration = rc.durationBeats;
      let displayVoicing = [...rc.voicing];
      let displayBass = rc.bassNote;

      if (
        drag &&
        drag.phraseId === rc.phraseId &&
        drag.chordIndex === rc.chordIndex
      ) {
        if (drag.editMode === "move") {
          const newAbsBeats = Math.max(
            0,
            snapBeats(drag.startAbsBeats + drag.previewBeatsDelta, drag.shiftHeld)
          );
          const pos = absBeatsToPosition(newAbsBeats);
          displayBar = pos.bar;
          displayBeat = pos.beat;
          displaySubdivision = pos.subdivision;
        } else if (drag.editMode === "resize") {
          displayDuration = Math.max(
            0.25,
            snapBeats(drag.startDurationBeats + drag.previewBeatsDelta, drag.shiftHeld)
          );
        } else if (drag.editMode === "pitch") {
          if (drag.noteSubIndex >= 0) {
            displayVoicing = displayVoicing.map((p, i) =>
              i === drag.noteSubIndex ? p + drag.previewPitchDelta : p
            );
          } else {
            displayBass = displayBass + drag.previewPitchDelta;
          }
        }
      }

      const displayAbsBeats = positionToAbsBeats(displayBar, displayBeat, displaySubdivision);
      const nx = absBeatsToX(displayAbsBeats, scrollBeat, pixelsPerBeat);
      const nw = Math.max(2, displayDuration * pixelsPerBeat - 1);
      if (nx + nw < LABEL_WIDTH || nx > w) continue;

      const isActive = activeChordKey === `${rc.phraseId}:${rc.chordIndex}`;
      const isDragging = drag?.phraseId === rc.phraseId && drag?.chordIndex === rc.chordIndex;
      const baseAlpha = isActive || isDragging ? 1.0 : 0.8;

      // Chord voicing notes
      for (const pitch of displayVoicing) {
        const ny = pitchToY(pitch);
        const outOfKey = !scaleDegrees.has(pitch % 12);

        ctx.globalAlpha = baseAlpha;
        ctx.fillStyle = "#3b82f6";
        ctx.fillRect(nx, ny + 1, nw, ROW_HEIGHT - 2);

        if (outOfKey) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(nx, ny + 1, nw, ROW_HEIGHT - 2);
        }

        // Right-edge resize handle indicator (subtle)
        if (editMode === "resize" || editMode === "move") {
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(nx + nw - 3, ny + 2, 2, ROW_HEIGHT - 4);
        }
      }

      // Bass note
      const bassY = pitchToY(displayBass);
      const bassOutOfKey = !scaleDegrees.has(displayBass % 12);

      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(nx, bassY + 1, nw, ROW_HEIGHT - 2);

      if (bassOutOfKey) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(nx, bassY + 1, nw, ROW_HEIGHT - 2);
      }

      ctx.globalAlpha = 1;

      // Override indicator dot
      if (rc.hasOverride) {
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(nx + nw - 3, pitchToY(displayVoicing[0]) + 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    // ─── Playhead ─────────────────────────────────────────────────────────────
    if (isPlayingRef.current && playheadBeatsRef.current >= 0) {
      const px = absBeatsToX(playheadBeatsRef.current, scrollBeat, pixelsPerBeat);
      if (px >= LABEL_WIDTH && px <= w) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, CANVAS_HEIGHT);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }, [
    session.melody,
    resolvedChords,
    scaleDegrees,
    scrollBeat,
    pixelsPerBeat,
    canvasWidth,
    totalBars,
    activeChordKey,
    editMode,
    drawTick,
  ]);

  // ─── Minimap draw ────────────────────────────────────────────────────────────
  const drawMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mw = canvas.width;
    const mh = canvas.height;
    const totalBeats = totalBars * 4;
    const mpb = (mw - LABEL_WIDTH) / totalBeats; // minimap pixels per beat

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, mw, mh);

    for (const rc of resolvedChords) {
      const mx = LABEL_WIDTH + rc.absBeats * mpb;
      const mw2 = Math.max(1, rc.durationBeats * mpb);

      for (const pitch of rc.voicing) {
        const my = ((MAX_PITCH - pitch) / PITCH_RANGE) * mh;
        const mh2 = Math.max(1, (ROW_HEIGHT / CANVAS_HEIGHT) * mh);
        ctx.fillStyle = "#3b82f6";
        ctx.globalAlpha = 0.7;
        ctx.fillRect(mx, my, mw2, mh2);
      }

      const bassY = ((MAX_PITCH - rc.bassNote) / PITCH_RANGE) * mh;
      const bassH = Math.max(1, (ROW_HEIGHT / CANVAS_HEIGHT) * mh);
      ctx.fillStyle = "#22c55e";
      ctx.globalAlpha = 0.7;
      ctx.fillRect(mx, bassY, mw2, bassH);
    }
    ctx.globalAlpha = 1;

    // Visible window highlight
    const windowX = LABEL_WIDTH + scrollBeat * mpb;
    const windowW = visibleBeats * mpb;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(windowX, 0, windowW, mh);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(windowX, 0, windowW, mh);
  }, [resolvedChords, totalBars, scrollBeat, visibleBeats, canvasWidth]);

  // Trigger redraws
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { if (zoomMode === "detail") drawMinimap(); }, [zoomMode, drawMinimap]);

  // ─── RAF playhead loop ───────────────────────────────────────────────────────
  const startPlayheadLoop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const loop = () => {
      const secs = Tone.getTransport().seconds;
      playheadBeatsRef.current = (secs * bpm) / 60;
      draw();
      if (isPlayingRef.current) {
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };
    animFrameRef.current = requestAnimationFrame(loop);
  }, [bpm, draw]);

  // ─── Play ────────────────────────────────────────────────────────────────────
  const handlePlay = useCallback(async () => {
    if (isPlayingRef.current) {
      stopPlayback();
      isPlayingRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      playheadBeatsRef.current = -1;
      setActiveChordKey(null);
      draw();
      return;
    }

    // Build ChordEvent list from resolved data
    const chordEvents: ChordEvent[] = [];
    for (const rc of resolvedChords) {
      const sel = session.selectedOptions[rc.phraseId];
      const mode: EmotionalMode = sel?.mode ?? "bright";
      const opt = sel?.option ?? "A";
      const ph = session.harmonicOutput[mode].find((h) => h.phraseId === rc.phraseId);
      const orig = ph?.options[opt]?.chords[rc.chordIndex];
      if (!orig) continue;
      chordEvents.push({
        ...orig,
        bar: rc.bar,
        beat: rc.beat,
        voicing: rc.voicing,
        durationBeats: rc.durationBeats,
        bassNote: rc.bassNote,
      });
    }

    const firstMode = session.selectedOptions[session.phrases[0]?.phraseId]?.mode ?? "bright";
    isPlayingRef.current = true;
    Tone.getTransport().start();
    startPlayheadLoop();

    await playChordProgression(chordEvents, bpm, firstMode, (idx) => {
      if (idx < resolvedChords.length) {
        const rc = resolvedChords[idx];
        setActiveChordKey(`${rc.phraseId}:${rc.chordIndex}`);
      }
    });

    isPlayingRef.current = false;
    setActiveChordKey(null);
    playheadBeatsRef.current = -1;
  }, [resolvedChords, session, bpm, startPlayheadLoop, draw]);

  // ─── Global Reset ────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    onSessionUpdate({ ...session, timingOverrides: {} });
  }, [session, onSessionUpdate]);

  // ─── Hit test ────────────────────────────────────────────────────────────────
  const hitTest = useCallback(
    (cx: number, cy: number): HitResult | { found: false } => {
      for (let i = resolvedChords.length - 1; i >= 0; i--) {
        const rc = resolvedChords[i];
        const nx = absBeatsToX(rc.absBeats, scrollBeat, pixelsPerBeat);
        const nw = Math.max(2, rc.durationBeats * pixelsPerBeat - 1);

        if (cx < nx - 2 || cx > nx + nw + 4) continue;

        const isRightEdge = cx > nx + nw - 8;

        // Check bass
        const bassY = pitchToY(rc.bassNote);
        if (cy >= bassY && cy < bassY + ROW_HEIGHT) {
          return {
            found: true,
            phraseId: rc.phraseId,
            chordIndex: rc.chordIndex,
            noteSubIndex: -1,
            absBeats: rc.absBeats,
            durationBeats: rc.durationBeats,
            pitch: rc.bassNote,
            isRightEdge,
          };
        }

        // Check voicing
        for (let j = 0; j < rc.voicing.length; j++) {
          const pitch = rc.voicing[j];
          const ny = pitchToY(pitch);
          if (cy >= ny && cy < ny + ROW_HEIGHT) {
            return {
              found: true,
              phraseId: rc.phraseId,
              chordIndex: rc.chordIndex,
              noteSubIndex: j,
              absBeats: rc.absBeats,
              durationBeats: rc.durationBeats,
              pitch,
              isRightEdge,
            };
          }
        }
      }
      return { found: false };
    },
    [resolvedChords, scrollBeat, pixelsPerBeat]
  );

  // ─── Mouse down ───────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      setContextMenu(null);

      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = hitTest(cx, cy);
      if (!hit.found) return;

      // Determine actual drag mode
      let activeDragMode: EditMode = editMode;
      if (editMode === "resize" && !hit.isRightEdge) return;
      if (editMode === "move" && hit.isRightEdge) activeDragMode = "resize";

      dragRef.current = {
        editMode: activeDragMode,
        phraseId: hit.phraseId,
        chordIndex: hit.chordIndex,
        noteSubIndex: hit.noteSubIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startAbsBeats: hit.absBeats,
        startDurationBeats: hit.durationBeats,
        startPitch: hit.pitch,
        pixelsPerBeat,
        scrollBeat,
        shiftHeld: e.shiftKey,
        previewPitchDelta: 0,
        previewBeatsDelta: 0,
      };
    },
    [editMode, hitTest, pixelsPerBeat, scrollBeat]
  );

  // ─── Mouse move ───────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const drag = dragRef.current;

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      const beatsDelta = dx / drag.pixelsPerBeat;
      const pitchDelta = -Math.round(dy / ROW_HEIGHT);

      drag.previewBeatsDelta = beatsDelta;
      drag.previewPitchDelta = pitchDelta;
      drag.shiftHeld = e.shiftKey;

      // Trigger redraw with preview
      setDrawTick((t) => t + 1);
    },
    []
  );

  // ─── Mouse up ─────────────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      // Skip tiny accidental drags
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

      const beatsDelta = dx / drag.pixelsPerBeat;
      const pitchDelta = -Math.round(dy / ROW_HEIGHT);

      const rc = resolvedChords.find(
        (r) => r.phraseId === drag.phraseId && r.chordIndex === drag.chordIndex
      );
      if (!rc) return;

      const existing = session.timingOverrides?.[drag.phraseId]?.[drag.chordIndex];
      const override: TimingOverride = {
        bar: existing?.bar ?? rc.bar,
        beat: existing?.beat ?? rc.beat,
        subdivision: existing?.subdivision ?? rc.subdivision,
        durationBeats: existing?.durationBeats ?? rc.durationBeats,
        pitchOffsets: existing?.pitchOffsets ?? new Array(rc.voicing.length).fill(0),
      };

      if (drag.editMode === "move") {
        const newAbsBeats = Math.max(
          0,
          snapBeats(drag.startAbsBeats + beatsDelta, drag.shiftHeld)
        );
        const pos = absBeatsToPosition(newAbsBeats);
        override.bar = pos.bar;
        override.beat = pos.beat;
        override.subdivision = pos.subdivision;
      } else if (drag.editMode === "resize") {
        override.durationBeats = Math.max(
          0.25,
          snapBeats(drag.startDurationBeats + beatsDelta, drag.shiftHeld)
        );
      } else if (drag.editMode === "pitch") {
        const offsets = [...(override.pitchOffsets ?? new Array(rc.voicing.length).fill(0))];
        if (drag.noteSubIndex >= 0) {
          offsets[drag.noteSubIndex] = (offsets[drag.noteSubIndex] ?? 0) + pitchDelta;
        }
        // Note: bass pitch offset is not written (spec writes only voicing pitchOffsets)
        override.pitchOffsets = offsets;
      }

      const newTimingOverrides = {
        ...session.timingOverrides,
        [drag.phraseId]: {
          ...(session.timingOverrides?.[drag.phraseId] ?? {}),
          [drag.chordIndex]: override,
        },
      };

      onSessionUpdate({ ...session, timingOverrides: newTimingOverrides });
    },
    [session, resolvedChords, onSessionUpdate]
  );

  // ─── Context menu ─────────────────────────────────────────────────────────────
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit.found) {
        setContextMenu({
          screenX: e.clientX,
          screenY: e.clientY,
          phraseId: hit.phraseId,
          chordIndex: hit.chordIndex,
        });
      }
    },
    [hitTest]
  );

  const handleResetOverride = useCallback(() => {
    if (!contextMenu) return;
    const newOverrides = { ...session.timingOverrides };
    if (newOverrides[contextMenu.phraseId]) {
      const copy = { ...newOverrides[contextMenu.phraseId] };
      delete copy[contextMenu.chordIndex];
      newOverrides[contextMenu.phraseId] = copy;
    }
    setContextMenu(null);
    onSessionUpdate({ ...session, timingOverrides: newOverrides });
  }, [contextMenu, session, onSessionUpdate]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ─── Minimap click → scroll ───────────────────────────────────────────────────
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = minimapRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const totalBeats = totalBars * 4;
      const mpb = (canvasWidth - LABEL_WIDTH) / totalBeats;
      const clickedBeat = (cx - LABEL_WIDTH) / mpb;
      const newScroll = Math.max(0, Math.min((totalBars - 4) * 4, clickedBeat - 8));
      setScrollBeat(newScroll);
    },
    [totalBars, canvasWidth]
  );

  // ─── Render ───────────────────────────────────────────────────────────────────
  const btnBase: React.CSSProperties = {
    padding: "3px 8px",
    fontSize: 11,
    fontFamily: "monospace",
    borderRadius: 4,
    cursor: "pointer",
    border: "1px solid transparent",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.5)",
  };

  const btnActive = (color: string): React.CSSProperties => ({
    ...btnBase,
    background: `${color}22`,
    color,
    border: `1px solid ${color}66`,
  });

  return (
    <div
      style={{
        background: "#0a1628",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* ─── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Edit mode buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["move", "resize", "pitch"] as EditMode[]).map((m) => (
            <button
              key={m}
              style={editMode === m ? btnActive("#3b82f6") : btnBase}
              onClick={() => setEditMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)" }} />

        {/* Zoom buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["overview", "detail"] as ZoomMode[]).map((z) => (
            <button
              key={z}
              style={zoomMode === z ? btnActive("#22c55e") : btnBase}
              onClick={() => setZoomMode(z)}
            >
              {z.charAt(0).toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)" }} />

        {/* Play / Stop */}
        <button
          style={isPlayingRef.current ? btnActive("#ef4444") : btnBase}
          onClick={handlePlay}
        >
          {isPlayingRef.current ? "■ Stop" : "▶ Play"}
        </button>

        {/* Global Reset */}
        <button style={btnBase} onClick={handleReset}>
          Global Reset
        </button>

        {/* Done Editing (right-aligned) */}
        <button
          style={{ ...btnActive("#22D3EE"), marginLeft: "auto" }}
          onClick={onClose}
        >
          Done Editing
        </button>
      </div>

      {/* ─── Detail zoom nav ─────────────────────────────────────────────────── */}
      {zoomMode === "detail" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            style={btnBase}
            onClick={() => setScrollBeat((b) => Math.max(0, b - 4))}
          >
            ←
          </button>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
            Bar {Math.floor(scrollBeat / 4) + 1}–{Math.min(totalBars, Math.floor(scrollBeat / 4) + 4)}{" "}
            of {totalBars}
          </span>
          <button
            style={btnBase}
            onClick={() => setScrollBeat((b) => Math.min((totalBars - 4) * 4, b + 4))}
          >
            →
          </button>
        </div>
      )}

      {/* ─── Minimap (detail mode) ────────────────────────────────────────────── */}
      {zoomMode === "detail" && (
        <canvas
          ref={minimapRef}
          width={canvasWidth}
          height={40}
          style={{ width: "100%", height: 40, borderRadius: 4, cursor: "pointer", display: "block" }}
          onClick={handleMinimapClick}
        />
      )}

      {/* ─── Main canvas ─────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", overflow: "hidden", borderRadius: 4 }}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={CANVAS_HEIGHT}
          style={{
            display: "block",
            width: "100%",
            height: CANVAS_HEIGHT,
            cursor:
              editMode === "resize"
                ? "ew-resize"
                : editMode === "pitch"
                ? "ns-resize"
                : "grab",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        />

        {/* Context menu */}
        {contextMenu && (
          <div
            style={{
              position: "fixed",
              left: contextMenu.screenX,
              top: contextMenu.screenY,
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 6,
              padding: "4px 0",
              zIndex: 1000,
              minWidth: 160,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.7)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLButtonElement).style.background = "transparent")
              }
              onClick={handleResetOverride}
            >
              Reset to generated
            </button>
          </div>
        )}
      </div>

      {/* ─── Legend ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: 10,
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.3)",
          flexWrap: "wrap",
        }}
      >
        {[
          { color: "#3b82f6", label: "Chord" },
          { color: "#22c55e", label: "Bass" },
          { color: "rgba(255,255,255,0.3)", label: "Melody (read-only)" },
          { color: "#ef4444", label: "Out of key" },
          { color: "#f59e0b", label: "Has override" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 10,
                height: 8,
                borderRadius: 2,
                background: color,
              }}
            />
            <span>{label}</span>
          </div>
        ))}
        <span style={{ marginLeft: "auto" }}>
          Shift = 1/8 snap &nbsp;|&nbsp; Right-click = reset chord
        </span>
      </div>
    </div>
  );
}
