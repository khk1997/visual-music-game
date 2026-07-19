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
    keyboardGuide,
    keyboardGuideToggleButton,
    modeCards,
    modePanel,
    modeScreen,
    modeSelect,
    midiStatus,
    modeStatus,
    playbackScreen,
    soundSelect,
    topBar,
    themeList,
    themePanel,
    themePreviewDescription,
    themePreviewMedia,
    themePreviewTitle
} from './core/dom.js';
import {
    MAJOR_SCALE,
    NATURAL_MINOR_SCALE,
    NOTE_TO_PC,
    SCALE_KEY_MAP
} from './core/config.js';
import { createPerfMonitor } from './app/perf-monitor.js';
import { createInstrumentManager } from './audio/instrument-manager.js';
import { createRecordSlotController } from './audio/record-slots.js';
import { createKeyboardInputController } from './input/keyboard.js';
import { createLiveInputService } from './input/live-input.js';
import { createMidiInputController } from './input/midi.js';
import { createPointerInputController } from './input/pointer.js';
import { createAbsolutePitchModule } from './modes/absolute-pitch.js';
import { BACKGROUND_THEMES } from './themes/registry.js';
import { createPianoFeedbackController } from './ui/piano-feedback.js';
import { createKeyboardGuideController } from './ui/keyboard-guide.js';
import { createScreenManager } from './ui/screen-manager.js';
import { createThemePanelController } from './ui/theme-panel.js';
import { updateBackgroundPointField } from './visual/background-ripples.js';
import { updatePianoRollMaskMesh } from './visual/piano-roll-mask.js';
import {
    PIANO_ROLL_BAR_BASE_HEIGHT,
    PIANO_ROLL_BAR_PLANE_Z,
    MIST_TINT_COLOR,
    WHITE_COLOR,
    clearPianoRollBarInstance,
    createPianoRollBarInstancingSystem,
    getEffectColor,
    syncPianoRollBarSetCount,
    updatePianoRollBarInstance
} from './visual/piano-roll-bars.js';
import {
    acquirePianoRollJetIndices,
    createPianoRollJetBatch,
    initializePianoRollJetParticles,
    releasePianoRollJetEffect,
    updatePianoRollJetEffect
} from './visual/piano-roll-jets.js';
import {
    acquireMistEffect,
    acquireSparkEffect,
    releaseMistEffect,
    releaseSparkEffect
} from './visual/effects.js';
import { createFluidInkSystem } from './visual/fluid-ink.js';
import { createVisualMaterials } from './visual/materials.js';
import { createVisualScene } from './visual/scene.js';
import {
    createPianoRollBarTexture,
    createPS5Textures
} from './visual/textures.js';

