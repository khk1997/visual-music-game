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
import { createPointerInputController } from './input/pointer.js';
import { createAbsolutePitchModule } from './modes/absolute-pitch.js';
import { BACKGROUND_THEMES } from './themes/registry.js';
import { createPianoFeedbackController } from './ui/piano-feedback.js';
import { createScreenManager } from './ui/screen-manager.js';
import { createThemePanelController } from './ui/theme-panel.js';
import { updateBackgroundPointField } from './visual/background-ripples.js';
import { updatePianoRollMaskMesh } from './visual/piano-roll-mask.js';
import {
    PIANO_ROLL_BAR_BASE_HEIGHT,
    PIANO_ROLL_BAR_PLANE_Z,
    MIST_TINT_COLOR,
    WHITE_COLOR,
    createPianoRollBarInstancingSystem,
    getEffectColor,
    syncPianoRollBarSetCount,
    updatePianoRollBarLayerInstance
} from './visual/piano-roll-bars.js';
import {
    acquirePianoRollJetIndices,
    createPianoRollJetBatch,
    releasePianoRollJetEffect
} from './visual/piano-roll-jets.js';
import {
    acquireMistEffect,
    acquireSparkEffect,
    releaseMistEffect,
    releaseSparkEffect
} from './visual/effects.js';
import { createVisualMaterials } from './visual/materials.js';
import { createVisualScene } from './visual/scene.js';
import {
    createPianoRollBarTexture,
    createHaloTexture,
    createPS5Textures
} from './visual/textures.js';

