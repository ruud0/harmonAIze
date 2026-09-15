import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load .env manually (no dotenv dependency needed)
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch { /* .env optional */ }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type LayerName = "melody" | "chords" | "bass";
type GeneratedNote = { bar: number; beat: number; pitch: string; duration: number; layer: LayerName };

const PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};
const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic major": [0, 2, 4, 7, 9],
  "pentatonic minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

function midiToPitchName(midi: number): string {
  const note = PITCHES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function buildFallbackLoop(key: string, scale: string, bars: number) {
  const root = KEY_ROOTS[key] ?? 0;
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.major;
  const triadDegrees = [0, 2, 4];
  const progression = [0, 3, 4, 0]; // I-iv-v-I style motion
  const notes: GeneratedNote[] = [];
  const chords: string[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length] % intervals.length;
    const chordRootPc = (root + intervals[degree]) % 12;
    const chordName = `${PITCHES[chordRootPc]}${scale.includes("minor") || scale === "dorian" || scale === "phrygian" ? "m" : ""}`;
    chords.push(chordName);

    // Chord stabs on beats 0 and 2
    for (const beat of [0, 2]) {
      for (const deg of triadDegrees) {
        const idx = (degree + deg) % intervals.length;
        const midi = 60 + ((root + intervals[idx]) % 12);
        notes.push({ bar, beat, pitch: midiToPitchName(midi), duration: 1, layer: "chords" });
      }
    }

    // Root bass pulse
    notes.push({ bar, beat: 0, pitch: midiToPitchName(36 + chordRootPc), duration: 2, layer: "bass" });
    notes.push({ bar, beat: 2, pitch: midiToPitchName(36 + chordRootPc), duration: 2, layer: "bass" });

    // Simple melodic figure from scale tones
    const melodyDegrees = [0, 1, 2, 4, 2, 1, 0, 4];
    melodyDegrees.forEach((step, i) => {
      const idx = (degree + step) % intervals.length;
      const midi = 72 + ((root + intervals[idx]) % 12);
      notes.push({ bar, beat: i * 0.5, pitch: midiToPitchName(midi), duration: 0.5, layer: "melody" });
    });
  }

  return { chords, notes };
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(cors());
  app.use(express.json());

  // ── POST /api/generate ────────────────────────────────────────────────────
  app.post("/api/generate", async (req, res) => {
    try {
      const { key = "C", scale = "major", bars = 4, mood = "happy", bpm = 120 } = req.body as {
        key: string;
        scale: string;
        bars: number;
        mood: string;
        bpm: number;
      };

      const prompt = `Generate a ${bars}-bar melodic loop in ${key} ${scale} with a ${mood} mood at ${bpm} BPM. Return ONLY raw JSON (no markdown):
{
  "chords": ["one chord name per bar, exactly ${bars} items"],
  "notes": [{ "bar": 0, "beat": 0.0, "pitch": "A4", "duration": 0.5, "layer": "melody" }]
}
Rules: bar 0 to ${bars - 1}, beat 0.0 to 3.75 (in 0.25 increments), duration in quarter notes (0.25=16th, 0.5=8th, 1=quarter, 2=half), layer is melody/chords/bass, 4-8 notes per bar, stay strictly in ${key} ${scale} scale. chords array must have exactly ${bars} items (one per bar).`;

      const requestedBars = Math.max(1, Math.min(16, Number(bars) || 4));
      let parsed: { chords: string[]; notes: GeneratedNote[] };
      if (!process.env.ANTHROPIC_API_KEY) {
        parsed = buildFallbackLoop(key, scale, requestedBars);
      } else {
        try {
          const message = await anthropic.messages.create({
            model: "claude-opus-5",
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
          });

          const text = (message.content[0] as { type: string; text: string }).text.trim();
          // Strip any accidental markdown fences
          const clean = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
          parsed = JSON.parse(clean);
        } catch (apiErr) {
          console.warn("[/api/generate] Falling back to local generator:", apiErr);
          parsed = buildFallbackLoop(key, scale, requestedBars);
        }
      }

      // Validate basic structure
      if (!Array.isArray(parsed.chords) || !Array.isArray(parsed.notes)) {
        throw new Error("Invalid response structure from AI");
      }

      res.json({ ok: true, data: parsed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[/api/generate]", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
