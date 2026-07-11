const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const CC_SUSTAIN = 64;

function formatDeviceName(input) {
    const manufacturer = (input.manufacturer ?? '').trim();
    const name = (input.name ?? '').trim();
    if (!name) return manufacturer || 'MIDI Device';
    if (!manufacturer || name.toLowerCase().includes(manufacturer.toLowerCase())) {
        return name;
    }
    return `${manufacturer} ${name}`;
}

export function createMidiInputController({
    isInteractivePlayback,
    initAudio,
    isInstrumentLoading,
    getRingPointForMidi,
    onLiveNoteOn,
    onLiveNoteOff,
    onDevicesChanged
}) {
    let midiAccess = null;
    const boundInputs = new Set();
    const activeNotes = new Set();
    const pedalHeldNotes = new Set();
    let sustainPedalDown = false;

    function getConnectedDeviceNames() {
        if (!midiAccess) return [];
        const names = [];
        for (const input of midiAccess.inputs.values()) {
            if (input.state === 'connected') {
                names.push(formatDeviceName(input));
            }
        }
        return names;
    }

    function notifyDevicesChanged() {
        onDevicesChanged?.(getConnectedDeviceNames());
    }

    function releaseNote(midi) {
        if (!activeNotes.has(midi)) return;
        activeNotes.delete(midi);
        onLiveNoteOff({ key: `midi:${midi}`, midi });
    }

    async function handleNoteOn(midi, velocity) {
        if (!isInteractivePlayback()) return;
        if (activeNotes.has(midi)) {
            releaseNote(midi);
        }
        pedalHeldNotes.delete(midi);

        try {
            await initAudio();
        } catch (err) {
            console.error('Audio init failed for MIDI input:', err);
            return;
        }
        if (isInstrumentLoading()) return;

        const point = getRingPointForMidi(midi);
        activeNotes.add(midi);
        onLiveNoteOn({
            key: `midi:${midi}`,
            midi,
            ringX: point.x,
            ringY: point.y,
            sustained: true,
            velocity
        });
    }

    function handleNoteOff(midi) {
        if (sustainPedalDown && activeNotes.has(midi)) {
            pedalHeldNotes.add(midi);
            return;
        }
        pedalHeldNotes.delete(midi);
        releaseNote(midi);
    }

    function handleSustainPedal(value) {
        const down = value >= 64;
        if (down === sustainPedalDown) return;
        sustainPedalDown = down;

        if (!down) {
            for (const midi of Array.from(pedalHeldNotes)) {
                releaseNote(midi);
            }
            pedalHeldNotes.clear();
        }
    }

    function handleMidiMessage(event) {
        const [status, data1, data2 = 0] = event.data;
        const command = status & 0xf0;

        if (command === NOTE_ON && data2 > 0) {
            void handleNoteOn(data1, data2 / 127);
        } else if (command === NOTE_OFF || (command === NOTE_ON && data2 === 0)) {
            handleNoteOff(data1);
        } else if (command === CONTROL_CHANGE && data1 === CC_SUSTAIN) {
            handleSustainPedal(data2);
        }
    }

    function bindInput(input) {
        if (boundInputs.has(input.id)) return;
        boundInputs.add(input.id);
        input.addEventListener('midimessage', handleMidiMessage);
    }

    function bindAllInputs() {
        if (!midiAccess) return;
        for (const input of midiAccess.inputs.values()) {
            bindInput(input);
        }
    }

    function stopAllNotes() {
        for (const midi of Array.from(activeNotes)) {
            releaseNote(midi);
        }
        pedalHeldNotes.clear();
        sustainPedalDown = false;
    }

    async function bind() {
        if (!navigator.requestMIDIAccess) {
            onDevicesChanged?.(null);
            return false;
        }

        try {
            midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        } catch (err) {
            console.warn('MIDI access denied or unavailable:', err);
            onDevicesChanged?.(null);
            return false;
        }

        bindAllInputs();
        notifyDevicesChanged();

        midiAccess.addEventListener('statechange', (event) => {
            if (event.port.type !== 'input') return;
            if (event.port.state === 'connected') {
                bindInput(event.port);
            } else {
                boundInputs.delete(event.port.id);
                stopAllNotes();
            }
            notifyDevicesChanged();
        });

        return true;
    }

    return {
        bind,
        getConnectedDeviceNames,
        stopAllNotes
    };
}
