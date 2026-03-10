/**
 * Harmony Enhancement MVP — Main Page
 * Design: Spectral / Frequency-Space Minimalism
 *
 * Layout: Left rail (upload/key/export) | Center (melody grid + phrase cards)
 * Single Session object flows through all stages.
 */

import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { Music2, RefreshCw, ChevronRight } from "lucide-react";
import type { Session, EmotionalMode, OptionKey } from "@/lib/types";
import { runPipeline, updateSelection } from "@/lib/pipeline";
import UploadZone from "@/components/UploadZone";
import PianoRoll from "@/components/PianoRoll";
import PhraseCard from "@/components/PhraseCard";
import KeyDisplay from "@/components/KeyDisplay";
import ExportPanel from "@/components/ExportPanel";
import ProcessingStatus from "@/components/ProcessingStatus";
import PianoRollEditor from "@/components/PianoRollEditor";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [pipelineStage, setPipelineStage] = useState<Session["pipelineStage"]>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null);
  const [showPianoRollEditor, setShowPianoRollEditor] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setSession(null);
    setSelectedPhraseId(null);

    try {
      const result = await runPipeline(file, (stage, message) => {
        setPipelineStage(stage);
        setStageMessage(message);
      });

      if (result.pipelineStage === "error") {
        toast.error(result.errorMessage ?? "Processing failed.");
        setPipelineStage("idle");
        return;
      }

      setSession(result);
      // Auto-select first phrase
      if (result.phrases.length > 0) {
        setSelectedPhraseId(result.phrases[0].phraseId);
      }
      toast.success(`Processed ${result.phrases.length} phrases in ${result.detectedKey?.root} ${result.detectedKey?.mode}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to process MIDI file.");
      setPipelineStage("idle");
    }
  }, []);

  const handleSelectionChange = useCallback(
    (phraseId: string, mode: EmotionalMode, option: OptionKey) => {
      setSession((prev) => prev ? updateSelection(prev, phraseId, mode, option) : prev);
    },
    []
  );

  const handleSessionLoad = useCallback((loaded: Session) => {
    setSession(loaded);
    if (loaded.phrases.length > 0) {
      setSelectedPhraseId(loaded.phrases[0].phraseId);
    }
    toast.success("Session loaded.");
  }, []);

  const isProcessing =
    pipelineStage !== "idle" &&
    pipelineStage !== "ready" &&
    pipelineStage !== "error";

  const bpm = session?.midiMeta?.tempos[0]?.bpm ?? 120;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#080C14" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/6">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.3)" }}
          >
            <Music2 size={16} style={{ color: "#22D3EE" }} />
          </div>
          <div>
            <span className="font-semibold text-white/90 text-sm tracking-tight">
              Harmony
            </span>
            <span className="ml-2 text-xs text-white/30 font-mono">MVP</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-white/25 font-mono">
          <span>4 modes</span>
          <span>·</span>
          <span>3 options / phrase</span>
          <span>·</span>
          <span>MIDI export</span>
        </div>

        {session && (
          <button
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
            onClick={() => {
              setSession(null);
              setPipelineStage("idle");
              setSelectedPhraseId(null);
            }}
          >
            <RefreshCw size={12} />
            New file
          </button>
        )}
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        <aside className="w-72 flex-shrink-0 border-r border-white/6 flex flex-col overflow-y-auto">
          {/* Hero image strip */}
          <div
            className="h-32 flex-shrink-0 relative overflow-hidden"
            style={{
              backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663397687868/GJe4dAS5TJ74c5scPuQ5VR/hero-bg-AFcsNETiUFMj3tHF4S2ruj.webp)`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(8,12,20,0.3) 0%, rgba(8,12,20,0.85) 100%)",
              }}
            />
            <div className="absolute bottom-3 left-4">
              <p className="text-xs text-white/50 font-mono">
                {session
                  ? session.sourceFile
                  : "Upload a melody MIDI to begin"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 flex-1">
            {/* Key display */}
            {session?.detectedKey && (
              <KeyDisplay
                detectedKey={session.detectedKey}
                totalBars={session.midiMeta?.totalBars ?? 0}
                noteCount={session.melody.length}
                phraseCount={session.phrases.length}
                bpm={bpm}
              />
            )}

            {/* Export panel */}
            {session?.pipelineStage === "ready" && (
              <ExportPanel
                session={session}
                onSessionLoad={handleSessionLoad}
              />
            )}

            {/* Phrase navigator */}
            {session?.phrases && session.phrases.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs text-white/30 font-mono uppercase tracking-widest px-1 mb-1">
                  Phrases
                </h3>
                {session.phrases.map((phrase) => {
                  const sel = session.selectedOptions[phrase.phraseId];
                  const modeColors: Record<string, string> = {
                    bright: "#22D3EE",
                    dark: "#A78BFA",
                    calm: "#34D399",
                    tense: "#FB7185",
                  };
                  const color = sel ? modeColors[sel.mode] : "rgba(255,255,255,0.2)";
                  const phraseNum =
                    parseInt(phrase.phraseId.replace("phrase_", "")) + 1;
                  const isActive = selectedPhraseId === phrase.phraseId;

                  return (
                    <button
                      key={phrase.phraseId}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-150 hover:bg-white/4"
                      style={{
                        background: isActive ? `${color}10` : "transparent",
                        border: `1px solid ${isActive ? color + "30" : "transparent"}`,
                      }}
                      onClick={() => setSelectedPhraseId(phrase.phraseId)}
                    >
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold font-mono flex-shrink-0"
                        style={{
                          background: `${color}20`,
                          color,
                          fontFamily: "Space Mono, monospace",
                        }}
                      >
                        {phraseNum}
                      </span>
                      <span className="text-xs text-white/50 font-mono">
                        bars {phrase.startBar}–{phrase.endBar}
                      </span>
                      {sel && (
                        <span
                          className="ml-auto text-xs font-mono opacity-60"
                          style={{ color }}
                        >
                          {sel.mode[0].toUpperCase()}/{sel.option}
                        </span>
                      )}
                      <ChevronRight
                        size={10}
                        className={`ml-auto transition-opacity ${isActive ? "opacity-60" : "opacity-20"}`}
                        style={{ color }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto flex flex-col">
          {/* Idle state: upload zone */}
          {pipelineStage === "idle" && !session && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-lg">
                <UploadZone onFile={handleFile} />
              </div>
            </div>
          )}

          {/* Processing state */}
          {isProcessing && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-sm">
                <ProcessingStatus
                  stage={pipelineStage}
                  message={stageMessage}
                  filename={session?.sourceFile}
                />
              </div>
            </div>
          )}

          {/* Ready state: melody grid + phrase cards */}
          {session?.pipelineStage === "ready" && (
            <div className="flex flex-col gap-0">
              {/* Melody grid */}
              <div className="px-6 pt-5 pb-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-mono text-white/30 uppercase tracking-widest">
                    Melody — {session.midiMeta?.totalBars} bars
                  </h2>
                  <span className="text-xs font-mono text-white/20">
                    Click a phrase region to focus
                  </span>
                </div>
                <PianoRoll
                  detectedKey={session.detectedKey!}
                  onNotesChange={(updatedNotes) => setSession(prev => prev ? {...prev, melody: updatedNotes} : prev)}
                  notes={session.melody}
                  phrases={session.phrases}
                  totalBars={session.midiMeta?.totalBars ?? 16}
                  selectedPhraseId={selectedPhraseId ?? undefined}
                  activeMode={
                    selectedPhraseId
                      ? session.selectedOptions[selectedPhraseId]?.mode ?? "bright"
                      : "bright"
                  }
                  onPhraseClick={setSelectedPhraseId}
                />
              </div>

              {/* Phrase cards */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-mono text-white/30 uppercase tracking-widest">
                    Harmonic Options — {session.phrases.length} phrases
                  </h2>
                  <span className="text-xs font-mono text-white/20">
                    Select mode + option per phrase, then export
                  </span>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {session.phrases.map((phrase) => {
                    const harmony = {
                      bright: session.harmonicOutput.bright.find(
                        (h) => h.phraseId === phrase.phraseId
                      ),
                      dark: session.harmonicOutput.dark.find(
                        (h) => h.phraseId === phrase.phraseId
                      ),
                      calm: session.harmonicOutput.calm.find(
                        (h) => h.phraseId === phrase.phraseId
                      ),
                      tense: session.harmonicOutput.tense.find(
                        (h) => h.phraseId === phrase.phraseId
                      ),
                    };

                    const sel = session.selectedOptions[phrase.phraseId] ?? {
                      mode: "bright" as EmotionalMode,
                      option: "A" as OptionKey,
                    };

                    return (
                      <div
                        key={phrase.phraseId}
                        className="fade-up"
                        style={{
                          animationDelay: `${parseInt(phrase.phraseId.replace("phrase_", "")) * 50}ms`,
                        }}
                      >
                        <PhraseCard
                          phrase={phrase}
                          harmonyByMode={harmony}
                          currentSelection={sel}
                          isSelected={selectedPhraseId === phrase.phraseId}
                          bpm={bpm}
                          onSelectionChange={handleSelectionChange}
                          onClick={() => setSelectedPhraseId(phrase.phraseId)}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Edit Timings button */}
                <div className="mt-4 flex justify-center">
                  <button
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all"
                    style={{
                      background: showPianoRollEditor
                        ? "rgba(34,211,238,0.15)"
                        : "rgba(255,255,255,0.06)",
                      color: showPianoRollEditor ? "#22D3EE" : "rgba(255,255,255,0.5)",
                      border: `1px solid ${showPianoRollEditor ? "rgba(34,211,238,0.3)" : "rgba(255,255,255,0.1)"}`,
                    }}
                    onClick={() => setShowPianoRollEditor((v) => !v)}
                  >
                    {showPianoRollEditor ? "▲ Hide Timing Editor" : "▼ Edit Timings"}
                  </button>
                </div>
              </div>

              {/* Piano Roll Editor panel */}
              {showPianoRollEditor && (
                <div className="px-6 pb-6">
                  <PianoRollEditor
                    session={session}
                    onSessionUpdate={(updated) => setSession(updated)}
                    onClose={() => setShowPianoRollEditor(false)}
                  />
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