// =========================================================
// 1. 音源設定
// =========================================================
        const PIANO_TAP_DURATION = 0.12;
        let backgroundVisualsReady = false;
        let screenManager = null;
        let themePanelController = null;
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
        const { scene, camera, renderer } = createVisualScene();

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

                if (theme.id === 'piano-roll' && getCurrentSound() !== 'piano') {
                    soundSelect.value = 'piano';
                    void switchInstrument('piano');
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
            onVisualNoteOn: (midi, x, y, sustained) => {
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

        function getCurrentBackgroundTheme() {
            return themePanelController.getCurrentBackgroundTheme();
        }

        function usesLegacyGridEffects() {
            return getCurrentBackgroundTheme().id === 'playstation-style';
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

        const haloTexture = createHaloTexture();

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
            return getCurrentBackgroundTheme().id === 'piano-roll';
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

        function updatePianoRollBarInstance(bar, baseOpacity) {
            const barSet = getPianoRollBarSet(bar.isBlackKey);
            if (!barSet) return;

            const shimmer = 0.94 + Math.sin(performance.now() * 0.01 + bar.midi * 0.35) * 0.08;
            const scaleY = bar.currentHeight / bar.baseHeight;
            const centerY = bar.positionY;

            if (barSet.shadowLayer) {
                updatePianoRollBarLayerInstance(
                    barSet.shadowLayer,
                    bar.slot,
                    bar.x,
                    centerY - bar.currentHeight * 0.03,
                    PIANO_ROLL_BAR_PLANE_Z - 0.001,
                    scaleY,
                    WHITE_COLOR,
                    baseOpacity * 0.18
                );
            }

            updatePianoRollBarLayerInstance(
                barSet.auraLayer,
                bar.slot,
                bar.x,
                centerY,
                PIANO_ROLL_BAR_PLANE_Z,
                scaleY,
                bar.color,
                baseOpacity * 0.26 * shimmer
            );
            updatePianoRollBarLayerInstance(
                barSet.glowLayer,
                bar.slot,
                bar.x,
                centerY,
                PIANO_ROLL_BAR_PLANE_Z,
                scaleY,
                bar.color,
                baseOpacity * 0.78 * shimmer
            );
            updatePianoRollBarLayerInstance(
                barSet.coreLayer,
                bar.slot,
                bar.x,
                centerY,
                PIANO_ROLL_BAR_PLANE_Z,
                scaleY,
                bar.coreColor,
                Math.min(1, baseOpacity * 1.08)
            );
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

            updatePianoRollBarLayerInstance(barSet.auraLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            updatePianoRollBarLayerInstance(barSet.glowLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            updatePianoRollBarLayerInstance(barSet.coreLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            if (barSet.shadowLayer) {
                updatePianoRollBarLayerInstance(barSet.shadowLayer, bar.slot, 0, 0, PIANO_ROLL_BAR_PLANE_Z - 0.001, 0.0001, WHITE_COLOR, 0);
            }
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

            updatePianoRollBarInstance(bar, bar.glowBaseOpacity);
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
                updatePianoRollBarInstance(bar, bar.glowBaseOpacity);

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
        }

        function triggerPianoRollNoteOff(source, midi) {
            releasePianoRollNoteBar(source, midi);
        }

        function spawnPianoRollJet(point, midi, isBlackKey, isHeldPulse = false) {
            if (!usesPianoRollNoteLanes()) return;

            const count = isHeldPulse
                ? (isBlackKey ? 10 : 8)
                : (isBlackKey ? 12 : 10);
            const batch = isBlackKey ? pianoRollJetBatches.black : pianoRollJetBatches.white;
            const indices = acquirePianoRollJetIndices(batch, count);
            if (!indices) return;
            const {
                pos,
                vel,
                drift,
                sizes,
                alphas,
                colors,
                ages,
                phases,
                swirl
            } = batch;

            for (let i = 0; i < count; i++) {
                const particleIndex = indices[i];
                const offset = particleIndex * 3;
                const spread = (Math.random() - 0.5) * (isHeldPulse
                    ? (isBlackKey ? 0.016 : 0.022)
                    : (isBlackKey ? 0.014 : 0.019));
                const lift = isHeldPulse
                    ? 0.004 + Math.random() * 0.006
                    : 0.0045 + Math.random() * 0.0065;
                const color = getEffectColor(midi).lerp(
                    WHITE_COLOR,
                    isHeldPulse
                        ? 0.12 + Math.random() * 0.08
                        : 0.18 + Math.random() * 0.1
                );

                pos[offset] = point.x + spread * 0.3;
                pos[offset + 1] = point.y - 0.008 + Math.random() * 0.012;
                pos[offset + 2] = PIANO_ROLL_BAR_PLANE_Z + 0.008 + (Math.random() - 0.5) * 0.006;

                vel[offset] = spread * 0.16;
                vel[offset + 1] = lift;
                vel[offset + 2] = 0;

                drift[offset] = (Math.random() - 0.5) * 0.0014;
                drift[offset + 1] = 0.00055 + Math.random() * 0.0008;
                drift[offset + 2] = (Math.random() - 0.5) * 0.00035;

                sizes[particleIndex] = (isHeldPulse ? 0.9 : 0.72) * ((isBlackKey ? 14 : 13) + Math.random() * 6);
                alphas[particleIndex] = isHeldPulse
                    ? 0.054 + Math.random() * 0.036
                    : 0.05 + Math.random() * 0.045;
                colors[offset] = color.r;
                colors[offset + 1] = color.g;
                colors[offset + 2] = color.b;
                ages[particleIndex] = Math.random() * 0.18;
                phases[particleIndex] = Math.random() * Math.PI * 2;
                swirl[particleIndex] = 0.00045 + Math.random() * 0.00065;
            }

            batch.points.visible = true;
            batch.posAttr.needsUpdate = true;
            batch.sizeAttr.needsUpdate = true;
            batch.alphaAttr.needsUpdate = true;
            batch.colorAttr.needsUpdate = true;

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
                    const { batch, indices } = jet;
                    let alive = 0;

                    for (let j = 0; j < indices.length; j++) {
                        const particleIndex = indices[j];
                        if (batch.alphas[particleIndex] > 0.006) {
                            const offset = particleIndex * 3;
                            batch.ages[particleIndex] += 0.06;

                            const swirlX = Math.sin(batch.ages[particleIndex] * 3.2 + batch.phases[particleIndex]) * batch.swirl[particleIndex];
                            const swirlZ = Math.cos(batch.ages[particleIndex] * 2.4 + batch.phases[particleIndex] * 0.7) * batch.swirl[particleIndex] * 0.35;
                            const pulse = jet.isHeldPulse
                                ? 0.992 + Math.sin(batch.ages[particleIndex] * 1.15 + batch.phases[particleIndex]) * 0.012
                                : 1;

                            batch.vel[offset] += batch.drift[offset] + swirlX;
                            batch.vel[offset + 1] += batch.drift[offset + 1];
                            batch.vel[offset + 2] += batch.drift[offset + 2] + swirlZ;

                            batch.pos[offset] += batch.vel[offset];
                            batch.pos[offset + 1] += batch.vel[offset + 1];
                            batch.pos[offset + 2] += batch.vel[offset + 2];

                            batch.vel[offset] *= 0.84;
                            batch.vel[offset + 1] *= 0.94;
                            batch.vel[offset + 2] *= 0.84;
                            batch.alphas[particleIndex] *= (jet.isHeldPulse ? 0.968 : 0.958) * pulse;
                            alive++;
                        }
                    }

                    batch.posAttr.needsUpdate = true;
                    batch.alphaAttr.needsUpdate = true;

                    if (alive === 0) {
                        releasePianoRollJetEffect(jet);
                        activePianoRollJets.splice(i, 1);
                    }
                }
            }

            updatePianoRollBars();

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
        });
