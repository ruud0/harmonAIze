/**
 * PhraseCard — Per-phrase chord option selector
 * Design: Spectral / Frequency-Space Minimalism
 * Shows 4 mode tabs × 3 options (A/B/C) with chord symbols, scores, and play button.
 */

import React, { useState, useCallback } from "react";
import { Play, Square, Music2, Zap, Moon, Wind } from "lucide-react";
import type {
  Phrase,
  PhraseHarmony,
  EmotionalMode,
  OptionKey,
  ChordEvent,
} from "@/lib/types";
import { MODE_COLORS, MODE_LABELS } from "@/lib/types";
import type { ChordQuality } from "@/lib/types";
import { playChordProgression, stopPlayback } from "@/lib/audioPlayer";

interface PhraseCardProps {
  phrase: Phrase;
  harmonyByMode: {
    bright: PhraseHarmony | undefined;
    dark: PhraseHarmony | undefined;
    calm: PhraseHarmony | undefined;
    tense: PhraseHarmony | undefined;
  };
  currentSelection: { mode: EmotionalMode; option: OptionKey };
  isSelected: boolean;
  bpm: number;
  showChordNames: boolean; // true = "Fm7", false = "im7"
  onSelectionChange: (phraseId: string, mode: EmotionalMode, option: OptionKey) => void;
  onClick: () => void;
}

const MODE_ICONS: Record<EmotionalMode, React.ReactNode> = {
  bright: <Zap size={12} />,
  dark: <Moon size={12} />,
  calm: <Wind size={12} />,
  tense: <Music2 size={12} />,
};

const MODES: EmotionalMode[] = ["bright", "dark", "calm", "tense"];
const OPTIONS: OptionKey[] = ["A", "B", "C"];

function qualityToSuffix(q: ChordQuality): string {
  switch (q) {
    case "major": return "";
    case "minor": return "m";
    case "diminished": return "°";
    case "augmented": return "+";
    case "dominant7": return "7";
    case "major7": return "maj7";
    case "minor7": return "m7";
    case "halfDim7": return "ø7";
    case "dim7": return "°7";
    case "sus2": return "sus2";
    case "sus4": return "sus4";
    case "add9": return "add9";
    case "major9": return "maj9";
    case "minor9": return "m9";
    default: return "";
  }
}

function formatChordLabel(chord: ChordEvent, showChordNames: boolean): string {
  if (showChordNames) {
    return chord.root + qualityToSuffix(chord.quality);
  }
  // Roman numeral + quality suffix
  const suffix = qualityToSuffix(chord.quality);
  return chord.degreeLabel + suffix;
}

