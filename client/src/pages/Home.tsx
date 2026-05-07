/**
 * harmonAIze — Main DAW page
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import DAWPianoRoll from '@/components/DAWPianoRoll';
import {
  type GeneratedLoop,
  type HarmNote,
  type RawApiNote,
  rawNotesToHarmNotes,
  PPQ,
} from '@/lib/harmonaizeTypes';
import {
  downloadBlob,
  exportMultiTrackMidi,
} from '@/lib/harmonaizeMidi';
import JSZip from 'jszip';

const BG = '#141414';
const PANEL = '#1a1a1a';
const SURFACE = '#242424';
const BORDER = '#2a2a2a';
const ACCENT = '#ff6b35';
const TEXT = '#cccccc';
const MUTED = '#666666';

const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES = ['major','minor','dorian','phrygian','lydian','mixolydian','pentatonic major','pentatonic minor','blues'];
const MOODS = ['happy','melancholy','epic','mysterious','energetic','calm','tense','dreamy'];
const BAR_OPTIONS = [2, 4, 8, 16] as const;
const BPM_MIN = 40;
const BPM_MAX = 240;
const BEATS_PER_BAR = 4;

function WaveformLoader() {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 18 }}>
      {[0,1,2,3,4].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 3,
            background: '#fff',
            borderRadius: 2,
            animation: `waveBar 0.8s ease-in-out ${i * 0.12}s infinite alternate`,
          }}
        />
      ))}
      <style>{`@keyframes waveBar { from { height: 4px; opacity: 0.5; } to { height: 16px; opacity: 1; } }`}</style>
    </span>
  );
}

interface BarCardProps {
  barIndex: number;
  chord: string;
  notes: HarmNote[];
  isModified: boolean;
}

function BarCard({ barIndex, chord, notes, isModified }: BarCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, W, H);
    const barNotes = notes.filter((n) => n.bar === barIndex);
    if (!barNotes.length) return;
    const pitches = barNotes.map((n) => n.pitch);
    const minP = Math.min(...pitches), maxP = Math.max(...pitches);
    const pRange = Math.max(1, maxP - minP);
    const barTicks = BEATS_PER_BAR * PPQ;
    for (const n of barNotes) {
      const x = (n.startTick / barTicks) * W;
      const w = Math.max(2, (n.duration / barTicks) * W);
      const y = H - ((n.pitch - minP) / pRange) * (H - 4) - 2;
      ctx.fillStyle = '#e05018';
      ctx.fillRect(x, y, w, 2);
    }
  }, [notes, barIndex]);
  return (
    <div style={{ flexShrink: 0, width: 80, height: 68, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '4px 6px', gap: 2 }}>
      <div style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace' }}>bar {barIndex + 1}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: isModified ? '#4ea8de' : ACCENT, fontFamily: 'monospace', lineHeight: 1.2 }}>
        {chord}{isModified && <span style={{ fontSize: 9, marginLeft: 2 }}>*</span>}
      </div>
      <canvas ref={canvasRef} width={68} height={24} style={{ display: 'block', borderRadius: 2 }} />
    </div>
  );
}

function Sel({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && <span style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace', textTransform: 'uppercase' }}>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'monospace', cursor: 'pointer', outline: 'none' }}>
        {options.map((o) => <option key={o} value={o} style={{ background: SURFACE }}>{o}</option>)}
      </select>
    </div>
  );
}

export default function Home() {
  const [key, setKey] = useState('C');
  const [scale, setScale] = useState('major');
  const [loopBars, setLoopBars] = useState<2 | 4 | 8 | 16>(4);
  const [mood, setMood] = useState('happy');
  const [bpm, setBpm] = useState(120);
  const [loop, setLoop] = useState<GeneratedLoop | null>(null);
  const [notes, setNotes] = useState<HarmNote[]>([]);
  const [generating, setGenerating] = useState(false);
  const [statusText, setStatusText] = useState('Generate a loop to begin.');
  const [origNotes, setOrigNotes] = useState<HarmNote[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const playStartTickRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<Array<{ osc: OscillatorNode; gain: GainNode }>>([]);
  const audioTimeoutsRef = useRef<number[]>([]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setStatusText('Generating...');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, scale, bars: loopBars, mood, bpm }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Unknown error');
      const raw = json.data as { chords: string[]; notes: RawApiNote[] };
      const harmNotes = rawNotesToHarmNotes(raw.notes);
      const newLoop: GeneratedLoop = { key, scale, bars: loopBars, bpm, mood, chords: raw.chords, notes: harmNotes };
      setLoop(newLoop);
      setNotes(harmNotes);
      setOrigNotes(harmNotes);
      setStatusText(`${key} ${scale} · ${loopBars} bars · ${bpm} BPM · ${mood}`);
    } catch (err: unknown) {
      setStatusText(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }, [key, scale, loopBars, mood, bpm]);

  const totalTicks = (loop?.bars ?? loopBars) * BEATS_PER_BAR * PPQ;
  const ticksPerSecond = (bpm / 60) * PPQ;

  const midiToHz = useCallback((midi: number) => 440 * Math.pow(2, (midi - 69) / 12), []);

  const stopScheduledAudio = useCallback(() => {
    for (const t of audioTimeoutsRef.current) window.clearTimeout(t);
    audioTimeoutsRef.current = [];
    for (const { osc, gain } of audioNodesRef.current) {
      try {
        gain.gain.cancelScheduledValues(0);
        gain.gain.value = 0;
        osc.stop();
      } catch {
        // oscillator may already be stopped
      }
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    }
    audioNodesRef.current = [];
  }, []);

  const scheduleAudio = useCallback((fromTick: number) => {
    stopScheduledAudio();
    if (!notes.length) return;

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime + 0.02;
    const cycleTicks = totalTicks;
    const gainByLayer: Record<HarmNote['layer'], number> = { melody: 0.18, chords: 0.12, bass: 0.2 };

    notes.forEach((n) => {
      const noteTick = n.bar * BEATS_PER_BAR * PPQ + n.startTick;
      if (noteTick < fromTick || noteTick >= cycleTicks) return;
      const delaySec = (noteTick - fromTick) / ticksPerSecond;
      const durSec = Math.max(0.03, n.duration / ticksPerSecond);
      const timeout = window.setTimeout(() => {
        if (!audioCtxRef.current) return;
        const startAt = audioCtxRef.current.currentTime + 0.003;
        const stopAt = startAt + durSec;
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.type = n.layer === 'bass' ? 'triangle' : 'sawtooth';
        osc.frequency.value = midiToHz(n.pitch);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(gainByLayer[n.layer], startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start(startAt);
        osc.stop(stopAt + 0.01);
        audioNodesRef.current.push({ osc, gain });
      }, Math.max(0, delaySec * 1000));
      audioTimeoutsRef.current.push(timeout);
    });
  }, [notes, totalTicks, ticksPerSecond, midiToHz, stopScheduledAudio]);

  const stopPlayback = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
    setPlayheadTick(null);
    stopScheduledAudio();
  }, [stopScheduledAudio]);

  const startPlayback = useCallback((fromTick: number) => {
    playStartTimeRef.current = performance.now();
    playStartTickRef.current = fromTick;
    setIsPlaying(true);
    scheduleAudio(fromTick);
    const tick = () => {
      const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
      let cur = playStartTickRef.current + elapsed * ticksPerSecond;
      if (cur >= totalTicks) {
        if (loopEnabled) {
          playStartTimeRef.current = performance.now();
          playStartTickRef.current = 0;
          scheduleAudio(0);
          cur = 0;
        } else {
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          setIsPlaying(false);
          setPlayheadTick(null);
          stopScheduledAudio();
          return;
        }
      }
      setPlayheadTick(cur);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [ticksPerSecond, totalTicks, loopEnabled, scheduleAudio, stopScheduledAudio]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setIsPlaying(false);
      stopScheduledAudio();
    } else {
      startPlayback(playheadTick ?? 0);
    }
  }, [isPlaying, startPlayback, playheadTick, stopScheduledAudio]);

  useEffect(() => () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopScheduledAudio();
  }, [stopScheduledAudio]);

  // Spacebar play/pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = (e.target as HTMLElement).isContentEditable;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'TEXTAREA' || isEditable) return;
      e.preventDefault();
      togglePlayPause();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause]);

  function isBarModified(barIndex: number): boolean {
    if (!loop) return false;
    const ob = origNotes.filter((n) => n.bar === barIndex);
    const cb = notes.filter((n) => n.bar === barIndex);
    if (ob.length !== cb.length) return true;
    return ob.some((o) => {
      const c = cb.find((n) => n.id === o.id);
      if (!c) return true;
      return c.startTick !== o.startTick || c.duration !== o.duration || c.pitch !== o.pitch;
    });
  }

  const hasNotes = notes.length > 0;

  function handleExportMulti() {
    if (!hasNotes) return;
    downloadBlob(exportMultiTrackMidi(notes, bpm), 'harmonaize.mid');
  }

  async function handleExportZip() {
    if (!hasNotes) return;
    const zip = new JSZip();
    zip.file('melody.mid', exportMultiTrackMidi(notes.filter((n) => n.layer === 'melody'), bpm));
    zip.file('chords.mid', exportMultiTrackMidi(notes.filter((n) => n.layer === 'chords'), bpm));
    zip.file('bass.mid', exportMultiTrackMidi(notes.filter((n) => n.layer === 'bass'), bpm));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'harmonaize_layers.zip');
  }

  const btnBase: React.CSSProperties = { border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 };
  const accentBtn: React.CSSProperties = { ...btnBase, background: ACCENT, color: '#fff', padding: '0 16px', height: 32, fontSize: 13 };
  const mutedBtn = (disabled: boolean): React.CSSProperties => ({ ...btnBase, background: SURFACE, color: disabled ? '#444' : TEXT, border: `1px solid ${BORDER}`, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 });
  const iconBtn: React.CSSProperties = { ...btnBase, background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, padding: '4px 9px', fontSize: 14 };
  const activeIconBtn: React.CSSProperties = { ...iconBtn, background: ACCENT, color: '#fff', border: `1px solid ${ACCENT}` };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG, color: TEXT, fontFamily: 'monospace', overflow: 'hidden' }}>
      {/* Top bar (40px) */}
      <div style={{ height: 40, flexShrink: 0, background: PANEL, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10 }}>
        <span style={{ color: ACCENT, fontWeight: 700, fontSize: 15, letterSpacing: '-0.5px', marginRight: 4 }}>harmonAIze</span>
        {loop && <span style={{ color: MUTED, fontSize: 11 }}>{loop.key} {loop.scale}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: MUTED }}>BPM</span>
          <input type="number" min={BPM_MIN} max={BPM_MAX} value={bpm} onChange={(e) => setBpm(Math.max(BPM_MIN, Math.min(BPM_MAX, Number(e.target.value))))} style={{ width: 52, background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '2px 6px', fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
        </div>
        <div style={{ flex: 1 }} />
        <button style={iconBtn} onClick={stopPlayback} title="Stop">&#9632;</button>
        <button style={isPlaying ? activeIconBtn : iconBtn} onClick={togglePlayPause} title="Play/Pause">{isPlaying ? '⏸' : '▶'}</button>
        <button style={loopEnabled ? activeIconBtn : iconBtn} onClick={() => setLoopEnabled((v) => !v)} title="Loop">&#8635;</button>
        <button style={mutedBtn(!hasNotes)} disabled={!hasNotes} onClick={handleExportMulti}>&#8595; Multi-track .mid</button>
        <button style={mutedBtn(!hasNotes)} disabled={!hasNotes} onClick={handleExportZip}>&#8595; Layers .zip</button>
      </div>

      {/* Generate panel (52px) */}
      <div style={{ height: 52, flexShrink: 0, background: PANEL, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, overflowX: 'auto' }}>
        <Sel value={key} onChange={setKey} options={KEYS} label="Key" />
        <Sel value={scale} onChange={setScale} options={SCALES} label="Scale" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase' }}>Bars</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {BAR_OPTIONS.map((b) => (
              <button key={b} onClick={() => setLoopBars(b)} style={{ ...btnBase, padding: '2px 7px', background: loopBars === b ? ACCENT : SURFACE, color: loopBars === b ? '#fff' : TEXT, border: `1px solid ${loopBars === b ? ACCENT : BORDER}`, fontSize: 11 }}>{b}</button>
            ))}
          </div>
        </div>
        <Sel value={mood} onChange={setMood} options={MOODS} label="Mood" />
        <button style={accentBtn} onClick={handleGenerate} disabled={generating}>
          {generating ? <><WaveformLoader /><span>Generating...</span></> : '✦ Generate'}
        </button>
        {loop && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{loop.key} {loop.scale} · {loop.bars} bars · {loop.bpm} BPM · {loop.mood}</span>}
      </div>

      {/* Progression panel (80px) */}
      <div style={{ height: 80, flexShrink: 0, background: PANEL, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', padding: '4px 8px', gap: 4, overflowX: 'auto' }}>
        {loop
          ? loop.chords.map((chord, i) => <BarCard key={i} barIndex={i} chord={chord} notes={notes} isModified={isBarModified(i)} />)
          : <span style={{ fontSize: 12, color: MUTED, padding: '0 4px' }}>No loop generated yet. Press Generate above.</span>
        }
      </div>

      {/* Piano Roll (flex 1) */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <DAWPianoRoll loop={loop} notes={notes} playheadTick={playheadTick} isPlaying={isPlaying} onNotesChange={setNotes} />
      </div>

      {/* Status bar (24px) */}
      <div style={{ height: 24, flexShrink: 0, background: SURFACE, borderTop: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 11, color: MUTED, gap: 8 }}>
        <span>{statusText}</span>
        {notes.length > 0 && <span>{notes.length} notes · melody:{notes.filter((n) => n.layer === 'melody').length} chords:{notes.filter((n) => n.layer === 'chords').length} bass:{notes.filter((n) => n.layer === 'bass').length}</span>}
        <span style={{ marginLeft: 'auto', color: '#333', fontSize: 10 }}>Left-click=place · drag body=move · drag edge=resize · right-click=delete · Ctrl+Z/Y=undo/redo</span>
      </div>
    </div>
  );
}
