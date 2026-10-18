"""Builds the bundled demo song and parser test fixtures in every supported format.

The song ("Night Drive") is an original composition for this project. It is written
once in a compact notation below and exported as:
  GP3 / GP4 / GP5   via PyGuitarPro (dev-only dependency: pip install pyguitarpro)
  GP7 (.gp)         zip container with a hand-written GPIF document
  GP6 (.gpx)        BCFZ-compressed BCFS container with a GP6-flavoured GPIF document

Usage: python scripts/make_fixtures.py
"""
import io
import os
import re
import struct
import zipfile
from xml.sax.saxutils import escape

import guitarpro as gp

ROOT = os.path.join(os.path.dirname(__file__), '..')
FIXTURES = os.path.join(ROOT, 'fixtures')
DEMO = os.path.join(ROOT, 'public', 'demo')

STANDARD = [64, 59, 55, 50, 45, 40]
BASS = [43, 38, 33, 28]

# ---------------------------------------------------------------------------
# Song definition.
#   :8  set duration (1 2 4 8 16 32), suffix "." dotted, "t" triplet
#   f.s fret on string s (1 = highest), {fx,...} effects, (a b c) chord, r rest
#   effects: pm palm mute, v vibrato, h hammer/pull to next, b100 bend (100 = full),
#            br100 bend + release, sl shift slide to next, si slide in from below,
#            x dead note, nh natural harmonic, lr let ring, t tie, st staccato, ac accent
#   drums: notes are MIDI keys written as k.1 (string is ignored)
# ---------------------------------------------------------------------------

RIFF_A = ':8 0.6{pm} 0.6{pm} 3.6 0.6{pm} 5.6 0.6{pm} 3.6 2.5'
RIFF_B = ':8 0.6{pm} 0.6{pm} 3.6 0.6{pm} 5.6 3.6 2.5 0.5'
RIFF_C = ':8 0.6{pm} 0.6{pm} 3.6 0.6{pm} 5.6 0.6{pm} 7.6{sl} 9.6'
TURN = ':4 (0.6 2.5 2.4) (3.6 5.5 5.4) (5.6 7.5 7.4) :8 (2.5 4.4 4.3) (2.5{x} 4.4{x} 4.3{x})'
EM = ':4 (0.6 2.5 2.4) (0.6 2.5 2.4) :8 (0.6 2.5 2.4) (0.6 2.5 2.4) :4 (0.6 2.5 2.4)'
C5 = ':4 (3.5 5.4 5.3) (3.5 5.4 5.3) :8 (3.5 5.4 5.3) (3.5 5.4 5.3) :4 (3.5 5.4 5.3)'
D5 = ':4 (5.5 7.4 7.3) (5.5 7.4 7.3) :8t (5.5 7.4 7.3) (5.5 7.4 7.3) (5.5 7.4 7.3) :4 (5.5 7.4 7.3)'
B5 = ':4 (2.5 4.4 4.3) (2.5 4.4 4.3) :8 (2.5 4.4 4.3) (2.5 4.4 4.3) :4 (2.5 4.4 4.3)'
END_GTR = ':1 (0.6{lr} 2.5{lr} 2.4{lr} 0.3{lr})'

GROOVE = ':8 (36.1 42.1) 42.1 (38.1 42.1) 42.1 (36.1 42.1) (36.1 42.1) (38.1 42.1) 42.1'
GROOVE_IN = ':8 (36.1 49.1) 42.1 (38.1 42.1) 42.1 (36.1 42.1) (36.1 42.1) (38.1 42.1) 42.1'
FILL = ':8 (36.1 42.1) 42.1 (38.1 42.1) 42.1 :16 38.1 38.1 45.1 45.1 :8 41.1 41.1'
RIDE = ':8 (36.1 51.1) 51.1 (38.1 51.1) 51.1 (36.1 51.1) (36.1 51.1) (38.1 51.1) 51.1'
RIDE_IN = ':8 (36.1 49.1) 51.1 (38.1 51.1) 51.1 (36.1 51.1) (36.1 51.1) (38.1 51.1) 51.1'

