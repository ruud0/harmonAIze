# harmonAIze

Generate a musical loop in a chosen key and mood, edit it in a DAW-style piano
roll, and export it as MIDI stems your DAW can open.

![demo](docs/demo.gif)

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
- **Works without an API key.** With `ANTHROPIC_API_KEY` set, generation goes
  through Claude. Without it, the server falls back to a local music-theory
  generator that builds a diatonic progression with triad voicings, a bass
  pulse, and a scale-tone melodic figure. Same response shape, no network call.

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

Requires a Node process at runtime; it is not a static site.

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

Not built yet: the MIDI-upload path — importing an existing melody and
harmonising it, rather than generating from parameters. Scaffolding for it
exists in the component tree but is not wired to the app.
