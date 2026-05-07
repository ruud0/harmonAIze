/**
 * DAWPianoRoll — canvas-based 88-key piano roll for harmonAIze
 * 88 keys (MIDI 21–108), PPQ=96, 1/16-note snap
 * Unified mouse mode: place/move/resize-left/resize-right/delete
 * Undo/redo: Ctrl+Z / Ctrl+Y (up to 20 snapshots)
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type HarmNote, type GeneratedLoop, PPQ, snapTick, getInKeyPitches, isInKey } from '@/lib/harmonaizeTypes';

// ── Constants ──────────────────────────────────────────────────────────────
const ROW_H = 16;
const KEY_W = 36;
const BEATS_PER_BAR = 4;
const MIDI_MIN = 21;
const MIDI_MAX = 108;
const TOTAL_ROWS = MIDI_MAX - MIDI_MIN + 1; // 88
const EDGE_ZONE = 7;
const MIN_NOTE_TICKS = PPQ / 4;
const CANVAS_H_TOTAL = TOTAL_ROWS * ROW_H; // 1408 px
const VEL_H = 52;
const MINIMAP_H = 24;

const C = {
  bg: '#141414',
  whiteRow: '#232323',
  blackRow: '#1c1c1c',
  cNote: '#1e281e',
  inKey: '#1e2820',
  beatLine: '#292929',
  barLine: '#3c3c3c',
  noteBody: '#e05018',
  noteHighlight: '#ff7840',
  playhead: '#ffffff',
  keyWhite: '#333333',
  keyBlack: '#1e1e1e',
  keyLabel: '#555555',
  velBg: '#1a1a1a',
  velBar: '#e05018',
  minimapBg: '#111111',
  minimapNote: '#e05018',
};

const BLACK_SET = new Set([1, 3, 6, 8, 10]);
function isBlack(midi: number) { return BLACK_SET.has(midi % 12); }
function noteLabel(midi: number): string | null { return midi % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : null; }

// ── Geometry helpers ───────────────────────────────────────────────────────
function midiToRow(midi: number) { return MIDI_MAX - midi; } // 0=top row
function rowToMidi(row: number) { return MIDI_MAX - row; }
function midiToY(midi: number) { return midiToRow(midi) * ROW_H; }

function noteGT(n: HarmNote) { return n.bar * BEATS_PER_BAR * PPQ + n.startTick; }
function gtToBarTick(gt: number) {
  const barTicks = BEATS_PER_BAR * PPQ;
  const bar = Math.floor(gt / barTicks);
  return { bar, startTick: gt - bar * barTicks };
}

// ── Types ──────────────────────────────────────────────────────────────────
type DragKind = 'place' | 'move' | 'resize-left' | 'resize-right';

interface DragState {
  kind: DragKind;
  noteId: string | null;
  startClientX: number;
  startClientY: number;
  origGT: number;         // global tick of note start when drag began
  origDur: number;
  origPitch: number;
  rightEdgeGT: number;    // fixed right edge for resize-left
  changed: boolean;
}

interface Props {
  loop: GeneratedLoop | null;
  notes: HarmNote[];
  playheadTick: number | null;
  isPlaying: boolean;
  onNotesChange: (notes: HarmNote[]) => void;
}

export default function DAWPianoRoll({ loop, notes, playheadTick, onNotesChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rollViewRef  = useRef<HTMLDivElement>(null);  // scrollable
  const rollCanvasRef = useRef<HTMLCanvasElement>(null);
  const keyCanvasRef  = useRef<HTMLCanvasElement>(null);
  const velCanvasRef  = useRef<HTMLCanvasElement>(null);
  const minimapRef    = useRef<HTMLCanvasElement>(null);

  // Scroll state mirrors scrollLeft/Top of rollViewRef
  const scrollRef = useRef({ left: 0, top: 0 });
  const [, forceRedraw] = useState(0);
  const redraw = useCallback(() => forceRedraw((n) => n + 1), []);

  // Visible size of roll viewport
  const [viewW, setViewW] = useState(800);
  const [viewH, setViewH] = useState(400);

  // Undo/redo
  const histRef = useRef<HarmNote[][]>([]);
  const histIdxRef = useRef(-1);
  const pushHist = useCallback((snap: HarmNote[]) => {
    histRef.current.splice(histIdxRef.current + 1);
    histRef.current.push(snap);
    if (histRef.current.length > 20) histRef.current.shift();
    histIdxRef.current = histRef.current.length - 1;
  }, []);

  // Draft notes during drag
  const draftRef = useRef<HarmNote[] | null>(null);
  const dragRef  = useRef<DragState | null>(null);

  const displayNotes = useCallback(() => draftRef.current ?? notes, [notes]);

  const bars = loop?.bars ?? 4;
  const pxPerBar = 240;
  const pxPerTick = pxPerBar / (BEATS_PER_BAR * PPQ);
  const totalW = bars * pxPerBar;

  const inKeySet = loop ? getInKeyPitches(loop.key, loop.scale) : new Set<number>();

  // ── Undo/Redo keyboard ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (histIdxRef.current < histRef.current.length - 1) {
            histIdxRef.current++;
            onNotesChange([...histRef.current[histIdxRef.current]]);
          }
        } else {
          if (histIdxRef.current > 0) {
            histIdxRef.current--;
            onNotesChange([...histRef.current[histIdxRef.current]]);
          }
        }
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (histIdxRef.current < histRef.current.length - 1) {
          histIdxRef.current++;
          onNotesChange([...histRef.current[histIdxRef.current]]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNotesChange]);

  // ── Resize observer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rollViewRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setViewW(r.width);
      setViewH(r.height);
    });
    ro.observe(rollViewRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Draw roll canvas ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = rollCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const sl = scrollRef.current.left;
    const st = scrollRef.current.top;

    ctx.clearRect(0, 0, W, H);

    // Background rows
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = midiToY(midi) - st;
      if (y + ROW_H < 0 || y > H) continue;
      if (midi % 12 === 0) ctx.fillStyle = C.cNote;
      else if (loop && isInKey(midi, inKeySet)) ctx.fillStyle = C.inKey;
      else if (isBlack(midi)) ctx.fillStyle = C.blackRow;
      else ctx.fillStyle = C.whiteRow;
      ctx.fillRect(0, y, W, ROW_H);
    }

    // Grid
    const sixteenth = PPQ / 4;
    const t0 = sl / pxPerTick;
    const t1 = (sl + W) / pxPerTick;
    for (let s = Math.floor(t0 / sixteenth); s <= Math.ceil(t1 / sixteenth); s++) {
      const x = s * sixteenth * pxPerTick - sl;
      const isBeat = s % 4 === 0;
      const isBar = s % 16 === 0;
      if (isBar) {
        ctx.strokeStyle = C.barLine;
        ctx.lineWidth = 1;
        const barNum = s / 16;
        ctx.fillStyle = '#555';
        ctx.font = '9px monospace';
        ctx.fillText(String(barNum + 1), x + 2, 10);
      } else if (isBeat) {
        ctx.strokeStyle = C.beatLine;
        ctx.lineWidth = 0.5;
      } else {
        ctx.strokeStyle = '#1e1e1e';
        ctx.lineWidth = 0.5;
      }
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Notes
    for (const note of displayNotes()) {
      const gt = noteGT(note);
      const x  = gt * pxPerTick - sl;
      const x2 = (gt + note.duration) * pxPerTick - sl;
      const y  = midiToY(note.pitch) - st;
      const w  = x2 - x;
      if (x2 < 0 || x > W || y + ROW_H < 0 || y > H) continue;

      ctx.fillStyle = C.noteBody;
      ctx.fillRect(x + 1, y + 1, w - 2, ROW_H - 2);
      ctx.fillStyle = C.noteHighlight;
      ctx.fillRect(x + 1, y + 1, w - 2, 2);

      if (w > EDGE_ZONE * 2 + 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 1, y + 1, EDGE_ZONE, ROW_H - 2);
        ctx.fillRect(x2 - EDGE_ZONE - 1, y + 1, EDGE_ZONE, ROW_H - 2);
      }
    }

    // Playhead
    if (playheadTick !== null) {
      const x = playheadTick * pxPerTick - sl;
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = C.playhead;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillStyle = C.playhead;
        ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8); ctx.fill();
      }
    }
  });

  // ── Draw piano keys ────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = keyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const H = canvas.height;
    const st = scrollRef.current.top;

    ctx.clearRect(0, 0, KEY_W, H);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, KEY_W, H);

    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const y = midiToY(midi) - st;
      if (y + ROW_H < 0 || y > H) continue;
      ctx.fillStyle = isBlack(midi) ? C.keyBlack : C.keyWhite;
      ctx.fillRect(1, y + 1, isBlack(midi) ? 20 : KEY_W - 2, ROW_H - 1);
      const label = noteLabel(midi);
      if (label) {
        ctx.fillStyle = C.keyLabel;
        ctx.font = '8px monospace';
        ctx.fillText(label, 1, y + ROW_H - 3);
      }
    }
  });

  // ── Draw velocity ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = velCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const sl = scrollRef.current.left;

    ctx.fillStyle = C.velBg;
    ctx.fillRect(0, 0, W, H);

    for (const note of displayNotes()) {
      const gt = noteGT(note);
      const x = gt * pxPerTick - sl;
      const w = Math.max(2, note.duration * pxPerTick - 2);
      const barH = Math.round((note.velocity / 127) * (H - 4));
      if (x + w < 0 || x > W) continue;
      ctx.fillStyle = C.velBar;
      ctx.fillRect(x, H - barH - 2, w, barH);
    }
  });

  // ── Draw minimap ───────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = C.minimapBg;
    ctx.fillRect(0, 0, W, H);

    const totalTicks = bars * BEATS_PER_BAR * PPQ;
    const scaleX = W / totalTicks;
    const scaleY = H / TOTAL_ROWS;
    for (const note of displayNotes()) {
      const gt = noteGT(note);
      ctx.fillStyle = C.minimapNote;
      ctx.fillRect(gt * scaleX, midiToRow(note.pitch) * scaleY, Math.max(1, note.duration * scaleX), Math.max(1, scaleY));
    }
    // Viewport box
    const sl = scrollRef.current.left;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sl * scaleX / pxPerTick, 0, (viewW / pxPerTick) * scaleX, H);
  });

  // ── Hit test ───────────────────────────────────────────────────────────
  function hitTest(cx: number, cy: number): { note: HarmNote; kind: 'left-edge' | 'right-edge' | 'body' } | null {
    const sl = scrollRef.current.left;
    const st = scrollRef.current.top;
    const midi = rowToMidi(Math.floor((cy + st) / ROW_H));
    const noteList = displayNotes();
    for (let i = noteList.length - 1; i >= 0; i--) {
      const n = noteList[i];
      if (n.pitch !== midi) continue;
      const gt = noteGT(n);
      const xL = gt * pxPerTick - sl;
      const xR = (gt + n.duration) * pxPerTick - sl;
      if (cx < xL || cx > xR) continue;
      if (cx - xL <= EDGE_ZONE) return { note: n, kind: 'left-edge' };
      if (xR - cx <= EDGE_ZONE) return { note: n, kind: 'right-edge' };
      return { note: n, kind: 'body' };
    }
    return null;
  }

  // ── Canvas mouse events ────────────────────────────────────────────────
  function onRollMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const sl = scrollRef.current.left;
    const st = scrollRef.current.top;

    if (e.button === 2) {
      const hit = hitTest(cx, cy);
      if (hit) {
        const next = notes.filter((n) => n.id !== hit.note.id);
        pushHist(next);
        onNotesChange(next);
      }
      return;
    }

    const hit = hitTest(cx, cy);
    if (!hit) {
      // Place note
      const rawGT = (cx + sl) / pxPerTick;
      const gt = Math.max(0, snapTick(rawGT));
      const midi = rowToMidi(Math.floor((cy + st) / ROW_H));
      if (midi < MIDI_MIN || midi > MIDI_MAX) return;
      const { bar, startTick } = gtToBarTick(gt);
      const id = `n${Date.now()}${Math.random().toString(36).slice(2)}`;
      const newNote: HarmNote = { id, bar, startTick, pitch: midi, duration: PPQ / 2, layer: 'melody', velocity: 100 };
      const next = [...notes, newNote];
      pushHist(next);
      draftRef.current = next;
      dragRef.current = { kind: 'place', noteId: id, startClientX: e.clientX, startClientY: e.clientY, origGT: gt, origDur: newNote.duration, origPitch: midi, rightEdgeGT: gt + newNote.duration, changed: false };
      redraw();
      return;
    }

    const gt = noteGT(hit.note);
    const base = { noteId: hit.note.id, startClientX: e.clientX, startClientY: e.clientY, origGT: gt, origDur: hit.note.duration, origPitch: hit.note.pitch, rightEdgeGT: gt + hit.note.duration, changed: false };
    if (hit.kind === 'body')       dragRef.current = { kind: 'move',         ...base };
    else if (hit.kind === 'left-edge')  dragRef.current = { kind: 'resize-left',  ...base };
    else                           dragRef.current = { kind: 'resize-right', ...base };
    draftRef.current = [...notes];
    redraw();
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dxTick = (e.clientX - drag.startClientX) / pxPerTick;
      const dyRow  = Math.round((e.clientY - drag.startClientY) / ROW_H);
      // Always transform from latest draft while dragging, otherwise freshly placed notes can
      // disappear if the cursor moves a few pixels before mouseup.
      const base = draftRef.current ?? notes;

      let updated: HarmNote[];
      if (drag.kind === 'place') {
        updated = base.map((n) => {
          if (n.id !== drag.noteId) return n;
          return { ...n, duration: Math.max(MIN_NOTE_TICKS, snapTick(drag.origDur + dxTick)) };
        });
      } else if (drag.kind === 'move') {
        updated = base.map((n) => {
          if (n.id !== drag.noteId) return n;
          const newGT = Math.max(0, snapTick(drag.origGT + dxTick));
          const newPitch = Math.max(MIDI_MIN, Math.min(MIDI_MAX, drag.origPitch - dyRow));
          const { bar, startTick } = gtToBarTick(newGT);
          return { ...n, bar, startTick, pitch: newPitch };
        });
      } else if (drag.kind === 'resize-left') {
        updated = base.map((n) => {
          if (n.id !== drag.noteId) return n;
          const newLeft = Math.min(drag.rightEdgeGT - MIN_NOTE_TICKS, Math.max(0, snapTick(drag.origGT + dxTick)));
          const { bar, startTick } = gtToBarTick(newLeft);
          return { ...n, bar, startTick, duration: drag.rightEdgeGT - newLeft };
        });
      } else {
        updated = base.map((n) => {
          if (n.id !== drag.noteId) return n;
          const newEnd = snapTick(drag.origGT + drag.origDur + dxTick);
          return { ...n, duration: Math.max(MIN_NOTE_TICKS, newEnd - drag.origGT) };
        });
      }

      drag.changed = true;
      draftRef.current = updated;
      redraw();
    };

    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (draftRef.current) {
        // 'place': history already pushed on mousedown; always commit the note
        // moves/resizes: only push history if something actually changed
        if (drag.kind !== 'place' && drag.changed) pushHist(draftRef.current);
        onNotesChange(draftRef.current);
      }
      dragRef.current = null;
      draftRef.current = null;
      redraw();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [notes, pxPerTick, pushHist, onNotesChange, redraw]);

  // Cursor style on roll canvas
  function getCursor(e: React.MouseEvent<HTMLCanvasElement>): string {
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return 'crosshair';
    if (hit.kind === 'body') return 'grab';
    return 'ew-resize';
  }

  // ── Scroll sync ────────────────────────────────────────────────────────
  function onRollScroll(e: React.UIEvent<HTMLDivElement>) {
    scrollRef.current = { left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop };
    // Sync key column vertical scroll
    if (keyCanvasRef.current?.parentElement) {
      keyCanvasRef.current.parentElement.scrollTop = e.currentTarget.scrollTop;
    }
    redraw();
  }

  // Minimap click to jump
  function onMinimapClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const totalTicks = bars * BEATS_PER_BAR * PPQ;
    if (rollViewRef.current) rollViewRef.current.scrollLeft = frac * totalTicks * pxPerTick;
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, userSelect: 'none' }}>
      {/* Minimap */}
      <div style={{ height: MINIMAP_H, flexShrink: 0, marginLeft: KEY_W, background: C.minimapBg }}>
        <canvas ref={minimapRef} width={Math.max(1, viewW - KEY_W)} height={MINIMAP_H} style={{ display: 'block', cursor: 'pointer' }} onClick={onMinimapClick} />
      </div>

      {/* Roll + keys row */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Key column */}
        <div style={{ width: KEY_W, flexShrink: 0, overflowY: 'hidden', borderRight: '1px solid #2a2a2a' }}>
          <canvas ref={keyCanvasRef} width={KEY_W} height={viewH} style={{ display: 'block' }} />
        </div>

        {/* Scrollable roll */}
        <div
          ref={rollViewRef}
          style={{ flex: 1, overflow: 'auto' }}
          onScroll={onRollScroll}
        >
          {/* Virtual size */}
          <div style={{ width: totalW, height: CANVAS_H_TOTAL, position: 'relative' }}>
            {/* Sticky canvas that always fills the viewport */}
            <div style={{ position: 'sticky', left: 0, top: 0, width: '100%', height: 0, overflow: 'visible', pointerEvents: 'none' }}>
              <canvas
                ref={rollCanvasRef}
                width={viewW}
                height={viewH}
                style={{ display: 'block', position: 'absolute', top: 0, left: 0, pointerEvents: 'auto', cursor: 'crosshair' }}
                onMouseDown={onRollMouseDown}
                onMouseMove={(e) => { e.currentTarget.style.cursor = getCursor(e); }}
                onContextMenu={(e) => e.preventDefault()}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Velocity panel */}
      <div style={{ height: VEL_H, flexShrink: 0, display: 'flex', borderTop: '1px solid #2a2a2a' }}>
        <div style={{ width: KEY_W, flexShrink: 0, borderRight: '1px solid #2a2a2a', background: '#1a1a1a', display: 'flex', alignItems: 'flex-start', padding: 2 }}>
          <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>VEL</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <canvas ref={velCanvasRef} width={Math.max(1, viewW - KEY_W)} height={VEL_H} style={{ display: 'block' }} />
        </div>
      </div>
    </div>
  );
}
