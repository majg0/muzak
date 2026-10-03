//! A finite, sourced musical vocabulary. Terms classify concepts; they do not
//! imply that a compiler can realize every technique or that a label proves a relation.
//! All 354 headwords of the pinned LilyPond glossary are independently inventoried
//! in docs/research/music-vocabulary.json. Additional entries are curated extensions.
//! Spelling aliases share an enum value; different senses can share a lookup spelling.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyTermDomain")]
pub enum TermDomain {
    Pitch,
    Harmony,
    Rhythm,
    Performance,
    Instrumentation,
    Timbre,
    Structure,
    Notation,
    Text,
    Tradition,
    Provenance,
}

/// Parameterized ontology category. Classification alone does not promise
/// implemented realization and does not specify an unchecked field path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyRepresentation")]
pub enum Representation {
    Pitch,
    Spelling,
    Interval,
    Scale,
    Tuning,
    Chord,
    Voicing,
    HarmonicFunction,
    Key,
    Rhythm,
    Meter,
    Beat,
    Subdivision,
    Tempo,
    Groove,
    Tuplet,
    DurationNotation,
    Articulation,
    Technique,
    Ornament,
    Arpeggio,
    PitchGesture,
    Dynamics,
    Expression,
    Instrument,
    Ensemble,
    Performer,
    Timbre,
    Orchestration,
    Voice,
    Phrase,
    Motif,
    Form,
    Texture,
    Transformation,
    Notation,
    Lyrics,
    Provenance,
    Tradition,
}
impl Representation {
    /// Typed route to the component that stores this concept's parameterized values.
    /// Provenance lives on assertions, so it deliberately has no value component.
    pub fn component_kind(self) -> Option<super::ComponentKind> {
        use super::ComponentKind;
        match self {
            Self::Pitch => Some(ComponentKind::Pitch),
            Self::Spelling => Some(ComponentKind::Spelling),
            Self::Interval => Some(ComponentKind::Interval),
            Self::Scale => Some(ComponentKind::Scale),
            Self::Tuning => Some(ComponentKind::Tuning),
            Self::Chord => Some(ComponentKind::Chord),
            Self::Voicing => Some(ComponentKind::Voicing),
            Self::HarmonicFunction => Some(ComponentKind::HarmonicFunction),
            Self::Key => Some(ComponentKind::Key),
            Self::Rhythm => Some(ComponentKind::Rhythm),
            Self::Meter => Some(ComponentKind::Meter),
            Self::Beat => Some(ComponentKind::Beat),
            Self::Subdivision => Some(ComponentKind::Subdivision),
            Self::Tempo => Some(ComponentKind::Tempo),
            Self::Groove => Some(ComponentKind::Groove),
            Self::Tuplet => Some(ComponentKind::Tuplet),
            Self::DurationNotation => Some(ComponentKind::DurationNotation),
            Self::Articulation => Some(ComponentKind::Articulation),
            Self::Technique => Some(ComponentKind::Technique),
            Self::Ornament => Some(ComponentKind::Ornament),
            Self::Arpeggio => Some(ComponentKind::Arpeggio),
            Self::PitchGesture => Some(ComponentKind::PitchGesture),
            Self::Dynamics => Some(ComponentKind::Dynamics),
            Self::Expression => Some(ComponentKind::Expression),
            Self::Instrument => Some(ComponentKind::Instrument),
            Self::Ensemble => Some(ComponentKind::Ensemble),
            Self::Performer => Some(ComponentKind::Performer),
            Self::Timbre => Some(ComponentKind::Timbre),
            Self::Orchestration => Some(ComponentKind::Orchestration),
            Self::Voice => Some(ComponentKind::Voice),
            Self::Phrase => Some(ComponentKind::Phrase),
            Self::Motif => Some(ComponentKind::Motif),
            Self::Form => Some(ComponentKind::Form),
            Self::Texture => Some(ComponentKind::Texture),
            Self::Transformation => Some(ComponentKind::Transformation),
            Self::Notation => Some(ComponentKind::Notation),
            Self::Lyrics => Some(ComponentKind::Lyrics),
            Self::Provenance => None,
            Self::Tradition => Some(ComponentKind::Tradition),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "OntologyGlossaryEntry")]
pub struct GlossaryEntry {
    pub term: MusicTerm,
    pub name: String,
    pub aliases: Vec<String>,
    pub domain: TermDomain,
    pub representation: Representation,
    pub sources: Vec<String>,
}

macro_rules! music_vocabulary {
    ($($variant:ident => ($name:literal, $domain:ident, $representation:ident,
        [$($alias:literal),*], [$($source:expr),+]);)+) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[serde(rename_all = "camelCase")]
        #[ts(rename = "OntologyMusicTerm")]
        pub enum MusicTerm { $($variant),+ }

        impl MusicTerm {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub fn entry(self) -> GlossaryEntry {
                match self {
                    $(Self::$variant => GlossaryEntry {
                        term: self,
                        name: $name.into(),
                        aliases: vec![$($alias.into()),*],
                        domain: TermDomain::$domain,
                        representation: Representation::$representation,
                        sources: vec![$($source.into()),+],
                    }),+
                }
            }
        }
    };
}

macro_rules! lily {
    ($path:literal) => {
        concat!(
            "https://lilypond.org/doc/v2.26/Documentation/music-glossary/",
            $path
        )
    };
}

const TECHNICAL: &str =
    "https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/technical/";
const ARTICULATIONS: &str =
    "https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/articulations/";
const ORNAMENTS: &str =
    "https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ornaments/";
const DYNAMICS: &str =
    "https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/dynamics/";
const CHORD_KINDS: &str =
    "https://www.w3.org/2021/06/musicxml40/musicxml-reference/data-types/kind-value/";
const INSTRUMENT_SOUNDS: &str = "https://www.w3.org/2021/06/musicxml40/listings/sounds.xml/";
const ACOUSTICS: &str = "https://www.sfu.ca/sonic-studio-webdav/handbook/index.html";
const TIMBRE: &str = "https://www.sfu.ca/sonic-studio-webdav/handbook/Timbre.html";
const ANALYSIS: &str = "https://music-encoding.org/guidelines/v5/content/analysisharm.html";
const INSTRUMENT_CLASSIFICATION: &str =
    "https://mimo-international.com/documents/Hornbostel%20Sachs.pdf";

