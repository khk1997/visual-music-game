export const BACKGROUND_THEMES = [
    {
        id: 'playstation-style',
        label: 'PlayStation Style',
        color: 0x000000,
        exposure: 2.0,
        description: '經典霧化符號背景，亮度高、對比強，適合自由演奏時快速看清互動反饋。',
        previewBackground: 'radial-gradient(circle at 22% 18%, rgba(255,255,255,0.2), transparent 28%), radial-gradient(circle at 76% 70%, rgba(98, 142, 255, 0.24), transparent 34%), linear-gradient(180deg, rgba(30,36,48,0.96), rgba(14,18,26,0.96))'
    },
    {
        id: 'deep-blue',
        label: 'Piano Roll',
        color: 0x03111f,
        exposure: 1.75,
        description: '藍色長條與光暈音軌為主，節奏感更聚焦，適合 piano roll 視覺演出。',
        previewBackground: 'radial-gradient(circle at 70% 24%, rgba(115, 202, 255, 0.2), transparent 34%), radial-gradient(circle at 22% 76%, rgba(40, 124, 210, 0.24), transparent 38%), linear-gradient(180deg, rgba(8, 25, 42, 0.97), rgba(3, 13, 24, 0.97))'
    },
    {
        id: 'theme-3',
        label: 'theme3',
        color: 0x120f22,
        exposure: 1.6,
        description: 'Theme placeholder 3.',
        previewBackground: 'radial-gradient(circle at 22% 18%, rgba(213, 142, 255, 0.22), transparent 30%), radial-gradient(circle at 74% 68%, rgba(87, 118, 255, 0.2), transparent 34%), linear-gradient(180deg, rgba(22, 16, 40, 0.96), rgba(10, 9, 24, 0.98))'
    },
    {
        id: 'theme-4',
        label: 'theme4',
        color: 0x101820,
        exposure: 1.55,
        description: 'Theme placeholder 4.',
        previewBackground: 'radial-gradient(circle at 28% 22%, rgba(125, 232, 255, 0.18), transparent 26%), radial-gradient(circle at 78% 74%, rgba(51, 203, 179, 0.16), transparent 34%), linear-gradient(180deg, rgba(16, 28, 37, 0.96), rgba(8, 14, 20, 0.98))'
    },
    {
        id: 'theme-5',
        label: 'theme5',
        color: 0x22140f,
        exposure: 1.58,
        description: 'Theme placeholder 5.',
        previewBackground: 'radial-gradient(circle at 26% 24%, rgba(255, 204, 130, 0.18), transparent 28%), radial-gradient(circle at 76% 68%, rgba(255, 125, 94, 0.18), transparent 32%), linear-gradient(180deg, rgba(36, 20, 16, 0.96), rgba(18, 10, 10, 0.98))'
    },
    {
        id: 'theme-6',
        label: 'theme6',
        color: 0x0f182b,
        exposure: 1.62,
        description: 'Theme placeholder 6.',
        previewBackground: 'radial-gradient(circle at 24% 20%, rgba(177, 220, 255, 0.18), transparent 28%), radial-gradient(circle at 72% 72%, rgba(74, 114, 255, 0.24), transparent 34%), linear-gradient(180deg, rgba(15, 26, 46, 0.96), rgba(8, 13, 24, 0.98))'
    },
    {
        id: 'theme-7',
        label: 'theme7',
        color: 0x1c1324,
        exposure: 1.64,
        description: 'Theme placeholder 7.',
        previewBackground: 'radial-gradient(circle at 24% 18%, rgba(255, 180, 227, 0.22), transparent 28%), radial-gradient(circle at 80% 74%, rgba(163, 126, 255, 0.2), transparent 34%), linear-gradient(180deg, rgba(29, 19, 40, 0.96), rgba(14, 10, 24, 0.98))'
    }
];

export const INSTRUMENT_VOLUMES = {
    synth: 0,
    piano: 3,
    harp: 10,
    big_ben: -10,
    bell: 0,
    pluck: -3,
    chiptune_lead: -9,
    saw_lead: -8,
    lofi_ep: 3
};

