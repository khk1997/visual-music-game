function getKeyVisualPosition(key) {
    const row = "qwertyuiop".includes(key)
        ? "qwertyuiop"
        : "asdfghjkl".includes(key)
            ? "asdfghjkl"
            : "zxcvbnm";

    const x = (row.indexOf(key) / (row.length - 1)) * 12 - 6;
    const y = row === "qwertyuiop" ? 2.5 : row === "zxcvbnm" ? -2.5 : 0;

    return { x, y };
}

export function createKeyboardInputController({
    documentTarget = document,
    windowTarget = window,
    getCurrentScreen,
    isInteractivePlayback,
    getMidiFromScaleKey,
    initAudio,
    isInstrumentLoading,
    onHomeEnter,
    onLiveNoteOff,
    onLiveNoteOn,
    onRecordSlotHotkey,
    onStopAllLiveInput
}) {
    const activeVisualKeyStates = new Map();

    function stopActiveVisualKeys() {
        for (const [key, visualState] of Array.from(activeVisualKeyStates.entries())) {
            onLiveNoteOff({ key, midi: visualState.midi });
            activeVisualKeyStates.delete(key);
        }
    }

    async function handleKeyDown(event) {
        if (!isInteractivePlayback()) {
            if (getCurrentScreen() === 'home' && event.key === 'Enter') {
                onHomeEnter();
            }
            return;
        }

        const key = event.key.toLowerCase();

        if (/^[1-6]$/.test(key)) {
            event.preventDefault();
            if (!event.repeat) {
                onRecordSlotHotkey?.(Number(key) - 1);
            }
            return;
        }

        const midi = getMidiFromScaleKey(key, event.shiftKey, event.ctrlKey);

        if (midi === null) return;

        event.preventDefault();
        if (event.repeat) return;

        try {
            await initAudio();
            if (isInstrumentLoading()) return;

            const { x, y } = getKeyVisualPosition(key);
            activeVisualKeyStates.set(key, { midi });
            onLiveNoteOn({ key, midi, ringX: x, ringY: y, sustained: true });
        } catch (err) {
            console.error('Audio init/play failed:', err);
        }
    }

    function handleKeyUp(event) {
        if (!isInteractivePlayback()) return;

        const key = event.key.toLowerCase();
        const visualState = activeVisualKeyStates.get(key);

        if (visualState) {
            onLiveNoteOff({ key, midi: visualState.midi });
            activeVisualKeyStates.delete(key);
        }
    }

    function handleBlur() {
        onStopAllLiveInput();
    }

    function handleVisibilityChange() {
        if (documentTarget.visibilityState === 'hidden') {
            onStopAllLiveInput();
        }
    }

    function bind() {
        windowTarget.addEventListener('keydown', handleKeyDown);
        windowTarget.addEventListener('keyup', handleKeyUp);
        windowTarget.addEventListener('blur', handleBlur);
        documentTarget.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return {
        bind,
        stopActiveVisualKeys
    };
}
