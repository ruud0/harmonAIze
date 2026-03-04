/**
 * ExportPanel — Export harmonized MIDI and save/load session
 * Design: Spectral / Frequency-Space Minimalism
 */

import React, { useState, useCallback } from "react";
import { Download, Save, FolderOpen, CheckCircle2, Loader2 } from "lucide-react";
import type { Session } from "@/lib/types";
import { exportMidi, downloadSession, deserializeSession } from "@/lib/midiExporter";

interface ExportPanelProps {
  session: Session;
  onSessionLoad: (session: Session) => void;
}

export default function ExportPanel({ session, onSessionLoad }: ExportPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportMidi(session);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = session.sourceFile.replace(/\.(mid|midi)$/i, "");
      a.download = `${baseName}-harmony.mid`;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. See console for details.");
    } finally {
      setExporting(false);
    }
  }, [session]);

  const handleSaveSession = useCallback(() => {
    downloadSession(session);
  }, [session]);

  const handleLoadSession = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const loaded = deserializeSession(ev.target?.result as string);
          onSessionLoad(loaded);
        } catch {
          alert("Invalid session file.");
        }
      };
      reader.readAsText(file);
    },
    [onSessionLoad]
  );

  // Count selected options
  const selectionCount = Object.keys(session.selectedOptions).length;
  const phraseCount = session.phrases.length;

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/70">Export</h3>
        <span className="text-xs font-mono text-white/30">
          {selectionCount}/{phraseCount} phrases selected
        </span>
      </div>

      {/* Selection summary */}
      <div className="flex flex-wrap gap-2">
        {session.phrases.map((phrase) => {
          const sel = session.selectedOptions[phrase.phraseId];
          const phraseNum = parseInt(phrase.phraseId.replace("phrase_", "")) + 1;
          const modeColors: Record<string, string> = {
            bright: "#22D3EE",
            dark: "#A78BFA",
            calm: "#34D399",
            tense: "#FB7185",
          };
          const color = sel ? modeColors[sel.mode] : "rgba(255,255,255,0.15)";
          return (
            <div
              key={phrase.phraseId}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono"
              style={{
                background: sel ? `${color}15` : "rgba(255,255,255,0.04)",
                border: `1px solid ${sel ? color + "30" : "rgba(255,255,255,0.06)"}`,
                color: sel ? color : "rgba(255,255,255,0.3)",
              }}
            >
              P{phraseNum}
              {sel && (
                <span className="opacity-60">
                  {sel.mode[0].toUpperCase()}/{sel.option}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Export buttons */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-semibold text-sm transition-all duration-150"
          style={{
            background: exported
              ? "rgba(52,211,153,0.15)"
              : "rgba(34,211,238,0.12)",
            border: `1px solid ${exported ? "#34D39940" : "#22D3EE40"}`,
            color: exported ? "#34D399" : "#22D3EE",
          }}
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : exported ? (
            <CheckCircle2 size={16} />
          ) : (
            <Download size={16} />
          )}
          {exporting
            ? "Exporting..."
            : exported
            ? "Downloaded!"
            : "Export Harmonized MIDI"}
        </button>

        <div className="flex gap-2">
          <button
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors border border-white/6 hover:border-white/12"
            onClick={handleSaveSession}
          >
            <Save size={12} />
            Save Session
          </button>
          <label className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors border border-white/6 hover:border-white/12 cursor-pointer">
            <FolderOpen size={12} />
            Load Session
            <input
              type="file"
              accept=".json"
              className="sr-only"
              onChange={handleLoadSession}
            />
          </label>
        </div>
      </div>

      <p className="text-xs text-white/20 font-mono">
        Output: melody + chord + bass tracks · {session.midiMeta?.tempos[0]?.bpm ?? 120} BPM
      </p>
    </div>
  );
}
