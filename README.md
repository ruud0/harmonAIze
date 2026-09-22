# harmonAIze

Generate a musical loop in a chosen key and mood, edit it in a DAW-style piano
roll, and export it as MIDI stems your DAW can open.

### ▶ [Open the live demo](https://ruud0.github.io/harmonAIze/)

Runs entirely in the browser — no install, no sign-in, no API key. Pick a key
and mood, hit generate, edit the notes in the piano roll, and export a real
`.mid` file. The hosted build has no server behind it, so generation uses the
local music-theory generator described below.

## What it does

Pick a key, scale, mood, length (2–16 bars) and tempo. The generator returns a
three-layer arrangement — **melody, chords, and bass** — which you can audition
in the browser and then take into a real project.

- **Piano-roll editor.** A dark, DAW-adjacent grid with a moving playhead, so
  you can see the arrangement rather than just hear it.
- **Live playback.** Tone.js drives three separate voices — a polyphonic chord
  synth, a melody synth, and a monophonic bass — with loop toggling.
- **Two export paths.** A single multi-track `.mid`, or a `.zip` containing
  `melody.mid`, `chords.mid`, and `bass.mid` as separate files, so each layer
  lands on its own DAW track.
- **Works without an API key, or without a server at all.** With
  `ANTHROPIC_API_KEY` set, generation goes through Claude. Without it, the same
  local music-theory generator runs instead — a diatonic progression with triad
  voicings, a bass pulse, and a scale-tone melodic figure over nine scale modes.
  It lives in `client/src/lib/localGenerator.ts` and runs client-side, so the
  static build above needs no backend; `lib/generateLoop.ts` tries the API first
  and falls back to it.

## Why I built it

Loop generators tend to hand you audio you cannot take apart. I wanted the
output to be *editable material* rather than a finished bounce — separable
layers, real MIDI, and a piano roll to fix the notes the generator got wrong.
The fallback generator exists for the same reason: the tool should still be
useful when the model is unavailable, so the music theory is implemented
properly rather than delegated entirely to a prompt.

## Stack

**Client** — React 18, TypeScript, Vite, Tailwind, shadcn/ui, wouter for
routing, Tone.js for audio, JSZip for stem bundling.
**Server** — Express, the Anthropic SDK, with a deterministic local generator as
fallback. Built with esbuild to a single ESM bundle.

## Run it

```sh
git clone https://github.com/ruud0/harmonAIze.git
cd harmonAIze
pnpm install          # or: npm install

pnpm dev              # Vite dev server
```

For the generator, optionally:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Leave it unset and the local fallback generator runs instead — the app is fully
usable either way.

Production build:

```sh
pnpm build            # vite build + esbuild bundle of the server
pnpm start            # serves the built client from the Express server
```

That path requires a Node process at runtime. The client can also be built
standalone — `VITE_BASE=/harmonAIze/ pnpm exec vite build` — which is what the
Pages workflow deploys: same app, local generator only, no backend.

## Layout

```
client/src/pages/Home.tsx          controls, generation, export
client/src/components/DAWPianoRoll.tsx   piano-roll grid and playhead
client/src/lib/audioPlayer.ts      Tone.js playback for the three layers
client/src/lib/harmonaizeMidi.ts   MIDI writing and multi-track export
server/index.ts                    /api/generate, Claude call, local fallback
```

## Status

Working: generation, playback, piano-roll display, and both export paths.

Built but not wired up: a full MIDI-upload harmonisation path. `client/src/lib/`
holds a MIDI parser, a key detector, a phrase segmenter, a chord engine, and a
voice-leading module (~1,600 lines), with the UI for it — upload zone, phrase
cards, a second piano-roll editor — in `client/src/components/` (~2,600 lines).
The current Home page uses the parameter-driven generator instead, so none of
that pipeline is reachable from the running app.