// =========================================================
// 1. 音源設定
// =========================================================
        const PIANO_TAP_DURATION = 0.12;
        let currentNoteIntensity = 0.85;
        let midiInputController = null;
        let backgroundVisualsReady = false;
        let screenManager = null;
        let themePanelController = null;
        let keyboardGuideController = null;
        let recordSlotController = null;
        let liveInputController = null;
        let keyboardInputController = null;
        let pointerInputController = null;
        const {
            bindSoundSelect,
            createInstrumentInstance,
            disposeLofiChain,
            getCurrentSound,
            getInstrument,
            getIsInstrumentLoading,
            getTriggerTime,
            initAudio,
            playBackHomeClickSound,
            playMidi,
            playMidiWithInstrument,
            playModeCardClickSound,
            supportsHeldNotes,
            switchInstrument
        } = createInstrumentManager({
            soundSelect,
            onStopLiveInput: () => liveInputController?.stopAll()
        });
        bindSoundSelect();

        function stopLiveInputPlayback() {
            liveInputController?.stopAll();
        }

        // =========================================================
        // 2. 鋼琴 UI
        // =========================================================
        const pianoContainer = document.getElementById('piano-container');
        const pianoUi = document.getElementById('piano-ui');
        const recordSlotButtons = Array.from(document.querySelectorAll('.record-slot-button'));
        const allKeysMap = {};
        let pianoLayoutFrame = null;
        const bottomUiDesignWidth = 1680;
        const bottomUiViewportGutter = 32;

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

        function syncBottomUiScale() {
            if (!bottomUi) return;

            const availableWidth = Math.max(0, window.innerWidth - bottomUiViewportGutter);
            const nextScale = Math.min(1, availableWidth / bottomUiDesignWidth);
            bottomUi.style.setProperty('--bottom-ui-scale', nextScale.toFixed(4));
        }

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

        syncBottomUiScale();
        schedulePianoLayoutSync();
        window.addEventListener('resize', schedulePianoLayoutSync);
        window.addEventListener('resize', syncBottomUiScale);

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

        const {
            highlightKey,
            playVisualFeedback,
            triggerTimedHighlight
        } = createPianoFeedbackController({
            allKeysMap,
            createRingPoint: (x, y, z) => new THREE.Vector3(x, y, z),
            getPlanes: () => ({
                background: BG_PLANE_Z,
                mist: MIST_PLANE_Z,
                ring: RING_PLANE_Z,
                spark: SPARK_PLANE_Z
            }),
            projectPointToPlane,
            spawnMist,
            spawnSparks,
            triggerInteraction
        });

        function isInteractivePlayback() {
            return screenManager?.isInteractivePlayback() ?? false;
        }

        function transitionFromHome(selectedCard, nextScreen) {
            screenManager?.transitionFromHome(selectedCard, nextScreen);
        }

        function setScreen(nextScreen, options = {}) {
            screenManager?.setScreen(nextScreen, options);
        }

        function nowSeconds() {
            return performance.now() * 0.001;
        }

        function recordPerformanceEvent(event) {
            recordSlotController?.recordEvent(event);
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
            keyboardGuideController?.render();
        });

        modeSelect.addEventListener('change', () => {
            currentMode = modeSelect.value;
            updateKeyUI();
            keyboardGuideController?.render();
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
        const { scene, camera, renderer } = createVisualScene();

        const screenPointScratch = {
            mouse: new THREE.Vector2(),
            ray: new THREE.Raycaster(),
            plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
        };

        keyboardGuideController = createKeyboardGuideController({
            guideEl: keyboardGuide,
            toggleButton: keyboardGuideToggleButton,
            getCurrentKeyRoot: () => currentKeyRoot,
            getCurrentMode: () => currentMode
        });
        keyboardGuideController.bind();

        themePanelController = createThemePanelController({
            backgroundToggleButton,
            themeList,
            themePanel,
            themePreviewDescription,
            themePreviewMedia,
            themePreviewTitle,
            themes: BACKGROUND_THEMES,
            getUiState: () => ({
                currentScreen: screenManager?.getCurrentScreen() ?? 'home',
                isFreePlayThemeSelection: screenManager?.getIsFreePlayThemeSelection() ?? false
            }),
            onApplyTheme: (theme) => {
                scene.background = new THREE.Color(theme.color);
                renderer.toneMappingExposure = theme.exposure;

                if (theme.forcedInstrument && getCurrentSound() !== theme.forcedInstrument) {
                    soundSelect.value = theme.forcedInstrument;
                    void switchInstrument(theme.forcedInstrument);
                }

                if (backgroundVisualsReady) {
                    syncBackgroundVisualState();
                }
            },
            onPlaySelectSound: playModeCardClickSound,
            requestScreenChange: (nextScreen, options) => setScreen(nextScreen, options)
        });

        screenManager = createScreenManager({
            absolutePitch,
            absolutePitchCard,
            absolutePitchUi,
            backHomeButton,
            backgroundToggleButton,
            bottomUi,
            freePlayCard,
            modeCards,
            modePanel,
            modeScreen,
            modeStatus,
            playbackScreen,
            themeUi: themePanelController,
            onPlayBackHomeClickSound: playBackHomeClickSound,
            onPlayModeCardClickSound: playModeCardClickSound,
            stopRecordSlots: () => recordSlotController?.stopAll()
        });

        recordSlotController = createRecordSlotController({
            buttons: recordSlotButtons,
            createInstrumentInstance,
            disposeLofiChain,
            getCurrentSound,
            getTriggerTime,
            highlightKey,
            initAudio,
            nowSeconds,
            playMidiWithInstrument,
            playVisualFeedback,
            releasePlaybackVisuals: (midi) => {
                if (typeof midi === 'number') {
                    triggerPianoRollNoteOff('playback', midi);
                    return;
                }

                for (const barKey of Array.from(livePianoRollBars.keys())) {
                    if (barKey.startsWith('playback:')) {
                        const playbackMidi = Number(barKey.split(':')[1]);
                        triggerPianoRollNoteOff('playback', playbackMidi);
                    }
                }

                // 墨水的持續墨流不在 livePianoRollBars 裡，需另外清掉回放來源的墨流
                fluidInkSystem.noteOffByPrefix('playback:');
            },
            supportsHeldNotes,
            tapDuration: PIANO_TAP_DURATION,
            triggerPlaybackNoteOn: (midi, sustained) => {
                triggerPianoRollNoteOn('playback', midi, sustained);
            }
        });
        recordSlotController.bind();

        liveInputController = createLiveInputService({
            getCurrentSound,
            getInstrument,
            getIsInstrumentLoading,
            getTriggerTime,
            onPlayTapMidi: playMidi,
            onRecordEvent: recordPerformanceEvent,
            onStopVisualNotes: () => keyboardInputController?.stopActiveVisualKeys(),
            onVisualNoteOff: (midi) => {
                highlightKey('user', midi, false);
                triggerPianoRollNoteOff('user', midi);
            },
            onVisualNoteOn: (midi, x, y, sustained, velocity) => {
                currentNoteIntensity = velocity ?? 0.85;
                playVisualFeedback('user', midi, x, y);
                triggerPianoRollNoteOn('user', midi, sustained);
            },
            supportsHeldNotes,
            tapDuration: PIANO_TAP_DURATION
        });

        keyboardInputController = createKeyboardInputController({
            getCurrentScreen: () => screenManager?.getCurrentScreen() ?? 'home',
            isInteractivePlayback,
            getMidiFromScaleKey,
            initAudio,
            isInstrumentLoading: getIsInstrumentLoading,
            onHomeEnter: () => transitionFromHome(freePlayCard, 'free-play'),
            onGuideKeyDown: (key) => keyboardGuideController?.activateKey(key),
            onGuideKeyUp: (key) => keyboardGuideController?.deactivateKey(key),
            onGuideKeysClear: () => keyboardGuideController?.clearActiveKeys(),
            onLiveNoteOff: (payload) => liveInputController?.triggerNoteOff(payload),
            onLiveNoteOn: (payload) => liveInputController?.triggerNoteOn(payload),
            onRecordSlotHotkey: (index) => recordSlotController?.triggerSlot(index),
            onStopAllLiveInput: stopLiveInputPlayback
        });
        keyboardInputController.bind();

        pointerInputController = createPointerInputController({
            isInteractivePlayback,
            getExcludedElements: () => [bottomUi, topBar],
            initAudio,
            isInstrumentLoading: getIsInstrumentLoading,
            getDefaultMidi: () => getMidiFromScaleKey('a', false, false) ?? 60,
            getRingPoint: (clientX, clientY) => getScreenPointOnPlane(clientX, clientY, RING_PLANE_Z),
            onLiveNoteOn: (payload) => liveInputController?.triggerNoteOn(payload)
        });
        pointerInputController.bind();

        function getRingPointForMidi(midi) {
            const keyEl = allKeysMap[midi];
            if (keyEl) {
                const rect = keyEl.getBoundingClientRect();
                const point = getScreenPointOnPlane(
                    rect.left + rect.width * 0.5,
                    rect.top,
                    RING_PLANE_Z
                );
                if (point) return point;
            }
            return { x: ((midi - 21) / 87) * 12 - 6, y: 0 };
        }

        function updateMidiStatus(deviceNames) {
            if (!midiStatus) return;

            if (deviceNames === null) {
                midiStatus.classList.add('hidden');
                return;
            }

            midiStatus.classList.remove('hidden');
            if (deviceNames.length === 0) {
                midiStatus.textContent = 'MIDI: 未連接';
                midiStatus.classList.remove('is-connected');
            } else {
                midiStatus.textContent = `MIDI: ${deviceNames.join(', ')}`;
                midiStatus.classList.add('is-connected');
            }
        }

        midiInputController = createMidiInputController({
            isInteractivePlayback,
            initAudio,
            isInstrumentLoading: getIsInstrumentLoading,
            getRingPointForMidi,
            onLiveNoteOn: (payload) => liveInputController?.triggerNoteOn(payload),
            onLiveNoteOff: (payload) => liveInputController?.triggerNoteOff(payload),
            onDevicesChanged: updateMidiStatus
        });
        void midiInputController.bind();

        function getCurrentBackgroundTheme() {
            return themePanelController.getCurrentBackgroundTheme();
        }

        function getVisualSystem() {
            return getCurrentBackgroundTheme().visualSystem ?? 'legacy-grid';
        }

        function usesLegacyGridEffects() {
            return getVisualSystem() === 'legacy-grid';
        }

        function updateThemePanelSelection() {
            themePanelController.updateThemePanelSelection();
        }

        function closeThemePanel() {
            themePanelController.closeThemePanel();
        }

        function openThemePanel() {
            themePanelController.openThemePanel();
        }

        function resetThemeSelectionVisualState() {
            themePanelController.resetThemeSelectionVisualState();
        }

        function applyBackgroundTheme(index) {
            themePanelController.applyBackgroundTheme(index);
        }

        backgroundToggleButton.classList.add('is-readonly');
        themePanelController.setupThemePanel();
        applyBackgroundTheme(0);
        screenManager.bindUi();
        setScreen('home');
        absolutePitch.resetIntro();

        // =========================================================
        // 6. 貼圖生成
        // =========================================================
        const { sparkTex, bgTex, mistTex } = createPS5Textures();

        const pianoRollBarTexture = createPianoRollBarTexture();

        // =========================================================
        // 7. 背景波紋
        // =========================================================
        const {
            bgUniforms,
            bgMaterial,
            pianoRollJetMaterial,
            sparkMaterial,
            mistMaterial
        } = createVisualMaterials({ bgTex, mistTex, sparkTex });

        let bgPoints = null;
        const BG_PLANE_Z = -2;
        const MIST_PLANE_Z = -0.35;
        const RING_PLANE_Z = 0.1;
        const SPARK_PLANE_Z = 0.2;
        const activePianoRollBars = [];
        const livePianoRollBars = new Map();
        const pianoRollBarCoreColorScratch = new THREE.Color();
        let pianoRollBarGroup = null;
        let pianoRollBarInstancing = null;
        let pianoRollMaskMesh = null;

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
            bgPoints = updateBackgroundPointField({
                scene,
                camera,
                material: bgMaterial,
                currentPoints: bgPoints,
                planeZ: BG_PLANE_Z,
                visible: usesLegacyGridEffects()
            });
        }

        function ensurePianoRollBarGroup() {
            if (pianoRollBarGroup) return;
            pianoRollBarGroup = new THREE.Group();
            pianoRollBarGroup.renderOrder = 1;
            scene.add(pianoRollBarGroup);
            pianoRollBarInstancing = createPianoRollBarInstancingSystem(pianoRollBarGroup, pianoRollBarTexture);
            updatePianoRollMask();
        }

        function usesPianoRollNoteLanes() {
            return getVisualSystem() === 'piano-roll';
        }

        function usesFluidInk() {
            return getVisualSystem() === 'fluid-ink';
        }

        function clearPianoRollBars() {
            for (let i = activePianoRollBars.length - 1; i >= 0; i--) {
                releasePianoRollBarInstance(activePianoRollBars[i]);
            }
            activePianoRollBars.length = 0;
            livePianoRollBars.clear();
        }

        function updatePianoRollMask() {
            pianoRollMaskMesh = updatePianoRollMaskMesh({
                group: pianoRollBarGroup,
                currentMask: pianoRollMaskMesh,
                pianoContainer,
                getScreenPointOnPlane,
                getPlaneViewSize,
                backgroundColor: getCurrentBackgroundTheme().color,
                planeZ: PIANO_ROLL_BAR_PLANE_Z
            });
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

        function getPianoRollBarBottomY(bar) {
            return bar.holding ? bar.entryY : bar.launchY;
        }

        function getQueuedLaunchY(midi, baseLaunchY, initialHeight) {
            const laneGap = 0.06;
            let queuedLaunchY = baseLaunchY;

            for (const bar of activePianoRollBars) {
                if (bar.midi !== midi) continue;

                const barBottomY = getPianoRollBarBottomY(bar);
                if (barBottomY > queuedLaunchY - 2.2) {
                    queuedLaunchY = Math.min(queuedLaunchY, barBottomY - laneGap - initialHeight);
                }
            }

            return queuedLaunchY;
        }

        function isBlackKeyMidi(midi) {
            return [1, 3, 6, 8, 10].includes(midi % 12);
        }

        function getPianoRollBarSet(isBlackKey) {
            return isBlackKey ? pianoRollBarInstancing?.black : pianoRollBarInstancing?.white;
        }

        function acquirePianoRollBarSlot(isBlackKey) {
            const barSet = getPianoRollBarSet(isBlackKey);
            if (!barSet || barSet.freeSlots.length === 0) return null;
            const slot = barSet.freeSlots.pop();
            barSet.usedSlots[slot] = 1;
            syncPianoRollBarSetCount(barSet);
            return slot;
        }

        function releasePianoRollBarInstance(bar) {
            if (!bar) return;

            const barSet = getPianoRollBarSet(bar.isBlackKey);
            if (!barSet) return;

            clearPianoRollBarInstance(barSet, bar);
            barSet.usedSlots[bar.slot] = 0;
            barSet.freeSlots.push(bar.slot);
            syncPianoRollBarSetCount(barSet);
        }

        function getPianoRollBarKey(source, midi) {
            return `${source}:${midi}`;
        }

        function startPianoRollNoteBar(source, midi, isSustained) {
            if (!usesPianoRollNoteLanes()) return;

            ensurePianoRollBarGroup();

            const barKey = getPianoRollBarKey(source, midi);
            if (isSustained && livePianoRollBars.has(barKey)) return;

            const launchPoint = getMidiLaunchPosition(midi, PIANO_ROLL_BAR_PLANE_Z);
            const blackKey = isBlackKeyMidi(midi);
            const slot = acquirePianoRollBarSlot(blackKey);
            if (slot === null) return;
            const initialHeight = PIANO_ROLL_BAR_BASE_HEIGHT;
            const minFloatingHeight = 0.2 + ((midi % 12) / 12) * 0.1;
            const color = getEffectColor(midi);
            const queuedLaunchY = getQueuedLaunchY(midi, launchPoint.y, initialHeight);
            const coreColor = color.clone().lerp(WHITE_COLOR, 0.08);
            spawnPianoRollJet(launchPoint, midi, blackKey);

            const bar = {
                key: barKey,
                slot,
                midi,
                isBlackKey: blackKey,
                x: launchPoint.x,
                positionY: queuedLaunchY + initialHeight * 0.5,
                color,
                coreColor,
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

            updatePianoRollBarInstance(getPianoRollBarSet(bar.isBlackKey), bar, bar.glowBaseOpacity);
            activePianoRollBars.push(bar);

            if (isSustained) {
                livePianoRollBars.set(barKey, bar);
            }
        }

        function releasePianoRollNoteBar(source, midi) {
            const barKey = getPianoRollBarKey(source, midi);
            const bar = livePianoRollBars.get(barKey);
            if (!bar) return;

            bar.holding = false;
            bar.sprouting = false;
            bar.targetHeight = bar.currentHeight;
            bar.launchY = bar.entryY;
            bar.velocity = 0.024;
            bar.fade = 1;
            livePianoRollBars.delete(barKey);
        }

        function updatePianoRollBars() {
            const { height } = getPlaneViewSize(PIANO_ROLL_BAR_PLANE_Z);
            const upperBound = height * 0.5 + 6;

            for (let i = activePianoRollBars.length - 1; i >= 0; i--) {
                const bar = activePianoRollBars[i];
                if (typeof bar.glowBaseOpacity !== 'number') {
                    bar.glowBaseOpacity = 0.88;
                }

                let targetGlowBaseOpacity = 0.88 * bar.fade;
                if (bar.holding) {
                    bar.topY += bar.velocity;
                    bar.currentHeight = Math.max(bar.baseHeight, bar.topY - bar.entryY);
                    bar.positionY = bar.entryY + bar.currentHeight * 0.5;
                    targetGlowBaseOpacity = 0.88;

                    bar.jetPulseTimer -= 1 / 60;
                    if (bar.jetPulseTimer <= 0) {
                        spawnPianoRollJet({ x: bar.x, y: bar.entryY }, bar.midi, isBlackKeyMidi(bar.midi), true);
                        bar.jetPulseTimer = 0.3 + Math.random() * 0.18;
                    }
                } else if (bar.sprouting) {
                    bar.currentHeight = Math.min(bar.targetHeight, bar.currentHeight + bar.releaseGrowthSpeed);
                    bar.positionY = bar.launchY + bar.currentHeight * 0.5;
                    targetGlowBaseOpacity = 0.88;

                    if (bar.currentHeight >= bar.targetHeight - 0.0001) {
                        bar.sprouting = false;
                    }
                } else {
                    bar.positionY += bar.velocity;
                    bar.x += bar.drift;
                    bar.launchY += bar.velocity;
                }

                bar.glowBaseOpacity += (targetGlowBaseOpacity - bar.glowBaseOpacity) * 0.1;
                updatePianoRollBarInstance(getPianoRollBarSet(bar.isBlackKey), bar, bar.glowBaseOpacity);

                if (bar.positionY > upperBound) {
                    releasePianoRollBarInstance(bar);
                    activePianoRollBars.splice(i, 1);
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
        const activePianoRollJets = [];
        const pooledSparks = [];
        const pooledMists = [];
        let impactIdx = 0;

        const perfMonitor = createPerfMonitor({
            renderer,
            getThemeLabel: () => getCurrentBackgroundTheme().label,
            getPixelRatio: () => renderer.getPixelRatio(),
            getStateSnapshot: () => ({
                activeBars: activePianoRollBars.length,
                activeSparks: activeSparks.length,
                activeMists: activeMists.length,
                activeJets: activePianoRollJets.length,
                recordedEvents: recordSlotController?.getStats().recordedEvents ?? 0,
                isPlaybackActive: (recordSlotController?.getStats().playingSlots ?? 0) > 0
            })
        });

        const pianoRollJetBatches = {
            white: createPianoRollJetBatch(scene, pianoRollJetMaterial, 8),
            black: createPianoRollJetBatch(scene, pianoRollJetMaterial, 11)
        };

        const FLUID_INK_PLANE_Z = -1.5;
        const fluidInkSystem = createFluidInkSystem({
            scene,
            camera,
            renderer,
            planeZ: FLUID_INK_PLANE_Z
        });

        function clearActiveSparks() {
            for (let i = activeSparks.length - 1; i >= 0; i--) {
                releaseSparkEffect(scene, pooledSparks, activeSparks[i]);
            }
            activeSparks.length = 0;
        }

        function clearActiveMists() {
            for (let i = activeMists.length - 1; i >= 0; i--) {
                releaseMistEffect(scene, pooledMists, activeMists[i]);
            }
            activeMists.length = 0;
        }

        function clearActivePianoRollJets() {
            for (let i = activePianoRollJets.length - 1; i >= 0; i--) {
                releasePianoRollJetEffect(activePianoRollJets[i]);
            }
            activePianoRollJets.length = 0;
        }

        function syncBackgroundVisualState() {
            const showLegacyEffects = usesLegacyGridEffects();
            const showPianoRollBars = usesPianoRollNoteLanes();

            if (bgPoints) {
                bgPoints.visible = showLegacyEffects;
            }

            ensurePianoRollBarGroup();
            pianoRollBarGroup.visible = showPianoRollBars;
            updatePianoRollMask();

            fluidInkSystem.setVisible(usesFluidInk());
            if (!usesFluidInk()) {
                fluidInkSystem.clear();
            }

            if (!showLegacyEffects) {
                bgUniforms.uImpactTimes.value.fill(-100);
                clearActiveSparks();
                clearActiveMists();
            }

            if (!showPianoRollBars) {
                clearPianoRollBars();
                clearActivePianoRollJets();
            }
        }

        syncBackgroundVisualState();

        function triggerInteraction(source, bgPoint, midi) {
            if (usesLegacyGridEffects()) {
                bgUniforms.uImpacts.value[impactIdx].set(bgPoint.x, bgPoint.y, 0);
                bgUniforms.uImpactTimes.value[impactIdx] = performance.now() * 0.001;
                impactIdx = (impactIdx + 1) % 20;
            }

            triggerTimedHighlight(source, midi);
        }

        function triggerPianoRollNoteOn(source, midi, isSustained = false) {
            startPianoRollNoteBar(source, midi, isSustained);

            if (usesFluidInk()) {
                const launchPoint = getMidiLaunchPosition(midi, FLUID_INK_PLANE_Z);
                fluidInkSystem.noteOn(`${source}:${midi}`, launchPoint.x, launchPoint.y, midi, currentNoteIntensity, isSustained);
            }
        }

        function triggerPianoRollNoteOff(source, midi) {
            releasePianoRollNoteBar(source, midi);
            fluidInkSystem.noteOff(`${source}:${midi}`);
        }

        function spawnPianoRollJet(point, midi, isBlackKey, isHeldPulse = false) {
            if (!usesPianoRollNoteLanes()) return;

            const count = isHeldPulse
                ? (isBlackKey ? 10 : 8)
                : (isBlackKey ? 12 : 10);
            const batch = isBlackKey ? pianoRollJetBatches.black : pianoRollJetBatches.white;
            const indices = acquirePianoRollJetIndices(batch, count);
            if (!indices) return;
            initializePianoRollJetParticles(batch, indices, point, midi, isBlackKey, isHeldPulse);

            activePianoRollJets.push({
                batch,
                indices,
                isHeldPulse
            });
        }

        function spawnSparks(point) {
            if (!usesLegacyGridEffects()) return;

            const count = 8;
            const effect = acquireSparkEffect(scene, pooledSparks, count, sparkMaterial);
            const {
                points,
                pos,
                vel,
                sizes,
                alphas,
                types,
                rx,
                ry,
                rz,
                rvx,
                rvy,
                rvz
            } = effect;

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

            points.renderOrder = 2;
            effect.posAttr.needsUpdate = true;
            effect.sizeAttr.needsUpdate = true;
            effect.alphaAttr.needsUpdate = true;
            effect.typeAttr.needsUpdate = true;
            effect.rotXAttr.needsUpdate = true;
            effect.rotYAttr.needsUpdate = true;
            effect.rotZAttr.needsUpdate = true;

            activeSparks.push(effect);
        }

        function spawnMist(point, midi) {
            if (!usesLegacyGridEffects()) return;

            const count = 3;
            const effect = acquireMistEffect(scene, pooledMists, count, mistMaterial);
            const { points, pos, drift, sizes, alphas, colors } = effect;

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 0.28;
                const color = getEffectColor(midi);
                color.lerp(MIST_TINT_COLOR, 0.22 + Math.random() * 0.16);

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

            points.renderOrder = 1;
            effect.posAttr.needsUpdate = true;
            effect.sizeAttr.needsUpdate = true;
            effect.alphaAttr.needsUpdate = true;
            effect.colorAttr.needsUpdate = true;

            activeMists.push(effect);
        }

        function getScreenPointOnPlane(clientX, clientY, targetZ) {
            const { mouse, ray, plane } = screenPointScratch;
            mouse.set(
                (clientX / window.innerWidth) * 2 - 1,
                -(clientY / window.innerHeight) * 2 + 1
            );
            ray.setFromCamera(mouse, camera);

            const point = new THREE.Vector3();
            plane.constant = -targetZ;
            ray.ray.intersectPlane(plane, point);
            return point;
        }

        function projectPointToPlane(sourcePoint, targetZ) {
            const direction = sourcePoint.clone().sub(camera.position);
            const scale = (targetZ - camera.position.z) / direction.z;
            return camera.position.clone().add(direction.multiplyScalar(scale));
        }

        // =========================================================
        // 11. 動畫循環
        // =========================================================
        let lastAnimationTimeMs = performance.now();

        function animate() {
            requestAnimationFrame(animate);

            const nowMs = performance.now();
            const now = nowMs * 0.001;
            const deltaSeconds = Math.min((nowMs - lastAnimationTimeMs) * 0.001, 0.05);
            lastAnimationTimeMs = nowMs;
            bgUniforms.uTime.value = now;

            if (activeSparks.length > 0) {
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
                        releaseSparkEffect(scene, pooledSparks, s);
                        activeSparks.splice(i, 1);
                    }
                }
            }

            if (activeMists.length > 0) {
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
                        releaseMistEffect(scene, pooledMists, m);
                        activeMists.splice(i, 1);
                    }
                }
            }

            if (activePianoRollJets.length > 0) {
                for (let i = activePianoRollJets.length - 1; i >= 0; i--) {
                    const jet = activePianoRollJets[i];
                    const alive = updatePianoRollJetEffect(jet);

                    if (alive === 0) {
                        releasePianoRollJetEffect(jet);
                        activePianoRollJets.splice(i, 1);
                    }
                }
            }

            updatePianoRollBars();
            fluidInkSystem.update(deltaSeconds);

            renderer.render(scene, camera);
            perfMonitor.sampleFrame(nowMs);
        }

        animate();

        window.addEventListener('resize', () => {
            schedulePianoLayoutSync();
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setPixelRatio(window.devicePixelRatio || 1);
            renderer.setSize(window.innerWidth, window.innerHeight);
            updateBgPoints();
            updatePianoRollMask();
            fluidInkSystem.handleResize();
        });
