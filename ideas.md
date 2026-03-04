# Harmony Enhancement MVP — Design Brainstorm

## Context
A professional music tool: MIDI upload → key detection → phrase segmentation → harmonic generation (4 modes × 3 options per phrase) → per-phrase audition → MIDI export. The user is a musician/producer, not a casual consumer. The UI must feel like a serious DAW-adjacent tool.

---

<response>
<text>
## Idea 1 — Dark Studio / Waveform Brutalism
**Design Movement:** Industrial Brutalism meets Pro Audio UI (think Ableton Live + Figma dark mode)
**Core Principles:**
- Raw, functional aesthetics with zero decorative noise
- High-contrast dark surfaces with sharp typographic hierarchy
- Data-dense layouts that respect the musician's workflow
- Every element earns its place — no padding for padding's sake

**Color Philosophy:** Near-black (#0D0D0F) background with cool-gray panels. A single electric amber (#F5A623) as the only accent — used exclusively for active states, progress, and key indicators. Danger in deep red. Success in muted green. The palette communicates state, not decoration.

**Layout Paradigm:** Three-column asymmetric layout: narrow left rail (file/session info), wide center (phrase timeline + piano roll preview), right panel (chord options per phrase). The timeline is the hero — everything else is subordinate.

**Signature Elements:**
- Waveform/grid visualization of the melody across the top
- Monospaced labels for bar numbers, chord symbols, MIDI note values
- Thin horizontal dividers instead of card borders

**Interaction Philosophy:** Every action has an immediate visual echo. Hover states are subtle (brightness +10%). Active states are bold (amber glow). No modal dialogs — everything inline.

**Animation:** Micro-transitions only. 150ms ease-out for panel reveals. No bouncy springs. Progress bars fill linearly. The tool should feel fast, not playful.

**Typography System:** `JetBrains Mono` for all data labels, chord symbols, bar numbers. `DM Sans` for UI labels and headings. No serif. Tight letter-spacing on headings.
</text>
<probability>0.07</probability>
</response>

<response>
<text>
## Idea 2 — Manuscript Paper / Analog Warmth
**Design Movement:** Swiss Modernism filtered through analog music notation — sheet music meets Bauhaus
**Core Principles:**
- Warm off-white surfaces evoking manuscript paper
- Musical notation as a visual language (staff lines, clef-inspired dividers)
- Structured grid with deliberate asymmetry at the macro level
- Tactile feel — paper texture, ink-weight typography

**Color Philosophy:** Warm cream (#FAF7F0) background with deep charcoal (#1C1917) text. Burgundy (#8B1A1A) as the primary accent — the color of a conductor's marking pen. Pale sage (#C8D5B9) for secondary highlights. The palette evokes a handwritten score.

**Layout Paradigm:** Horizontal scrolling phrase timeline (like a musical score reading left to right). Each phrase is a "measure" card. The right side docks the chord option panel. Top bar shows key signature and tempo — styled like a score header.

**Signature Elements:**
- Subtle horizontal staff lines as background texture in the timeline area
- Chord symbols rendered in a music-notation-inspired typeface
- Phrase cards with rounded top corners only (like notation brackets)

**Interaction Philosophy:** Selections feel like pencil marks — immediate, precise. Auditioning a chord option plays a brief animation of "notes appearing on the staff." Export feels like "printing the score."

**Animation:** Gentle fade-ins (200ms). Selected options get a soft underline that draws in from left. Processing states use a metronome-tick pulse.

**Typography System:** `Playfair Display` for headings and key/mode labels. `IBM Plex Mono` for chord symbols and bar numbers. `Source Serif 4` for body text. The mix of serif display + mono data creates a music-theory-textbook feel.
</text>
<probability>0.06</probability>
</response>

<response>
<text>
## Idea 3 — Spectral / Frequency-Space Minimalism
**Design Movement:** Scientific visualization meets minimal product design — oscilloscope aesthetics, frequency spectrum UI
**Core Principles:**
- Deep navy-to-black gradient as the primary surface (space-like depth)
- Data visualization IS the design — the melody grid, phrase blocks, and chord options are the visual content
- Neon accent colors mapped to emotional modes (bright = cyan, dark = violet, calm = teal, tense = coral)
- Generous negative space with precise, tight data clusters

**Color Philosophy:** Background: near-black navy (#080C14). Surface: dark blue-gray (#111827). Each emotional mode gets its own spectral color: Bright → #22D3EE (cyan), Dark → #A78BFA (violet), Calm → #34D399 (teal), Tense → #FB7185 (coral). White text only. The mode colors are the entire palette — everything else is grayscale.

**Layout Paradigm:** Full-width top section shows the melody as a pitch-height timeline (dots on a grid, like a piano roll). Below, phrase cards expand vertically. The mode selector is a horizontal tab row with colored underlines. The three options (A/B/C) are side-by-side columns within each phrase card.

**Signature Elements:**
- Pitch-grid melody visualization (dots at MIDI pitch height × time position)
- Mode-colored glow on selected chord options
- Thin vertical bar markers for phrase boundaries

**Interaction Philosophy:** The tool rewards exploration. Hovering a chord option previews its color-coded voicing in the melody grid. Selecting locks it with a satisfying glow pulse. The emotional mode tabs shift the entire color temperature of the UI.

**Animation:** Chord options fade in with a 250ms stagger. Mode switching triggers a smooth color transition across all accents (300ms). Processing uses a scanning-line animation across the melody grid.

**Typography System:** `Space Grotesk` for all UI labels (geometric, technical). `Space Mono` for chord symbols and MIDI data. The Space family keeps the sci-fi/spectral aesthetic consistent.
</text>
<probability>0.09</probability>
</response>

---

## Selected Design: **Idea 3 — Spectral / Frequency-Space Minimalism**

**Rationale:** The mode-color system is architecturally aligned with the product's core feature (4 emotional modes). The pitch-grid visualization makes the melody tangible. The dark background reduces eye fatigue for long sessions. The Space typography family is distinctive without being decorative.