MEASURES = [
    # time, repeatOpen, repeatClose (total plays), alternate endings, marker, tempo
    dict(marker='Intro', open=True),
    dict(),
    dict(alt=[1], close=2),
    dict(alt=[2]),
    dict(marker='Verse', tempo=120),
    dict(), dict(), dict(),
    dict(marker='Solo'),
    dict(), dict(), dict(double=True),
    dict(time=(3, 4), marker='Outro'),
    dict(time=(4, 4)),
]

TRACKS = [
    dict(name='Rhythm Guitar', program=30, tuning=STANDARD, bars=[
        RIFF_A, RIFF_B, RIFF_C, TURN, EM, C5, D5, B5, EM, C5, D5, B5,
        ':2. (0.6 2.5 2.4)', END_GTR]),
    dict(name='Lead Guitar', program=29, tuning=STANDARD, bars=[
        ':1 r', ':1 r', ':1 r', ':1 r', ':1 r', ':1 r', ':1 r', ':1 r',
        ':4 9.3 :8 7.3{h} 9.3 :4 8.2 :8 9.3 8.2',
        ':4 10.2 8.2{sl} :2 10.2{v}',
        ':8 10.2 8.2 10.2 7.1 :4 10.1{b100} 10.1{t}',
        ':4 7.1{br100} :8 10.2 9.3{x} :4 12.3{nh} 12.2{nh}',
        ':4 5.2{si} 7.2{st} 5.2{ac}',
        ':1 12.1{v}']),
    dict(name='Bass', program=33, tuning=BASS, bars=[
        ':8 0.4 0.4 0.4 0.4 0.4 0.4 3.4 2.3',
        ':8 0.4 0.4 0.4 0.4 0.4 0.4 3.4 2.3',
        ':8 0.4 0.4 0.4 0.4 0.4 0.4 5.4 3.4',
        ':4 0.4 3.4 5.4 :8 2.3 2.3',
        ':4 0.4 0.4 :8 0.4 0.4 :4 0.4',
        ':4 3.3 3.3 :8 3.3 3.3 :4 3.3',
        ':4 5.3 5.3 :8t 5.3 5.3 5.3 :4 5.3',
        ':4 2.3 2.3 :8 2.3 2.3 :4 2.3',
        ':4 0.4 0.4 :8 0.4 0.4 :4 0.4',
        ':4 3.3 3.3 :8 3.3 3.3 :4 3.3',
        ':4 5.3 5.3 :8 5.3 5.3 :4 5.3',
        ':4 2.3 2.3 :8 2.3 2.3 :4 2.3',
        ':2. 0.4',
        ':1 0.4{lr}']),
    dict(name='Drums', program=0, tuning=[0, 0, 0, 0, 0, 0], drums=True, bars=[
        GROOVE_IN, GROOVE, GROOVE, FILL, RIDE_IN, RIDE, RIDE, FILL, RIDE_IN, RIDE, RIDE, FILL,
        ':4 (36.1 49.1) (38.1 42.1) (36.1 42.1)', ':1 (36.1 49.1)']),
]

TOKEN = re.compile(r':\S+|\([^)]*\)|r|-?\d+\.\d+(?:\{[^}]*\})?')
NOTE = re.compile(r'(-?\d+)\.(\d+)(?:\{([^}]*)\})?')


def parse_bar(src):
    beats = []
    dur, dotted, triplet = 4, False, False
    for tok in TOKEN.findall(src):
        if tok.startswith(':'):
            spec = tok[1:]
            dotted = spec.endswith('.')
            triplet = spec.endswith('t')
            dur = int(spec.rstrip('.t'))
            continue
        beat = dict(dur=dur, dotted=dotted, triplet=triplet, notes=[], rest=tok == 'r')
        if not beat['rest']:
            body = tok[1:-1] if tok.startswith('(') else tok
            for m in NOTE.finditer(body):
                fx = set(filter(None, (m.group(3) or '').split(',')))
                beat['notes'].append(dict(fret=int(m.group(1)), string=int(m.group(2)), fx=fx))
        beats.append(beat)
    return beats


