/**
 * UploadZone — MIDI file upload with drag-and-drop
 * Design: Spectral / Frequency-Space Minimalism
 */

import React, { useCallback, useState } from "react";
import { Upload, FileMusic } from "lucide-react";

interface UploadZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function UploadZone({ onFile, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(mid|midi)$/i)) {
        alert("Please upload a .mid or .midi file.");
        return;
      }
      onFile(file);
    },
    [onFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <label
      className={`relative flex flex-col items-center justify-center gap-6 rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-200 cursor-pointer ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
      style={{
        borderColor: isDragging ? "#22D3EE" : "rgba(255,255,255,0.1)",
        background: isDragging
          ? "rgba(34,211,238,0.05)"
          : "rgba(255,255,255,0.02)",
        boxShadow: isDragging ? "0 0 32px rgba(34,211,238,0.15)" : undefined,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept=".mid,.midi"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
      />

      {/* Illustration */}
      <div className="relative">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/310519663397687868/GJe4dAS5TJ74c5scPuQ5VR/upload-illustration-7imPLHWcuVPLhCwi6oagqj.webp"
          alt=""
          className="w-24 h-24 object-contain opacity-80"
          style={{
            filter: isDragging
              ? "drop-shadow(0 0 12px rgba(34,211,238,0.6))"
              : "drop-shadow(0 0 8px rgba(34,211,238,0.3))",
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-lg font-semibold text-white/80">
          Drop your melody MIDI here
        </p>
        <p className="text-sm text-white/40">
          or click to browse — .mid / .midi files only
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs text-white/25 font-mono">
        <span>4/4 time signature</span>
        <span>·</span>
        <span>Melody track auto-detected</span>
        <span>·</span>
        <span>All keys supported</span>
      </div>
    </label>
  );
}