export default function PhraseCard({
  phrase,
  harmonyByMode,
  currentSelection,
  isSelected,
  bpm,
  showChordNames,
  onSelectionChange,
  onClick,
}: PhraseCardProps) {
  const [activeMode, setActiveMode] = useState<EmotionalMode>(currentSelection.mode);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingOption, setPlayingOption] = useState<OptionKey | null>(null);
  const [activeChordIdx, setActiveChordIdx] = useState<number>(-1);

  const phraseNum = parseInt(phrase.phraseId.replace("phrase_", "")) + 1;
  const modeColor = MODE_COLORS[activeMode];
  const currentHarmony = harmonyByMode[activeMode];

  const handlePlay = useCallback(
    async (option: OptionKey) => {
      if (isPlaying && playingOption === option) {
        stopPlayback();
        setIsPlaying(false);
        setPlayingOption(null);
        setActiveChordIdx(-1);
        return;
      }

      stopPlayback();
      const chords = currentHarmony?.options[option]?.chords;
      if (!chords || chords.length === 0) return;

      setIsPlaying(true);
      setPlayingOption(option);
      setActiveChordIdx(0);

      try {
        await playChordProgression(chords, bpm, (idx) => {
          setActiveChordIdx(idx);
        });
      } finally {
        setIsPlaying(false);
        setPlayingOption(null);
        setActiveChordIdx(-1);
      }
    },
    [isPlaying, playingOption, currentHarmony, bpm]
  );

  const handleSelect = useCallback(
    (option: OptionKey) => {
      onSelectionChange(phrase.phraseId, activeMode, option);
    },
    [phrase.phraseId, activeMode, onSelectionChange]
  );

  const isOptionSelected = (option: OptionKey) =>
    currentSelection.mode === activeMode && currentSelection.option === option;

  return (
    <div
      className={`phrase-card rounded-xl overflow-hidden transition-all duration-200 ${
        isSelected ? `mode-glow-${activeMode}` : ""
      }`}
      style={{
        borderColor: isSelected ? `${modeColor}40` : undefined,
        borderWidth: isSelected ? "1.5px" : "1px",
      }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-xs font-bold px-2 py-0.5 rounded"
            style={{
              background: `${modeColor}20`,
              color: modeColor,
              fontFamily: "Space Mono, monospace",
            }}
          >
            P{phraseNum}
          </span>
          <span className="text-xs text-white/40 font-mono">
            bars {phrase.startBar}–{phrase.endBar}
          </span>
          {phrase.peakFlag && (
            <span className="text-xs px-1.5 py-0.5 rounded text-amber-400 bg-amber-400/10">
              peak
            </span>
          )}
          {phrase.cadenceFlag && (
            <span className="text-xs px-1.5 py-0.5 rounded text-white/40 bg-white/5">
              cadence
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-white/30 font-mono">
          <span>E {Math.round(phrase.energyScore * 100)}%</span>
          <span>·</span>
          <span>D {Math.round(phrase.densityScore * 100)}%</span>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex border-b border-white/5">
        {MODES.map((mode) => {
          const color = MODE_COLORS[mode];
          const isActive = activeMode === mode;
          const isCurrentlySelected = currentSelection.mode === mode;
          return (
            <button
              key={mode}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all duration-150"
              style={{
                color: isActive ? color : "rgba(255,255,255,0.3)",
                borderBottom: isActive ? `2px solid ${color}` : "2px solid transparent",
                background: isActive ? `${color}08` : "transparent",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setActiveMode(mode);
              }}
            >
              <span style={{ color: isActive ? color : "rgba(255,255,255,0.3)" }}>
                {MODE_ICONS[mode]}
              </span>
              {MODE_LABELS[mode]}
              {isCurrentlySelected && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: color }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Options A / B / C */}
      <div className="p-3 grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const optionData = currentHarmony?.options[option];
          const selected = isOptionSelected(option);
          const playing = isPlaying && playingOption === option;

          return (
            <div
              key={option}
              className={`option-btn rounded-lg p-3 flex flex-col gap-2 ${
                selected ? "selected" : ""
              }`}
              style={{
                borderColor: selected ? modeColor : undefined,
                background: selected ? `${modeColor}10` : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(option);
              }}
            >
              {/* Option header */}
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-bold font-mono"
                  style={{
                    color: selected ? modeColor : "rgba(255,255,255,0.5)",
                    fontFamily: "Space Mono, monospace",
                  }}
                >
                  {option}
                </span>
                <span className="text-xs text-white/30">
                  {optionData?.label}
                </span>
              </div>

              {/* Chord symbols */}
              {optionData && (
                <div className="flex flex-wrap gap-1">
                  {optionData.chords.slice(0, 4).map((chord, i) => (
                    <span
                      key={i}
                      className="text-xs px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background:
                          playing && activeChordIdx === i
                            ? `${modeColor}30`
                            : "rgba(255,255,255,0.06)",
                        color:
                          playing && activeChordIdx === i
                            ? modeColor
                            : "rgba(255,255,255,0.7)",
                        fontFamily: "Space Mono, monospace",
                        fontSize: "10px",
                        transition: "all 150ms ease",
                      }}
                    >
                      {formatChordLabel(chord, showChordNames)}
                    </span>
                  ))}
                </div>
              )}

              {/* Scores */}
              {optionData && (
                <div className="flex gap-2 text-xs text-white/25 font-mono" style={{ fontSize: "9px" }}>
                  <span>VL {Math.round(optionData.voiceLeadingScore * 100)}</span>
                  <span>·</span>
                  <span>C {Math.round(optionData.consonanceScore * 100)}</span>
                </div>
              )}

              {/* Play button */}
              <button
                className="mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-xs transition-all duration-150"
                style={{
                  background: playing ? `${modeColor}20` : "rgba(255,255,255,0.04)",
                  color: playing ? modeColor : "rgba(255,255,255,0.4)",
                  border: `1px solid ${playing ? modeColor + "40" : "transparent"}`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlay(option);
                }}
              >
                {playing ? <Square size={10} /> : <Play size={10} />}
                <span>{playing ? "Stop" : "Play"}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