def bend_value(fx, prefix):
    for f in fx:
        if f.startswith(prefix) and f[len(prefix):].isdigit():
            return int(f[len(prefix):])
    return None


# ---------------------------------------------------------------------------
# GP3/4/5 via PyGuitarPro
# ---------------------------------------------------------------------------

def build_gp_song(version):
    song = gp.Song()
    song.title = 'Night Drive'
    song.subtitle = 'Original demo'
    song.artist = 'Riffbox'
    song.album = 'Fixtures'
    song.tab = 'Riffbox'
    song.tempo = 112
    song.measureHeaders = []
    numerator, denominator = 4, 4
    start = 960
    for i, m in enumerate(MEASURES):
        if 'time' in m:
            numerator, denominator = m['time']
        h = gp.MeasureHeader(number=i + 1, start=start)
        h.timeSignature.numerator = numerator
        h.timeSignature.denominator = gp.Duration(value=denominator)
        h.isRepeatOpen = m.get('open', False)
        if 'close' in m:
            # PyGuitarPro models the number of repeats (GP5 files then store total plays).
            h.repeatClose = m['close'] - 1
        if 'alt' in m:
            mask = 0
            for n in m['alt']:
                mask |= 1 << (n - 1)
            h.repeatAlternative = mask
        if 'marker' in m:
            h.marker = gp.Marker(title=m['marker'], color=gp.Color(200, 40, 40))
        h.hasDoubleBar = m.get('double', False)
        song.measureHeaders.append(h)
        start += 960 * 4 * numerator // denominator

    song.tracks = []
    for t_index, spec in enumerate(TRACKS):
        track = gp.Track(song, number=t_index + 1, name=spec['name'])
        track.isPercussionTrack = spec.get('drums', False)
        track.strings = [gp.GuitarString(n + 1, v) for n, v in enumerate(spec['tuning'])]
        track.channel = gp.MidiChannel(channel=9 if track.isPercussionTrack else t_index,
                                       effectChannel=9 if track.isPercussionTrack else t_index,
                                       instrument=spec['program'])
        track.measures = []
        for m_index, header in enumerate(song.measureHeaders):
            measure = gp.Measure(track, header)
            voice = measure.voices[0]
            for b in parse_bar(spec['bars'][m_index]):
                dur = gp.Duration(value=b['dur'], isDotted=b['dotted'])
                if b['triplet']:
                    dur.tuplet = gp.Tuplet(3, 2)
                beat = gp.Beat(voice, duration=dur,
                               status=gp.BeatStatus.rest if b['rest'] else gp.BeatStatus.normal)
                if m_index == 8 and t_index == 0 and not voice.beats:
                    # Instrument change: the rhythm guitar switches to a clean sound for the solo.
                    beat.effect.mixTableChange = gp.MixTableChange(instrument=gp.MixTableItem(value=27))
                if m_index == 4 and t_index == 0 and not voice.beats and 'tempo' in MEASURES[4]:
                    beat.effect.mixTableChange = gp.MixTableChange(
                        tempo=gp.MixTableItem(value=MEASURES[4]['tempo']), hideTempo=False)
                for k, n in enumerate(b['notes']):
                    # Drum hits in a chord must each sit on their own "string".
                    string = k + 1 if track.isPercussionTrack else n['string']
                    note = gp.Note(beat, value=n['fret'], string=string, type=gp.NoteType.normal)
                    fx = n['fx']
                    e = note.effect
                    e.palmMute = 'pm' in fx
                    e.vibrato = 'v' in fx
                    e.hammer = 'h' in fx
                    e.letRing = 'lr' in fx
                    e.staccato = 'st' in fx
                    e.accentuatedNote = 'ac' in fx
                    if 'x' in fx:
                        note.type = gp.NoteType.dead
                    if 't' in fx:
                        note.type = gp.NoteType.tie
                    if 'nh' in fx:
                        e.harmonic = gp.NaturalHarmonic()
                    if 'sl' in fx:
                        e.slides = [gp.SlideType.shiftSlideTo]
                    if 'si' in fx:
                        e.slides = [gp.SlideType.intoFromBelow]
                    bend = bend_value(fx, 'b')
                    release = bend_value(fx, 'br')
                    if release is not None:
                        q = release // 25
                        e.bend = gp.BendEffect(type=gp.BendType.bendRelease, value=release, points=[
                            gp.BendPoint(0, 0), gp.BendPoint(4, q), gp.BendPoint(8, q), gp.BendPoint(12, 0)])
                    elif bend is not None:
                        q = bend // 25
                        e.bend = gp.BendEffect(type=gp.BendType.bend, value=bend, points=[
                            gp.BendPoint(0, 0), gp.BendPoint(6, q), gp.BendPoint(12, q)])
                    beat.notes.append(note)
                voice.beats.append(beat)
            track.measures.append(measure)
        song.tracks.append(track)
    return song


