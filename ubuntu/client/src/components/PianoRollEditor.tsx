/**
 * PianoRollEditor — HTML Canvas piano roll for timing/pitch edits
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Three note layers: melody (white/ghost), chord (blue), bass (green).
 * Three interaction modes: Move, Resize, Pitch.
 * FL Studio style playback with yellow-green playhead.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as Tone from "tone";
import type { Session, EmotionalMode, OptionKey, TimingOverride } from "@/lib/types";
import { getScaleDegrees } from "@/lib/keyDetector";
import { midiToFullName } from "@/lib/midiParser";

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL_WIDTH = 40;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 10;
const MIDI_MIN = 24;
const MIDI_MAX = 84;
const NUM_ROWS = MIDI_MAX - MIDI_MIN + 1; // 61
const BEATS_PER_BAR = 4;
const SUBDIVISIONS_PER_BEAT = 4;
const RESIZE_HANDLE_PX = 8;

const OVERVIEW_PIXELS_PER_BAR = 64;
const DETAIL_PIXELS_PER_BAR = 128;

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoteData {
  phraseId: string;
  chordIndex: number; // index in the phrase's selected chords array
  noteIndex: number;  // -1=melody, 0=bass, 1..n=chord voicing
  type: "chord" | "bass" | "melody";
  bar: number;
  beat: number;
  subdivision: number;
  durationBeats: number;
  pitch: number; // MIDI pitch including any applied offset
  pitchOffset: number;
  isCurrentlyPlaying?: boolean;
}

interface DragState {
  active: boolean;
  type: "move" | "resize" | "pitch";
  note: NoteData;
  startX: number;
  startY: number;
  origBar: number;
  origBeat: number;
  origSubdivision: number;
  origDuration: number;
  origPitchOffset: number;
  chordGroupNotes: NoteData[]; // all notes sharing same chordIndex (for group drag)
}

interface PianoRollEditorProps {
  session: Session;
  onSessionUpdate: (updated: Session) => void;
  selectedOptions: Session["selectedOptions"];
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noteToBeats(bar: number, beat: number, subdivision: number): number {
  return (bar - 1) * BEATS_PER_BAR + (beat - 1) + (subdivision - 1) / SUBDIVISIONS_PER_BEAT;
}

function beatsToXPixels(beats: number, pixelsPerBar: number): number {
  return beats * (pixelsPerBar / BEATS_PER_BAR);
}

function xPixelsToBeats(px: number, pixelsPerBar: number): number {
  return px / (pixelsPerBar / BEATS_PER_BAR);
}

function pitchToY(pitch: number): number {
  return (MIDI_MAX - pitch) * ROW_HEIGHT + RULER_HEIGHT;
}

function yToPitch(y: number): number {
  return MIDI_MAX - Math.floor((y - RULER_HEIGHT) / ROW_HEIGHT);
}

function snapToGrid(beats: number, shiftKey = false): number {
  const gridSize = shiftKey ? 0.5 : 0.25; // 1/8 or 1/16 note
  return Math.max(0, Math.round(beats / gridSize) * gridSize);
}

function beatsToBarBeatSub(totalBeats: number): { bar: number; beat: number; subdivision: number } {
  const clipped = Math.max(0, totalBeats);
  const bar = Math.floor(clipped / BEATS_PER_BAR) + 1;
  const beatFrac = (clipped % BEATS_PER_BAR);
  const beat = Math.floor(beatFrac) + 1;
  const subFrac = (beatFrac % 1) * SUBDIVISIONS_PER_BEAT;
  const subdivision = Math.round(subFrac) + 1;
  return { bar, beat: Math.min(beat, BEATS_PER_BAR), subdivision: Math.max(1, Math.min(subdivision, SUBDIVISIONS_PER_BEAT)) };
}

// ─── Note resolver ────────────────────────────────────────────────────────────

function resolveNotes(session: Session, selectedOptions: Session["selectedOptions"]): NoteData[] {
  const notes: NoteData[] = [];
  const overrides = session.timingOverrides ?? {};

  for (const phrase of session.phrases) {
    const sel = selectedOptions[phrase.phraseId] ?? { mode: "bright" as EmotionalMode, option: "A" as OptionKey };
    const harmony = session.harmonicOutput[sel.mode]?.find(h => h.phraseId === phrase.phraseId);
    if (!harmony) continue;
    const chords = harmony.options[sel.option]?.chords ?? [];

    chords.forEach((chord, chordIndex) => {
      const ov = overrides[phrase.phraseId]?.[chordIndex];
      const bar = ov?.bar ?? chord.bar;
      const beat = ov?.beat ?? chord.beat;
      const subdivision = ov?.subdivision ?? 1;
      const durationBeats = ov?.durationBeats ?? 2;
      const pitchOffsets = ov?.pitchOffsets ?? [];

      // Bass note (noteIndex = 0)
      notes.push({
        phraseId: phrase.phraseId,
        chordIndex,
        noteIndex: 0,
        type: "bass",
        bar, beat, subdivision,
        durationBeats,
        pitch: chord.bassNote + (pitchOffsets[0] ?? 0),
        pitchOffset: pitchOffsets[0] ?? 0,
      });

      // Chord voicing (noteIndex = 1..n)
      chord.voicing.forEach((p, vi) => {
        notes.push({
          phraseId: phrase.phraseId,
          chordIndex,
          noteIndex: vi + 1,
          type: "chord",
          bar, beat, subdivision,
          durationBeats,
          pitch: p + (pitchOffsets[vi + 1] ?? 0),
          pitchOffset: pitchOffsets[vi + 1] ?? 0,
        });
      });
    });
  }

  // Melody (not interactive)
  for (const note of session.melody) {
    notes.push({
      phraseId: "",
      chordIndex: -1,
      noteIndex: -1,
      type: "melody",
      bar: note.bar,
      beat: note.beat,
      subdivision: note.subdivision,
      durationBeats: note.durationBeats,
      pitch: note.pitch,
      pitchOffset: 0,
    });
  }

  return notes;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PianoRollEditor({
  session,
  onSessionUpdate,
  selectedOptions,
  onClose,
}: PianoRollEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [interactionMode, setInteractionMode] = useState<"move" | "resize" | "pitch">("move");
  const [zoom, setZoom] = useState<"overview" | "detail">("overview");
  const [playheadBeats, setPlayheadBeats] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [bpmStr, setBpmStr] = useState(String(session.midiMeta?.tempos[0]?.bpm ?? 120));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; phraseId: string; chordIndex: number } | null>(null);
  const [hoveredNote, setHoveredNote] = useState<NoteData | null>(null);
  const [playingChordKey, setPlayingChordKey] = useState<string | null>(null); // "phraseId:chordIndex"

  const isPlayingRef = useRef(false);
  const rafRef = useRef<number>(0);
  const startBeatsRef = useRef(0);
  const startTimeRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);

  const bpm = Math.max(20, Math.min(300, parseFloat(bpmStr) || 120));
  const pixelsPerBar = zoom === "overview" ? OVERVIEW_PIXELS_PER_BAR : DETAIL_PIXELS_PER_BAR;
  const totalBars = session.midiMeta?.totalBars ?? 16;
  const canvasContentWidth = totalBars * pixelsPerBar;
  const canvasHeight = NUM_ROWS * ROW_HEIGHT + RULER_HEIGHT;

  const scaleDegrees = useMemo(() => {
    if (!session.detectedKey) return new Set<number>();
    return new Set(getScaleDegrees(session.detectedKey.root, session.detectedKey.mode));
  }, [session.detectedKey]);

  const notes = useMemo(() => resolveNotes(session, selectedOptions), [session, selectedOptions]);

  // ─── Drawing ────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = LABEL_WIDTH + canvasContentWidth;
    const H = canvasHeight;
    canvas.width = W;
    canvas.height = H;

    // Background
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, W, H);

    // ── Row backgrounds (in-key vs out-of-key) ──────────────────────────────
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = pitchToY(midi) ;
      const inKey = scaleDegrees.has(midi % 12);
      ctx.fillStyle = inKey ? "#1e293b" : "#0f172a";
      ctx.fillRect(LABEL_WIDTH, y, canvasContentWidth, ROW_HEIGHT);
    }

    // ── Row separators ──────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = pitchToY(midi);
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ── Vertical grid lines (beats & bars) ──────────────────────────────────
    const beatsTotal = totalBars * BEATS_PER_BAR;
    for (let b = 0; b <= beatsTotal; b++) {
      const x = LABEL_WIDTH + beatsToXPixels(b, pixelsPerBar);
      const isBar = b % BEATS_PER_BAR === 0;
      ctx.strokeStyle = isBar ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // ── Ruler ───────────────────────────────────────────────────────────────
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, W, RULER_HEIGHT);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(W, RULER_HEIGHT);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px 'Space Mono', monospace";
    for (let bar = 1; bar <= totalBars; bar++) {
      const x = LABEL_WIDTH + (bar - 1) * pixelsPerBar;
      ctx.fillText(String(bar), x + 3, 15);
      // Beat ticks
      for (let beat = 1; beat < BEATS_PER_BAR; beat++) {
        const bx = x + beat * (pixelsPerBar / BEATS_PER_BAR);
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bx, RULER_HEIGHT - 5);
        ctx.lineTo(bx, RULER_HEIGHT);
        ctx.stroke();
      }
    }

    // ── Y-axis labels (C notes) ──────────────────────────────────────────────
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, RULER_HEIGHT, LABEL_WIDTH, H - RULER_HEIGHT);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH, RULER_HEIGHT);
    ctx.lineTo(LABEL_WIDTH, H);
    ctx.stroke();

    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (midi % 12 === 0) { // C notes
        const y = pitchToY(midi);
        const octave = Math.floor(midi / 12) - 1;
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "9px 'Space Mono', monospace";
        ctx.fillText(`C${octave}`, 4, y + ROW_HEIGHT - 2);
        // Horizontal line at C notes
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    }

    // ── Notes ────────────────────────────────────────────────────────────────
    for (const note of notes) {
      const startBeats = noteToBeats(note.bar, note.beat, note.subdivision);
      const x = LABEL_WIDTH + beatsToXPixels(startBeats, pixelsPerBar);
      const w = Math.max(4, beatsToXPixels(note.durationBeats, pixelsPerBar) - 1);
      const y = pitchToY(note.pitch);
      const isPlaying = playingChordKey === `${note.phraseId}:${note.chordIndex}`;

      if (note.type === "melody") {
        ctx.fillStyle = isPlaying ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.18)";
      } else if (note.type === "chord") {
        ctx.fillStyle = isPlaying ? "rgba(59,130,246,1)" : "rgba(59,130,246,0.8)";
      } else {
        // bass
        ctx.fillStyle = isPlaying ? "rgba(34,197,94,1)" : "rgba(34,197,94,0.8)";
      }

      ctx.fillRect(x, y + 1, w, ROW_HEIGHT - 2);

      // Out-of-key overlay
      if (note.type !== "melody" && !scaleDegrees.has(note.pitch % 12)) {
        ctx.fillStyle = "rgba(239,68,68,0.5)";
        ctx.fillRect(x, y + 1, w, ROW_HEIGHT - 2);
      }

      // Resize handle for interactive notes
      if (note.type !== "melody") {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(x + w - 3, y + 2, 3, ROW_HEIGHT - 4);
      }
    }

    // ── Playhead ─────────────────────────────────────────────────────────────
    const phX = LABEL_WIDTH + beatsToXPixels(playheadBeats, pixelsPerBar);
    ctx.strokeStyle = "#a3e635";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, H);
    ctx.stroke();

    // Playhead triangle on ruler
    ctx.fillStyle = "#a3e635";
    ctx.beginPath();
    ctx.moveTo(phX - 5, 0);
    ctx.lineTo(phX + 5, 0);
    ctx.lineTo(phX, 8);
    ctx.closePath();
    ctx.fill();

    // ── Minimap (detail mode) ─────────────────────────────────────────────────
    if (zoom === "detail" && canvasContentWidth > 0) {
      const mmW = 120;
      const mmH = 20;
      const mmX = W - mmW - 8;
      const mmY = RULER_HEIGHT + 4;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(mmX, mmY, mmW, mmH);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.strokeRect(mmX, mmY, mmW, mmH);

      // Minimap notes
      for (const note of notes) {
        if (note.type === "melody") continue;
        const nb = noteToBeats(note.bar, note.beat, note.subdivision);
        const nx = mmX + (nb / (totalBars * BEATS_PER_BAR)) * mmW;
        const nw = Math.max(1, (note.durationBeats / (totalBars * BEATS_PER_BAR)) * mmW);
        const ny = mmY + ((MIDI_MAX - note.pitch) / NUM_ROWS) * mmH;
        ctx.fillStyle = note.type === "chord" ? "#3b82f6" : "#22c55e";
        ctx.fillRect(nx, ny, nw, 2);
      }

      // Minimap viewport
      const scroll = scrollRef.current;
      if (scroll) {
        const viewStart = scroll.scrollLeft / canvasContentWidth;
        const viewW = scroll.clientWidth / canvasContentWidth;
        ctx.strokeStyle = "rgba(163,230,53,0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(mmX + viewStart * mmW, mmY, viewW * mmW, mmH);
      }
    }
  }, [notes, playheadBeats, pixelsPerBar, scaleDegrees, totalBars, canvasContentWidth, canvasHeight, zoom, playingChordKey]);

  useEffect(() => { draw(); }, [draw]);

  // ─── Auto-scroll playhead in detail mode ───────────────────────────────────

  useEffect(() => {
    if (!isPlaying || zoom !== "detail") return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const phX = beatsToXPixels(playheadBeats, pixelsPerBar);
    const viewLeft = scroll.scrollLeft;
    const viewRight = viewLeft + scroll.clientWidth;
    if (phX < viewLeft || phX > viewRight - 60) {
      scroll.scrollLeft = Math.max(0, phX - 80);
    }
  }, [playheadBeats, isPlaying, zoom, pixelsPerBar]);

  // ─── RAF playhead loop ──────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  // ─── Playback synths ────────────────────────────────────────────────────────

  const melodySynthRef = useRef<Tone.PolySynth | null>(null);
  const chordSynthRef = useRef<Tone.PolySynth | null>(null);
  const bassSynthRef = useRef<Tone.Synth | null>(null);

  const disposeSynths = useCallback(() => {
    if (melodySynthRef.current) { melodySynthRef.current.dispose(); melodySynthRef.current = null; }
    if (chordSynthRef.current) { chordSynthRef.current.releaseAll(); chordSynthRef.current.dispose(); chordSynthRef.current = null; }
    if (bassSynthRef.current) { bassSynthRef.current.dispose(); bassSynthRef.current = null; }
  }, []);

  // ─── Play ────────────────────────────────────────────────────────────────────

  const handlePlay = useCallback(async () => {
    await Tone.start();
    disposeSynths();

    melodySynthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.5 },
      volume: -6,
    }).toDestination();

    chordSynthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.2, sustain: 0.7, release: 1.5 },
      volume: -10,
    }).toDestination();

    bassSynthRef.current = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.8 },
      volume: -6,
    }).toDestination();

    Tone.getTransport().cancel();
    Tone.getTransport().stop();
    Tone.getTransport().bpm.value = bpm;

    const startBeats = playheadBeats;
    startBeatsRef.current = startBeats;
    startTimeRef.current = Tone.now() + 0.05;

    // Group notes by chord for highlight tracking
    const chordGroups = new Map<string, NoteData[]>();
    for (const note of notes) {
      if (note.type === "melody") continue;
      const key = `${note.phraseId}:${note.chordIndex}`;
      if (!chordGroups.has(key)) chordGroups.set(key, []);
      chordGroups.get(key)!.push(note);
    }

    const beatDuration = 60 / bpm;

    // Schedule notes via Transport
    for (const note of notes) {
      const noteBeats = noteToBeats(note.bar, note.beat, note.subdivision);
      if (noteBeats < startBeats) continue;
      const offsetSec = (noteBeats - startBeats) * beatDuration;
      const durSec = note.durationBeats * beatDuration * 0.92;
      const noteName = midiToFullName(note.pitch);

      Tone.getTransport().schedule((time) => {
        try {
          if (note.type === "melody" && melodySynthRef.current) {
            melodySynthRef.current.triggerAttackRelease(noteName, durSec, time);
          } else if (note.type === "chord" && chordSynthRef.current) {
            chordSynthRef.current.triggerAttackRelease(noteName, durSec, time);
          } else if (note.type === "bass" && bassSynthRef.current) {
            bassSynthRef.current.triggerAttackRelease(noteName, durSec, time);
          }
        } catch {}
        // Highlight chord
        const key = `${note.phraseId}:${note.chordIndex}`;
        Tone.getDraw().schedule(() => {
          setPlayingChordKey(key);
        }, time);
      }, offsetSec);
    }

    Tone.getTransport().start();
    isPlayingRef.current = true;
    setIsPlaying(true);
    setIsPaused(false);

    const loop = () => {
      if (!isPlayingRef.current) return;
      const elapsed = Tone.getTransport().seconds;
      const currentBeats = startBeats + elapsed * (bpm / 60);
      setPlayheadBeats(currentBeats);

      // Auto-stop at end
      if (currentBeats >= totalBars * BEATS_PER_BAR) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        setPlayingChordKey(null);
        Tone.getTransport().stop();
        disposeSynths();
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [bpm, playheadBeats, notes, totalBars, disposeSynths]);

  const handlePause = useCallback(() => {
    if (!isPlaying) return;
    stopRaf();
    Tone.getTransport().pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(true);
    setPlayingChordKey(null);
    disposeSynths();
  }, [isPlaying, stopRaf, disposeSynths]);

  const handleStop = useCallback(() => {
    stopRaf();
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    setPlayingChordKey(null);
    setPlayheadBeats(0);
    disposeSynths();
  }, [stopRaf, disposeSynths]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRaf();
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      disposeSynths();
    };
  }, [stopRaf, disposeSynths]);

  // ─── Hit testing ─────────────────────────────────────────────────────────────

  const hitTest = useCallback(
    (clientX: number, clientY: number): { note: NoteData; isResize: boolean } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (x < LABEL_WIDTH || y < RULER_HEIGHT) return null;

      // Reverse order to pick top-drawn note first
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        if (note.type === "melody") continue;
        const startBeats = noteToBeats(note.bar, note.beat, note.subdivision);
        const nx = LABEL_WIDTH + beatsToXPixels(startBeats, pixelsPerBar);
        const nw = Math.max(4, beatsToXPixels(note.durationBeats, pixelsPerBar) - 1);
        const ny = pitchToY(note.pitch);

        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
          const isResize = x >= nx + nw - RESIZE_HANDLE_PX;
          return { note, isResize };
        }
      }
      return null;
    },
    [notes, pixelsPerBar]
  );

  // ─── Mouse events ──────────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 2) return; // right-click handled separately

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Click on ruler → reposition playhead
      if (y < RULER_HEIGHT && x >= LABEL_WIDTH) {
        const beats = xPixelsToBeats(x - LABEL_WIDTH, pixelsPerBar);
        setPlayheadBeats(Math.max(0, beats));
        return;
      }

      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;

      const { note, isResize } = hit;
      const effectiveMode = interactionMode === "move" && isResize ? "resize" : interactionMode;

      // Collect chord group notes (same phraseId + chordIndex)
      const chordGroupNotes = notes.filter(
        n => n.phraseId === note.phraseId && n.chordIndex === note.chordIndex && n.type !== "melody"
      );

      dragRef.current = {
        active: true,
        type: effectiveMode,
        note,
        startX: e.clientX,
        startY: e.clientY,
        origBar: note.bar,
        origBeat: note.beat,
        origSubdivision: note.subdivision,
        origDuration: note.durationBeats,
        origPitchOffset: note.pitchOffset,
        chordGroupNotes,
      };

      canvas.style.cursor = "grabbing";
      e.preventDefault();
    },
    [hitTest, interactionMode, notes, pixelsPerBar]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (!drag?.active) {
        // Update cursor
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < RULER_HEIGHT) {
          canvas.style.cursor = "pointer";
          return;
        }
        const hit = hitTest(e.clientX, e.clientY);
        if (!hit) {
          canvas.style.cursor = "crosshair";
        } else if (hit.isResize) {
          canvas.style.cursor = "ew-resize";
        } else {
          canvas.style.cursor = "pointer";
        }
        setHoveredNote(hit?.note ?? null);
        return;
      }

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === "move") {
        const deltaBeats = snapToGrid(xPixelsToBeats(dx, pixelsPerBar), e.shiftKey);
        const origBeats = noteToBeats(drag.origBar, drag.origBeat, drag.origSubdivision);
        const newBeats = Math.max(0, origBeats + deltaBeats);
        const { bar, beat, subdivision } = beatsToBarBeatSub(newBeats);

        // Apply to all notes in chord group (move as group)
        const newOverrides = { ...(session.timingOverrides ?? {}) };
        for (const gn of drag.chordGroupNotes) {
          const gnOrigBeats = noteToBeats(gn.bar, gn.beat, gn.subdivision);
          const gnDelta = gnOrigBeats - noteToBeats(drag.origBar, drag.origBeat, drag.origSubdivision);
          const gnNewBeats = Math.max(0, newBeats + gnDelta);
          const gnPos = beatsToBarBeatSub(gnNewBeats);
          if (!newOverrides[gn.phraseId]) newOverrides[gn.phraseId] = {};
          const existing = newOverrides[gn.phraseId][gn.chordIndex];
          newOverrides[gn.phraseId][gn.chordIndex] = {
            bar: gnPos.bar,
            beat: gnPos.beat,
            subdivision: gnPos.subdivision,
            durationBeats: existing?.durationBeats ?? gn.durationBeats,
            pitchOffsets: existing?.pitchOffsets ?? [],
          };
        }
        onSessionUpdate({ ...session, timingOverrides: newOverrides });
      } else if (drag.type === "resize") {
        const deltaDur = xPixelsToBeats(dx, pixelsPerBar);
        const newDur = Math.max(0.25, drag.origDuration + deltaDur);
        const snappedDur = snapToGrid(newDur, e.shiftKey);

        const newOverrides = { ...(session.timingOverrides ?? {}) };
        for (const gn of drag.chordGroupNotes) {
          if (!newOverrides[gn.phraseId]) newOverrides[gn.phraseId] = {};
          const existing = newOverrides[gn.phraseId][gn.chordIndex];
          newOverrides[gn.phraseId][gn.chordIndex] = {
            bar: existing?.bar ?? gn.bar,
            beat: existing?.beat ?? gn.beat,
            subdivision: existing?.subdivision ?? gn.subdivision,
            durationBeats: snappedDur,
            pitchOffsets: existing?.pitchOffsets ?? [],
          };
        }
        onSessionUpdate({ ...session, timingOverrides: newOverrides });
      } else if (drag.type === "pitch") {
        // Move individual note by semitones
        const deltaSemitones = -Math.round(dy / ROW_HEIGHT);
        const newOffset = drag.origPitchOffset + deltaSemitones;

        const newOverrides = { ...(session.timingOverrides ?? {}) };
        const { phraseId, chordIndex, noteIndex } = drag.note;
        if (!newOverrides[phraseId]) newOverrides[phraseId] = {};
        const existing = newOverrides[phraseId][chordIndex];
        const pitchOffsets = [...(existing?.pitchOffsets ?? [])];
        pitchOffsets[noteIndex] = newOffset;
        newOverrides[phraseId][chordIndex] = {
          bar: existing?.bar ?? drag.note.bar,
          beat: existing?.beat ?? drag.note.beat,
          subdivision: existing?.subdivision ?? drag.note.subdivision,
          durationBeats: existing?.durationBeats ?? drag.note.durationBeats,
          pitchOffsets,
        };
        onSessionUpdate({ ...session, timingOverrides: newOverrides });
      }
    },
    [hitTest, pixelsPerBar, session, onSessionUpdate]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag?.active) {
        dragRef.current = null;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = "crosshair";
      }
    },
    []
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const hit = hitTest(e.clientX, e.clientY);
      if (hit && hit.note.type !== "melody") {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        setContextMenu({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          phraseId: hit.note.phraseId,
          chordIndex: hit.note.chordIndex,
        });
      }
    },
    [hitTest]
  );

  const handleResetNote = useCallback(() => {
    if (!contextMenu) return;
    const newOverrides = { ...(session.timingOverrides ?? {}) };
    if (newOverrides[contextMenu.phraseId]) {
      const phraseOv = { ...newOverrides[contextMenu.phraseId] };
      delete phraseOv[contextMenu.chordIndex];
      if (Object.keys(phraseOv).length === 0) {
        delete newOverrides[contextMenu.phraseId];
      } else {
        newOverrides[contextMenu.phraseId] = phraseOv;
      }
    }
    onSessionUpdate({ ...session, timingOverrides: newOverrides });
    setContextMenu(null);
  }, [contextMenu, session, onSessionUpdate]);

  const handleGlobalReset = useCallback(() => {
    onSessionUpdate({ ...session, timingOverrides: {} });
  }, [session, onSessionUpdate]);

  // ─── Toolbar button style ──────────────────────────────────────────────────

  const toolBtn = (active: boolean, color = "#22d3ee") => ({
    background: active ? `${color}20` : "rgba(255,255,255,0.05)",
    color: active ? color : "rgba(255,255,255,0.5)",
    border: `1px solid ${active ? color + "40" : "rgba(255,255,255,0.1)"}`,
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "11px",
    fontFamily: "Space Mono, monospace",
    cursor: "pointer",
  } as React.CSSProperties);

  return (
    <div
      style={{
        background: "#080c14",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
        }}
      >
        {/* Interaction mode */}
        <button style={toolBtn(interactionMode === "move")} onClick={() => setInteractionMode("move")}>Move</button>
        <button style={toolBtn(interactionMode === "resize")} onClick={() => setInteractionMode("resize")}>Resize</button>
        <button style={toolBtn(interactionMode === "pitch")} onClick={() => setInteractionMode("pitch")}>Pitch</button>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

        {/* Zoom */}
        <button style={toolBtn(zoom === "overview", "#a78bfa")} onClick={() => setZoom("overview")}>Overview</button>
        <button style={toolBtn(zoom === "detail", "#a78bfa")} onClick={() => setZoom("detail")}>Detail</button>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

        {/* Transport */}
        <button
          style={toolBtn(isPlaying, "#a3e635")}
          onClick={isPlaying ? handlePause : handlePlay}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button style={toolBtn(false, "#fb7185")} onClick={handleStop}>■</button>

        {/* BPM */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", fontFamily: "Space Mono, monospace" }}>BPM</span>
          <input
            type="number"
            value={bpmStr}
            onChange={e => setBpmStr(e.target.value)}
            style={{
              width: 52,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "rgba(255,255,255,0.8)",
              fontSize: 11,
              fontFamily: "Space Mono, monospace",
              padding: "2px 6px",
              textAlign: "center",
            }}
          />
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

        {/* Global reset */}
        <button style={toolBtn(false, "#fb7185")} onClick={handleGlobalReset}>Global Reset</button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Legend */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#3b82f6", fontFamily: "Space Mono, monospace" }}>■ Chord</span>
          <span style={{ fontSize: 9, color: "#22c55e", fontFamily: "Space Mono, monospace" }}>■ Bass</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "Space Mono, monospace" }}>■ Melody</span>
        </div>

        <button
          style={toolBtn(false, "#22d3ee")}
          onClick={onClose}
        >
          Done Editing
        </button>
      </div>

      {/* Canvas scroll container */}
      <div
        ref={scrollRef}
        style={{
          overflowX: "auto",
          overflowY: "auto",
          maxHeight: "420px",
          position: "relative",
        }}
        onScroll={() => draw()}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", cursor: "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
          onClick={() => setContextMenu(null)}
        />

        {/* Context menu */}
        {contextMenu && (
          <div
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6,
              padding: "4px 0",
              zIndex: 100,
              minWidth: 160,
            }}
          >
            <button
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                textAlign: "left",
                background: "transparent",
                color: "rgba(255,255,255,0.8)",
                fontSize: 12,
                fontFamily: "Space Mono, monospace",
                cursor: "pointer",
                border: "none",
              }}
              onClick={handleResetNote}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              Reset to generated
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
