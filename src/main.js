import * as THREE from 'three';

import {
    absolutePitchCard,
    absolutePitchUi,
    backHomeButton,
    backgroundToggleButton,
    bottomUi,
    currentKeyLabel,
    freePlayCard,
    keySelect,
    modeCards,
    modePanel,
    modeScreen,
    modeSelect,
    modeStatus,
    playbackScreen,
    playbackToggleButton,
    recordToggleButton,
    rhythmGameCard,
    rhythmGameUi,
    soundSelect,
    themeList,
    themePanel,
    themePreviewDescription,
    themePreviewMedia,
    themePreviewTitle
} from './core/dom.js';
import {
    BACKGROUND_THEMES,
    BIG_BEN_SAMPLE_CONFIG,
    HARP_SAMPLE_CONFIG,
    INSTRUMENT_VOLUMES,
    LOW_LATENCY_CONFIG,
    MAJOR_SCALE,
    NATURAL_MINOR_SCALE,
    NOTE_TO_PC,
    PIANO_RELEASE,
    PIANO_SAMPLE_CONFIG,
    SCALE_KEY_MAP
} from './core/config.js';
import { createAbsolutePitchModule } from './modes/absolute-pitch.js';

// =========================================================
// 1. 音源設定
// =========================================================
        let instrument = null;
        let playbackInstrument = null;
        let reverb = null;
        let limiter = null;
        let audioStarted = false;
        let currentSound = 'synth';
        let isInstrumentLoading = false;
        let instrumentSwitchToken = 0;
        let recordedSoundType = 'synth';
        let lofiVibrato = null;
        let lofiFilter = null;
        const activePianoKeyStates = new Map();
        const activeVisualKeyStates = new Map();
        let playbackLofiVibrato = null;
        let playbackLofiFilter = null;
        const liveKeyHighlights = new Map();
        const playbackKeyHighlights = new Map();
        const PIANO_TAP_DURATION = 0.12;
        let currentScreen = 'home';
        let isFreePlayThemeSelection = false;
        let hasConfirmedThemeSelectionInCurrentFlow = false;
        let isThemeSelectionTransitioning = false;
        const themeSelectionTransitionTimers = [];

        let currentBackgroundIndex = 0;
        let hoveredThemeIndex = null;
        let backgroundVisualsReady = false;
        let isRecording = false;
        let recordingStartTime = 0;
        let recordedEvents = [];
        let isPlaybackActive = false;
        let playbackEndTimer = null;
        const playbackTimers = [];
        const playbackPianoNotes = new Map();
        let playbackLoopDuration = 0;
        let uiClickSynth = null;
        const modeTransitionTimers = [];
        let isModeTransitioning = false;

        function getToneContext() {
            if (typeof Tone.getContext === 'function') return Tone.getContext();
            return Tone.context;
        }

        function applyLowLatencyMode() {
            const toneContext = getToneContext();
            if (toneContext) {
                toneContext.lookAhead = LOW_LATENCY_CONFIG.lookAhead;
                toneContext.updateInterval = LOW_LATENCY_CONFIG.updateInterval;
            }
        }

        function getTriggerTime() {
            if (typeof Tone.immediate === 'function') {
                return Tone.immediate();
            }
            return Tone.now();
        }

        function supportsHeldNotes(soundType) {
            return soundType === 'piano'
                || soundType === 'chiptune_lead'
                || soundType === 'saw_lead';
        }

        function ensureUiClickSynth() {
            if (uiClickSynth) return uiClickSynth;

            uiClickSynth = new Tone.Synth({
                oscillator: {
                    type: 'triangle'
                },
                envelope: {
                    attack: 0.002,
                    decay: 0.07,
                    sustain: 0,
                    release: 0.08
                }
            }).connect(limiter);

            uiClickSynth.volume.value = -14;
            return uiClickSynth;
        }

        async function playModeCardClickSound() {
            try {
                if (!audioStarted) {
                    await initAudio();
                }

                const clickSynth = ensureUiClickSynth();
                const triggerTime = getTriggerTime();
                clickSynth.triggerAttackRelease('E5', 0.09, triggerTime);
                clickSynth.triggerAttackRelease('B5', 0.07, triggerTime + 0.045);
            } catch (err) {
                console.error('Mode card click sound failed:', err);
            }
        }

        async function playBackHomeClickSound() {
            try {
                if (!audioStarted) {
                    await initAudio();
                }

                const clickSynth = ensureUiClickSynth();
                const triggerTime = getTriggerTime();
                clickSynth.triggerAttackRelease('D6', 0.045, triggerTime, 0.7);
                clickSynth.triggerAttackRelease('A5', 0.055, triggerTime + 0.032, 0.62);
                clickSynth.triggerAttackRelease('E5', 0.1, triggerTime + 0.078, 0.82);
            } catch (err) {
                console.error('Back home click sound failed:', err);
            }
        }

        function applyInstrumentVolumeTo(targetInstrument, type) {
            if (!targetInstrument || !targetInstrument.volume) return;
            targetInstrument.volume.value = INSTRUMENT_VOLUMES[type] ?? 0;
        }

        function disposeLofiChain(vibratoRef, filterRef) {
            if (vibratoRef && typeof vibratoRef.dispose === 'function') {
                vibratoRef.dispose();
            }
            if (filterRef && typeof filterRef.dispose === 'function') {
                filterRef.dispose();
            }
        }

        function disposeCurrentInstrument() {
            disposeLofiChain(lofiVibrato, lofiFilter);
            if (instrument && typeof instrument.dispose === 'function') {
                instrument.dispose();
            }
            instrument = null;
            lofiVibrato = null;
            lofiFilter = null;
            activePianoKeyStates.clear();
        }

        function disposePlaybackInstrument() {
            disposeLofiChain(playbackLofiVibrato, playbackLofiFilter);
            if (playbackInstrument && typeof playbackInstrument.dispose === 'function') {
                playbackInstrument.dispose();
            }
            playbackInstrument = null;
            playbackLofiVibrato = null;
            playbackLofiFilter = null;
            playbackPianoNotes.clear();
        }

        function setInstrumentLoadingState(loading) {
            isInstrumentLoading = loading;
            soundSelect.disabled = loading;
        }

        function stopLiveInputPlayback() {
            if (instrument && typeof instrument.releaseAll === 'function') {
                instrument.releaseAll(getTriggerTime());
            }

            for (const state of activePianoKeyStates.values()) {
                if (state.instrumentRef && typeof state.instrumentRef.releaseAll === 'function') {
                    state.instrumentRef.releaseAll(getTriggerTime());
                }
            }

            activePianoKeyStates.clear();

            for (const [key, visualState] of Array.from(activeVisualKeyStates.entries())) {
                recordPerformanceEvent({ type: 'note-off', midi: visualState.midi });
                triggerDeepBlueNoteOff('user', visualState.midi);
                activeVisualKeyStates.delete(key);
            }
        }

        function swapCurrentInstrument(created, type) {
            const previousInstrument = instrument;
            const previousLofiVibrato = lofiVibrato;
            const previousLofiFilter = lofiFilter;

            instrument = created.instrument;
            lofiVibrato = created.lofiVibrato;
            lofiFilter = created.lofiFilter;
            currentSound = type;

            disposeLofiChain(previousLofiVibrato, previousLofiFilter);
            if (previousInstrument && typeof previousInstrument.dispose === 'function') {
                previousInstrument.dispose();
            }
            activePianoKeyStates.clear();
        }

        async function createInstrumentInstance(type) {
            let nextInstrument = null;
            let nextLofiVibrato = null;
            let nextLofiFilter = null;

            if (type === 'piano') {
                nextInstrument = new Tone.Sampler({
                    urls: PIANO_SAMPLE_CONFIG.urls,
                    baseUrl: PIANO_SAMPLE_CONFIG.baseUrl,
                    release: PIANO_RELEASE
                }).connect(reverb);

                await Tone.loaded();
            }
            else if (type === 'harp') {
                nextInstrument = new Tone.Sampler({
                    urls: HARP_SAMPLE_CONFIG.urls,
                    baseUrl: HARP_SAMPLE_CONFIG.baseUrl
                }).connect(reverb);

                await Tone.loaded();
            }
            else if (type === 'big_ben') {
                nextInstrument = new Tone.Sampler({
                    urls: BIG_BEN_SAMPLE_CONFIG.urls,
                    baseUrl: BIG_BEN_SAMPLE_CONFIG.baseUrl,
                    release: 4.0
                });

                if (nextInstrument.detune) {
                    nextInstrument.detune.value = 400;
                }

                nextLofiFilter = new Tone.Compressor({
                    threshold: -22,
                    ratio: 10,
                    attack: 0.003,
                    release: 0.28
                });

                nextInstrument.chain(nextLofiFilter, limiter);

                await Tone.loaded();
            }
            else if (type === 'synth') {
                nextInstrument = new Tone.PolySynth(Tone.Synth, {
                    oscillator: { type: "triangle" },
                    envelope: {
                        attack: 0.005,
                        decay: 0.1,
                        sustain: 0.3,
                        release: 1.2
                    }
                }).connect(reverb);
            }
            else if (type === 'bell') {
                nextInstrument = new Tone.PolySynth(Tone.FMSynth, {
                    harmonicity: 8,
                    modulationIndex: 12,
                    envelope: {
                        attack: 0.001,
                        decay: 1.2,
                        sustain: 0,
                        release: 1.5
                    },
                    modulation: {
                        type: "sine"
                    },
                    modulationEnvelope: {
                        attack: 0.002,
                        decay: 0.3,
                        sustain: 0,
                        release: 0.8
                    }
                }).connect(reverb);
            }
            else if (type === 'pluck') {
                nextInstrument = new Tone.PolySynth(Tone.Synth, {
                    oscillator: { type: "triangle" },
                    envelope: {
                        attack: 0.001,
                        decay: 0.16,
                        sustain: 0.0,
                        release: 0.1
                    }
                }).connect(reverb);
            }
            else if (type === 'chiptune_lead') {
                nextInstrument = new Tone.PolySynth(Tone.Synth, {
                    oscillator: { type: "square" },
                    envelope: {
                        attack: 0.002,
                        decay: 0.08,
                        sustain: 0.45,
                        release: 0.12
                    }
                }).connect(reverb);
            }
            else if (type === 'saw_lead') {
                nextInstrument = new Tone.PolySynth(Tone.Synth, {
                    oscillator: { type: "sawtooth" },
                    envelope: {
                        attack: 0.01,
                        decay: 0.22,
                        sustain: 0.14,
                        release: 0.16
                    }
                }).connect(reverb);
            }
            else if (type === 'lofi_ep') {
                nextInstrument = new Tone.PolySynth(Tone.FMSynth, {
                    harmonicity: 1.5,
                    modulationIndex: 3.5,
                    detune: 0,
                    oscillator: { type: "triangle" },
                    envelope: {
                        attack: 0.015,
                        decay: 0.35,
                        sustain: 0.28,
                        release: 1.1
                    },
                    modulation: { type: "sine" },
                    modulationEnvelope: {
                        attack: 0.02,
                        decay: 0.2,
                        sustain: 0.0,
                        release: 0.6
                    }
                });

                nextLofiVibrato = new Tone.Vibrato({
                    frequency: 4.2,
                    depth: 0.08,
                    type: "sine"
                });
                nextLofiFilter = new Tone.Filter({
                    type: "lowpass",
                    frequency: 3600,
                    rolloff: -24,
                    Q: 0.8
                });

                nextInstrument.chain(nextLofiVibrato, nextLofiFilter, reverb);
            }

            applyInstrumentVolumeTo(nextInstrument, type);
            return {
                instrument: nextInstrument,
                lofiVibrato: nextLofiVibrato,
                lofiFilter: nextLofiFilter
            };
        }

        async function createPianoInstrument() {
            const created = await createInstrumentInstance('piano');
            swapCurrentInstrument(created, 'piano');
        }

        async function createHarpInstrument() {
            const created = await createInstrumentInstance('harp');
            swapCurrentInstrument(created, 'harp');
        }

        async function createPlaybackInstrument(type) {
            disposePlaybackInstrument();

            const created = await createInstrumentInstance(type);
            playbackInstrument = created.instrument;
            playbackLofiVibrato = created.lofiVibrato;
            playbackLofiFilter = created.lofiFilter;
        }

        async function createInstrument(type) {
            if (type === 'piano') {
                await createPianoInstrument();
            }
            else if (type === 'harp') {
                await createHarpInstrument();
            }
            else {
                const created = await createInstrumentInstance(type);
                swapCurrentInstrument(created, type);
            }
        }

        async function initAudio() {
            if (audioStarted) return;

            await Tone.start();
            applyLowLatencyMode();

            limiter = new Tone.Limiter(-1).toDestination();
            reverb = new Tone.Reverb({
                decay: 2.5,
                wet: 0.3
            }).connect(limiter);

            await createInstrument(currentSound);
            audioStarted = true;
        }

        soundSelect.addEventListener('change', async () => {
            const selectedSound = soundSelect.value;

            if (!audioStarted) return;

            const switchToken = ++instrumentSwitchToken;
            stopLiveInputPlayback();
            setInstrumentLoadingState(true);

            try {
                await createInstrument(selectedSound);
            } catch (err) {
                console.error('Failed to switch instrument:', err);
                soundSelect.value = currentSound;
            } finally {
                if (switchToken === instrumentSwitchToken) {
                    setInstrumentLoadingState(false);
                }
            }
        });

        function playMidiWithInstrument(targetInstrument, soundType, midi) {
            if (!targetInstrument || isInstrumentLoading) return;
            const note = Tone.Frequency(midi, "midi").toNote();
            const triggerTime = getTriggerTime();

            if (soundType === 'piano') {
                targetInstrument.triggerAttackRelease(note, 1.4, triggerTime);
            } else if (soundType === 'big_ben') {
                targetInstrument.triggerAttackRelease(note, 3.5, triggerTime);
            } else if (soundType === 'harp') {
                targetInstrument.triggerAttackRelease(note, 2.0, triggerTime);
            } else if (soundType === 'bell') {
                targetInstrument.triggerAttackRelease(note, "2n", triggerTime);
            } else if (soundType === 'pluck') {
                targetInstrument.triggerAttackRelease(note, "16n", triggerTime);
            } else if (soundType === 'chiptune_lead') {
                targetInstrument.triggerAttackRelease(note, "16n", triggerTime);
            } else if (soundType === 'saw_lead') {
                targetInstrument.triggerAttackRelease(note, "8n", triggerTime);
            } else if (soundType === 'lofi_ep') {
                targetInstrument.triggerAttackRelease(note, "4n", triggerTime);
            } else {
                targetInstrument.triggerAttackRelease(note, "8n", triggerTime);
            }
        }

        function playMidi(midi) {
            playMidiWithInstrument(instrument, currentSound, midi);
        }

        function playPianoKeyDown(key, midi) {
            if (!instrument || isInstrumentLoading || !supportsHeldNotes(currentSound) || activePianoKeyStates.has(key)) return;

            const note = Tone.Frequency(midi, "midi").toNote();
            const startTime = getTriggerTime();

            instrument.triggerAttack(note, startTime);
            activePianoKeyStates.set(key, { note, startTime, midi, instrumentRef: instrument });
        }

        function releasePianoKey(key) {
            const state = activePianoKeyStates.get(key);
            if (!state) return;
            if (!state.instrumentRef) {
                activePianoKeyStates.delete(key);
                return;
            }

            const now = getTriggerTime();
            const heldFor = now - state.startTime;
            const releaseTime = heldFor < PIANO_TAP_DURATION
                ? now + (PIANO_TAP_DURATION - heldFor)
                : now;

            state.instrumentRef.triggerRelease(state.note, releaseTime);
            activePianoKeyStates.delete(key);
        }

        // =========================================================
        // 2. 鋼琴 UI
        // =========================================================
        const pianoContainer = document.getElementById('piano-container');
        const pianoUi = document.getElementById('piano-ui');
        const allKeysMap = {};
        let pianoLayoutFrame = null;

        function createPianoKeys() {
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

            for (let midi = 21; midi <= 108; midi++) {
                const key = document.createElement('div');
                key.className = notes[midi % 12].includes('#') ? 'key black' : 'key white';
                pianoUi.appendChild(key);
                allKeysMap[midi] = key;
            }
        }

        createPianoKeys();

        function syncPianoLayoutWidth() {
            const measuredWidth = pianoContainer.clientWidth;
            if (!measuredWidth) return;

            const nextWidth = measuredWidth * 0.92;
            pianoUi.style.width = `${nextWidth}px`;
            pianoUi.style.minWidth = `${nextWidth}px`;
        }

        function schedulePianoLayoutSync() {
            if (pianoLayoutFrame !== null) {
                cancelAnimationFrame(pianoLayoutFrame);
            }
            pianoLayoutFrame = requestAnimationFrame(() => {
                pianoLayoutFrame = null;
                syncPianoLayoutWidth();
            });
        }

        schedulePianoLayoutSync();
        window.addEventListener('resize', schedulePianoLayoutSync);

        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => {
                schedulePianoLayoutSync();
            }).observe(pianoContainer);
        }

        function getPianoKeyboardBounds() {
            const keys = Object.values(allKeysMap);
            if (keys.length === 0) return null;

            const uiRect = pianoUi.getBoundingClientRect();
            let minLeft = Infinity;
            let maxRight = -Infinity;
            let minTop = Infinity;

            for (const keyEl of keys) {
                const rect = keyEl.getBoundingClientRect();
                minLeft = Math.min(minLeft, rect.left - uiRect.left);
                maxRight = Math.max(maxRight, rect.right - uiRect.left);
                minTop = Math.min(minTop, rect.top - uiRect.top);
            }

            if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight) || !Number.isFinite(minTop)) {
                return null;
            }

            return {
                leftX: minLeft,
                rightX: maxRight,
                topY: minTop
            };
        }

        function updateKeyHighlightState(midi) {
            const keyEl = allKeysMap[midi];
            if (!keyEl) return;

            const hasLive = (liveKeyHighlights.get(midi) ?? 0) > 0;
            const hasPlayback = (playbackKeyHighlights.get(midi) ?? 0) > 0;

            keyEl.classList.remove('user-active', 'playback-active', 'mixed-active');

            if (hasLive && hasPlayback) keyEl.classList.add('mixed-active');
            else if (hasLive) keyEl.classList.add('user-active');
            else if (hasPlayback) keyEl.classList.add('playback-active');
        }

        function highlightKey(source, midi, active) {
            const targetMap = source === 'playback' ? playbackKeyHighlights : liveKeyHighlights;
            const currentCount = targetMap.get(midi) ?? 0;

            if (active) {
                targetMap.set(midi, currentCount + 1);
            } else if (currentCount <= 1) {
                targetMap.delete(midi);
            } else {
                targetMap.set(midi, currentCount - 1);
            }

            updateKeyHighlightState(midi);
        }

        function clearHighlightMap(targetMap) {
            for (const midi of Array.from(targetMap.keys())) {
                targetMap.delete(midi);
                updateKeyHighlightState(midi);
            }
        }

        function isInteractivePlayback() {
            return currentScreen === 'free-play' && !isFreePlayThemeSelection;
        }

        function resetModeTransitionState() {
            while (modeTransitionTimers.length) {
                clearTimeout(modeTransitionTimers.pop());
            }

            isModeTransitioning = false;
            modePanel.classList.remove('is-transitioning', 'is-exiting');
            for (const card of modeCards) {
                card.classList.remove('is-selected', 'is-muted');
            }
        }

        function transitionFromHome(selectedCard, nextScreen) {
            if (isModeTransitioning || currentScreen !== 'home') return;

            isModeTransitioning = true;
            void playModeCardClickSound();
            modePanel.classList.add('is-transitioning');

            for (const card of modeCards) {
                card.classList.toggle('is-selected', card === selectedCard);
                card.classList.toggle('is-muted', card !== selectedCard);
            }

            modeTransitionTimers.push(window.setTimeout(() => {
                modePanel.classList.add('is-exiting');
            }, 300));

            modeTransitionTimers.push(window.setTimeout(() => {
                setScreen(nextScreen);
                while (modeTransitionTimers.length) {
                    clearTimeout(modeTransitionTimers.pop());
                }
                isModeTransitioning = false;
            }, 760));
        }

        function setScreen(nextScreen, options = {}) {
            const { skipThemeSelection = false, forceThemeSelection = false } = options;
            const previousScreen = currentScreen;
            currentScreen = nextScreen;

            const isHome = nextScreen === 'home';
            const isFreePlay = nextScreen === 'free-play';
            const isAbsolutePitch = nextScreen === 'absolute-pitch';
            const isRhythmGame = nextScreen === 'rhythm-game';
            const isExperienceScreen = isFreePlay || isAbsolutePitch || isRhythmGame;
            const enteringFreePlay = isFreePlay && previousScreen !== 'free-play';

            if (isFreePlay) {
                isFreePlayThemeSelection = forceThemeSelection || (enteringFreePlay && !skipThemeSelection);
                if (isFreePlayThemeSelection) {
                    hasConfirmedThemeSelectionInCurrentFlow = false;
                }
            } else {
                isFreePlayThemeSelection = false;
                hasConfirmedThemeSelectionInCurrentFlow = false;
            }

            if (isFreePlayThemeSelection) {
                if (isRecording) stopRecording();
                if (isPlaybackActive) stopPlayback();
            }

            if (!isFreePlay) {
                if (isRecording) stopRecording();
                if (isPlaybackActive) stopPlayback();
            }

            if (!isAbsolutePitch) {
                absolutePitch.updateIdleState();
                absolutePitch.resetIntro();
            }

            if (isHome) {
                resetModeTransitionState();
            }

            if (isFreePlayThemeSelection || !isFreePlay) {
                resetThemeSelectionVisualState();
            }

            modeScreen.classList.toggle('hidden', !isHome);
            playbackScreen.classList.toggle('active', isExperienceScreen);
            playbackScreen.classList.toggle('theme-selecting', isFreePlay && isFreePlayThemeSelection);
            bottomUi.classList.toggle('hidden', !isFreePlay || isFreePlayThemeSelection);
            absolutePitchUi.classList.toggle('active', isAbsolutePitch);
            rhythmGameUi.classList.toggle('active', isRhythmGame);
            backgroundToggleButton.classList.toggle('ui-hidden', !isFreePlay || isFreePlayThemeSelection);
            recordToggleButton.classList.toggle('ui-hidden', !isFreePlay || isFreePlayThemeSelection);
            playbackToggleButton.classList.toggle('ui-hidden', !isFreePlay || isFreePlayThemeSelection);
            if (!isFreePlay) {
                closeThemePanel();
            } else if (isFreePlayThemeSelection) {
                openThemePanel();
            } else {
                closeThemePanel();
            }
            modeStatus.textContent = isFreePlayThemeSelection
                ? 'Select Theme'
                : isAbsolutePitch
                ? 'Perfect Pitch'
                : isRhythmGame
                    ? 'Rhythm Game'
                    : 'Free Play';
            document.body.style.cursor = isFreePlay && !isFreePlayThemeSelection ? 'crosshair' : 'default';
            updateThemePanelSelection();
        }

        freePlayCard.addEventListener('click', () => {
            transitionFromHome(freePlayCard, 'free-play');
        });

        absolutePitchCard.addEventListener('click', () => {
            transitionFromHome(absolutePitchCard, 'absolute-pitch');
        });

        rhythmGameCard.addEventListener('click', () => {
            transitionFromHome(rhythmGameCard, 'rhythm-game');
        });

        backHomeButton.addEventListener('click', () => {
            void playBackHomeClickSound();
            if (currentScreen === 'free-play' && !isFreePlayThemeSelection) {
                setScreen('free-play', { forceThemeSelection: true });
            } else {
                setScreen('home');
            }
        });

        function nowSeconds() {
            return performance.now() * 0.001;
        }

        function updateTransportButtons() {
            recordToggleButton.textContent = isRecording ? 'Stop Rec' : 'Record';
            recordToggleButton.classList.toggle('is-active', isRecording);

            playbackToggleButton.textContent = isPlaybackActive ? 'Stop Loop' : 'Playback';
            playbackToggleButton.classList.toggle('is-active', isPlaybackActive);

            const playbackDisabled = isRecording || recordedEvents.length === 0;
            playbackToggleButton.classList.toggle('is-disabled', playbackDisabled);
            playbackToggleButton.disabled = playbackDisabled;
        }

        function stopPlayback() {
            for (const timer of playbackTimers) {
                clearTimeout(timer);
            }
            playbackTimers.length = 0;

            if (playbackEndTimer !== null) {
                clearTimeout(playbackEndTimer);
                playbackEndTimer = null;
            }

            for (const midi of Array.from(playbackPianoNotes.keys())) {
                releasePlaybackPianoMidi(midi);
            }

            for (const barKey of Array.from(liveDeepBlueBars.keys())) {
                if (barKey.startsWith('playback:')) {
                    const midi = Number(barKey.split(':')[1]);
                    triggerDeepBlueNoteOff('playback', midi);
                }
            }

            clearHighlightMap(playbackKeyHighlights);
            isPlaybackActive = false;
            updateTransportButtons();
        }

        function stopRecording() {
            isRecording = false;
            updateTransportButtons();
        }

        function startRecording() {
            stopPlayback();
            recordedEvents = [];
            recordedSoundType = currentSound;
            recordingStartTime = nowSeconds();
            isRecording = true;
            updateTransportButtons();
        }

        function recordPerformanceEvent(event) {
            if (!isRecording) return;

            recordedEvents.push({
                ...event,
                time: nowSeconds() - recordingStartTime
            });
        }

        function attackPlaybackPianoMidi(midi) {
            if (!playbackInstrument || !supportsHeldNotes(recordedSoundType) || playbackPianoNotes.has(midi)) return;

            const note = Tone.Frequency(midi, "midi").toNote();
            const startTime = getTriggerTime();
            playbackInstrument.triggerAttack(note, startTime);
            playbackPianoNotes.set(midi, { note, startTime });
        }

        function releasePlaybackPianoMidi(midi) {
            if (!playbackInstrument) return;

            const state = playbackPianoNotes.get(midi);
            if (!state) return;

            const now = getTriggerTime();
            const heldFor = now - state.startTime;
            const releaseTime = heldFor < PIANO_TAP_DURATION
                ? now + (PIANO_TAP_DURATION - heldFor)
                : now;

            playbackInstrument.triggerRelease(state.note, releaseTime);
            playbackPianoNotes.delete(midi);
        }

        function playVisualFeedback(source, midi, ringX, ringY) {
            const ringPoint = new THREE.Vector3(ringX, ringY, RING_PLANE_Z);
            const mistPoint = projectPointToPlane(ringPoint, MIST_PLANE_Z);
            const bgPoint = projectPointToPlane(ringPoint, BG_PLANE_Z);
            const sparkPoint = projectPointToPlane(ringPoint, SPARK_PLANE_Z);

            triggerInteraction(source, bgPoint, midi);
            spawnMist(mistPoint, midi);
            spawnSparks(sparkPoint);
        }

        const absolutePitch = createAbsolutePitchModule({
            container: absolutePitchUi,
            createInstrumentInstance,
            disposeLofiChain,
            initAudio,
            nowSeconds,
            playMidiWithInstrument,
            playVisualFeedback
        });

        setScreen('home');
        absolutePitch.resetIntro();

        function schedulePlaybackLoopPass() {
            if (!isPlaybackActive) return;

            for (const event of recordedEvents) {
                const timer = setTimeout(() => {
                    if (!isPlaybackActive) return;

                    if (event.type === 'note-on') {
                        playVisualFeedback('playback', event.midi, event.ringX, event.ringY);
                        triggerDeepBlueNoteOn('playback', event.midi, !!event.sustained);

                        if (supportsHeldNotes(recordedSoundType) && event.sustained) {
                            attackPlaybackPianoMidi(event.midi);
                        } else {
                            playMidiWithInstrument(playbackInstrument, recordedSoundType, event.midi);
                        }
                    } else if (event.type === 'note-off') {
                        triggerDeepBlueNoteOff('playback', event.midi);
                        if (supportsHeldNotes(recordedSoundType)) {
                            releasePlaybackPianoMidi(event.midi);
                        }
                    }
                }, Math.max(0, event.time * 1000));

                playbackTimers.push(timer);
            }

            playbackEndTimer = setTimeout(() => {
                for (const midi of Array.from(playbackPianoNotes.keys())) {
                    releasePlaybackPianoMidi(midi);
                }

                schedulePlaybackLoopPass();
            }, playbackLoopDuration * 1000);
        }

        async function startPlayback() {
            if (recordedEvents.length === 0 || isRecording) return;

            stopPlayback();

            try {
                await initAudio();
                await createPlaybackInstrument(recordedSoundType);
            } catch (err) {
                console.error('Playback audio init failed:', err);
                return;
            }

            isPlaybackActive = true;
            updateTransportButtons();
            playbackLoopDuration = recordedEvents.reduce((maxTime, event) => Math.max(maxTime, event.time), 0) + 0.25;
            schedulePlaybackLoopPass();
        }

        recordToggleButton.addEventListener('click', () => {
            if (isRecording) stopRecording();
            else startRecording();
        });

        playbackToggleButton.addEventListener('click', async () => {
            if (isPlaybackActive) {
                stopPlayback();
                return;
            }

            await startPlayback();
        });

        updateTransportButtons();

        // =========================================================
        // 3. 調性系統
        // =========================================================
        let currentKeyRoot = 'C';
        let currentMode = 'major';

        function getCurrentScale() {
            return currentMode === 'major' ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
        }

        function updateKeyUI() {
            const modeText = currentMode === 'major' ? 'Major' : 'Minor';
            currentKeyLabel.textContent = `${currentKeyRoot} ${modeText}`;
            keySelect.value = currentKeyRoot;
            modeSelect.value = currentMode;
        }

        keySelect.addEventListener('change', () => {
            currentKeyRoot = keySelect.value;
            updateKeyUI();
        });

        modeSelect.addEventListener('change', () => {
            currentMode = modeSelect.value;
            updateKeyUI();
        });

        // =========================================================
        // 4. 鍵位映射
        // =========================================================
        function getMidiFromScaleKey(key, shiftKey, ctrlKey) {
            const info = SCALE_KEY_MAP[key];
            if (!info) return null;

            const rootPc = NOTE_TO_PC[currentKeyRoot];
            const scale = getCurrentScale();
            const baseCMidi = info.octaveBase;
            const rootMidi = baseCMidi + rootPc;

            let midi = rootMidi + scale[info.degree];

            if (shiftKey) midi += 1;
            if (ctrlKey) midi -= 1;

            return Math.max(21, Math.min(108, midi));
        }
        updateKeyUI();

        // =========================================================
        // 5. 視覺場景
        // =========================================================
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 8;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.toneMapping = THREE.ReinhardToneMapping;
        renderer.toneMappingExposure = 2.0;
        document.body.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 1.2));

        function getCurrentBackgroundTheme() {
            return BACKGROUND_THEMES[currentBackgroundIndex];
        }

        function usesLegacyGridEffects() {
            return getCurrentBackgroundTheme().id === 'playstation-style';
        }

        function updateThemePanelSelection() {
            const currentTheme = getCurrentBackgroundTheme();
            const previewTheme = hoveredThemeIndex === null
                ? currentTheme
                : BACKGROUND_THEMES[(hoveredThemeIndex + BACKGROUND_THEMES.length) % BACKGROUND_THEMES.length];
            backgroundToggleButton.textContent = `Theme: ${currentTheme.label}`;

            if (themePreviewTitle) {
                themePreviewTitle.textContent = previewTheme.label;
            }
            if (themePreviewDescription) {
                themePreviewDescription.textContent = previewTheme.description || 'Theme preview';
            }
            if (themePreviewMedia) {
                themePreviewMedia.style.background = previewTheme.previewBackground || '';
            }

            if (!themeList || isThemeSelectionTransitioning) return;
            const themeButtons = themeList.querySelectorAll('.theme-list-item');
            const shouldShowSelected = !(currentScreen === 'free-play'
                && isFreePlayThemeSelection
                && !hasConfirmedThemeSelectionInCurrentFlow);
            for (const button of themeButtons) {
                const buttonIndex = Number(button.dataset.themeIndex);
                button.classList.toggle('is-selected', shouldShowSelected && buttonIndex === currentBackgroundIndex);
            }
        }

        function closeThemePanel() {
            if (!themePanel) return;
            themePanel.classList.remove('is-open');
            themePanel.setAttribute('aria-hidden', 'true');
            backgroundToggleButton.classList.remove('is-active');
            hoveredThemeIndex = null;
            updateThemePanelSelection();
        }

        function clearThemeSelectionTransitionTimers() {
            while (themeSelectionTransitionTimers.length) {
                clearTimeout(themeSelectionTransitionTimers.pop());
            }
        }

        function resetThemeSelectionVisualState() {
            clearThemeSelectionTransitionTimers();
            isThemeSelectionTransitioning = false;
            if (!themePanel) return;
            themePanel.classList.remove('is-transitioning', 'is-exiting');
            if (!themeList) return;
            const themeButtons = themeList.querySelectorAll('.theme-list-item');
            for (const button of themeButtons) {
                button.classList.remove('is-selected', 'is-muted');
            }
        }

        function startThemeSelectionTransition(index) {
            if (!themePanel || !themeList || isThemeSelectionTransitioning) return;
            const themeButtons = Array.from(themeList.querySelectorAll('.theme-list-item'));
            if (themeButtons.length === 0) return;

            void playModeCardClickSound();

            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }

            for (const button of themeButtons) {
                const buttonIndex = Number(button.dataset.themeIndex);
                button.classList.toggle('is-selected', buttonIndex === index);
                button.classList.toggle('is-muted', buttonIndex !== index);
            }

            isThemeSelectionTransitioning = true;
            hasConfirmedThemeSelectionInCurrentFlow = true;
            hoveredThemeIndex = null;
            themePanel.classList.add('is-transitioning');
            applyBackgroundTheme(index);

            themeSelectionTransitionTimers.push(window.setTimeout(() => {
                if (!themePanel) return;
                themePanel.classList.add('is-exiting');
            }, 300));

            themeSelectionTransitionTimers.push(window.setTimeout(() => {
                resetThemeSelectionVisualState();
                setScreen('free-play', { skipThemeSelection: true });
            }, 760));
        }

        function openThemePanel() {
            if (!themePanel) return;
            themePanel.classList.add('is-open');
            themePanel.setAttribute('aria-hidden', 'false');
            backgroundToggleButton.classList.add('is-active');
        }

        function setupThemePanel() {
            if (!themeList) return;
            themeList.innerHTML = '';

            BACKGROUND_THEMES.forEach((theme, index) => {
                const item = document.createElement('li');
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'theme-list-item';
                button.dataset.themeIndex = String(index);
                button.textContent = theme.label;
                button.addEventListener('mouseenter', () => {
                    hoveredThemeIndex = index;
                    updateThemePanelSelection();
                });
                button.addEventListener('mouseleave', () => {
                    hoveredThemeIndex = null;
                    updateThemePanelSelection();
                });
                button.addEventListener('focus', () => {
                    hoveredThemeIndex = index;
                    updateThemePanelSelection();
                });
                button.addEventListener('blur', () => {
                    hoveredThemeIndex = null;
                    updateThemePanelSelection();
                });
                button.addEventListener('click', () => {
                    startThemeSelectionTransition(index);
                });
                item.appendChild(button);
                themeList.appendChild(item);
            });
        }

        function applyBackgroundTheme(index) {
            currentBackgroundIndex = (index + BACKGROUND_THEMES.length) % BACKGROUND_THEMES.length;
            const theme = BACKGROUND_THEMES[currentBackgroundIndex];

            scene.background = new THREE.Color(theme.color);
            renderer.toneMappingExposure = theme.exposure;
            updateThemePanelSelection();

            if (backgroundVisualsReady) {
                syncBackgroundVisualState();
            }
        }

        backgroundToggleButton.classList.add('is-readonly');

        setupThemePanel();
        applyBackgroundTheme(currentBackgroundIndex);

        // =========================================================
        // 6. 貼圖生成
        // =========================================================
        function createPS5Textures() {
            function makeCanvas() {
                const canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 128;
                const ctx = canvas.getContext('2d');
                ctx.lineCap = 'round';
                return { canvas, ctx };
            }

            function drawSparkShapes(ctx, x, c, lw, sb) {
                ctx.save();
                ctx.translate(x, 64);
                ctx.shadowColor = c;
                ctx.shadowBlur = sb;
                ctx.strokeStyle = c;
                ctx.lineWidth = lw;

                // 底層加一圈較淡的粗描邊，做出一點厚度感
                ctx.globalAlpha = 0.38;
                ctx.lineWidth = lw + 4;
                if (x === 64) {
                    ctx.beginPath();
                    ctx.moveTo(-30, -30);
                    ctx.lineTo(30, 30);
                    ctx.moveTo(30, -30);
                    ctx.lineTo(-30, 30);
                    ctx.stroke();
                }
                if (x === 192) {
                    ctx.beginPath();
                    ctx.arc(0, 0, 35, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (x === 320) {
                    ctx.beginPath();
                    ctx.moveTo(0, -35);
                    ctx.lineTo(-35, 30);
                    ctx.lineTo(35, 30);
                    ctx.closePath();
                    ctx.stroke();
                }
                if (x === 448) {
                    ctx.beginPath();
                    ctx.rect(-30, -30, 60, 60);
                    ctx.stroke();
                }

                ctx.globalAlpha = 1;
                ctx.lineWidth = lw;
                if (x === 64) {
                    ctx.beginPath();
                    ctx.moveTo(-30, -30);
                    ctx.lineTo(30, 30);
                    ctx.moveTo(30, -30);
                    ctx.lineTo(-30, 30);
                    ctx.stroke();
                }
                if (x === 192) {
                    ctx.beginPath();
                    ctx.arc(0, 0, 35, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (x === 320) {
                    ctx.beginPath();
                    ctx.moveTo(0, -35);
                    ctx.lineTo(-35, 30);
                    ctx.lineTo(35, 30);
                    ctx.closePath();
                    ctx.stroke();
                }
                if (x === 448) {
                    ctx.beginPath();
                    ctx.rect(-30, -30, 60, 60);
                    ctx.stroke();
                }

                ctx.restore();
            }

            function carveHollowShape(ctx, x) {
                if (x === 64) {
                    ctx.beginPath();
                    ctx.moveTo(-20, -20);
                    ctx.lineTo(20, 20);
                    ctx.moveTo(20, -20);
                    ctx.lineTo(-20, 20);
                    ctx.stroke();
                }
                if (x === 192) {
                    ctx.beginPath();
                    ctx.arc(0, 0, 18, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (x === 320) {
                    ctx.beginPath();
                    ctx.moveTo(0, -23);
                    ctx.lineTo(-21, 16);
                    ctx.lineTo(21, 16);
                    ctx.closePath();
                    ctx.stroke();
                }
                if (x === 448) {
                    ctx.beginPath();
                    ctx.rect(-18, -18, 36, 36);
                    ctx.stroke();
                }
            }

            function drawBackgroundShapes(ctx, x, fillColor) {
                ctx.save();
                ctx.translate(x, 64);
                ctx.shadowColor = fillColor;
                ctx.shadowBlur = 10;
                ctx.fillStyle = fillColor;

                ctx.beginPath();
                ctx.arc(0, 0, 31, 0, Math.PI * 2);
                ctx.fill();

                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 7;
                carveHollowShape(ctx, x);
                ctx.restore();
            }

            const { canvas: cC, ctx: cCtx } = makeCanvas();
            drawSparkShapes(cCtx, 64, '#00d2ff', 8.8, 13);
            drawSparkShapes(cCtx, 192, '#ff355e', 8.8, 13);
            drawSparkShapes(cCtx, 320, '#00ff85', 8.8, 13);
            drawSparkShapes(cCtx, 448, '#ff67e2', 8.8, 13);
            const sparkTex = new THREE.CanvasTexture(cC);

            const { canvas: bgC, ctx: bgCtx } = makeCanvas();
            drawBackgroundShapes(bgCtx, 64, '#ffffff');
            drawBackgroundShapes(bgCtx, 192, '#ffffff');
            drawBackgroundShapes(bgCtx, 320, '#ffffff');
            drawBackgroundShapes(bgCtx, 448, '#ffffff');
            const bgTex = new THREE.CanvasTexture(bgC);

            const mistCanvas = document.createElement('canvas');
            mistCanvas.width = 128;
            mistCanvas.height = 128;
            const mistCtx = mistCanvas.getContext('2d');
            const mistGradient = mistCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
            mistGradient.addColorStop(0, 'rgba(255,255,255,0.95)');
            mistGradient.addColorStop(0.32, 'rgba(255,255,255,0.38)');
            mistGradient.addColorStop(0.65, 'rgba(255,255,255,0.1)');
            mistGradient.addColorStop(1, 'rgba(255,255,255,0)');
            mistCtx.fillStyle = mistGradient;
            mistCtx.beginPath();
            mistCtx.arc(64, 64, 64, 0, Math.PI * 2);
            mistCtx.fill();
            const mistTex = new THREE.CanvasTexture(mistCanvas);

            return { sparkTex, bgTex, mistTex };
        }

        const { sparkTex, bgTex, mistTex } = createPS5Textures();

        function createHaloTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
            gradient.addColorStop(0.18, 'rgba(255,255,255,0.76)');
            gradient.addColorStop(0.34, 'rgba(255,255,255,0.28)');
            gradient.addColorStop(0.55, 'rgba(255,255,255,0.12)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(128, 128, 128, 0, Math.PI * 2);
            ctx.fill();

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            return texture;
        }

        const haloTexture = createHaloTexture();

        function createDeepBlueBarTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
            gradient.addColorStop(0, 'rgba(0, 210, 255, 0.0)');
            gradient.addColorStop(0.14, 'rgba(0, 210, 255, 0.14)');
            gradient.addColorStop(0.52, 'rgba(116, 211, 255, 0.72)');
            gradient.addColorStop(0.9, 'rgba(183, 235, 255, 0.92)');
            gradient.addColorStop(0.985, 'rgba(228, 248, 255, 0.82)');
            gradient.addColorStop(1, 'rgba(228, 248, 255, 0.58)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const horizontalMask = ctx.createLinearGradient(0, 0, canvas.width, 0);
            horizontalMask.addColorStop(0, 'rgba(255,255,255,0)');
            horizontalMask.addColorStop(0.07, 'rgba(255,255,255,0.015)');
            horizontalMask.addColorStop(0.16, 'rgba(255,255,255,0.06)');
            horizontalMask.addColorStop(0.28, 'rgba(255,255,255,0.16)');
            horizontalMask.addColorStop(0.4, 'rgba(255,255,255,0.34)');
            horizontalMask.addColorStop(0.48, 'rgba(255,255,255,0.52)');
            horizontalMask.addColorStop(0.5, 'rgba(255,255,255,0.58)');
            horizontalMask.addColorStop(0.52, 'rgba(255,255,255,0.52)');
            horizontalMask.addColorStop(0.6, 'rgba(255,255,255,0.34)');
            horizontalMask.addColorStop(0.72, 'rgba(255,255,255,0.16)');
            horizontalMask.addColorStop(0.84, 'rgba(255,255,255,0.06)');
            horizontalMask.addColorStop(0.93, 'rgba(255,255,255,0.015)');
            horizontalMask.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = horizontalMask;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';

            const coreGradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
            coreGradient.addColorStop(0, 'rgba(255,255,255,0)');
            coreGradient.addColorStop(0.18, 'rgba(70, 227, 255, 0.08)');
            coreGradient.addColorStop(0.56, 'rgba(180, 244, 255, 0.32)');
            coreGradient.addColorStop(0.9, 'rgba(255,255,255,0.18)');
            coreGradient.addColorStop(1, 'rgba(255,255,255,0.1)');
            ctx.fillStyle = coreGradient;
            ctx.fillRect(canvas.width * 0.36, 0, canvas.width * 0.28, canvas.height);

            const glowX = canvas.width * 0.5;
            const glowY = 30;
            const glowRadius = 48;
            const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
            glow.addColorStop(0, 'rgba(255,255,255,0.62)');
            glow.addColorStop(0.5, 'rgba(164,230,255,0.26)');
            glow.addColorStop(1, 'rgba(164,230,255,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(glowX, glowY, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            return texture;
        }

        const deepBlueBarTexture = createDeepBlueBarTexture();

        // =========================================================
        // 7. 背景波紋
        // =========================================================
        const bgUniforms = {
            uTime: { value: 0 },
            uTex: { value: bgTex },
            uImpacts: { value: Array.from({ length: 20 }, () => new THREE.Vector3(100, 100, 0)) },
            uImpactTimes: { value: Array(20).fill(-100) }
        };

        let bgGeometry = null;
        let bgPoints = null;
        const BG_PLANE_Z = -2;
        const MIST_PLANE_Z = -0.35;
        const RING_PLANE_Z = 0.1;
        const SPARK_PLANE_Z = 0.2;
        const DEEP_BLUE_BAR_PLANE_Z = -1.15;
        const activeDeepBlueBars = [];
        const liveDeepBlueBars = new Map();
        let deepBlueBarGroup = null;
        let deepBlueMaskMesh = null;
        const bgMaterial = new THREE.ShaderMaterial({
            uniforms: bgUniforms,
            vertexShader: `
                uniform float uTime;
                uniform vec3 uImpacts[20];
                uniform float uImpactTimes[20];
                attribute float aType;
                varying float vGlow;
                varying float vType;

                void main() {
                    vType = aType;

                    float totalOsc = 0.0;
                    float brightEffect = 0.0;
                    float maxRad = 8.0;

                    for (int i = 0; i < 20; i++) {
                        float d = distance(position.xy, uImpacts[i].xy);
                        float e = uTime - uImpactTimes[i];

                        if (e > 0.0 && e < 4.0) {
                            float waveR = maxRad * smoothstep(0.0, 1.5, e);
                            float dec = exp(-e * 1.8) * exp(-d * 0.1);
                            float rip = sin(d * 3.5 - e * 15.0);
                            float m = smoothstep(2.5, 0.0, abs(d - waveR));

                            totalOsc += rip * m * dec;
                            brightEffect += m * dec * 1.0;
                        }
                    }

                    vGlow = max(0.0, brightEffect + max(0.0, totalOsc * 1.35)) * 0.9;

                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = 1.18 * (1.0 + totalOsc * 1.2) * (350.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTex;
                varying float vGlow;
                varying float vType;

                void main() {
                    vec2 uv = gl_PointCoord;
                    uv.x = (uv.x + floor(vType)) / 4.0;
                    vec4 tex = texture2D(uTex, uv);
                    gl_FragColor = vec4(tex.rgb * vGlow, tex.a * vGlow * 0.25);
                }
            `,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        function createBgGeometry() {
            // 固定 world space 間距
            const spacing = 0.215;
            // 取得相機參數
            const aspect = window.innerWidth / window.innerHeight;
            const fov = camera.fov * Math.PI / 180;
            // 計算 z = -2 時的可見範圍（相機在 z=8）
            const camZ = camera.position.z;
            const planeZ = BG_PLANE_Z;
            const dz = camZ - planeZ;
            const viewHeight = 2 * Math.tan(fov / 2) * dz;
            const viewWidth = viewHeight * aspect;
            const xCount = Math.ceil(viewWidth / spacing) + 2;
            const yCount = Math.ceil(viewHeight / spacing) + 2;
            const xStart = -viewWidth / 2;
            const yStart = -viewHeight / 2;

            const bgPositions = [];
            const bgTypes = [];
            for (let i = 0; i < xCount; i++) {
                for (let j = 0; j < yCount; j++) {
                    const x = xStart + i * spacing;
                    const y = yStart + j * spacing;
                    bgPositions.push(x, y, planeZ);
                    bgTypes.push((i + j * 2) % 4);
                }
            }

            if (bgGeometry) bgGeometry.dispose();
            bgGeometry = new THREE.BufferGeometry();
            bgGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bgPositions, 3));
            bgGeometry.setAttribute('aType', new THREE.Float32BufferAttribute(bgTypes, 1));
            return bgGeometry;
        }

        function getPlaneViewSize(targetZ) {
            const aspect = window.innerWidth / window.innerHeight;
            const fov = camera.fov * Math.PI / 180;
            const distance = camera.position.z - targetZ;
            const height = 2 * Math.tan(fov / 2) * distance;
            const width = height * aspect;

            return { width, height };
        }

        // 初始化與重建背景點
        function updateBgPoints() {
            if (bgPoints) {
                scene.remove(bgPoints);
                bgPoints.geometry.dispose();
                // material 不要 dispose，會重用
            }
            const geometry = createBgGeometry();
            bgPoints = new THREE.Points(geometry, bgMaterial);
            bgPoints.renderOrder = 0;
            scene.add(bgPoints);
            bgPoints.visible = usesLegacyGridEffects();
        }

        function ensureDeepBlueBarGroup() {
            if (deepBlueBarGroup) return;
            deepBlueBarGroup = new THREE.Group();
            deepBlueBarGroup.renderOrder = 1;
            scene.add(deepBlueBarGroup);
            updateDeepBlueMask();
        }

        function usesDeepBlueNoteLanes() {
            return getCurrentBackgroundTheme().id === 'deep-blue';
        }

        function clearDeepBlueBars() {
            for (let i = activeDeepBlueBars.length - 1; i >= 0; i--) {
                const bar = activeDeepBlueBars[i];
                if (deepBlueBarGroup) {
                    deepBlueBarGroup.remove(bar.mesh);
                }
                disposeDeepBlueBarMesh(bar.mesh);
            }
            activeDeepBlueBars.length = 0;
            liveDeepBlueBars.clear();
        }

        function updateDeepBlueMask() {
            if (!deepBlueBarGroup || !pianoContainer) return;

            if (deepBlueMaskMesh) {
                deepBlueBarGroup.remove(deepBlueMaskMesh);
                deepBlueMaskMesh.geometry.dispose();
                deepBlueMaskMesh.material.dispose();
                deepBlueMaskMesh = null;
            }

            const containerRect = pianoContainer.getBoundingClientRect();
            if (!containerRect.height || !containerRect.width) return;

            const topLeft = getScreenPointOnPlane(0, containerRect.top, DEEP_BLUE_BAR_PLANE_Z + 0.02);
            const bottomRight = getScreenPointOnPlane(window.innerWidth, window.innerHeight, DEEP_BLUE_BAR_PLANE_Z + 0.02);
            const { width: viewWidth } = getPlaneViewSize(DEEP_BLUE_BAR_PLANE_Z + 0.02);
            const maskHeight = Math.max(0.01, topLeft.y - bottomRight.y);
            const backgroundColor = getCurrentBackgroundTheme().color;

            const geometry = new THREE.PlaneGeometry(viewWidth + 2, maskHeight);
            const material = new THREE.MeshBasicMaterial({
                color: backgroundColor,
                transparent: false,
                depthWrite: false,
                toneMapped: false
            });

            deepBlueMaskMesh = new THREE.Mesh(geometry, material);
            deepBlueMaskMesh.position.set(0, bottomRight.y + maskHeight * 0.5, DEEP_BLUE_BAR_PLANE_Z + 0.02);
            deepBlueMaskMesh.renderOrder = 2;
            deepBlueBarGroup.add(deepBlueMaskMesh);
        }

        function getMidiLanePositionX(midi, targetZ) {
            const { width } = getPlaneViewSize(targetZ);
            const laneRatio = (midi - 21) / (108 - 21);
            const innerPadding = 0.08;
            return -width * (0.5 - innerPadding) + laneRatio * width * (1 - innerPadding * 2);
        }

        function getMidiLaunchPosition(midi, targetZ) {
            const keyEl = allKeysMap[midi];
            if (!keyEl) {
                const { height } = getPlaneViewSize(targetZ);
                return {
                    x: getMidiLanePositionX(midi, targetZ),
                    y: -height * 0.5 + 0.9
                };
            }

            const rect = keyEl.getBoundingClientRect();
            const clientX = rect.left + rect.width * 0.5;
            const clientY = rect.top;
            const point = getScreenPointOnPlane(clientX, clientY, targetZ);
            return { x: point.x, y: point.y };
        }

        function getDeepBlueBarBottomY(bar) {
            return bar.holding ? bar.entryY : bar.launchY;
        }

        function getQueuedLaunchY(midi, baseLaunchY, initialHeight) {
            const laneGap = 0.06;
            let queuedLaunchY = baseLaunchY;

            for (const bar of activeDeepBlueBars) {
                if (bar.midi !== midi) continue;

                const barBottomY = getDeepBlueBarBottomY(bar);
                if (barBottomY > queuedLaunchY - 2.2) {
                    queuedLaunchY = Math.min(queuedLaunchY, barBottomY - laneGap - initialHeight);
                }
            }

            return queuedLaunchY;
        }

        function isBlackKeyMidi(midi) {
            return [1, 3, 6, 8, 10].includes(midi % 12);
        }

        function createDeepBlueBarMesh(color, width, height, isBlackKey) {
            const group = new THREE.Group();
            const renderBaseOrder = isBlackKey ? 6 : 3;
            let shadowMesh = null;

            if (isBlackKey) {
                const shadowMaterial = new THREE.MeshBasicMaterial({
                    color: 0x000000,
                    transparent: true,
                    opacity: 0.18,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    toneMapped: false
                });
                shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.68, height * 1.14), shadowMaterial);
                shadowMesh.position.set(0, -height * 0.03, -0.001);
                shadowMesh.renderOrder = renderBaseOrder;
                group.add(shadowMesh);
            }

            const auraMaterial = new THREE.MeshBasicMaterial({
                map: deepBlueBarTexture,
                color,
                transparent: true,
                opacity: 0.24,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
                toneMapped: false
            });
            const glowMaterial = new THREE.MeshBasicMaterial({
                map: deepBlueBarTexture,
                color,
                transparent: true,
                opacity: 0.46,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
                toneMapped: false
            });
            const coreMaterial = new THREE.MeshBasicMaterial({
                color: color.clone().lerp(new THREE.Color(0xffffff), 0.08),
                transparent: true,
                opacity: 0.92,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
                toneMapped: false
            });

            const auraMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.78, height), auraMaterial);
            const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.28, height), glowMaterial);
            const coreMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.82, height), coreMaterial);

            auraMesh.renderOrder = renderBaseOrder + 1;
            glowMesh.renderOrder = renderBaseOrder + 2;
            coreMesh.renderOrder = renderBaseOrder + 3;

            group.add(auraMesh);
            group.add(glowMesh);
            group.add(coreMesh);
            group.userData = { shadowMesh, auraMesh, glowMesh, coreMesh, isBlackKey };
            return group;
        }

        function updateDeepBlueBarGlow(bar, baseOpacity) {
            const shimmer = 0.94 + Math.sin(performance.now() * 0.01 + bar.midi * 0.35) * 0.08;
            const visuals = bar.mesh.userData;
            if (!visuals) return;

            if (visuals.shadowMesh) {
                visuals.shadowMesh.material.opacity = baseOpacity * 0.18;
            }
            visuals.auraMesh.material.opacity = baseOpacity * 0.26 * shimmer;
            visuals.glowMesh.material.opacity = baseOpacity * 0.78 * shimmer;
            visuals.coreMesh.material.opacity = Math.min(1, baseOpacity * 1.08);
        }

        function disposeDeepBlueBarMesh(mesh) {
            if (!mesh) return;
            mesh.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }

        function getDeepBlueBarKey(source, midi) {
            return `${source}:${midi}`;
        }

        function startDeepBlueNoteBar(source, midi, isSustained) {
            if (!usesDeepBlueNoteLanes()) return;

            ensureDeepBlueBarGroup();

            const barKey = getDeepBlueBarKey(source, midi);
            if (isSustained && liveDeepBlueBars.has(barKey)) return;

            const launchPoint = getMidiLaunchPosition(midi, DEEP_BLUE_BAR_PLANE_Z);
            const blackKey = isBlackKeyMidi(midi);
            const barWidth = 0.18;
            const initialHeight = 0.03;
            const minFloatingHeight = 0.2 + ((midi % 12) / 12) * 0.1;
            const color = getEffectColor(midi);
            const queuedLaunchY = getQueuedLaunchY(midi, launchPoint.y, initialHeight);
            const mesh = createDeepBlueBarMesh(color, barWidth, initialHeight, blackKey);
            mesh.position.set(launchPoint.x, queuedLaunchY + initialHeight * 0.5, DEEP_BLUE_BAR_PLANE_Z);
            deepBlueBarGroup.add(mesh);
            spawnDeepBlueJet(launchPoint, midi, blackKey);

            const bar = {
                key: barKey,
                mesh,
                midi,
                launchY: queuedLaunchY,
                entryY: launchPoint.y,
                topY: queuedLaunchY + initialHeight,
                currentHeight: initialHeight,
                baseHeight: initialHeight,
                velocity: 0.024,
                fade: 1,
                holding: isSustained,
                sprouting: false,
                targetHeight: minFloatingHeight,
                minFloatingHeight,
                growthSpeed: 0.018,
                releaseGrowthSpeed: 0.045,
                drift: 0,
                glowBaseOpacity: 0.88,
                jetPulseTimer: 0.22 + Math.random() * 0.12
            };

            activeDeepBlueBars.push(bar);

            if (isSustained) {
                liveDeepBlueBars.set(barKey, bar);
            }
        }

        function releaseDeepBlueNoteBar(source, midi) {
            const barKey = getDeepBlueBarKey(source, midi);
            const bar = liveDeepBlueBars.get(barKey);
            if (!bar) return;

            bar.holding = false;
            bar.sprouting = false;
            bar.targetHeight = bar.currentHeight;
            bar.launchY = bar.entryY;
            bar.velocity = 0.024;
            bar.fade = 1;
            liveDeepBlueBars.delete(barKey);
        }

        function updateDeepBlueBars() {
            const { height } = getPlaneViewSize(DEEP_BLUE_BAR_PLANE_Z);
            const upperBound = height * 0.5 + 6;

            for (let i = activeDeepBlueBars.length - 1; i >= 0; i--) {
                const bar = activeDeepBlueBars[i];
                if (typeof bar.glowBaseOpacity !== 'number') {
                    bar.glowBaseOpacity = 0.88;
                }

                let targetGlowBaseOpacity = 0.88 * bar.fade;
                if (bar.holding) {
                    bar.topY += bar.velocity;
                    bar.currentHeight = Math.max(bar.baseHeight, bar.topY - bar.entryY);
                    bar.mesh.scale.y = bar.currentHeight / bar.baseHeight;
                    bar.mesh.position.y = bar.entryY + bar.currentHeight * 0.5;
                    targetGlowBaseOpacity = 0.88;

                    bar.jetPulseTimer -= 1 / 60;
                    if (bar.jetPulseTimer <= 0) {
                        spawnDeepBlueJet({ x: bar.mesh.position.x, y: bar.entryY }, bar.midi, isBlackKeyMidi(bar.midi), true);
                        bar.jetPulseTimer = 0.3 + Math.random() * 0.18;
                    }
                } else if (bar.sprouting) {
                    bar.currentHeight = Math.min(bar.targetHeight, bar.currentHeight + bar.releaseGrowthSpeed);
                    bar.mesh.scale.y = bar.currentHeight / bar.baseHeight;
                    bar.mesh.position.y = bar.launchY + bar.currentHeight * 0.5;
                    targetGlowBaseOpacity = 0.88;

                    if (bar.currentHeight >= bar.targetHeight - 0.0001) {
                        bar.sprouting = false;
                    }
                } else {
                    bar.mesh.position.y += bar.velocity;
                    bar.mesh.position.x += bar.drift;
                    bar.launchY += bar.velocity;
                }

                bar.glowBaseOpacity += (targetGlowBaseOpacity - bar.glowBaseOpacity) * 0.1;
                updateDeepBlueBarGlow(bar, bar.glowBaseOpacity);

                if (bar.mesh.position.y > upperBound) {
                    if (deepBlueBarGroup) {
                        deepBlueBarGroup.remove(bar.mesh);
                    }
                    disposeDeepBlueBarMesh(bar.mesh);
                    activeDeepBlueBars.splice(i, 1);
                }
            }
        }

        updateBgPoints();
        backgroundVisualsReady = true;


        // =========================================================
        // 8. 光圈與火花
        // =========================================================
        const activeSparks = [];
        const activeMists = [];
        const activeDeepBlueJets = [];
        let impactIdx = 0;

        function getEffectColor(midi) {
            const palette = [
                new THREE.Color(0x00f5d4),
                new THREE.Color(0x3cf0ff),
                new THREE.Color(0x7a5cff),
                new THREE.Color(0xff4fa3),
                new THREE.Color(0xefffff)
            ];
            return palette[Math.abs(midi) % palette.length].clone();
        }

        function clearActiveSparks() {
            for (let i = activeSparks.length - 1; i >= 0; i--) {
                const s = activeSparks[i];
                scene.remove(s.points);
                s.geo.dispose();
                s.points.material.dispose();
            }
            activeSparks.length = 0;
        }

        function clearActiveMists() {
            for (let i = activeMists.length - 1; i >= 0; i--) {
                const m = activeMists[i];
                scene.remove(m.points);
                m.geo.dispose();
                m.points.material.dispose();
            }
            activeMists.length = 0;
        }

        function clearActiveDeepBlueJets() {
            for (let i = activeDeepBlueJets.length - 1; i >= 0; i--) {
                const jet = activeDeepBlueJets[i];
                scene.remove(jet.points);
                jet.geo.dispose();
                jet.points.material.dispose();
            }
            activeDeepBlueJets.length = 0;
        }

        function syncBackgroundVisualState() {
            const showLegacyEffects = usesLegacyGridEffects();
            const showDeepBlueBars = usesDeepBlueNoteLanes();

            if (bgPoints) {
                bgPoints.visible = showLegacyEffects;
            }

            ensureDeepBlueBarGroup();
            deepBlueBarGroup.visible = showDeepBlueBars;
            updateDeepBlueMask();

            if (!showLegacyEffects) {
                bgUniforms.uImpactTimes.value.fill(-100);
                clearActiveSparks();
                clearActiveMists();
            }

            if (!showDeepBlueBars) {
                clearDeepBlueBars();
                clearActiveDeepBlueJets();
            }
        }

        syncBackgroundVisualState();

        function triggerInteraction(source, bgPoint, midi) {
            if (usesLegacyGridEffects()) {
                bgUniforms.uImpacts.value[impactIdx].set(bgPoint.x, bgPoint.y, 0);
                bgUniforms.uImpactTimes.value[impactIdx] = performance.now() * 0.001;
                impactIdx = (impactIdx + 1) % 20;
            }

            highlightKey(source, midi, true);
            setTimeout(() => highlightKey(source, midi, false), 150);
        }

        function triggerDeepBlueNoteOn(source, midi, isSustained = false) {
            startDeepBlueNoteBar(source, midi, isSustained);
        }

        function triggerDeepBlueNoteOff(source, midi) {
            releaseDeepBlueNoteBar(source, midi);
        }

        function spawnDeepBlueJet(point, midi, isBlackKey, isHeldPulse = false) {
            if (!usesDeepBlueNoteLanes()) return;

            const count = isHeldPulse
                ? (isBlackKey ? 10 : 8)
                : (isBlackKey ? 12 : 10);
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            const vel = new Float32Array(count * 3);
            const drift = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const alphas = new Float32Array(count);
            const colors = new Float32Array(count * 3);
            const ages = new Float32Array(count);
            const phases = new Float32Array(count);
            const swirl = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const spread = (Math.random() - 0.5) * (isHeldPulse
                    ? (isBlackKey ? 0.016 : 0.022)
                    : (isBlackKey ? 0.014 : 0.019));
                const lift = isHeldPulse
                    ? 0.004 + Math.random() * 0.006
                    : 0.0045 + Math.random() * 0.0065;
                const color = getEffectColor(midi).lerp(
                    new THREE.Color(0xffffff),
                    isHeldPulse
                        ? 0.12 + Math.random() * 0.08
                        : 0.18 + Math.random() * 0.1
                );

                pos[i * 3] = point.x + spread * 0.3;
                pos[i * 3 + 1] = point.y - 0.008 + Math.random() * 0.012;
                pos[i * 3 + 2] = DEEP_BLUE_BAR_PLANE_Z + 0.008 + (Math.random() - 0.5) * 0.006;

                vel[i * 3] = spread * 0.16;
                vel[i * 3 + 1] = lift;
                vel[i * 3 + 2] = 0;

                drift[i * 3] = (Math.random() - 0.5) * 0.0014;
                drift[i * 3 + 1] = 0.00055 + Math.random() * 0.0008;
                drift[i * 3 + 2] = (Math.random() - 0.5) * 0.00035;

                sizes[i] = (isHeldPulse ? 0.9 : 0.72) * ((isBlackKey ? 14 : 13) + Math.random() * 6);
                alphas[i] = isHeldPulse
                    ? 0.054 + Math.random() * 0.036
                    : 0.05 + Math.random() * 0.045;
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
                ages[i] = Math.random() * 0.18;
                phases[i] = Math.random() * Math.PI * 2;
                swirl[i] = 0.00045 + Math.random() * 0.00065;
            }

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const points = new THREE.Points(
                geo,
                new THREE.ShaderMaterial({
                    uniforms: { uTex: { value: mistTex } },
                    vertexShader: `
                        attribute float aSize;
                        attribute float aAlpha;
                        attribute vec3 aColor;
                        varying float vAlpha;
                        varying vec3 vColor;

                        void main() {
                            vAlpha = aAlpha;
                            vColor = aColor;
                            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = aSize * (0.45 + aAlpha * 0.9) * (350.0 / -mvPos.z);
                            gl_Position = projectionMatrix * mvPos;
                        }
                    `,
                    fragmentShader: `
                        uniform sampler2D uTex;
                        varying float vAlpha;
                        varying vec3 vColor;

                        void main() {
                            vec4 tex = texture2D(uTex, gl_PointCoord);
                            gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
                        }
                    `,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );

            points.renderOrder = isBlackKey ? 11 : 8;
            scene.add(points);

            activeDeepBlueJets.push({
                points,
                geo,
                pos,
                vel,
                drift,
                alphas,
                ages,
                phases,
                swirl,
                isHeldPulse,
                posAttr: geo.attributes.position,
                alphaAttr: geo.attributes.aAlpha
            });
        }

        function spawnSparks(point) {
            if (!usesLegacyGridEffects()) return;

            const count = 8;

            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            const vel = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const alphas = new Float32Array(count);
            const types = new Float32Array(count);
            const rx = new Float32Array(count);
            const ry = new Float32Array(count);
            const rz = new Float32Array(count);
            const rvx = new Float32Array(count);
            const rvy = new Float32Array(count);
            const rvz = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                pos[i * 3] = point.x;
                pos[i * 3 + 1] = point.y;
                pos[i * 3 + 2] = SPARK_PLANE_Z;

                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 0.05 + 0.05;

                vel[i * 3] = Math.cos(angle) * speed;
                vel[i * 3 + 1] = Math.sin(angle) * speed;
                vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;

                sizes[i] = 2.6 + Math.random() * 1.4;
                alphas[i] = 1.5;
                types[i] = Math.floor(Math.random() * 4);

                rx[i] = Math.random() * Math.PI * 2;
                ry[i] = Math.random() * Math.PI * 2;
                rz[i] = Math.random() * Math.PI * 2;

                rvx[i] = (Math.random() - 0.5) * 0.18;
                rvy[i] = (Math.random() - 0.5) * 0.18;
                rvz[i] = (Math.random() - 0.5) * 0.18;
            }

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aType', new THREE.BufferAttribute(types, 1));
            geo.setAttribute('aRotX', new THREE.BufferAttribute(rx, 1));
            geo.setAttribute('aRotY', new THREE.BufferAttribute(ry, 1));
            geo.setAttribute('aRotZ', new THREE.BufferAttribute(rz, 1));

            const points = new THREE.Points(
                geo,
                new THREE.ShaderMaterial({
                    uniforms: { uTex: { value: sparkTex } },
                    vertexShader: `
                        attribute float aSize;
                        attribute float aAlpha;
                        attribute float aType;
                        attribute float aRotX;
                        attribute float aRotY;
                        attribute float aRotZ;

                        varying float vAlpha;
                        varying float vType;
                        varying float vRotX;
                        varying float vRotY;
                        varying float vRotZ;

                        void main() {
                            vAlpha = aAlpha;
                            vType = aType;
                            vRotX = aRotX;
                            vRotY = aRotY;
                            vRotZ = aRotZ;

                            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = aSize * (0.3 + 0.7 * aAlpha) * (350.0 / -mvPos.z);
                            gl_Position = projectionMatrix * mvPos;
                        }
                    `,
                    fragmentShader: `
                        uniform sampler2D uTex;

                        varying float vAlpha;
                        varying float vType;
                        varying float vRotX;
                        varying float vRotY;
                        varying float vRotZ;

                        void main() {
                            vec2 uv = gl_PointCoord - vec2(0.5);

                            float cY = cos(vRotY);
                            float cX = cos(vRotX);
                            float sZ = sin(vRotZ);
                            float cZ = cos(vRotZ);

                            // Z 軸旋轉
                            vec2 rotUV = vec2(
                                uv.x * cZ - uv.y * sZ,
                                uv.x * sZ + uv.y * cZ
                            );

                            vec2 rUV = rotUV;
                            rUV.x /= (abs(cY) < 0.15 ? 0.15 : cY);
                            rUV.y /= (abs(cX) < 0.15 ? 0.15 : cX);

                            if (abs(rUV.x) > 0.5 || abs(rUV.y) > 0.5) discard;

                            vec2 finalUV = rUV + 0.5;
                            finalUV.x = (finalUV.x + floor(vType + 0.5)) / 4.0;

                            vec4 texColor = texture2D(uTex, finalUV);
                            gl_FragColor = vec4(texColor.rgb, texColor.a * vAlpha);
                        }
                    `,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );

            points.renderOrder = 2;
            scene.add(points);

            activeSparks.push({
                points,
                geo,
                pos,
                vel,
                alphas,
                rx,
                ry,
                rz,
                rvx,
                rvy,
                rvz,
                posAttr: geo.attributes.position,
                alphaAttr: geo.attributes.aAlpha,
                rotXAttr: geo.attributes.aRotX,
                rotYAttr: geo.attributes.aRotY,
                rotZAttr: geo.attributes.aRotZ
            });
        }

        function spawnMist(point, midi) {
            if (!usesLegacyGridEffects()) return;

            const count = 3;
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            const drift = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const alphas = new Float32Array(count);
            const colors = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 0.28;
                const color = getEffectColor(midi);
                color.lerp(new THREE.Color(0x6f8cff), 0.22 + Math.random() * 0.16);

                pos[i * 3] = point.x + Math.cos(angle) * radius;
                pos[i * 3 + 1] = point.y + Math.sin(angle) * radius;
                pos[i * 3 + 2] = MIST_PLANE_Z;

                drift[i * 3] = (Math.random() - 0.5) * 0.0035;
                drift[i * 3 + 1] = 0.002 + Math.random() * 0.003;
                drift[i * 3 + 2] = 0;

                sizes[i] = 34 + Math.random() * 24;
                alphas[i] = 0.12 + Math.random() * 0.1;
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
            }

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const points = new THREE.Points(
                geo,
                new THREE.ShaderMaterial({
                    uniforms: { uTex: { value: mistTex } },
                    vertexShader: `
                        attribute float aSize;
                        attribute float aAlpha;
                        attribute vec3 aColor;
                        varying float vAlpha;
                        varying vec3 vColor;

                        void main() {
                            vAlpha = aAlpha;
                            vColor = aColor;
                            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = aSize * (350.0 / -mvPos.z);
                            gl_Position = projectionMatrix * mvPos;
                        }
                    `,
                    fragmentShader: `
                        uniform sampler2D uTex;
                        varying float vAlpha;
                        varying vec3 vColor;

                        void main() {
                            vec4 tex = texture2D(uTex, gl_PointCoord);
                            gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
                        }
                    `,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );

            points.renderOrder = 1;
            scene.add(points);

            activeMists.push({
                points,
                geo,
                pos,
                drift,
                alphas,
                alphaAttr: geo.attributes.aAlpha,
                posAttr: geo.attributes.position
            });
        }

        // =========================================================
        // 9. 鍵盤座標對應
        // =========================================================
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

        function getScreenPointOnPlane(clientX, clientY, targetZ) {
            const mouse = new THREE.Vector2(
                (clientX / window.innerWidth) * 2 - 1,
                -(clientY / window.innerHeight) * 2 + 1
            );

            const ray = new THREE.Raycaster();
            ray.setFromCamera(mouse, camera);

            const point = new THREE.Vector3();
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -targetZ);
            ray.ray.intersectPlane(plane, point);
            return point;
        }

        function projectPointToPlane(sourcePoint, targetZ) {
            const direction = sourcePoint.clone().sub(camera.position);
            const scale = (targetZ - camera.position.z) / direction.z;
            return camera.position.clone().add(direction.multiplyScalar(scale));
        }

        // =========================================================
        // 10. 鍵盤互動
        // =========================================================
        window.addEventListener('keydown', async (e) => {
            if (!isInteractivePlayback()) {
                if (currentScreen === 'home' && e.key === 'Enter') {
                    transitionFromHome(freePlayCard, 'free-play');
                }
                return;
            }

            const key = e.key.toLowerCase();
            const midi = getMidiFromScaleKey(key, e.shiftKey, e.ctrlKey);

            if (midi !== null) {
                e.preventDefault();
                if (e.repeat) return;

                try {
                    await initAudio();
                    if (isInstrumentLoading) return;
                    const { x, y } = getKeyVisualPosition(key);
                    const sustained = true;
                    playVisualFeedback('user', midi, x, y);
                    triggerDeepBlueNoteOn('user', midi, sustained);
                    recordPerformanceEvent({ type: 'note-on', midi, ringX: x, ringY: y, sustained });
                    activeVisualKeyStates.set(key, { midi });

                    if (supportsHeldNotes(currentSound)) {
                        playPianoKeyDown(key, midi);
                    } else {
                        playMidi(midi);
                    }
                } catch (err) {
                    console.error('Audio init/play failed:', err);
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!isInteractivePlayback()) return;

            const key = e.key.toLowerCase();
            const visualState = activeVisualKeyStates.get(key);

            if (visualState) {
                recordPerformanceEvent({ type: 'note-off', midi: visualState.midi });
                triggerDeepBlueNoteOff('user', visualState.midi);
                activeVisualKeyStates.delete(key);
            }

            if (supportsHeldNotes(currentSound) && activePianoKeyStates.has(key)) {
                releasePianoKey(key);
            }
        });

        window.addEventListener('blur', () => {
            stopLiveInputPlayback();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                stopLiveInputPlayback();
            }
        });

        window.addEventListener('mousedown', async (e) => {
            if (!isInteractivePlayback()) return;

            const topBar = document.getElementById('top-bar');
            const rect = bottomUi.getBoundingClientRect();
            const topBarRect = topBar.getBoundingClientRect();

            if (
                (
                    e.clientX >= rect.left &&
                    e.clientX <= rect.right &&
                    e.clientY >= rect.top &&
                    e.clientY <= rect.bottom
                ) ||
                (
                    e.clientX >= topBarRect.left &&
                    e.clientX <= topBarRect.right &&
                    e.clientY >= topBarRect.top &&
                    e.clientY <= topBarRect.bottom
                )
            ) {
                return;
            }

            try {
                await initAudio();
                if (isInstrumentLoading) return;

                const midi = getMidiFromScaleKey('a', false, false) ?? 60;
                const ringPoint = getScreenPointOnPlane(e.clientX, e.clientY, RING_PLANE_Z);
                playVisualFeedback('user', midi, ringPoint.x, ringPoint.y);
                triggerDeepBlueNoteOn('user', midi, false);
                recordPerformanceEvent({ type: 'note-on', midi, ringX: ringPoint.x, ringY: ringPoint.y, sustained: false });
                playMidi(midi);
            } catch (err) {
                console.error('Mouse audio init/play failed:', err);
            }
        });

        // =========================================================
        // 11. 動畫循環
        // =========================================================
        function animate() {
            requestAnimationFrame(animate);

            const now = performance.now() * 0.001;
            bgUniforms.uTime.value = now;

            for (let i = activeSparks.length - 1; i >= 0; i--) {
                const s = activeSparks[i];
                let alive = 0;

                for (let j = 0; j < s.alphas.length; j++) {
                    if (s.alphas[j] > 0.01) {
                        s.pos[j * 3] += s.vel[j * 3];
                        s.pos[j * 3 + 1] += s.vel[j * 3 + 1];
                        s.pos[j * 3 + 2] += s.vel[j * 3 + 2];

                        s.vel[j * 3] *= 0.98;
                        s.vel[j * 3 + 1] *= 0.98;
                        s.vel[j * 3 + 2] *= 0.985;

                        s.rx[j] += s.rvx[j];
                        s.ry[j] += s.rvy[j];
                        s.rz[j] += s.rvz[j];

                        s.rvx[j] *= 0.992;
                        s.rvy[j] *= 0.992;
                        s.rvz[j] *= 0.992;

                        s.alphas[j] *= 0.975;
                        alive++;
                    }
                }

                s.posAttr.needsUpdate = true;
                s.alphaAttr.needsUpdate = true;
                s.rotXAttr.needsUpdate = true;
                s.rotYAttr.needsUpdate = true;
                s.rotZAttr.needsUpdate = true;

                if (alive === 0) {
                    scene.remove(s.points);
                    s.geo.dispose();
                    s.points.material.dispose();
                    activeSparks.splice(i, 1);
                }
            }

            for (let i = activeMists.length - 1; i >= 0; i--) {
                const m = activeMists[i];
                let alive = 0;

                for (let j = 0; j < m.alphas.length; j++) {
                    if (m.alphas[j] > 0.008) {
                        m.pos[j * 3] += m.drift[j * 3];
                        m.pos[j * 3 + 1] += m.drift[j * 3 + 1];
                        m.drift[j * 3] *= 0.992;
                        m.drift[j * 3 + 1] *= 0.996;
                        m.alphas[j] *= 0.975;
                        alive++;
                    }
                }

                m.posAttr.needsUpdate = true;
                m.alphaAttr.needsUpdate = true;

                if (alive === 0) {
                    scene.remove(m.points);
                    m.geo.dispose();
                    m.points.material.dispose();
                    activeMists.splice(i, 1);
                }
            }

            for (let i = activeDeepBlueJets.length - 1; i >= 0; i--) {
                const jet = activeDeepBlueJets[i];
                let alive = 0;

                for (let j = 0; j < jet.alphas.length; j++) {
                    if (jet.alphas[j] > 0.006) {
                        jet.ages[j] += 0.06;

                        const swirlX = Math.sin(jet.ages[j] * 3.2 + jet.phases[j]) * jet.swirl[j];
                        const swirlZ = Math.cos(jet.ages[j] * 2.4 + jet.phases[j] * 0.7) * jet.swirl[j] * 0.35;
                        const pulse = jet.isHeldPulse
                            ? 0.992 + Math.sin(jet.ages[j] * 1.15 + jet.phases[j]) * 0.012
                            : 1;

                        jet.vel[j * 3] += jet.drift[j * 3] + swirlX;
                        jet.vel[j * 3 + 1] += jet.drift[j * 3 + 1];
                        jet.vel[j * 3 + 2] += jet.drift[j * 3 + 2] + swirlZ;

                        jet.pos[j * 3] += jet.vel[j * 3];
                        jet.pos[j * 3 + 1] += jet.vel[j * 3 + 1];
                        jet.pos[j * 3 + 2] += jet.vel[j * 3 + 2];

                        jet.vel[j * 3] *= 0.84;
                        jet.vel[j * 3 + 1] *= 0.94;
                        jet.vel[j * 3 + 2] *= 0.84;
                        jet.alphas[j] *= (jet.isHeldPulse ? 0.968 : 0.958) * pulse;
                        alive++;
                    }
                }

                jet.posAttr.needsUpdate = true;
                jet.alphaAttr.needsUpdate = true;

                if (alive === 0) {
                    scene.remove(jet.points);
                    jet.geo.dispose();
                    jet.points.material.dispose();
                    activeDeepBlueJets.splice(i, 1);
                }
            }

            updateDeepBlueBars();

            renderer.render(scene, camera);
        }

        animate();

        window.addEventListener('resize', () => {
            schedulePianoLayoutSync();
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            updateBgPoints();
            updateDeepBlueMask();
        });