# ---------------------------------------------------------------------------
# GPIF (GP6 / GP7)
# ---------------------------------------------------------------------------

DRUM_ARTICULATIONS = [36, 38, 42, 46, 49, 51, 41, 45, 37]  # GP7 InstrumentSet order
# GP6 drum kit (element, variation): 0 kick, 1 snare, 5-9 toms, 10 hi-hat, 13 crash, 15 ride.
GP6_ELEMENTS = {36: (0, 0), 38: (1, 0), 37: (1, 2), 42: (10, 0), 46: (10, 2), 49: (13, 0),
                51: (15, 0), 41: (5, 0), 45: (7, 0)}
NOTE_VALUES = {1: 'Whole', 2: 'Half', 4: 'Quarter', 8: 'Eighth', 16: '16th', 32: '32nd'}


def gpif(gp6):
    rhythms, beats_xml, notes_xml, voices_xml, bars_xml = [], [], [], [], []
    rhythm_ids = {}

    def rhythm(b):
        key = (b['dur'], b['dotted'], b['triplet'])
        if key not in rhythm_ids:
            rhythm_ids[key] = len(rhythms)
            x = f'<Rhythm id="{len(rhythms)}"><NoteValue>{NOTE_VALUES[b["dur"]]}</NoteValue>'
            if b['dotted']:
                x += '<AugmentationDot count="1"/>'
            if b['triplet']:
                x += '<PrimaryTuplet num="3" den="2"/>'
            rhythms.append(x + '</Rhythm>')
        return rhythm_ids[key]

    def prop(name, inner):
        return f'<Property name="{name}">{inner}</Property>'

    tracks_xml = []
    bar_ids = [[] for _ in MEASURES]
    for t_index, spec in enumerate(TRACKS):
        drums = spec.get('drums', False)
        string_count = len(spec['tuning'])
        pitches = ' '.join(str(p) for p in reversed(spec['tuning']))
        name = f'<Name><![CDATA[{spec["name"]}]]></Name>'
        channel = 9 if drums else t_index
        if gp6:
            props = '' if drums else prop('Tuning', f'<Pitches>{pitches}</Pitches>') + prop('CapoFret', '<Fret>0</Fret>')
            table = 'Percussion' if drums else 'Instrument'
            tracks_xml.append(
                f'<Track id="{t_index}">{name}'
                + ('<Instrument ref="drmkt-s"/>' if drums else '<Instrument ref="e-gtr6"/>')
                + f'<GeneralMidi table="{table}"><Program>{spec["program"]}</Program><Port>0</Port>'
                f'<PrimaryChannel>{channel}</PrimaryChannel><SecondaryChannel>{channel}</SecondaryChannel>'
                f'<ForeOneChannelPerString>false</ForeOneChannelPerString></GeneralMidi>'
                f'<Properties>{props}</Properties>'
                + ('<Automations><Automation><Type>Instrument</Type><Bar>8</Bar><Position>0</Position><Value>27</Value></Automation></Automations>' if t_index == 0 else '')
                + '</Track>')
        else:
            if drums:
                elements = ''.join(
                    f'<Element><Name>E{k}</Name><Type>drum</Type><Articulations><Articulation><Name>A{k}</Name>'
                    f'<OutputMidiNumber>{k}</OutputMidiNumber></Articulation></Articulations></Element>'
                    for k in DRUM_ARTICULATIONS)
                iset = f'<InstrumentSet><Name>Drums</Name><Type>drumKit</Type><LineCount>5</LineCount><Elements>{elements}</Elements></InstrumentSet>'
                staff_props = ''
            else:
                iset = '<InstrumentSet><Name>Electric Guitar</Name><Type>electricGuitar</Type><LineCount>5</LineCount><Elements/></InstrumentSet>'
                staff_props = prop('Tuning', f'<Pitches>{pitches}</Pitches>') + prop('CapoFret', '<Fret>0</Fret>')
            tracks_xml.append(
                f'<Track id="{t_index}">{name}<Color>200 80 40</Color>{iset}'
                f'<Sounds><Sound><Name>Main</Name><Path>Main</Path><MIDI><LSB>0</LSB><MSB>0</MSB><Program>{spec["program"]}</Program></MIDI></Sound>'
                + ('<Sound><Name>Clean</Name><Path>Clean</Path><MIDI><LSB>0</LSB><MSB>0</MSB><Program>27</Program></MIDI></Sound>' if t_index == 0 else '')
                + '</Sounds>'
                f'<MidiConnection><Port>0</Port><PrimaryChannel>{channel}</PrimaryChannel><SecondaryChannel>{channel}</SecondaryChannel></MidiConnection>'
                f'<Staves><Staff><Properties>{staff_props}</Properties></Staff></Staves>'
                + ('<Automations><Automation><Type>Sound</Type><Linear>false</Linear><Bar>8</Bar><Position>0</Position>'
                   '<Visible>true</Visible><Value>Clean;Clean;Factory</Value></Automation></Automations>' if t_index == 0 else '')
                + '</Track>')

        for m_index, src in enumerate(spec['bars']):
            beat_ids = []
            for b in parse_bar(src):
                note_ids = []
                for n in b['notes']:
                    fx = n['fx']
                    inner = ''
                    if 't' in fx:
                        inner += '<Tie origin="false" destination="true"/>'
                    if 'v' in fx:
                        inner += '<Vibrato>Slight</Vibrato>'
                    if 'lr' in fx:
                        inner += '<LetRing/>'
                    if 'ac' in fx:
                        inner += '<Accent>8</Accent>'
                    if 'st' in fx:
                        inner += '<Accent>1</Accent>'
                    p = ''
                    if drums:
                        if gp6:
                            el, var = GP6_ELEMENTS[n['fret']]
                            p += prop('Element', f'<Element>{el}</Element>') + prop('Variation', f'<Variation>{var}</Variation>')
                        else:
                            inner += f'<InstrumentArticulation>{DRUM_ARTICULATIONS.index(n["fret"])}</InstrumentArticulation>'
                    else:
                        p += prop('String', f'<String>{string_count - n["string"]}</String>')
                        p += prop('Fret', f'<Fret>{n["fret"]}</Fret>')
                    if 'pm' in fx:
                        p += prop('PalmMuted', '<Enable/>')
                    if 'x' in fx:
                        p += prop('Muted', '<Enable/>')
                    if 'h' in fx:
                        p += prop('HopoOrigin', '<Enable/>')
                    if 'sl' in fx:
                        p += prop('Slide', '<Flags>1</Flags>')
                    if 'si' in fx:
                        p += prop('Slide', '<Flags>16</Flags>')
                    if 'nh' in fx:
                        p += prop('HarmonicType', '<HType>Natural</HType>') + prop('HarmonicFret', f'<HFret>{n["fret"]}</HFret>')
                    bend = bend_value(fx, 'b')
                    release = bend_value(fx, 'br')
                    if bend is not None or release is not None:
                        v = release if release is not None else bend
                        p += prop('Bended', '<Enable/>') + prop('BendOriginValue', '<Float>0</Float>')
                        p += prop('BendDestinationValue', f'<Float>{0 if release is not None else v}</Float>')
                        p += prop('BendMiddleValue', f'<Float>{v}</Float>')
                        p += prop('BendOriginOffset', '<Float>0</Float>')
                        p += prop('BendMiddleOffset1', '<Float>30</Float>') + prop('BendMiddleOffset2', '<Float>70</Float>')
                        p += prop('BendDestinationOffset', '<Float>100</Float>')
                    note_ids.append(len(notes_xml))
                    notes_xml.append(f'<Note id="{len(notes_xml)}">{inner}<Properties>{p}</Properties></Note>')
                beat_ids.append(len(beats_xml))
                notes = f'<Notes>{" ".join(map(str, note_ids))}</Notes>' if note_ids else ''
                beats_xml.append(f'<Beat id="{len(beats_xml)}"><Rhythm ref="{rhythm(b)}"/>{notes}</Beat>')
            voices_xml.append(f'<Voice id="{len(voices_xml)}"><Beats>{" ".join(map(str, beat_ids))}</Beats></Voice>')
            clef = 'Neutral' if drums else 'G2'
            bar_ids[m_index].append(len(bars_xml))
            bars_xml.append(f'<Bar id="{len(bars_xml)}"><Clef>{clef}</Clef><Voices>{len(voices_xml) - 1} -1 -1 -1</Voices></Bar>')

    master_bars = []
    numerator, denominator = 4, 4
    for i, m in enumerate(MEASURES):
        if 'time' in m:
            numerator, denominator = m['time']
        x = f'<MasterBar><Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode></Key><Time>{numerator}/{denominator}</Time>'
        if m.get('open') or 'close' in m:
            x += f'<Repeat start="{str(m.get("open", False)).lower()}" end="{str("close" in m).lower()}" count="{m.get("close", 0)}"/>'
        if 'alt' in m:
            x += f'<AlternateEndings>{" ".join(map(str, m["alt"]))}</AlternateEndings>'
        if 'marker' in m:
            x += f'<Section><Letter><![CDATA[]]></Letter><Text><![CDATA[{m["marker"]}]]></Text></Section>'
        if m.get('double'):
            x += '<DoubleBar/>'
        x += f'<Bars>{" ".join(map(str, bar_ids[i]))}</Bars></MasterBar>'
        master_bars.append(x)

    tempo_value = (lambda bpm: str(bpm)) if gp6 else (lambda bpm: f'{bpm} 2')
    automations = ''.join(
        f'<Automation><Type>Tempo</Type><Linear>false</Linear><Bar>{bar}</Bar><Position>0</Position>'
        f'<Visible>true</Visible><Value>{tempo_value(bpm)}</Value></Automation>'
        for bar, bpm in [(0, 112), (4, MEASURES[4]['tempo'])])

    version = '<GPVersion>6</GPVersion>' if gp6 else '<GPVersion>7</GPVersion>'
    return ('<?xml version="1.0" encoding="utf-8"?>\n<GPIF>' + version +
            '<Score><Title><![CDATA[Night Drive]]></Title><SubTitle><![CDATA[Original demo]]></SubTitle>'
            '<Artist><![CDATA[Riffbox]]></Artist><Album><![CDATA[Fixtures]]></Album><Tabber><![CDATA[Riffbox]]></Tabber></Score>'
            f'<MasterTrack><Tracks>{" ".join(str(i) for i in range(len(TRACKS)))}</Tracks><Automations>{automations}</Automations></MasterTrack>'
            f'<Tracks>{"".join(tracks_xml)}</Tracks><MasterBars>{"".join(master_bars)}</MasterBars>'
            f'<Bars>{"".join(bars_xml)}</Bars><Voices>{"".join(voices_xml)}</Voices>'
            f'<Beats>{"".join(beats_xml)}</Beats><Notes>{"".join(notes_xml)}</Notes>'
            f'<Rhythms>{"".join(rhythms)}</Rhythms></GPIF>')


