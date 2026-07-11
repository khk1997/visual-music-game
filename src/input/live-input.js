export function createLiveInputService({
    getCurrentSound,
    getInstrument,
    getIsInstrumentLoading,
    getTriggerTime,
    onPlayTapMidi,
    onRecordEvent,
    onStopVisualNotes,
    onVisualNoteOff,
    onVisualNoteOn,
    supportsHeldNotes,
    tapDuration = 0.12
}) {
    const activeHeldKeyStates = new Map();

    function playHeldMidi(key, midi, velocity) {
        const instrument = getInstrument();
        if (!instrument || getIsInstrumentLoading() || !supportsHeldNotes(getCurrentSound()) || activeHeldKeyStates.has(key)) {
            return;
        }

        const note = Tone.Frequency(midi, 'midi').toNote();
        const startTime = getTriggerTime();
        instrument.triggerAttack(note, startTime, velocity ?? 0.9);
        activeHeldKeyStates.set(key, { note, startTime, instrumentRef: instrument });
    }

    function releaseHeldKey(key) {
        const state = activeHeldKeyStates.get(key);
        if (!state) return;
        if (!state.instrumentRef) {
            activeHeldKeyStates.delete(key);
            return;
        }

        const now = getTriggerTime();
        const heldFor = now - state.startTime;
        const releaseTime = heldFor < tapDuration
            ? now + (tapDuration - heldFor)
            : now;

        state.instrumentRef.triggerRelease(state.note, releaseTime);
        activeHeldKeyStates.delete(key);
    }

    function triggerNoteOn({ key, midi, ringX, ringY, sustained = false, velocity }) {
        onVisualNoteOn(midi, ringX, ringY, sustained, velocity);
        onRecordEvent({ type: 'note-on', midi, ringX, ringY, sustained });

        if (typeof key === 'string' && supportsHeldNotes(getCurrentSound())) {
            playHeldMidi(key, midi, velocity);
            return;
        }

        onPlayTapMidi(midi);
    }

    function triggerNoteOff({ key, midi }) {
        onRecordEvent({ type: 'note-off', midi });
        onVisualNoteOff(midi);

        if (typeof key === 'string' && activeHeldKeyStates.has(key)) {
            releaseHeldKey(key);
        }
    }

    function stopAll() {
        const triggerTime = getTriggerTime();
        const releasedInstruments = new Set();
        const instrument = getInstrument();

        if (instrument && typeof instrument.releaseAll === 'function') {
            instrument.releaseAll(triggerTime);
            releasedInstruments.add(instrument);
        }

        for (const state of activeHeldKeyStates.values()) {
            const instrumentRef = state.instrumentRef;
            if (!instrumentRef || releasedInstruments.has(instrumentRef) || typeof instrumentRef.releaseAll !== 'function') {
                continue;
            }

            instrumentRef.releaseAll(triggerTime);
            releasedInstruments.add(instrumentRef);
        }

        activeHeldKeyStates.clear();
        onStopVisualNotes();
    }

    return {
        stopAll,
        triggerNoteOff,
        triggerNoteOn
    };
}