export const PIANO_SAMPLE_CONFIG = {
    urls: {
        A1: 'A1.mp3',
        C2: 'C2.mp3',
        'D#2': 'Ds2.mp3',
        'F#2': 'Fs2.mp3',
        A2: 'A2.mp3',
        C3: 'C3.mp3',
        'D#3': 'Ds3.mp3',
        'F#3': 'Fs3.mp3',
        A3: 'A3.mp3',
        C4: 'C4.mp3',
        'D#4': 'Ds4.mp3',
        'F#4': 'Fs4.mp3',
        A4: 'A4.mp3',
        C5: 'C5.mp3',
        'D#5': 'Ds5.mp3',
        'F#5': 'Fs5.mp3',
        A5: 'A5.mp3',
        C6: 'C6.mp3',
        'D#6': 'Ds6.mp3',
        'F#6': 'Fs6.mp3',
        A6: 'A6.mp3',
        C7: 'C7.mp3',
        'D#7': 'Ds7.mp3',
        'F#7': 'Fs7.mp3',
        A7: 'A7.mp3',
        C8: 'C8.mp3'
    },
    baseUrl: 'https://tonejs.github.io/audio/salamander/'
};

export const HARP_SAMPLE_CONFIG = {
    urls: {
        A2: 'A2.wav',
        C3: 'C3.wav',
        E3: 'E3.wav',
        A4: 'A4.wav',
        C5: 'C5.wav',
        E5: 'E5.wav',
        A6: 'A6.wav'
    },
    baseUrl: './harp/'
};

export const BIG_BEN_SAMPLE_CONFIG = {
    urls: {
        Bb3: 'Bb3.mp3'
    },
    baseUrl: './assets/samples/big-ben/'
};

export const PIANO_RELEASE = 0.18;

export const ABSOLUTE_PITCH_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const ABSOLUTE_PITCH_NOTE_LABELS = {
    C: { solfege: 'Do', degree: '1' },
    'C#': { solfege: '升Do', degree: '#1' },
    D: { solfege: 'Re', degree: '2' },
    'D#': { solfege: '升Re', degree: '#2' },
    E: { solfege: 'Mi', degree: '3' },
    F: { solfege: 'Fa', degree: '4' },
    'F#': { solfege: '升Fa', degree: '#4' },
    G: { solfege: 'Sol', degree: '5' },
    'G#': { solfege: '升Sol', degree: '#5' },
    A: { solfege: 'La', degree: '6' },
    'A#': { solfege: '升La', degree: '#6' },
    B: { solfege: 'Si', degree: '7' }
};

export const ABSOLUTE_PITCH_TOTAL_QUESTIONS = 15;
export const ABSOLUTE_PITCH_TIME_LIMIT = 10;
export const ABSOLUTE_PITCH_BASE_MIDI = 60;
export const ABSOLUTE_PITCH_MODES = {
    easy: { label: '簡單', noteCount: 1 },
    hard: { label: '困難', noteCount: 2 }
};

export const LOW_LATENCY_CONFIG = {
    lookAhead: 0.005,
    updateInterval: 0.01
};

export const NOTE_TO_PC = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
    E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
    Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export const SCALE_KEY_MAP = {
    z: { degree: 0, octaveBase: 48 },
    x: { degree: 1, octaveBase: 48 },
    c: { degree: 2, octaveBase: 48 },
    v: { degree: 3, octaveBase: 48 },
    b: { degree: 4, octaveBase: 48 },
    n: { degree: 5, octaveBase: 48 },
    m: { degree: 6, octaveBase: 48 },
    a: { degree: 0, octaveBase: 60 },
    s: { degree: 1, octaveBase: 60 },
    d: { degree: 2, octaveBase: 60 },
    f: { degree: 3, octaveBase: 60 },
    g: { degree: 4, octaveBase: 60 },
    h: { degree: 5, octaveBase: 60 },
    j: { degree: 6, octaveBase: 60 },
    k: { degree: 0, octaveBase: 72 },
    l: { degree: 1, octaveBase: 72 },
    q: { degree: 0, octaveBase: 72 },
    w: { degree: 1, octaveBase: 72 },
    e: { degree: 2, octaveBase: 72 },
    r: { degree: 3, octaveBase: 72 },
    t: { degree: 4, octaveBase: 72 },
    y: { degree: 5, octaveBase: 72 },
    u: { degree: 6, octaveBase: 72 },
    i: { degree: 0, octaveBase: 84 },
    o: { degree: 1, octaveBase: 84 },
    p: { degree: 2, octaveBase: 84 }
};