def write_gp7(path):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('VERSION', '7.0')
        z.writestr('Content/score.gpif', gpif(gp6=False))


class BitWriter:
    def __init__(self):
        self.out = bytearray()
        self.cur = 0
        self.n = 0

    def bit(self, b):
        self.cur = (self.cur << 1) | b
        self.n += 1
        if self.n == 8:
            self.out.append(self.cur)
            self.cur = self.n = 0

    def bits(self, value, count):  # most significant bit first
        for i in range(count - 1, -1, -1):
            self.bit((value >> i) & 1)

    def bits_reversed(self, value, count):  # least significant bit first
        for i in range(count):
            self.bit((value >> i) & 1)

    def finish(self):
        while self.n:
            self.bit(0)
        return bytes(self.out)


def bcfz(data):
    """Compresses with literal runs plus back-references (exercises both decoder paths)."""
    w = BitWriter()
    i = 0
    while i < len(data):
        best_len, best_off = 0, 0
        for off in range(1, min(i, 4095) + 1):
            length = 0
            while length < min(off, 4095) and i + length < len(data) and data[i - off + length] == data[i + length]:
                length += 1
            if length > best_len:
                best_len, best_off = length, off
        if best_len >= 4:
            size = max(best_off, best_len).bit_length()
            w.bit(1)
            w.bits(size, 4)
            w.bits_reversed(best_off, size)
            w.bits_reversed(best_len, size)
            i += best_len
        else:
            chunk = data[i:i + 3]
            w.bit(0)
            w.bits_reversed(len(chunk), 2)
            for byte in chunk:
                w.bits(byte, 8)
            i += len(chunk)
    return b'BCFZ' + struct.pack('<i', len(data)) + w.finish()


