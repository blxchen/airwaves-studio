# Riffbox

A local, offline tab player for your own Guitar Pro files, built on a custom engine: its own file parsers, renderer and synthesizer, with no third-party music libraries. Everything is unlocked, and there are no accounts or network calls.

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints. For a production build: `npm run build && npm run preview`.

## Features

- **Opens** Guitar Pro 3, 4, 5, 6 (`.gpx`) and 7/8 (`.gp`) files.
- **Library** stored in IndexedDB on your device, with drag-and-drop import, search, favorites and recently played.
- **Tab view:** tab staves and drum notation; rhythm stems, beams, dots and tuplets; repeats, alternate endings, section markers, tempo changes and time-signature changes.
- **Notation effects:** bends and releases, slides, hammer-ons and pull-offs, vibrato, palm mute, let ring, harmonics, dead and ghost notes, and ties.
- **Playback:**
  - a cursor that follows along and highlights the current notes, with auto-scroll
  - click a note to jump to it
  - speed from 25–200% without changing pitch
  - loop selected bars (drag across them) or the current bar (`L`)
  - count-in and metronome
- **Tracks sidebar:** switch tracks, plus mute, solo and volume for each track. Settings are remembered per song.
- **Instrument changes partway through a track** (for example, clean verse → distorted chorus). They're read from Guitar Pro files, shown as "♪ Instrument" labels in the tab, played back, and can be added in the editor.
- **Purple tracker:** glides continuously with the audio clock (allowing for output latency and swing feel) and lands exactly on every note.
- **Dynamics:** ppp–fff markings, crescendo/decrescendo wedges (which also play back), accents, staccato, and ghost notes.
- **Tone per track** (the **Tone** / **Kit** button next to each track):
  - Guitar: 20 styles (punk, pop-punk, metal, djent, grunge, rock, blues, jazz, funk, indie, shoegaze, country, acoustic…), amp knobs (gain, tight, bass, mids, treble, presence, tone, reverb), a speaker cabinet, and pedals (compressor, overdrive/distortion/fuzz, chorus, delay).
  - Bass: styles plus grit, EQ, compressor and a drive pedal.
  - Drums: 14 styles across 11 kits, punch, room and EQ. Each piece (kick, snare, hi-hat, toms, cymbals) has its own level, tuning and decay, can borrow its sound from another kit, or can use a sample you load from your own library.
- **Fullscreen** (Shift+F) and a collapsible track list.
- **Tab editor** (press `E`, or **Edit**):
  - click a string position to place the caret, type frets (two digits quickly for 10–24), and move with the arrow keys
  - one-key note effects: palm mute, let ring, vibrato, hammer-on, slide, bend, dead and ghost notes
  - durations, dots, triplets and rests; bars fill themselves with rests, and overfilled bars are flagged
  - bar settings: time signature, tempo, section names, repeats and endings
  - tracks: add guitar, bass or drum tracks, set the instrument, tuning and capo, and insert instrument changes
  - dynamics and crescendo/decrescendo
  - undo/redo, **Save** (`Ctrl+S`, lossless), and **Export** as `.gp5`
- **New tab:** start a blank tab from the library.
- **Extras:** a live fretboard, zoom, and keyboard shortcuts (press `?` in the player).

## Engine layout (`src/engine`)

| Path | What it does |
| --- | --- |
| `model.ts` | Score data model (ticks: 960 per quarter note) |
| `io/gp345.ts` | Guitar Pro 3/4/5 binary reader |
| `io/containers.ts` | ZIP reader (GP7/8) and BCFZ/BCFS reader (GP6) |
| `io/xml.ts`, `io/gpif.ts` | XML parser and GPIF score reader (GP6–8) |
| `timing.ts` | Repeat/ending play order and the tempo map |
| `audio/sf2.ts` | SoundFont 2 parser |
| `audio/synth.ts` | Web Audio sample voices: envelopes, pitch automation, filters, track buses |
| `audio/sequence.ts` | Score → note events: ties, bends, slides, harmonics, trills, swing, strums |
| `audio/player.ts` | Look-ahead scheduler, speed, looping, metronome and count-in |
| `audio/tone.ts` | Tone presets and the per-track amp/pedal/kit effects chain |
| `edit.ts` | Editing operations (notes, rhythm, bars, tracks, instrument changes) |
| `io/gp5writer.ts` | Guitar Pro 5 writer, used for saving and export |
| `render/layout.ts`, `render/TabSheet.tsx` | Line breaking and SVG drawing |

## Tests and fixtures

`npm test` parses every file in `fixtures/`, checks the decoded song (metadata, tempo, repeats, instrument changes, effects, drum keys, bar lengths, play order and the tempo map), then writes it as GP5, reads it back, and runs the same checks again.

The fixtures, and the bundled demo song "Night Drive" (an original composition), come from `scripts/make_fixtures.py` (`npm run fixtures`). It needs `pip install pyguitarpro` for the GP3–5 output; the GP6/GP7 output is written by the script itself.

## Credits

The instrument sounds are GeneralUser GS v2.0.3 by S. Christian Collins, which is free to use and bundle (see `public/soundfont/GeneralUser-GS-LICENSE.txt`).
