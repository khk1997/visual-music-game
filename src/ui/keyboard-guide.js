import {
    MAJOR_SCALE,
    NATURAL_MINOR_SCALE,
    NOTE_TO_PC,
    SCALE_KEY_MAP
} from '../core/config.js';

const GUIDE_ROWS = [
    { id: 'upper', keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], label: 'Upper' },
    { id: 'home', keys: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], label: 'Home' },
    { id: 'lower', keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm'], label: 'Lower' }
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function getNoteName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12];
}

function getKeyboardGuideNotes(root, mode) {
    const rootPc = NOTE_TO_PC[root] ?? 0;
    const scale = mode === 'minor' ? NATURAL_MINOR_SCALE : MAJOR_SCALE;

    return new Map(Object.entries(SCALE_KEY_MAP).map(([key, info]) => {
        const midi = Math.max(21, Math.min(108, info.octaveBase + rootPc + scale[info.degree]));

        return [key, {
            degree: info.degree + 1,
            midi,
            note: getNoteName(midi),
            octave: Math.floor(midi / 12) - 1
        }];
    }));
}

function createKeyElement(key, noteInfo) {
    const keyEl = document.createElement('div');
    keyEl.className = 'keyboard-guide-key';
    keyEl.dataset.guideKey = key;

    const keyCap = document.createElement('span');
    keyCap.className = 'keyboard-guide-keycap';
    keyCap.textContent = key.toUpperCase();

    const note = document.createElement('span');
    note.className = 'keyboard-guide-note';
    note.textContent = `${noteInfo.note}${noteInfo.octave}`;

    const degree = document.createElement('span');
    degree.className = 'keyboard-guide-degree';
    degree.textContent = String(noteInfo.degree);

    keyEl.append(keyCap, note, degree);
    return keyEl;
}

export function createKeyboardGuideController({
    guideEl,
    toggleButton,
    getCurrentKeyRoot,
    getCurrentMode
}) {
    let isOpen = false;
    const activeKeys = new Set();

    function getKeyElement(key) {
        return guideEl.querySelector(`[data-guide-key="${key}"]`);
    }

    function syncActiveKey(key) {
        getKeyElement(key)?.classList.toggle('is-active', activeKeys.has(key));
    }

    function setOpen(nextOpen) {
        isOpen = nextOpen;
        guideEl.classList.toggle('is-open', isOpen);
        guideEl.setAttribute('aria-hidden', String(!isOpen));
        toggleButton.classList.toggle('is-active', isOpen);
        toggleButton.setAttribute('aria-expanded', String(isOpen));
    }

    function render() {
        const root = getCurrentKeyRoot();
        const mode = getCurrentMode();
        const modeLabel = mode === 'minor' ? 'Minor' : 'Major';
        const notesByKey = getKeyboardGuideNotes(root, mode);

        guideEl.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'keyboard-guide-header';

        const titleGroup = document.createElement('div');

        const eyebrow = document.createElement('div');
        eyebrow.className = 'keyboard-guide-eyebrow';
        eyebrow.textContent = 'Keyboard Guide';

        const title = document.createElement('div');
        title.className = 'keyboard-guide-title';
        title.textContent = `${root} ${modeLabel}`;

        titleGroup.append(eyebrow, title);

        const closeButton = document.createElement('button');
        closeButton.className = 'keyboard-guide-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close keyboard guide');
        closeButton.textContent = 'x';
        closeButton.addEventListener('click', () => setOpen(false));

        header.append(titleGroup, closeButton);
        guideEl.appendChild(header);

        const rows = document.createElement('div');
        rows.className = 'keyboard-guide-rows';

        for (const rowConfig of GUIDE_ROWS) {
            const row = document.createElement('div');
            row.className = `keyboard-guide-row keyboard-guide-row-${rowConfig.id}`;
            row.setAttribute('aria-label', `${rowConfig.label} keyboard row`);

            for (const key of rowConfig.keys) {
                const noteInfo = notesByKey.get(key);
                if (!noteInfo) continue;
                const keyEl = createKeyElement(key, noteInfo);
                keyEl.classList.toggle('is-active', activeKeys.has(key));
                row.appendChild(keyEl);
            }

            rows.appendChild(row);
        }

        const footer = document.createElement('div');
        footer.className = 'keyboard-guide-footer';
        footer.innerHTML = `
            <span><strong>Shift</strong> +1 semitone</span>
            <span><strong>Ctrl</strong> -1 semitone</span>
            <span><strong>1-6</strong> record slots</span>
        `;

        guideEl.append(rows, footer);
    }

    function bind() {
        toggleButton.addEventListener('click', () => setOpen(!isOpen));
        render();
        setOpen(false);
    }

    return {
        activateKey: (key) => {
            activeKeys.add(key);
            syncActiveKey(key);
        },
        bind,
        clearActiveKeys: () => {
            activeKeys.clear();
            for (const keyEl of guideEl.querySelectorAll('.keyboard-guide-key.is-active')) {
                keyEl.classList.remove('is-active');
            }
        },
        deactivateKey: (key) => {
            activeKeys.delete(key);
            syncActiveKey(key);
        },
        render,
        setOpen
    };
}