def bcfs(files):
    sector = 0x1000
    body = bytearray(sector)  # header sector
    for name, content in files.items():
        entry_index = len(body) // sector
        body += bytes(sector)
        pointers = []
        for start in range(0, len(content), sector):
            pointers.append(len(body) // sector)
            body += content[start:start + sector].ljust(sector, b'\0')
        e = entry_index * sector
        struct.pack_into('<i', body, e, 2)
        body[e + 4:e + 4 + len(name)] = name.encode()
        struct.pack_into('<i', body, e + 0x8C, len(content))
        for k, p in enumerate(pointers):
            struct.pack_into('<i', body, e + 0x94 + 4 * k, p)
    return b'BCFS' + bytes(body)


def write_gpx(path):
    container = bcfs({'score.gpif': gpif(gp6=True).encode('utf-8'), 'misc.xml': b'<x/>'})
    with open(path, 'wb') as f:
        f.write(bcfz(container))


def main():
    os.makedirs(FIXTURES, exist_ok=True)
    os.makedirs(DEMO, exist_ok=True)
    for version, ext in [((3, 0, 0), 'gp3'), ((4, 0, 0), 'gp4'), ((5, 0, 0), 'gp5'), ((5, 1, 0), 'gp5')]:
        name = f'night-drive.{ext}' if version != (5, 1, 0) else 'night-drive-510.gp5'
        gp.write(build_gp_song(version), os.path.join(FIXTURES, name), version=version)
    write_gp7(os.path.join(FIXTURES, 'night-drive.gp'))
    write_gpx(os.path.join(FIXTURES, 'night-drive.gpx'))
    gp.write(build_gp_song((5, 1, 0)), os.path.join(DEMO, 'night-drive.gp5'), version=(5, 1, 0))
    for name in sorted(os.listdir(FIXTURES)):
        print(name, os.path.getsize(os.path.join(FIXTURES, name)))
    # Sanity check: PyGuitarPro can read back its own GP3-5 output.
    for name in ['night-drive.gp3', 'night-drive.gp4', 'night-drive.gp5', 'night-drive-510.gp5']:
        s = gp.parse(os.path.join(FIXTURES, name))
        print('readback', name, s.title, len(s.tracks), len(s.measureHeaders))


if __name__ == '__main__':
    main()
