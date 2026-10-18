// Parser regression test: every fixture must decode to the same song.
// Run: npm test
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadSong, setInflate } from '../src/engine/io/load';
import { writeGp5 } from '../src/engine/io/gp5writer';
import { writeGp5 } from '../src/engine/io/gp5writer';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Song } from '../src/engine/model';
import { playOrder, TempoMap } from '../src/engine/timing';

setInflate(async (data) => new Uint8Array(inflateRawSync(data)));

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function summary(song: Song) {
  const t0 = song.tracks[0];
  const lead = song.tracks[1];
  const notes = (t: number, m: number) => song.tracks[t].measures[m].voices[0].beats.map((b) => b.notes.map((n) => `${n.fret}.${n.string}`).join('+') || 'r').join(' ');
  return { t0, lead, notes };
}

async function main() {
  const dir = join(process.cwd(), 'fixtures');
  for (const file of readdirSync(dir)) {
    const bytes = new Uint8Array(readFileSync(join(dir, file)));
    console.log(file);
    let parsed: Song;
    try {
      parsed = await loadSong(file, bytes);
    } catch (e) {
      failures++;
      console.log('  FAIL parse', e);
      continue;
    }
    runChecks(file, parsed);
    // Round trip: write as GP5, read it back, and run the same checks.
    const written = writeGp5(parsed);
    mkdirSync(join(process.cwd(), 'tests', '.out'), { recursive: true });
    writeFileSync(join(process.cwd(), 'tests', '.out', `${file}.roundtrip.gp5`), written);
    console.log(`${file} -> gp5`);
    runChecks(file, await loadSong('roundtrip.gp5', written));
  }
  console.log(failures ? `\n${failures} failure(s)` : '\nAll parser checks passed');
  process.exit(failures ? 1 : 0);
}

function runChecks(label: string, song: Song) {
    const { t0, lead, notes } = summary(song);
    check('title', song.title === 'Night Drive', song.title);
    check('artist', song.artist === 'Riffbox', song.artist);
    check('tempo', song.tempo === 112, String(song.tempo));
    check('tempo change', song.tempoChanges.some((t) => t.measure === 4 && t.bpm === 120), JSON.stringify(song.tempoChanges));
    check('tracks', song.tracks.map((t) => t.name).join('|') === 'Rhythm Guitar|Lead Guitar|Bass|Drums', song.tracks.map((t) => t.name).join('|'));
    check('measures', song.measures.length === 14, String(song.measures.length));
    check('programs', song.tracks.map((t) => t.program).join(',') === '30,29,33,0', song.tracks.map((t) => t.program).join(','));
    check('instrument change', JSON.stringify(t0.instrumentChanges) === JSON.stringify([{ measure: 8, tick: 0, program: 27 }]), JSON.stringify(t0.instrumentChanges));
    check('drums flagged', song.tracks[3].isPercussion && !t0.isPercussion);
    check('tuning', t0.tuning.join(',') === '64,59,55,50,45,40', t0.tuning.join(','));
    check('bass tuning', song.tracks[2].tuning.join(',') === '43,38,33,28', song.tracks[2].tuning.join(','));
    check('repeat', song.measures[0].repeatOpen && song.measures[2].repeatClose === 2, JSON.stringify(song.measures.slice(0, 3).map((m) => [m.repeatOpen, m.repeatClose])));
    check('alt endings', song.measures[2].alternateEndings === 1 && song.measures[3].alternateEndings === 2, `${song.measures[2].alternateEndings} ${song.measures[3].alternateEndings}`);
    check('markers', song.measures[0].marker === 'Intro' && song.measures[8].marker === 'Solo', `${song.measures[0].marker} ${song.measures[8].marker}`);
    check('3/4 bar', song.measures[12].numerator === 3 && song.measures[12].length === 2880, `${song.measures[12].numerator}/${song.measures[12].denominator}`);
    check('riff A', notes(0, 0) === '0.5 0.5 3.5 0.5 5.5 0.5 3.5 2.4', notes(0, 0));
    if (!label.startsWith('night-drive.gp3')) check('palm mute', t0.measures[0].voices[0].beats[0].notes[0].palmMute); // GP3 has no palm mute
    check('triplet', t0.measures[6].voices[0].beats[2].tuplet?.enters === 3 && t0.measures[6].voices[0].beats[2].duration === 320);
    check('dead notes', t0.measures[3].voices[0].beats[4].notes.every((n) => n.dead));
    check('lead rests', lead.measures[0].voices[0].beats[0].rest);
    const solo = lead.measures[10].voices[0].beats;
    check('bend', !!solo[4].notes[0].bend && Math.abs(Math.max(...solo[4].notes[0].bend!.map((p) => p.value)) - 2) < 0.01, JSON.stringify(solo[4].notes[0].bend));
    check('tie', solo[5].notes[0].tieDestination && solo[5].notes[0].fret === 10, JSON.stringify(solo[5].notes[0]));
    check('hammer', lead.measures[8].voices[0].beats[1].notes[0].hammer);
    check('slide', !!lead.measures[9].voices[0].beats[1].notes[0].slide?.shift);
    check('vibrato', lead.measures[9].voices[0].beats[2].notes[0].vibrato !== 'none');
    check('harmonic', lead.measures[11].voices[0].beats[3].notes[0].harmonic === 'natural');
    check('drum keys', song.tracks[3].measures[0].voices[0].beats[0].notes.map((n) => n.midi).sort().join(',') === '36,49', JSON.stringify(song.tracks[3].measures[0].voices[0].beats[0].notes.map((n) => n.midi)));
    for (const track of song.tracks) {
      track.measures.forEach((m, i) => {
        const total = m.voices[0].beats.reduce((a, b) => a + b.duration, 0);
        check(`bar length ${track.name} #${i + 1}`, total === song.measures[i].length, `${total} vs ${song.measures[i].length}`);
      });
    }
}

main();