music_vocabulary! {
    PitchNameA => ("A", Pitch, Spelling, [], [lily!("a")]);
    ADue => ("a due", Instrumentation, Orchestration, [], [lily!("a-due")]);
    Accelerando => ("accelerando", Rhythm, Tempo, [], [lily!("accelerando")]);
    Accent => ("accent", Performance, Articulation, [], [lily!("accent")]);
    Ornament => ("ornament", Performance, Ornament, ["accessory", "embellishment"], [lily!("accessory"), lily!("embellishment"), lily!("ornament")]);
    Acciaccatura => ("acciaccatura", Performance, Ornament, [], [lily!("acciaccatura")]);
    Accidental => ("accidental", Pitch, Spelling, [], [lily!("accidental")]);
    Adagio => ("adagio", Rhythm, Tempo, [], [lily!("adagio")]);
    AlFine => ("al fine", Notation, Notation, [], [lily!("al-fine")]);
    AlNiente => ("al niente", Performance, Dynamics, [], [lily!("al-niente")]);
    CutTime => ("cut time", Rhythm, Meter, ["alla breve"], [lily!("alla-breve"), lily!("cut-time")]);
    Allegro => ("allegro", Rhythm, Tempo, [], [lily!("allegro")]);
    Alteration => ("alteration", Pitch, Spelling, [], [lily!("alteration")]);
    Alto => ("alto", Instrumentation, Performer, [], [lily!("alto")]);
    AltoClef => ("alto clef", Notation, Notation, [], [lily!("alto-clef")]);
    Ambitus => ("ambitus", Pitch, Pitch, [], [lily!("ambitus")]);
    Pickup => ("pickup", Rhythm, Meter, ["anacrusis"], [lily!("anacrusis"), lily!("pickup")]);
    Andante => ("andante", Rhythm, Tempo, [], [lily!("andante")]);
    Appoggiatura => ("appoggiatura", Performance, Ornament, ["backfall", "forefall"], [lily!("appoggiatura"), lily!("backfall"), lily!("forefall")]);
    Arpeggio => ("arpeggio", Performance, Arpeggio, [], [lily!("arpeggio")]);
    Arrastre => ("arrastre", Performance, Technique, [], [lily!("arrastre")]);
    Articulation => ("articulation", Performance, Articulation, [], [lily!("articulation")]);
    AscendingInterval => ("ascending interval", Pitch, Interval, [], [lily!("ascending-interval")]);
    Augmentation => ("augmentation", Structure, Transformation, [], [lily!("augmentation")]);
    AugmentedInterval => ("augmented interval", Pitch, Interval, ["augmented"], [lily!("augmented-interval")]);
    Autograph => ("autograph", Provenance, Provenance, [], [lily!("autograph")]);
    PitchNameB => ("B", Pitch, Spelling, [], [lily!("b")]);
    Measure => ("measure", Rhythm, Meter, ["bar"], [lily!("bar"), lily!("measure")]);
    BarLine => ("bar line", Notation, Notation, [], [lily!("bar-line")]);
    Baritone => ("baritone", Instrumentation, Performer, [], [lily!("baritone")]);
    BaritoneClef => ("baritone clef", Notation, Notation, [], [lily!("baritone-clef")]);
    Bass => ("bass", Instrumentation, Performer, [], [lily!("bass")]);
    FClef => ("F clef", Notation, Notation, ["bass clef"], [lily!("bass-clef"), lily!("f-clef")]);
    Beam => ("beam", Notation, Notation, [], [lily!("beam")]);
    Beat => ("beat", Rhythm, Beat, [], [lily!("beat")]);
    BeatRepeat => ("beat repeat", Notation, Notation, [], [lily!("beat-repeat")]);
    Tie => ("tie", Notation, Notation, ["bind"], [lily!("bind"), lily!("tie")]);
    Brace => ("brace", Notation, Notation, [], [lily!("brace")]);
    Bracket => ("bracket", Notation, Notation, [], [lily!("bracket")]);
    Brass => ("brass", Instrumentation, Instrument, [], [lily!("brass")]);
    BreathMark => ("breath mark", Notation, Notation, [], [lily!("breath-mark")]);
    Breve => ("breve", Notation, DurationNotation, [], [lily!("breve")]);
    PitchNameC => ("C", Pitch, Spelling, [], [lily!("c")]);
    CClef => ("C clef", Notation, Notation, [], [lily!("c-clef")]);
    Cadence => ("cadence", Harmony, HarmonicFunction, [], [lily!("cadence")]);
    Cadenza => ("cadenza", Structure, Form, [], [lily!("cadenza")]);
    Caesura => ("caesura", Rhythm, Tempo, [], [lily!("caesura")]);
    Canon => ("canon", Structure, Form, [], [lily!("canon")]);
    Cent => ("cent", Pitch, Interval, [], [lily!("cent")]);
    MiddleC => ("middle C", Pitch, Pitch, ["central C"], [lily!("central-c"), lily!("middle-c")]);
    Chord => ("chord", Harmony, Chord, [], [lily!("chord")]);
    ChordGrid => ("chord grid", Notation, Notation, [], [lily!("chord-grid")]);
    ChromaticScale => ("chromatic scale", Pitch, Scale, [], [lily!("chromatic-scale")]);
    Chromaticism => ("chromaticism", Harmony, HarmonicFunction, [], [lily!("chromaticism")]);
    ChurchMode => ("church mode", Pitch, Scale, ["ecclesiastical mode"], [lily!("church-mode"), lily!("ecclesiastical-mode")]);
    Clef => ("clef", Notation, Notation, [], [lily!("clef")]);
    Cluster => ("cluster", Harmony, Chord, [], [lily!("cluster")]);
    Comma => ("comma", Pitch, Interval, [], [lily!("comma")]);
    CommonTime => ("common time", Rhythm, Meter, ["common meter"], [lily!("common-meter"), lily!("common-time")]);
    CommonPracticePeriod => ("Common Practice Period", Tradition, Tradition, [], [lily!("common-practice-period")]);
    Complement => ("complement", Pitch, Interval, [], [lily!("complement")]);
    CompoundInterval => ("compound interval", Pitch, Interval, [], [lily!("compound-interval")]);
    CompoundMeter => ("compound meter", Rhythm, Meter, ["compound time"], [lily!("compound-meter"), lily!("compound-time")]);
    ConcertPitch => ("concert pitch", Pitch, Pitch, [], [lily!("concert-pitch")]);
    ConjunctMovement => ("conjunct movement", Structure, Phrase, [], [lily!("conjunct-movement")]);
    Consonance => ("consonance", Harmony, HarmonicFunction, [], [lily!("consonance")]);
    Contralto => ("contralto", Instrumentation, Performer, [], [lily!("contralto")]);
    CopyingMusic => ("copying music", Provenance, Provenance, [], [lily!("copying-music")]);
    Counterpoint => ("counterpoint", Structure, Texture, [], [lily!("counterpoint")]);
    Countertenor => ("countertenor", Instrumentation, Performer, [], [lily!("countertenor")]);
    Crescendo => ("crescendo", Performance, Dynamics, [], [lily!("crescendo")]);
    CueNotes => ("cue-notes", Notation, Notation, [], [lily!("cue_002dnotes")]);
    Custos => ("custos", Notation, Notation, ["direct"], [lily!("custos"), lily!("direct")]);
    PitchNameD => ("D", Pitch, Spelling, [], [lily!("d")]);
    DaCapo => ("da capo", Notation, Notation, [], [lily!("da-capo")]);
    DalNiente => ("dal niente", Performance, Dynamics, [], [lily!("dal-niente")]);
    DalSegno => ("dal segno", Notation, Notation, [], [lily!("dal-segno")]);
    Decrescendo => ("decrescendo", Performance, Dynamics, ["diminuendo"], [lily!("decrescendo"), lily!("diminuendo")]);
    DescendingInterval => ("descending interval", Pitch, Interval, [], [lily!("descending-interval")]);
    DiatonicScale => ("diatonic scale", Pitch, Scale, [], [lily!("diatonic-scale")]);
    SyntonicComma => ("syntonic comma", Pitch, Interval, ["didymic comma"], [lily!("didymic-comma"), lily!("syntonic-comma")]);
    DiminishedInterval => ("diminished interval", Pitch, Interval, ["diminished"], [lily!("diminished-interval")]);
    Diminution => ("diminution", Structure, Transformation, [], [lily!("diminution")]);
    DisjunctMovement => ("disjunct movement", Structure, Phrase, [], [lily!("disjunct-movement")]);
    Dissonance => ("dissonance", Harmony, HarmonicFunction, [], [lily!("dissonance")]);
    DissonantInterval => ("dissonant interval", Pitch, Interval, [], [lily!("dissonant-interval")]);
    Divisio => ("divisio", Notation, Notation, [], [lily!("divisio")]);
    Doit => ("doit", Performance, PitchGesture, [], [lily!("doit")]);
    Dominant => ("dominant", Harmony, HarmonicFunction, [], [lily!("dominant")]);
    DominantNinthChord => ("dominant ninth chord", Harmony, Chord, [], [lily!("dominant-ninth-chord")]);
    DominantSeventhChord => ("dominant seventh chord", Harmony, Chord, [], [lily!("dominant-seventh-chord")]);
    DorianMode => ("dorian mode", Pitch, Scale, [], [lily!("dorian-mode")]);
    AugmentationDot => ("augmentation dot", Notation, DurationNotation, ["dot (augmentation dot)"], [lily!("dot-_0028augmentation-dot_0029")]);
    DottedNote => ("dotted note", Notation, DurationNotation, [], [lily!("dotted-note")]);
    DoubleAppoggiatura => ("double appoggiatura", Performance, Ornament, [], [lily!("double-appoggiatura")]);
    DoubleBarLine => ("double bar line", Notation, Notation, [], [lily!("double-bar-line")]);
    DoubleDottedNote => ("double dotted note", Notation, DurationNotation, [], [lily!("double-dotted-note")]);
    DoubleFlat => ("double flat", Pitch, Spelling, [], [lily!("double-flat")]);
    DoubleSharp => ("double sharp", Pitch, Spelling, [], [lily!("double-sharp")]);
    DoubleTimeSignature => ("double time signature", Rhythm, Meter, [], [lily!("double-time-signature")]);
    DoubleTrill => ("double trill", Performance, Ornament, [], [lily!("double-trill")]);
    DupleMeter => ("duple meter", Rhythm, Meter, [], [lily!("duple-meter")]);
    Duplet => ("duplet", Rhythm, Tuplet, [], [lily!("duplet")]);
    Duration => ("duration", Rhythm, Rhythm, [], [lily!("duration")]);
    Dynamics => ("dynamics", Performance, Dynamics, [], [lily!("dynamics")]);
    PitchNameE => ("E", Pitch, Spelling, [], [lily!("e")]);
    EighthNote => ("eighth note", Notation, DurationNotation, [], [lily!("eighth-note")]);
    EighthRest => ("eighth rest", Notation, DurationNotation, [], [lily!("eighth-rest")]);
    Elision => ("elision", Text, Lyrics, [], [lily!("elision")]);
    Engraving => ("engraving", Provenance, Provenance, [], [lily!("engraving")]);
    Enharmonic => ("enharmonic", Pitch, Spelling, [], [lily!("enharmonic")]);
    EqualTemperament => ("equal temperament", Pitch, Tuning, [], [lily!("equal-temperament")]);
    ExpressionMark => ("expression mark", Performance, Expression, [], [lily!("expression-mark")]);
    MelismaLine => ("melisma line", Text, Lyrics, ["extender line"], [lily!("extender-line"), lily!("melisma-line")]);
    PitchNameF => ("F", Pitch, Spelling, [], [lily!("f")]);
    Fall => ("fall", Performance, PitchGesture, [], [lily!("fall")]);
    FeatheredBeam => ("feathered beam", Notation, Notation, [], [lily!("feathered-beam")]);
    Fermata => ("fermata", Rhythm, Tempo, ["pause"], [lily!("fermata"), lily!("pause")]);
    Fifth => ("fifth", Pitch, Interval, [], [lily!("fifth")]);
    FiguredBass => ("figured bass", Notation, Notation, ["thorough bass"], [lily!("figured-bass"), lily!("thorough-bass")]);
    Fine => ("fine", Notation, Notation, [], [lily!("fine")]);
    Fingering => ("fingering", Performance, Technique, [], [lily!("fingering")]);
    Flag => ("flag", Notation, Notation, ["hook", "pennant"], [lily!("flag"), lily!("hook"), lily!("pennant")]);
    Flageolet => ("flageolet", Performance, Technique, [], [lily!("flageolet")]);
    Flat => ("flat", Pitch, Spelling, [], [lily!("flat")]);
    Forte => ("forte", Performance, Dynamics, [], [lily!("forte")]);
    Fourth => ("fourth", Pitch, Interval, [], [lily!("fourth")]);
    FrenchedScore => ("Frenched score", Notation, Notation, [], [lily!("frenched-score")]);
    FrenchedStaff => ("Frenched staff", Notation, Notation, ["Frenched staves"], [lily!("frenched-staff"), lily!("frenched-staves")]);
    Fugue => ("fugue", Structure, Form, [], [lily!("fugue")]);
    FunctionalHarmony => ("functional harmony", Harmony, HarmonicFunction, [], [lily!("functional-harmony")]);
    PitchNameG => ("G", Pitch, Spelling, [], [lily!("g")]);
    GClef => ("G clef", Notation, Notation, ["treble clef"], [lily!("g-clef"), lily!("treble-clef")]);
    Glissando => ("glissando", Performance, PitchGesture, [], [lily!("glissando")]);
    GraceNotes => ("grace notes", Performance, Ornament, [], [lily!("grace-notes")]);
    GrandStaff => ("grand staff", Notation, Notation, [], [lily!("grand-staff")]);
    Grave => ("grave", Rhythm, Tempo, [], [lily!("grave")]);
    Turn => ("turn", Performance, Ornament, ["gruppetto"], [lily!("gruppetto"), lily!("turn")]);
    PitchNameH => ("H", Pitch, Spelling, [], [lily!("h")]);
    Hairpin => ("hairpin", Notation, Notation, [], [lily!("hairpin")]);
    HalfNote => ("half note", Notation, DurationNotation, [], [lily!("half-note")]);
    HalfRest => ("half rest", Notation, DurationNotation, [], [lily!("half-rest")]);
    HarmonicCadence => ("harmonic cadence", Harmony, HarmonicFunction, [], [lily!("harmonic-cadence")]);
    Harmonics => ("harmonics", Performance, Technique, [], [lily!("harmonics")]);
    Harmony => ("harmony", Harmony, Chord, [], [lily!("harmony")]);
    Hemiola => ("hemiola", Rhythm, Rhythm, [], [lily!("hemiola")]);
    HighBassClef => ("high bass clef", Notation, Notation, [], [lily!("high-bass-clef")]);
    Homophony => ("homophony", Structure, Texture, [], [lily!("homophony")]);
    HymnMeter => ("hymn meter", Text, Lyrics, [], [lily!("hymn-meter")]);
    IncompleteDominantSeventhChord => ("incomplete dominant seventh chord", Harmony, Chord, [], [lily!("incomplete-dominant-seventh-chord")]);
    Interval => ("interval", Pitch, Interval, [], [lily!("interval")]);
    ChordInversion => ("chord inversion", Harmony, Voicing, ["inversion"], [lily!("inversion")]);
    InvertedInterval => ("inverted interval", Pitch, Interval, [], [lily!("inverted-interval")]);
    JustIntonation => ("just intonation", Pitch, Tuning, [], [lily!("just-intonation")]);
    Key => ("key", Harmony, Key, [], [lily!("key")]);
    KeySignature => ("key signature", Harmony, Key, [], [lily!("key-signature")]);
    KievanNotation => ("Kievan notation", Notation, Notation, [], [lily!("kievan-notation")]);
    LaissezVibrer => ("laissez vibrer", Performance, Articulation, [], [lily!("laissez-vibrer")]);
    Largo => ("largo", Rhythm, Tempo, [], [lily!("largo")]);
    LeadingNote => ("leading note", Harmony, HarmonicFunction, [], [lily!("leading-note")]);
    LedgerLine => ("ledger line", Notation, Notation, ["leger line"], [lily!("ledger-line"), lily!("leger-line")]);
    Legato => ("legato", Performance, Articulation, [], [lily!("legato")]);
    Slur => ("slur", Notation, Notation, ["legato curve"], [lily!("legato-curve"), lily!("slur")]);
    Ligature => ("ligature", Notation, Notation, [], [lily!("ligature")]);
    Lilypond => ("lilypond", Provenance, Provenance, [], [lily!("lilypond")]);
    StaffLine => ("staff line", Notation, Notation, ["line"], [lily!("line")]);
    Loco => ("loco", Notation, Notation, [], [lily!("loco")]);
    LongAppoggiatura => ("long appoggiatura", Performance, Ornament, [], [lily!("long-appoggiatura")]);
    Longa => ("longa", Notation, DurationNotation, [], [lily!("longa")]);
    LyricTie => ("lyric tie", Text, Lyrics, [], [lily!("lyric-tie")]);
    Lyrics => ("lyrics", Text, Lyrics, ["song texts"], [lily!("lyrics"), lily!("song-texts")]);
    MajorMode => ("major mode", Pitch, Scale, ["major"], [lily!("major")]);
    MajorInterval => ("major interval", Pitch, Interval, [], [lily!("major-interval")]);
    Maxima => ("maxima", Notation, DurationNotation, [], [lily!("maxima")]);
    MeantoneTemperament => ("meantone temperament", Pitch, Tuning, [], [lily!("meantone-temperament")]);
    MeasureRepeat => ("measure repeat", Notation, Notation, [], [lily!("measure-repeat")]);
    Mediant => ("mediant", Harmony, HarmonicFunction, [], [lily!("mediant")]);
    Melisma => ("melisma", Text, Lyrics, [], [lily!("melisma")]);
    MelodicCadence => ("melodic cadence", Structure, Phrase, [], [lily!("melodic-cadence")]);
    MensuralNotation => ("mensural notation", Notation, Notation, [], [lily!("mensural-notation")]);
    MensurationSign => ("mensuration sign", Rhythm, Meter, [], [lily!("mensuration-sign")]);
    Mensurstrich => ("mensurstrich", Notation, Notation, [], [lily!("mensurstrich")]);
    Meter => ("meter", Rhythm, Meter, ["time"], [lily!("meter"), lily!("time")]);
    Metronome => ("metronome", Rhythm, Tempo, [], [lily!("metronome")]);
    MetronomeMark => ("metronome mark", Rhythm, Tempo, ["metronomic indication"], [lily!("metronome-mark"), lily!("metronomic-indication")]);
    Mezzo => ("mezzo", Performance, Dynamics, [], [lily!("mezzo")]);
    MezzoSoprano => ("mezzo-soprano", Instrumentation, Performer, [], [lily!("mezzo_002dsoprano")]);
    MinorMode => ("minor mode", Pitch, Scale, ["minor"], [lily!("minor")]);
    MinorInterval => ("minor interval", Pitch, Interval, [], [lily!("minor-interval")]);
    MixolydianMode => ("mixolydian mode", Pitch, Scale, [], [lily!("mixolydian-mode")]);
    Mode => ("mode", Pitch, Scale, [], [lily!("mode")]);
    Modulation => ("modulation", Harmony, HarmonicFunction, [], [lily!("modulation")]);
    Mordent => ("mordent", Performance, Ornament, [], [lily!("mordent")]);
    Motif => ("motif", Structure, Motif, ["motive"], [lily!("motif"), lily!("motive")]);
    Movement => ("movement", Structure, Form, [], [lily!("movement")]);
    MultiMeasureRest => ("multi-measure rest", Notation, DurationNotation, [], [lily!("multi_002dmeasure-rest")]);
    Natural => ("natural", Pitch, Spelling, [], [lily!("natural")]);
    NeighborTones => ("neighbor tones", Performance, Ornament, [], [lily!("neighbor-tones")]);
    Ninth => ("ninth", Pitch, Interval, [], [lily!("ninth")]);
    NonLegato => ("non-legato", Performance, Articulation, [], [lily!("non_002dlegato")]);
    Note => ("note", Pitch, Pitch, [], [lily!("note")]);
    NoteHead => ("note head", Notation, Notation, [], [lily!("note-head")]);
    NoteNames => ("note names", Pitch, Spelling, [], [lily!("note-names")]);
    NoteValue => ("note value", Notation, DurationNotation, [], [lily!("note-value")]);
    Octavation => ("octavation", Structure, Transformation, [], [lily!("octavation")]);
    Octave => ("octave", Pitch, Interval, [], [lily!("octave")]);
    OctaveMark => ("octave mark", Notation, Notation, ["octave marking", "octave sign"], [lily!("octave-mark"), lily!("octave-marking"), lily!("octave-sign")]);
    Ossia => ("ossia", Notation, Notation, [], [lily!("ossia")]);
    Part => ("part", Instrumentation, Orchestration, [], [lily!("part")]);
    PercentRepeat => ("percent repeat", Notation, Notation, [], [lily!("percent-repeat")]);
    Percussion => ("percussion", Instrumentation, Instrument, [], [lily!("percussion")]);
    PerfectInterval => ("perfect interval", Pitch, Interval, [], [lily!("perfect-interval")]);
    Phrase => ("phrase", Structure, Phrase, [], [lily!("phrase")]);
    Phrasing => ("phrasing", Performance, Expression, [], [lily!("phrasing")]);
    PianoDynamic => ("piano dynamic", Performance, Dynamics, ["piano"], [lily!("piano")]);
    Pitch => ("pitch", Pitch, Pitch, [], [lily!("pitch")]);
    Pizzicato => ("pizzicato", Performance, Technique, [], [lily!("pizzicato")]);
    Polymeter => ("polymeter", Rhythm, Meter, ["polymetric"], [lily!("polymeter"), lily!("polymetric")]);
    PolymetricTimeSignature => ("polymetric time signature", Rhythm, Meter, [], [lily!("polymetric-time-signature")]);
    Polyphony => ("polyphony", Structure, Texture, [], [lily!("polyphony")]);
    Portato => ("portato", Performance, Articulation, ["detached legato"], [lily!("portato"), ARTICULATIONS]);
    PowerChord => ("power chord", Harmony, Chord, [], [lily!("power-chord")]);
    Presto => ("presto", Rhythm, Tempo, [], [lily!("presto")]);
    Proportion => ("proportion", Structure, Transformation, [], [lily!("proportion")]);
    PythagoreanComma => ("Pythagorean comma", Pitch, Interval, [], [lily!("pythagorean-comma")]);
    Quadruplet => ("quadruplet", Rhythm, Tuplet, [], [lily!("quadruplet")]);
    IntervalQuality => ("interval quality", Pitch, Interval, ["quality"], [lily!("quality")]);
    QuarterNote => ("quarter note", Notation, DurationNotation, [], [lily!("quarter-note")]);
    QuarterRest => ("quarter rest", Notation, DurationNotation, [], [lily!("quarter-rest")]);
    QuarterTone => ("quarter tone", Pitch, Interval, [], [lily!("quarter-tone")]);
    Quintuplet => ("quintuplet", Rhythm, Tuplet, [], [lily!("quintuplet")]);
    Rallentando => ("rallentando", Rhythm, Tempo, [], [lily!("rallentando")]);
    RelativeKey => ("relative key", Harmony, Key, [], [lily!("relative-key")]);
    Repeat => ("repeat", Notation, Notation, [], [lily!("repeat")]);
    Rest => ("rest", Rhythm, Rhythm, [], [lily!("rest")]);
    Rhythm => ("rhythm", Rhythm, Rhythm, [], [lily!("rhythm")]);
    Ritardando => ("ritardando", Rhythm, Tempo, [], [lily!("ritardando")]);
    Ritenuto => ("ritenuto", Rhythm, Tempo, [], [lily!("ritenuto")]);
    Scale => ("scale", Pitch, Scale, [], [lily!("scale")]);
    ScaleDegree => ("scale degree", Pitch, Scale, [], [lily!("scale-degree")]);
    Scordatura => ("scordatura", Pitch, Tuning, [], [lily!("scordatura")]);
    Score => ("score", Notation, Notation, [], [lily!("score")]);
    Second => ("second", Pitch, Interval, [], [lily!("second")]);
    WholeNote => ("whole note", Notation, DurationNotation, ["semibreve"], [lily!("semibreve"), lily!("whole-note")]);
    Semitone => ("semitone", Pitch, Interval, [], [lily!("semitone")]);
    Seventh => ("seventh", Pitch, Interval, [], [lily!("seventh")]);
    Sextuplet => ("sextuplet", Rhythm, Tuplet, ["sextolet"], [lily!("sextolet"), lily!("sextuplet")]);
    Trill => ("trill", Performance, Ornament, ["shake"], [lily!("shake"), lily!("trill")]);
    Sharp => ("sharp", Pitch, Spelling, [], [lily!("sharp")]);
    SimileMark => ("simile mark", Notation, Notation, ["simile"], [lily!("simile"), lily!("simile-mark")]);
    SimpleMeter => ("simple meter", Rhythm, Meter, [], [lily!("simple-meter")]);
    SixteenthNote => ("sixteenth note", Notation, DurationNotation, [], [lily!("sixteenth-note")]);
    SixteenthRest => ("sixteenth rest", Notation, DurationNotation, [], [lily!("sixteenth-rest")]);
    Sixth => ("sixth", Pitch, Interval, [], [lily!("sixth")]);
    SixtyFourthNote => ("sixty-fourth note", Notation, DurationNotation, [], [lily!("sixty_002dfourth-note")]);
    SixtyFourthRest => ("sixty-fourth rest", Notation, DurationNotation, [], [lily!("sixty_002dfourth-rest")]);
    SlashRepeat => ("slash repeat", Notation, Notation, [], [lily!("slash-repeat")]);
    Solmization => ("solmization", Pitch, Spelling, [], [lily!("solmization")]);
    Sonata => ("sonata", Structure, Form, [], [lily!("sonata")]);
    SonataForm => ("sonata form", Structure, Form, [], [lily!("sonata-form")]);
    Soprano => ("soprano", Instrumentation, Performer, [], [lily!("soprano")]);
    Staccato => ("staccato", Performance, Articulation, [], [lily!("staccato")]);
    Staff => ("staff", Notation, Notation, ["staves"], [lily!("staff"), lily!("staves")]);
    Stem => ("stem", Notation, Notation, [], [lily!("stem")]);
    Stringendo => ("stringendo", Rhythm, Tempo, [], [lily!("stringendo")]);
    Strings => ("strings", Instrumentation, Instrument, [], [lily!("strings")]);
    StrongBeat => ("strong beat", Rhythm, Beat, [], [lily!("strong-beat")]);
    Subdominant => ("subdominant", Harmony, HarmonicFunction, [], [lily!("subdominant")]);
    Submediant => ("submediant", Harmony, HarmonicFunction, ["superdominant"], [lily!("submediant"), lily!("superdominant")]);
    Subtonic => ("subtonic", Harmony, HarmonicFunction, [], [lily!("subtonic")]);
    SulG => ("sul G", Performance, Technique, [], [lily!("sul-g")]);
    Supertonic => ("supertonic", Harmony, HarmonicFunction, [], [lily!("supertonic")]);
    Symphony => ("symphony", Structure, Form, [], [lily!("symphony")]);
    Syncopation => ("syncopation", Rhythm, Rhythm, [], [lily!("syncopation")]);
    System => ("system", Notation, Notation, [], [lily!("system")]);
    Temperament => ("temperament", Pitch, Tuning, [], [lily!("temperament")]);
    TempoIndication => ("tempo indication", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    Tenor => ("tenor", Instrumentation, Performer, [], [lily!("tenor")]);
    Tenth => ("tenth", Pitch, Interval, [], [lily!("tenth")]);
    Tenuto => ("tenuto", Performance, Articulation, [], [lily!("tenuto")]);
    Third => ("third", Pitch, Interval, [], [lily!("third")]);
    ThirtySecondNote => ("thirty-second note", Notation, DurationNotation, [], [lily!("thirty_002dsecond-note")]);
    ThirtySecondRest => ("thirty-second rest", Notation, DurationNotation, [], [lily!("thirty_002dsecond-rest")]);
    TimeSignature => ("time signature", Rhythm, Meter, [], [lily!("time-signature")]);
    MusicalTone => ("musical tone", Pitch, Pitch, ["tone"], [lily!("tone")]);
    Tonic => ("tonic", Harmony, HarmonicFunction, [], [lily!("tonic")]);
    TransposingInstrument => ("transposing instrument", Instrumentation, Instrument, [], [lily!("transposing-instrument")]);
    Transposition => ("transposition", Structure, Transformation, [], [lily!("transposition")]);
    Tremolo => ("tremolo", Performance, Ornament, [], [lily!("tremolo")]);
    Triad => ("triad", Harmony, Chord, [], [lily!("triad")]);
    TripleMeter => ("triple meter", Rhythm, Meter, [], [lily!("triple-meter")]);
    Triplet => ("triplet", Rhythm, Tuplet, [], [lily!("triplet")]);
    Tritone => ("tritone", Pitch, Interval, [], [lily!("tritone")]);
    TuningFork => ("tuning fork", Pitch, Tuning, [], [lily!("tuning-fork")]);
    Tuplet => ("tuplet", Rhythm, Tuplet, [], [lily!("tuplet")]);
    UnisonDoubling => ("unison doubling", Instrumentation, Orchestration, ["unison"], [lily!("unison")]);
    Upbeat => ("upbeat", Rhythm, Beat, [], [lily!("upbeat")]);
    Voice => ("voice", Structure, Voice, [], [lily!("voice")]);
    Volta => ("volta", Notation, Notation, [], [lily!("volta")]);
    VowelTransition => ("vowel transition", Text, Lyrics, [], [lily!("vowel-transition")]);
    WeakBeat => ("weak beat", Rhythm, Beat, [], [lily!("weak-beat")]);
    WholeRest => ("whole rest", Notation, DurationNotation, [], [lily!("whole-rest")]);
    WholeTone => ("whole tone", Pitch, Interval, [], [lily!("whole-tone")]);
    Woodwind => ("woodwind", Instrumentation, Instrument, [], [lily!("woodwind")]);
    Bayati => ("bayati", Tradition, Tradition, [], [lily!("bayati")]);
    Iraq => ("iraq", Tradition, Tradition, [], [lily!("iraq")]);
    Kurd => ("kurd", Tradition, Tradition, [], [lily!("kurd")]);
    Makam => ("makam", Tradition, Tradition, ["makamlar"], [lily!("makam"), lily!("makamlar")]);
    Maqam => ("maqam", Tradition, Tradition, [], [lily!("maqam")]);
    Rast => ("rast", Tradition, Tradition, [], [lily!("rast")]);
    Semai => ("semai", Tradition, Tradition, [], [lily!("semai")]);
    Sikah => ("sikah", Tradition, Tradition, [], [lily!("sikah")]);
    Taqasim => ("taqasim", Tradition, Tradition, [], [lily!("taqasim")]);
    HammerOn => ("hammer-on", Performance, Technique, ["hammer on"], [TECHNICAL]);
    PullOff => ("pull-off", Performance, Technique, ["pull off", "hammer-off", "hammer off"], [TECHNICAL]);
    UpBow => ("up-bow", Performance, Technique, [], [TECHNICAL]);
    DownBow => ("down-bow", Performance, Technique, [], [TECHNICAL]);
    OpenString => ("open string", Performance, Technique, [], [TECHNICAL]);
    ThumbPosition => ("thumb position", Performance, Technique, [], [TECHNICAL]);
    Pluck => ("pluck", Performance, Technique, [], [TECHNICAL]);
    DoubleTongue => ("double tongue", Performance, Technique, [], [TECHNICAL]);
    TripleTongue => ("triple tongue", Performance, Technique, [], [TECHNICAL]);
    Stopped => ("stopped", Performance, Technique, [], [TECHNICAL]);
    SnapPizzicato => ("snap pizzicato", Performance, Technique, ["Bartok pizzicato"], [TECHNICAL]);
    Fret => ("fret", Performance, Technique, [], [TECHNICAL]);
    StringSelection => ("string selection", Performance, Technique, [], [TECHNICAL]);
    Tap => ("tap", Performance, Technique, ["tapping"], [TECHNICAL]);
    Heel => ("heel", Performance, Technique, [], [TECHNICAL]);
    Toe => ("toe", Performance, Technique, [], [TECHNICAL]);
    Fingernails => ("fingernails", Performance, Technique, [], [TECHNICAL]);
    HoleFingering => ("hole fingering", Performance, Technique, [], [TECHNICAL]);
    HandbellTechnique => ("handbell technique", Performance, Technique, [], [TECHNICAL]);
    BrassBend => ("brass bend", Performance, Technique, [], [TECHNICAL]);
    Flip => ("flip", Performance, Technique, [], [TECHNICAL]);
    Smear => ("smear", Performance, Technique, [], [TECHNICAL]);
    OpenTone => ("open tone", Performance, Technique, [], [TECHNICAL]);
    HalfMuted => ("half muted", Performance, Technique, [], [TECHNICAL]);
    HarmonMute => ("Harmon mute", Performance, Technique, [], [TECHNICAL]);
    Golpe => ("golpe", Performance, Technique, [], [TECHNICAL]);
    NaturalHarmonic => ("natural harmonic", Performance, Technique, [], [TECHNICAL]);
    ArtificialHarmonic => ("artificial harmonic", Performance, Technique, [], [TECHNICAL]);
    BendRelease => ("bend release", Performance, Technique, [], [TECHNICAL]);
    PreBend => ("pre-bend", Performance, Technique, [], [TECHNICAL]);
    StringMute => ("string mute", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/string-mute/"]);
    PalmMute => ("palm mute", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/string-mute/"]);
    ColLegno => ("col legno", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SulPonticello => ("sul ponticello", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SulTasto => ("sul tasto", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    FlutterTonguing => ("flutter tonguing", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    Multiphonics => ("multiphonics", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    DeadNote => ("dead note", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    AlternatePicking => ("alternate picking", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SweepPicking => ("sweep picking", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    LegatoPicking => ("legato picking", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    PickScrape => ("pick scrape", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    Rasgueado => ("rasgueado", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    TremoloPicking => ("tremolo picking", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    BowPressure => ("bow pressure", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    BreathPressure => ("breath pressure", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SustainPedal => ("sustain pedal", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SostenutoPedal => ("sostenuto pedal", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    SoftPedal => ("soft pedal", Performance, Technique, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/other-play/"]);
    Staccatissimo => ("staccatissimo", Performance, Articulation, [], [ARTICULATIONS]);
    Marcato => ("marcato", Performance, Articulation, ["strong accent"], [ARTICULATIONS]);
    Scoop => ("scoop", Performance, Articulation, [], [ARTICULATIONS]);
    Plop => ("plop", Performance, Articulation, [], [ARTICULATIONS]);
    Stress => ("stress", Performance, Articulation, [], [ARTICULATIONS]);
    Unstress => ("unstress", Performance, Articulation, [], [ARTICULATIONS]);
    SoftAccent => ("soft accent", Performance, Articulation, [], [ARTICULATIONS]);
    Spiccato => ("spiccato", Performance, Articulation, [], [ARTICULATIONS]);
    InvertedTurn => ("inverted turn", Performance, Ornament, [], [ORNAMENTS]);
    DelayedTurn => ("delayed turn", Performance, Ornament, [], [ORNAMENTS]);
    DelayedInvertedTurn => ("delayed inverted turn", Performance, Ornament, [], [ORNAMENTS]);
    VerticalTurn => ("vertical turn", Performance, Ornament, [], [ORNAMENTS]);
    InvertedVerticalTurn => ("inverted vertical turn", Performance, Ornament, [], [ORNAMENTS]);
    InvertedMordent => ("inverted mordent", Performance, Ornament, [], [ORNAMENTS]);
    Schleifer => ("schleifer", Performance, Ornament, [], [ORNAMENTS]);
    Haydn => ("haydn", Performance, Ornament, [], [ORNAMENTS]);
    WavyLine => ("wavy line", Performance, Ornament, [], [ORNAMENTS]);
    TremoloAlternation => ("tremolo alternation", Performance, Ornament, [], [ORNAMENTS]);
    PitchBend => ("pitch bend", Performance, PitchGesture, ["bend"], [TECHNICAL]);
    Portamento => ("portamento", Performance, PitchGesture, [], [TECHNICAL]);
    Vibrato => ("vibrato", Performance, PitchGesture, [], [TECHNICAL]);
    Slide => ("slide", Performance, PitchGesture, [], [TECHNICAL]);
    WhammyBar => ("whammy bar", Performance, PitchGesture, [], [TECHNICAL]);
    Pianissimo => ("pianissimo", Performance, Dynamics, ["pp"], [DYNAMICS]);
    Pianississimo => ("pianississimo", Performance, Dynamics, ["ppp"], [DYNAMICS]);
    Fortissimo => ("fortissimo", Performance, Dynamics, ["ff"], [DYNAMICS]);
    Fortississimo => ("fortississimo", Performance, Dynamics, ["fff"], [DYNAMICS]);
    MezzoPiano => ("mezzo piano", Performance, Dynamics, ["mp"], [DYNAMICS]);
    MezzoForte => ("mezzo forte", Performance, Dynamics, ["mf"], [DYNAMICS]);
    Sforzando => ("sforzando", Performance, Dynamics, ["sfz", "sforzato", "sf"], [DYNAMICS]);
    Rinforzando => ("rinforzando", Performance, Dynamics, ["rfz"], [DYNAMICS]);
    Fortepiano => ("fortepiano", Performance, Dynamics, ["fp"], [DYNAMICS]);
    SforzandoPiano => ("sforzando piano", Performance, Dynamics, ["sfp"], [DYNAMICS]);
    SforzandoPianissimo => ("sforzando pianissimo", Performance, Dynamics, ["sfpp"], [DYNAMICS]);
    Niente => ("niente", Performance, Dynamics, ["n"], [DYNAMICS]);
    DynamicLevel => ("dynamic level", Performance, Dynamics, [], [DYNAMICS]);
    DynamicEnvelope => ("dynamic envelope", Performance, Dynamics, [], [DYNAMICS]);
    Dolce => ("dolce", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Espressivo => ("espressivo", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Cantabile => ("cantabile", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    ConBrio => ("con brio", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Agitato => ("agitato", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Maestoso => ("maestoso", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Misterioso => ("misterioso", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Pesante => ("pesante", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Leggiero => ("leggiero", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Sostenuto => ("sostenuto", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Tranquillo => ("tranquillo", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    Rubato => ("rubato", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    AdLibitum => ("ad libitum", Performance, Expression, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/words/"]);
    PianoInstrument => ("piano instrument", Instrumentation, Instrument, ["piano"], [INSTRUMENT_SOUNDS]);
    Violin => ("violin", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Viola => ("viola", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Cello => ("cello", Instrumentation, Instrument, ["violoncello"], [INSTRUMENT_SOUNDS]);
    DoubleBass => ("double bass", Instrumentation, Instrument, ["contrabass", "bass"], [INSTRUMENT_SOUNDS]);
    Flute => ("flute", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Piccolo => ("piccolo", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Oboe => ("oboe", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    EnglishHorn => ("English horn", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Clarinet => ("clarinet", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    BassClarinet => ("bass clarinet", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Bassoon => ("bassoon", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Contrabassoon => ("contrabassoon", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    FrenchHorn => ("French horn", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Trumpet => ("trumpet", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Trombone => ("trombone", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Tuba => ("tuba", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Harp => ("harp", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    AcousticGuitar => ("acoustic guitar", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    ElectricGuitar => ("electric guitar", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    BassGuitar => ("bass guitar", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Mandolin => ("mandolin", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Banjo => ("banjo", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Lute => ("lute", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Oud => ("oud", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Sitar => ("sitar", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Koto => ("koto", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Pipa => ("pipa", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Erhu => ("erhu", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Accordion => ("accordion", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Harmonica => ("harmonica", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Recorder => ("recorder", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Saxophone => ("saxophone", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Organ => ("organ", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Harpsichord => ("harpsichord", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Celesta => ("celesta", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Synthesizer => ("synthesizer", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Timpani => ("timpani", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    SnareDrum => ("snare drum", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    BassDrum => ("bass drum", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    TomTom => ("tom-tom", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Cymbal => ("cymbal", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    HiHat => ("hi-hat", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Triangle => ("triangle", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Tambourine => ("tambourine", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Gong => ("gong", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Marimba => ("marimba", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Xylophone => ("xylophone", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Vibraphone => ("vibraphone", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Glockenspiel => ("glockenspiel", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    TubularBells => ("tubular bells", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Tabla => ("tabla", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Djembe => ("djembe", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Conga => ("conga", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Bongo => ("bongo", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Cajon => ("cajon", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Darbuka => ("darbuka", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Shaker => ("shaker", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Castanets => ("castanets", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    WoodBlock => ("wood block", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    DrumKit => ("drum kit", Instrumentation, Instrument, [], [INSTRUMENT_SOUNDS]);
    Idiophone => ("idiophone", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Membranophone => ("membranophone", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Chordophone => ("chordophone", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Aerophone => ("aerophone", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Electrophone => ("electrophone", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Instrument => ("instrument", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    InstrumentFamily => ("instrument family", Instrumentation, Instrument, [], [INSTRUMENT_CLASSIFICATION]);
    Ensemble => ("ensemble", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    Orchestra => ("orchestra", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    ChamberOrchestra => ("chamber orchestra", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    StringOrchestra => ("string orchestra", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    Choir => ("choir", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    ChamberEnsemble => ("chamber ensemble", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    StringQuartet => ("string quartet", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    WindQuintet => ("wind quintet", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    BrassQuintet => ("brass quintet", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    BigBand => ("big band", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    RockBand => ("rock band", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    RhythmSection => ("rhythm section", Instrumentation, Ensemble, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ensemble/"]);
    Performer => ("performer", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Conductor => ("conductor", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Soloist => ("soloist", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Vocalist => ("vocalist", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Instrumentalist => ("instrumentalist", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Concertmaster => ("concertmaster", Instrumentation, Performer, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/score-instrument/"]);
    Orchestration => ("orchestration", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Instrumentation => ("instrumentation", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Doubling => ("doubling", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Divisi => ("divisi", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Tutti => ("tutti", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Solo => ("solo", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    ACappella => ("a cappella", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Desk => ("desk", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    SectionAssignment => ("section assignment", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    InstrumentAssignment => ("instrument assignment", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    PlayingRange => ("playing range", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Tessitura => ("tessitura", Instrumentation, Orchestration, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/part-group/"]);
    Timbre => ("timbre", Timbre, Timbre, ["tone color", "tone colour", "color", "colour"], [TIMBRE]);
    Spectrum => ("spectrum", Timbre, Timbre, [], [TIMBRE]);
    Partial => ("partial", Timbre, Timbre, [], [TIMBRE]);
    Overtone => ("overtone", Timbre, Timbre, [], [TIMBRE]);
    Fundamental => ("fundamental", Timbre, Timbre, [], [TIMBRE]);
    Inharmonicity => ("inharmonicity", Timbre, Timbre, [], [TIMBRE]);
    SpectralEnvelope => ("spectral envelope", Timbre, Timbre, [], [TIMBRE]);
    AmplitudeEnvelope => ("amplitude envelope", Timbre, Timbre, [], [TIMBRE]);
    AttackEnvelope => ("attack envelope", Timbre, Timbre, [], [TIMBRE]);
    Decay => ("decay", Timbre, Timbre, [], [TIMBRE]);
    Sustain => ("sustain", Timbre, Timbre, [], [TIMBRE]);
    ReleaseEnvelope => ("release envelope", Timbre, Timbre, [], [TIMBRE]);
    Resonance => ("resonance", Timbre, Timbre, [], [TIMBRE]);
    Formant => ("formant", Timbre, Timbre, [], [TIMBRE]);
    Noise => ("noise", Timbre, Timbre, [], [TIMBRE]);
    Brightness => ("brightness", Timbre, Timbre, [], [TIMBRE]);
    Roughness => ("roughness", Timbre, Timbre, [], [TIMBRE]);
    HarmonicSeries => ("harmonic series", Timbre, Timbre, [], [TIMBRE]);
    Acoustics => ("acoustics", Timbre, Timbre, [], [ACOUSTICS]);
    Frequency => ("frequency", Timbre, Timbre, [], [ACOUSTICS]);
    Amplitude => ("amplitude", Timbre, Timbre, [], [ACOUSTICS]);
    Loudness => ("loudness", Timbre, Timbre, [], [ACOUSTICS]);
    SoundPressure => ("sound pressure", Timbre, Timbre, [], [ACOUSTICS]);
    Decibel => ("decibel", Timbre, Timbre, [], [ACOUSTICS]);
    Phase => ("phase", Timbre, Timbre, [], [ACOUSTICS]);
    Reverberation => ("reverberation", Timbre, Timbre, [], [ACOUSTICS]);
    Delay => ("delay", Timbre, Timbre, [], [ACOUSTICS]);
    Echo => ("echo", Timbre, Timbre, [], [ACOUSTICS]);
    Distortion => ("distortion", Timbre, Timbre, [], [ACOUSTICS]);
    Overdrive => ("overdrive", Timbre, Timbre, [], [ACOUSTICS]);
    Filter => ("filter", Timbre, Timbre, [], [ACOUSTICS]);
    Equalization => ("equalization", Timbre, Timbre, [], [ACOUSTICS]);
    Compression => ("compression", Timbre, Timbre, [], [ACOUSTICS]);
    Panning => ("panning", Timbre, Timbre, [], [ACOUSTICS]);
    Spatialization => ("spatialization", Timbre, Timbre, [], [ACOUSTICS]);
    AmplitudeModulation => ("amplitude modulation", Timbre, Timbre, ["tremolo"], [ACOUSTICS]);
    FrequencyModulation => ("frequency modulation", Timbre, Timbre, [], [ACOUSTICS]);
    ChorusEffect => ("chorus effect", Timbre, Timbre, [], [ACOUSTICS]);
    Flanger => ("flanger", Timbre, Timbre, [], [ACOUSTICS]);
    Phaser => ("phaser", Timbre, Timbre, [], [ACOUSTICS]);
    Synthesis => ("synthesis", Timbre, Timbre, [], [ACOUSTICS]);
    Sampling => ("sampling", Timbre, Timbre, [], [ACOUSTICS]);
    SoundPreset => ("sound preset", Timbre, Timbre, [], [ACOUSTICS]);
    MajorChord => ("major chord", Harmony, Chord, ["major triad", "major"], [CHORD_KINDS]);
    MinorChord => ("minor chord", Harmony, Chord, ["minor triad", "minor"], [CHORD_KINDS]);
    DiminishedChord => ("diminished chord", Harmony, Chord, ["diminished triad", "diminished"], [CHORD_KINDS]);
    AugmentedChord => ("augmented chord", Harmony, Chord, ["augmented triad", "augmented"], [CHORD_KINDS]);
    MajorSeventhChord => ("major seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorSeventhChord => ("minor seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorMajorSeventhChord => ("minor major seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    HalfDiminishedSeventhChord => ("half-diminished seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    DiminishedSeventhChord => ("diminished seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    AugmentedSeventhChord => ("augmented seventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    MajorSixthChord => ("major sixth chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorSixthChord => ("minor sixth chord", Harmony, Chord, [], [CHORD_KINDS]);
    SuspendedSecondChord => ("suspended second chord", Harmony, Chord, ["sus2"], [CHORD_KINDS]);
    SuspendedFourthChord => ("suspended fourth chord", Harmony, Chord, ["sus4"], [CHORD_KINDS]);
    MajorNinthChord => ("major ninth chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorNinthChord => ("minor ninth chord", Harmony, Chord, [], [CHORD_KINDS]);
    DominantEleventhChord => ("dominant eleventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    DominantThirteenthChord => ("dominant thirteenth chord", Harmony, Chord, [], [CHORD_KINDS]);
    MajorEleventhChord => ("major eleventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    MajorThirteenthChord => ("major thirteenth chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorEleventhChord => ("minor eleventh chord", Harmony, Chord, [], [CHORD_KINDS]);
    MinorThirteenthChord => ("minor thirteenth chord", Harmony, Chord, [], [CHORD_KINDS]);
    ItalianSixth => ("Italian sixth", Harmony, Chord, [], [CHORD_KINDS]);
    FrenchSixth => ("French sixth", Harmony, Chord, [], [CHORD_KINDS]);
    GermanSixth => ("German sixth", Harmony, Chord, [], [CHORD_KINDS]);
    NeapolitanSixth => ("Neapolitan sixth", Harmony, Chord, [], [CHORD_KINDS]);
    TristanChord => ("Tristan chord", Harmony, Chord, [], [CHORD_KINDS]);
    ChordMember => ("chord member", Harmony, Chord, [], [CHORD_KINDS]);
    AddedDegree => ("added degree", Harmony, Chord, [], [CHORD_KINDS]);
    AlteredDegree => ("altered degree", Harmony, Chord, [], [CHORD_KINDS]);
    OmittedDegree => ("omitted degree", Harmony, Chord, [], [CHORD_KINDS]);
    HarmonicColor => ("harmonic color", Harmony, Chord, ["color", "colour"], [CHORD_KINDS]);
    Sonority => ("sonority", Harmony, Chord, [], [CHORD_KINDS]);
    PedalPoint => ("pedal point", Harmony, Chord, [], [CHORD_KINDS]);
    Voicing => ("voicing", Harmony, Voicing, [], [ANALYSIS]);
    RootPosition => ("root position", Harmony, Voicing, [], [ANALYSIS]);
    FirstInversion => ("first inversion", Harmony, Voicing, [], [ANALYSIS]);
    SecondInversion => ("second inversion", Harmony, Voicing, [], [ANALYSIS]);
    ThirdInversion => ("third inversion", Harmony, Voicing, [], [ANALYSIS]);
    CloseVoicing => ("close voicing", Harmony, Voicing, [], [ANALYSIS]);
    OpenVoicing => ("open voicing", Harmony, Voicing, [], [ANALYSIS]);
    DropVoicing => ("drop voicing", Harmony, Voicing, [], [ANALYSIS]);
    VoiceLeading => ("voice leading", Harmony, Voicing, [], [ANALYSIS]);
    VoiceCrossing => ("voice crossing", Harmony, Voicing, [], [ANALYSIS]);
    Spacing => ("spacing", Harmony, Voicing, [], [ANALYSIS]);
    RegisterPlacement => ("register placement", Harmony, Voicing, [], [ANALYSIS]);
    HarmonicFunction => ("harmonic function", Harmony, HarmonicFunction, [], [ANALYSIS]);
    HarmonicRhythm => ("harmonic rhythm", Harmony, HarmonicFunction, [], [ANALYSIS]);
    ChordProgression => ("chord progression", Harmony, HarmonicFunction, [], [ANALYSIS]);
    Tonicization => ("tonicization", Harmony, HarmonicFunction, [], [ANALYSIS]);
    SecondaryDominant => ("secondary dominant", Harmony, HarmonicFunction, [], [ANALYSIS]);
    ModalMixture => ("modal mixture", Harmony, HarmonicFunction, [], [ANALYSIS]);
    DeceptiveCadence => ("deceptive cadence", Harmony, HarmonicFunction, [], [ANALYSIS]);
    PerfectAuthenticCadence => ("perfect authentic cadence", Harmony, HarmonicFunction, [], [ANALYSIS]);
    ImperfectAuthenticCadence => ("imperfect authentic cadence", Harmony, HarmonicFunction, [], [ANALYSIS]);
    HalfCadence => ("half cadence", Harmony, HarmonicFunction, [], [ANALYSIS]);
    PlagalCadence => ("plagal cadence", Harmony, HarmonicFunction, [], [ANALYSIS]);
    PentatonicScale => ("pentatonic scale", Pitch, Scale, [], [lily!("scale")]);
    WholeToneScale => ("whole-tone scale", Pitch, Scale, [], [lily!("scale")]);
    OctatonicScale => ("octatonic scale", Pitch, Scale, ["diminished scale"], [lily!("scale")]);
    HexatonicScale => ("hexatonic scale", Pitch, Scale, [], [lily!("scale")]);
    BluesScale => ("blues scale", Pitch, Scale, [], [lily!("scale")]);
    NaturalMinorScale => ("natural minor scale", Pitch, Scale, ["ancient minor scale"], [lily!("scale"), lily!("ancient-minor-scale")]);
    HarmonicMinorScale => ("harmonic minor scale", Pitch, Scale, [], [lily!("scale")]);
    MelodicMinorScale => ("melodic minor scale", Pitch, Scale, [], [lily!("scale")]);
    IonianMode => ("ionian mode", Pitch, Scale, [], [lily!("scale")]);
    PhrygianMode => ("phrygian mode", Pitch, Scale, [], [lily!("scale")]);
    LydianMode => ("lydian mode", Pitch, Scale, [], [lily!("scale")]);
    AeolianMode => ("aeolian mode", Pitch, Scale, [], [lily!("scale")]);
    LocrianMode => ("locrian mode", Pitch, Scale, [], [lily!("scale")]);
    LydianDominant => ("lydian dominant", Pitch, Scale, [], [lily!("scale")]);
    AlteredScale => ("altered scale", Pitch, Scale, [], [lily!("scale")]);
    PitchCollection => ("pitch collection", Pitch, Scale, [], [lily!("scale")]);
    PitchLattice => ("pitch lattice", Pitch, Scale, [], [lily!("scale")]);
    PitchClass => ("pitch class", Pitch, Pitch, [], [lily!("pitch")]);
    Register => ("register", Pitch, Pitch, [], [lily!("pitch")]);
    PitchRange => ("pitch range", Pitch, Pitch, [], [lily!("pitch")]);
    NativePitch => ("native pitch", Pitch, Pitch, [], [lily!("pitch")]);
    UnpitchedSound => ("unpitched sound", Pitch, Pitch, [], [lily!("pitch")]);
    PitchSpelling => ("pitch spelling", Pitch, Spelling, [], [lily!("enharmonic")]);
    MicrotonalAccidental => ("microtonal accidental", Pitch, Spelling, [], [lily!("enharmonic")]);
    Tuning => ("tuning", Pitch, Tuning, [], [lily!("temperament")]);
    ReferencePitch => ("reference pitch", Pitch, Tuning, [], [lily!("temperament")]);
    EqualDivision => ("equal division", Pitch, Tuning, [], [lily!("temperament")]);
    Microtonality => ("microtonality", Pitch, Tuning, [], [lily!("temperament")]);
    NonOctaveTuning => ("non-octave tuning", Pitch, Tuning, [], [lily!("temperament")]);
    TonalCenter => ("tonal center", Harmony, Key, [], [lily!("key")]);
    Tonality => ("tonality", Harmony, Key, [], [lily!("key")]);
    Atonality => ("atonality", Harmony, Key, [], [lily!("key")]);
    Bitonality => ("bitonality", Harmony, Key, [], [lily!("key")]);
    Polytonality => ("polytonality", Harmony, Key, [], [lily!("key")]);
    RhythmicCell => ("rhythmic cell", Rhythm, Rhythm, [], [lily!("rhythm")]);
    Onset => ("onset", Rhythm, Rhythm, [], [lily!("rhythm")]);
    ReleaseTime => ("release time", Rhythm, Rhythm, [], [lily!("rhythm")]);
    InterOnsetInterval => ("inter-onset interval", Rhythm, Rhythm, [], [lily!("rhythm")]);
    Polyrhythm => ("polyrhythm", Rhythm, Rhythm, [], [lily!("rhythm")]);
    CrossRhythm => ("cross-rhythm", Rhythm, Rhythm, [], [lily!("rhythm")]);
    RhythmicCycle => ("rhythmic cycle", Rhythm, Rhythm, [], [lily!("rhythm")]);
    RhythmicDensity => ("rhythmic density", Rhythm, Rhythm, [], [lily!("rhythm")]);
    AttackPattern => ("attack pattern", Rhythm, Rhythm, [], [lily!("rhythm")]);
    Subdivision => ("subdivision", Rhythm, Subdivision, [], [lily!("beat")]);
    BinarySubdivision => ("binary subdivision", Rhythm, Subdivision, [], [lily!("beat")]);
    TernarySubdivision => ("ternary subdivision", Rhythm, Subdivision, [], [lily!("beat")]);
    Pulse => ("pulse", Rhythm, Beat, [], [lily!("beat")]);
    Tactus => ("tactus", Rhythm, Beat, [], [lily!("beat")]);
    Downbeat => ("downbeat", Rhythm, Beat, [], [lily!("beat")]);
    Backbeat => ("backbeat", Rhythm, Beat, [], [lily!("beat")]);
    Groove => ("groove", Rhythm, Groove, [], [lily!("rhythm")]);
    Swing => ("swing", Rhythm, Groove, [], [lily!("rhythm")]);
    Shuffle => ("shuffle", Rhythm, Groove, [], [lily!("rhythm")]);
    Microtiming => ("microtiming", Rhythm, Groove, [], [lily!("rhythm")]);
    LaidBackTiming => ("laid-back timing", Rhythm, Groove, [], [lily!("rhythm")]);
    PushedTiming => ("pushed timing", Rhythm, Groove, [], [lily!("rhythm")]);
    AdditiveMeter => ("additive meter", Rhythm, Meter, [], [lily!("meter")]);
    AsymmetricMeter => ("asymmetric meter", Rhythm, Meter, [], [lily!("meter")]);
    MixedMeter => ("mixed meter", Rhythm, Meter, [], [lily!("meter")]);
    FreeMeter => ("free meter", Rhythm, Meter, [], [lily!("meter")]);
    MeterGroup => ("meter group", Rhythm, Meter, [], [lily!("meter")]);
    MetricalAccent => ("metrical accent", Rhythm, Meter, [], [lily!("meter")]);
    Tempo => ("tempo", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    TempoCurve => ("tempo curve", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    MetricModulation => ("metric modulation", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    ATempo => ("a tempo", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    TempoPrimo => ("tempo primo", Rhythm, Tempo, [], [lily!("tempo-indication")]);
    MelodicVoice => ("melodic voice", Structure, Voice, [], [lily!("voice")]);
    VoiceSuccession => ("voice succession", Structure, Voice, [], [lily!("voice")]);
    VoiceAssignment => ("voice assignment", Structure, Voice, [], [lily!("voice")]);
    ParallelMotion => ("parallel motion", Structure, Voice, [], [lily!("voice")]);
    ContraryMotion => ("contrary motion", Structure, Voice, [], [lily!("voice")]);
    ObliqueMotion => ("oblique motion", Structure, Voice, [], [lily!("voice")]);
    SimilarMotion => ("similar motion", Structure, Voice, [], [lily!("voice")]);
    Melody => ("melody", Structure, Phrase, [], [lily!("phrase")]);
    MelodicContour => ("melodic contour", Structure, Phrase, [], [lily!("phrase")]);
    Subphrase => ("subphrase", Structure, Phrase, [], [lily!("phrase")]);
    Antecedent => ("antecedent", Structure, Phrase, [], [lily!("phrase")]);
    Consequent => ("consequent", Structure, Phrase, [], [lily!("phrase")]);
    Period => ("period", Structure, Phrase, [], [lily!("phrase")]);
    Sentence => ("sentence", Structure, Phrase, [], [lily!("phrase")]);
    PhraseBoundary => ("phrase boundary", Structure, Phrase, [], [lily!("phrase")]);
    PhraseElision => ("phrase elision", Structure, Phrase, [], [lily!("phrase")]);
    Theme => ("theme", Structure, Motif, [], [lily!("motif")]);
    Riff => ("riff", Structure, Motif, [], [lily!("motif")]);
    MusicalHook => ("musical hook", Structure, Motif, ["hook"], [lily!("motif")]);
    Leitmotif => ("leitmotif", Structure, Motif, [], [lily!("motif")]);
    MelodicCell => ("melodic cell", Structure, Motif, [], [lily!("motif")]);
    Form => ("form", Structure, Form, [], [lily!("sonata-form")]);
    Section => ("section", Structure, Form, [], [lily!("sonata-form")]);
    Introduction => ("introduction", Structure, Form, [], [lily!("sonata-form")]);
    Verse => ("verse", Structure, Form, [], [lily!("sonata-form")]);
    Chorus => ("chorus", Structure, Form, [], [lily!("sonata-form")]);
    Bridge => ("bridge", Structure, Form, [], [lily!("sonata-form")]);
    Refrain => ("refrain", Structure, Form, [], [lily!("sonata-form")]);
    PreChorus => ("pre-chorus", Structure, Form, [], [lily!("sonata-form")]);
    Interlude => ("interlude", Structure, Form, [], [lily!("sonata-form")]);
    Transition => ("transition", Structure, Form, [], [lily!("sonata-form")]);
    Development => ("development", Structure, Form, [], [lily!("sonata-form")]);
    Recapitulation => ("recapitulation", Structure, Form, [], [lily!("sonata-form")]);
    Coda => ("coda", Structure, Form, [], [lily!("sonata-form")]);
    Codetta => ("codetta", Structure, Form, [], [lily!("sonata-form")]);
    Exposition => ("exposition", Structure, Form, [], [lily!("sonata-form")]);
    Variation => ("variation", Structure, Form, [], [lily!("sonata-form")]);
    BinaryForm => ("binary form", Structure, Form, [], [lily!("sonata-form")]);
    TernaryForm => ("ternary form", Structure, Form, [], [lily!("sonata-form")]);
    Rondo => ("rondo", Structure, Form, [], [lily!("sonata-form")]);
    StrophicForm => ("strophic form", Structure, Form, [], [lily!("sonata-form")]);
    ThroughComposedForm => ("through-composed form", Structure, Form, [], [lily!("sonata-form")]);
    ThemeAndVariations => ("theme and variations", Structure, Form, [], [lily!("sonata-form")]);
    Passacaglia => ("passacaglia", Structure, Form, [], [lily!("sonata-form")]);
    Chaconne => ("chaconne", Structure, Form, [], [lily!("sonata-form")]);
    Suite => ("suite", Structure, Form, [], [lily!("sonata-form")]);
    Concerto => ("concerto", Structure, Form, [], [lily!("sonata-form")]);
    Prelude => ("prelude", Structure, Form, [], [lily!("sonata-form")]);
    Texture => ("texture", Structure, Texture, [], [lily!("counterpoint")]);
    Monophony => ("monophony", Structure, Texture, [], [lily!("counterpoint")]);
    Heterophony => ("heterophony", Structure, Texture, [], [lily!("counterpoint")]);
    Imitation => ("imitation", Structure, Texture, [], [lily!("counterpoint")]);
    Ostinato => ("ostinato", Structure, Texture, [], [lily!("counterpoint")]);
    Drone => ("drone", Structure, Texture, [], [lily!("counterpoint")]);
    Accompaniment => ("accompaniment", Structure, Texture, [], [lily!("counterpoint")]);
    MelodyAndAccompaniment => ("melody and accompaniment", Structure, Texture, [], [lily!("counterpoint")]);
    ContrapuntalTexture => ("contrapuntal texture", Structure, Texture, [], [lily!("counterpoint")]);
    MelodicInversion => ("melodic inversion", Structure, Transformation, ["inversion"], [lily!("transposition")]);
    Retrograde => ("retrograde", Structure, Transformation, [], [lily!("transposition")]);
    RetrogradeInversion => ("retrograde inversion", Structure, Transformation, [], [lily!("transposition")]);
    Fragmentation => ("fragmentation", Structure, Transformation, [], [lily!("transposition")]);
    RhythmicDisplacement => ("rhythmic displacement", Structure, Transformation, [], [lily!("transposition")]);
    Sequence => ("sequence", Structure, Transformation, [], [lily!("transposition")]);
    Reharmonization => ("reharmonization", Structure, Transformation, [], [lily!("transposition")]);
    Repetition => ("repetition", Structure, Transformation, [], [lily!("transposition")]);
    DevelopmentalVariation => ("developmental variation", Structure, Transformation, [], [lily!("transposition")]);
    PassingTone => ("passing tone", Performance, Ornament, [], [ANALYSIS]);
    Suspension => ("suspension", Performance, Ornament, [], [ANALYSIS]);
    Retardation => ("retardation", Performance, Ornament, [], [ANALYSIS]);
    Anticipation => ("anticipation", Performance, Ornament, [], [ANALYSIS]);
    EscapeTone => ("escape tone", Performance, Ornament, [], [ANALYSIS]);
    ChangingTone => ("changing tone", Performance, Ornament, [], [ANALYSIS]);
    Enclosure => ("enclosure", Performance, Ornament, [], [ANALYSIS]);
    EmbellishmentAnchor => ("embellishment anchor", Performance, Ornament, [], [ANALYSIS]);
    PhraseMark => ("phrase mark", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    Tablature => ("tablature", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    RomanNumeral => ("Roman numeral", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    ChordSymbol => ("chord symbol", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    RehearsalMark => ("rehearsal mark", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    RehearsalLetter => ("rehearsal letter", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    Segno => ("segno", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    CodaSign => ("coda sign", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    DaCapoAlFine => ("da capo al fine", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    DalSegnoAlCoda => ("dal segno al coda", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    RepeatCount => ("repeat count", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    EditorialAccidental => ("editorial accidental", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    CourtesyAccidental => ("courtesy accidental", Notation, Notation, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/"]);
    Syllable => ("syllable", Text, Lyrics, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/lyric/"]);
    VerseNumber => ("verse number", Text, Lyrics, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/lyric/"]);
    Phoneme => ("phoneme", Text, Lyrics, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/lyric/"]);
    SyllabicSinging => ("syllabic singing", Text, Lyrics, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/lyric/"]);
    Work => ("work", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Edition => ("edition", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Composer => ("composer", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Arranger => ("arranger", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Lyricist => ("lyricist", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Editor => ("editor", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Source => ("source", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Manuscript => ("manuscript", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Transcription => ("transcription", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Recording => ("recording", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Performance => ("performance", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Interpretation => ("interpretation", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Observation => ("observation", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Authorship => ("authorship", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Provenance => ("provenance", Provenance, Provenance, [], ["https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/identification/"]);
    Tradition => ("tradition", Tradition, Tradition, [], ["https://www.maqamworld.com/en/maqam.php"]);
    ModalFramework => ("modal framework", Tradition, Tradition, [], ["https://www.maqamworld.com/en/maqam.php"]);
    MelodicPath => ("melodic path", Tradition, Tradition, ["sayr"], ["https://www.maqamworld.com/en/maqam.php"]);
    Jins => ("jins", Tradition, Tradition, ["ajnas"], ["https://www.maqamworld.com/en/jins.php"]);
    Ghammaz => ("ghammaz", Tradition, Tradition, [], ["https://www.maqamworld.com/en/jins.php"]);
    JinsBaggage => ("jins baggage", Tradition, Tradition, [], ["https://www.maqamworld.com/en/jins.php"]);
    Iqa => ("iqa", Tradition, Tradition, ["iqa‘", "iqaat"], ["https://www.maqamworld.com/en/iqaa.php"]);
    Dum => ("dum", Tradition, Tradition, [], ["https://www.maqamworld.com/en/iqaa.php"]);
    Tak => ("tak", Tradition, Tradition, [], ["https://www.maqamworld.com/en/iqaa.php"]);
}

pub fn glossary() -> Vec<GlossaryEntry> {
    MusicTerm::ALL.iter().map(|term| term.entry()).collect()
}

fn normalized_term(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace(['‐', '‑', '–'], "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// All matching senses, in stable vocabulary order. An empty result is unknown,
/// never a guessed synonym. "Piano", "hook", "color" and "inversion" retain
/// distinct musical meanings; callers must choose an intended sense explicitly.
pub fn lookup_term(value: &str) -> Vec<MusicTerm> {
    let query = normalized_term(value);
    if query.is_empty() {
        return Vec::new();
    }
    MusicTerm::ALL
        .iter()
        .copied()
        .filter(|term| {
            let entry = term.entry();
            normalized_term(&entry.name) == query
                || entry
                    .aliases
                    .iter()
                    .any(|alias| normalized_term(alias) == query)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[derive(Deserialize)]
    struct Manifest {
        sources: Vec<ManifestSource>,
    }
    #[derive(Deserialize)]
    struct ManifestSource {
        id: String,
        headings: Vec<ManifestHeading>,
    }
    #[derive(Deserialize)]
    struct ManifestHeading {
        section: String,
        heading: String,
        url: String,
        term: MusicTerm,
    }

    #[test]
    fn every_pinned_glossary_headword_resolves_to_its_declared_sense() {
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../../../docs/research/music-vocabulary.json"
        ))
        .expect("valid independent source inventory");
        let source = manifest
            .sources
            .iter()
            .find(|s| s.id == "lilypond-2.26")
            .unwrap();
        assert_eq!(source.headings.len(), 354);
        assert_eq!(
            source
                .headings
                .iter()
                .filter(|h| h.section.starts_with("1."))
                .count(),
            344
        );
        assert_eq!(
            source
                .headings
                .iter()
                .filter(|h| h.section.starts_with("4."))
                .count(),
            10
        );
        let mut sections = HashSet::new();
        let mut urls = HashSet::new();
        for h in &source.headings {
            assert!(
                sections.insert(&h.section),
                "duplicate source section: {}",
                h.section
            );
            assert!(urls.insert(&h.url), "duplicate source URL: {}", h.url);
            assert!(
                lookup_term(&h.heading).contains(&h.term),
                "unmapped source heading: {}",
                h.heading
            );
            assert!(
                h.term.entry().sources.contains(&h.url),
                "missing provenance: {}",
                h.heading
            );
        }
    }

    #[test]
    fn catalog_has_unique_typed_concepts_and_explicit_classification() {
        let entries = glossary();
        assert!(entries.len() >= 450);
        let mut terms = HashSet::new();
        let mut names = HashSet::new();
        let mut categories = HashSet::new();
        for entry in entries {
            assert!(terms.insert(entry.term));
            assert!(names.insert(entry.name.clone()));
            assert!(!entry.sources.is_empty());
            assert!(entry.sources.iter().all(|s| s.starts_with("https://")));
            assert!(lookup_term(&entry.name).contains(&entry.term));
            categories.insert(entry.representation);
            assert_eq!(
                entry.representation.component_kind().is_none(),
                entry.representation == Representation::Provenance
            );
            let serialized = serde_json::to_string(&entry.term).unwrap();
            assert_eq!(
                serde_json::from_str::<MusicTerm>(&serialized).unwrap(),
                entry.term
            );
        }
        assert_eq!(categories.len(), 39);
    }

    #[test]
    fn aliases_preserve_ambiguity_and_distinct_dimensions() {
        assert_eq!(lookup_term(" hammer-off "), vec![MusicTerm::PullOff]);
        assert_eq!(lookup_term("motive"), vec![MusicTerm::Motif]);
        assert_eq!(lookup_term("semibreve"), vec![MusicTerm::WholeNote]);
        assert_eq!(
            lookup_term("piano"),
            vec![MusicTerm::PianoDynamic, MusicTerm::PianoInstrument]
        );
        assert_eq!(
            lookup_term("hook"),
            vec![MusicTerm::Flag, MusicTerm::MusicalHook]
        );
        assert!(lookup_term("color").contains(&MusicTerm::Timbre));
        assert!(lookup_term("color").contains(&MusicTerm::HarmonicColor));
        assert_ne!(
            MusicTerm::AugmentedInterval.entry().representation,
            MusicTerm::AugmentedChord.entry().representation
        );
        assert_ne!(
            MusicTerm::Augmentation.entry().representation,
            MusicTerm::AugmentedInterval.entry().representation
        );
        assert_ne!(
            MusicTerm::PitchBend.entry().representation,
            MusicTerm::HammerOn.entry().representation
        );
        assert!(lookup_term("unrecognized future term").is_empty());
    }
}
