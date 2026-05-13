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
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 8;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.toneMapping = THREE.ReinhardToneMapping;
        renderer.toneMappingExposure = 2.0;
        document.body.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 1.2));

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
                    triggerDeepBlueNoteOff('playback', midi);
                    return;
                }

                for (const barKey of Array.from(liveDeepBlueBars.keys())) {
                    if (barKey.startsWith('playback:')) {
                        const playbackMidi = Number(barKey.split(':')[1]);
                        triggerDeepBlueNoteOff('playback', playbackMidi);
                    }
                }
            },
            supportsHeldNotes,
            tapDuration: PIANO_TAP_DURATION,
            triggerPlaybackNoteOn: (midi, sustained) => {
                triggerDeepBlueNoteOn('playback', midi, sustained);
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
                triggerDeepBlueNoteOff('user', midi);
            },
            onVisualNoteOn: (midi, x, y, sustained) => {
                playVisualFeedback('user', midi, x, y);
                triggerDeepBlueNoteOn('user', midi, sustained);
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
        const WHITE_COLOR = new THREE.Color(0xffffff);
        const MIST_TINT_COLOR = new THREE.Color(0x6f8cff);
        const EFFECT_COLOR_PALETTE = [
            new THREE.Color(0x00f5d4),
            new THREE.Color(0x3cf0ff),
            new THREE.Color(0x7a5cff),
            new THREE.Color(0xff4fa3),
            new THREE.Color(0xefffff)
        ];
        const DEEP_BLUE_BAR_MAX_INSTANCES = 144;
        const DEEP_BLUE_BAR_BASE_WIDTH = 0.18;
        const DEEP_BLUE_BAR_BASE_HEIGHT = 0.03;
        const deepBlueBarGeometries = {
            shadow: new THREE.PlaneGeometry(DEEP_BLUE_BAR_BASE_WIDTH * 1.68, DEEP_BLUE_BAR_BASE_HEIGHT * 1.14),
            aura: new THREE.PlaneGeometry(DEEP_BLUE_BAR_BASE_WIDTH * 1.78, DEEP_BLUE_BAR_BASE_HEIGHT),
            glow: new THREE.PlaneGeometry(DEEP_BLUE_BAR_BASE_WIDTH * 1.28, DEEP_BLUE_BAR_BASE_HEIGHT),
            core: new THREE.PlaneGeometry(DEEP_BLUE_BAR_BASE_WIDTH * 0.82, DEEP_BLUE_BAR_BASE_HEIGHT)
        };
        const deepBlueBarShadowMaterialProps = {
            color: 0x000000,
            transparent: true,
            opacity: 0.18,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        };
        const deepBlueBarAuraMaterialProps = {
            map: deepBlueBarTexture,
            transparent: true,
            opacity: 0.24,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        };
        const deepBlueBarGlowMaterialProps = {
            map: deepBlueBarTexture,
            transparent: true,
            opacity: 0.46,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        };
        const deepBlueBarCoreMaterialProps = {
            transparent: true,
            opacity: 0.92,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        };

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
        const deepBlueBarInstanceScratch = new THREE.Object3D();
        const deepBlueBarCoreColorScratch = new THREE.Color();
        let deepBlueBarGroup = null;
        let deepBlueBarInstancing = null;
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
        const deepBlueJetMaterial = new THREE.ShaderMaterial({
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
        });
        const sparkMaterial = new THREE.ShaderMaterial({
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
        });
        const mistMaterial = new THREE.ShaderMaterial({
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
            deepBlueBarInstancing = createDeepBlueBarInstancingSystem(deepBlueBarGroup);
            updateDeepBlueMask();
        }

        function usesDeepBlueNoteLanes() {
            return getCurrentBackgroundTheme().id === 'piano-roll';
        }

        function clearDeepBlueBars() {
            for (let i = activeDeepBlueBars.length - 1; i >= 0; i--) {
                releaseDeepBlueBarInstance(activeDeepBlueBars[i]);
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

        function createDeepBlueBarAlphaMaterial(config) {
            const material = new THREE.MeshBasicMaterial(config);
            material.onBeforeCompile = (shader) => {
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;'
                ).replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;'
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    '#include <common>\nvarying float vInstanceAlpha;'
                ).replace(
                    'vec4 diffuseColor = vec4( diffuse, opacity );',
                    'vec4 diffuseColor = vec4( diffuse, opacity * vInstanceAlpha );'
                );
            };
            return material;
        }

        function createDeepBlueBarInstancedLayer({
            baseGeometry,
            material,
            renderOrder
        }) {
            const geometry = baseGeometry.clone();
            const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(DEEP_BLUE_BAR_MAX_INSTANCES), 1);
            geometry.setAttribute('instanceAlpha', alphaAttr);

            const mesh = new THREE.InstancedMesh(geometry, material, DEEP_BLUE_BAR_MAX_INSTANCES);
            mesh.renderOrder = renderOrder;
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

            for (let i = 0; i < DEEP_BLUE_BAR_MAX_INSTANCES; i++) {
                deepBlueBarInstanceScratch.position.set(0, 0, 0);
                deepBlueBarInstanceScratch.scale.set(0.0001, 0.0001, 0.0001);
                deepBlueBarInstanceScratch.updateMatrix();
                mesh.setMatrixAt(i, deepBlueBarInstanceScratch.matrix);
                mesh.setColorAt(i, WHITE_COLOR);
                alphaAttr.setX(i, 0);
            }

            mesh.instanceMatrix.needsUpdate = true;
            alphaAttr.needsUpdate = true;
            return { mesh, alphaAttr };
        }

        function createDeepBlueBarSet({ isBlackKey, parent }) {
            const freeSlots = [];
            const usedSlots = new Uint8Array(DEEP_BLUE_BAR_MAX_INSTANCES);
            for (let i = DEEP_BLUE_BAR_MAX_INSTANCES - 1; i >= 0; i--) {
                freeSlots.push(i);
            }

            const renderBaseOrder = isBlackKey ? 6 : 3;
            const shadowLayer = isBlackKey
                ? createDeepBlueBarInstancedLayer({
                    baseGeometry: deepBlueBarGeometries.shadow,
                    material: createDeepBlueBarAlphaMaterial(deepBlueBarShadowMaterialProps),
                    renderOrder: renderBaseOrder
                })
                : null;
            const auraLayer = createDeepBlueBarInstancedLayer({
                baseGeometry: deepBlueBarGeometries.aura,
                material: createDeepBlueBarAlphaMaterial({
                    color: 0xffffff,
                    ...deepBlueBarAuraMaterialProps
                }),
                renderOrder: renderBaseOrder + 1
            });
            const glowLayer = createDeepBlueBarInstancedLayer({
                baseGeometry: deepBlueBarGeometries.glow,
                material: createDeepBlueBarAlphaMaterial({
                    color: 0xffffff,
                    ...deepBlueBarGlowMaterialProps
                }),
                renderOrder: renderBaseOrder + 2
            });
            const coreLayer = createDeepBlueBarInstancedLayer({
                baseGeometry: deepBlueBarGeometries.core,
                material: createDeepBlueBarAlphaMaterial({
                    color: 0xffffff,
                    ...deepBlueBarCoreMaterialProps
                }),
                renderOrder: renderBaseOrder + 3
            });

            if (shadowLayer) parent.add(shadowLayer.mesh);
            parent.add(auraLayer.mesh);
            parent.add(glowLayer.mesh);
            parent.add(coreLayer.mesh);

            return {
                isBlackKey,
                freeSlots,
                usedSlots,
                shadowLayer,
                auraLayer,
                glowLayer,
                coreLayer
            };
        }

        function createDeepBlueBarInstancingSystem(parent) {
            return {
                white: createDeepBlueBarSet({ isBlackKey: false, parent }),
                black: createDeepBlueBarSet({ isBlackKey: true, parent })
            };
        }

        function getDeepBlueBarSet(isBlackKey) {
            return isBlackKey ? deepBlueBarInstancing?.black : deepBlueBarInstancing?.white;
        }

        function syncDeepBlueBarSetCount(barSet) {
            if (!barSet) return;

            let highestUsedSlot = -1;
            for (let i = barSet.usedSlots.length - 1; i >= 0; i--) {
                if (barSet.usedSlots[i]) {
                    highestUsedSlot = i;
                    break;
                }
            }

            const nextCount = highestUsedSlot + 1;
            if (barSet.shadowLayer) {
                barSet.shadowLayer.mesh.count = nextCount;
            }
            barSet.auraLayer.mesh.count = nextCount;
            barSet.glowLayer.mesh.count = nextCount;
            barSet.coreLayer.mesh.count = nextCount;
        }

        function updateDeepBlueBarLayerInstance(layer, slot, x, y, z, scaleY, color, alpha) {
            if (!layer) return;
            deepBlueBarInstanceScratch.position.set(x, y, z);
            deepBlueBarInstanceScratch.scale.set(1, scaleY, 1);
            deepBlueBarInstanceScratch.updateMatrix();
            layer.mesh.setMatrixAt(slot, deepBlueBarInstanceScratch.matrix);
            layer.mesh.setColorAt(slot, color);
            layer.alphaAttr.setX(slot, alpha);
            layer.mesh.instanceMatrix.needsUpdate = true;
            layer.mesh.instanceColor.needsUpdate = true;
            layer.alphaAttr.needsUpdate = true;
        }

        function updateDeepBlueBarInstance(bar, baseOpacity) {
            const barSet = getDeepBlueBarSet(bar.isBlackKey);
            if (!barSet) return;

            const shimmer = 0.94 + Math.sin(performance.now() * 0.01 + bar.midi * 0.35) * 0.08;
            const scaleY = bar.currentHeight / bar.baseHeight;
            const centerY = bar.positionY;

            if (barSet.shadowLayer) {
                updateDeepBlueBarLayerInstance(
                    barSet.shadowLayer,
                    bar.slot,
                    bar.x,
                    centerY - bar.currentHeight * 0.03,
                    DEEP_BLUE_BAR_PLANE_Z - 0.001,
                    scaleY,
                    WHITE_COLOR,
                    baseOpacity * 0.18
                );
            }

            updateDeepBlueBarLayerInstance(
                barSet.auraLayer,
                bar.slot,
                bar.x,
                centerY,
                DEEP_BLUE_BAR_PLANE_Z,
                scaleY,
                bar.color,
                baseOpacity * 0.26 * shimmer
            );
            updateDeepBlueBarLayerInstance(
                barSet.glowLayer,
                bar.slot,
                bar.x,
                centerY,
                DEEP_BLUE_BAR_PLANE_Z,
                scaleY,
                bar.color,
                baseOpacity * 0.78 * shimmer
            );
            updateDeepBlueBarLayerInstance(
                barSet.coreLayer,
                bar.slot,
                bar.x,
                centerY,
                DEEP_BLUE_BAR_PLANE_Z,
                scaleY,
                bar.coreColor,
                Math.min(1, baseOpacity * 1.08)
            );
        }

        function acquireDeepBlueBarSlot(isBlackKey) {
            const barSet = getDeepBlueBarSet(isBlackKey);
            if (!barSet || barSet.freeSlots.length === 0) return null;
            const slot = barSet.freeSlots.pop();
            barSet.usedSlots[slot] = 1;
            syncDeepBlueBarSetCount(barSet);
            return slot;
        }

        function releaseDeepBlueBarInstance(bar) {
            if (!bar) return;

            const barSet = getDeepBlueBarSet(bar.isBlackKey);
            if (!barSet) return;

            updateDeepBlueBarLayerInstance(barSet.auraLayer, bar.slot, 0, 0, DEEP_BLUE_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            updateDeepBlueBarLayerInstance(barSet.glowLayer, bar.slot, 0, 0, DEEP_BLUE_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            updateDeepBlueBarLayerInstance(barSet.coreLayer, bar.slot, 0, 0, DEEP_BLUE_BAR_PLANE_Z, 0.0001, WHITE_COLOR, 0);
            if (barSet.shadowLayer) {
                updateDeepBlueBarLayerInstance(barSet.shadowLayer, bar.slot, 0, 0, DEEP_BLUE_BAR_PLANE_Z - 0.001, 0.0001, WHITE_COLOR, 0);
            }
            barSet.usedSlots[bar.slot] = 0;
            barSet.freeSlots.push(bar.slot);
            syncDeepBlueBarSetCount(barSet);
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
            const slot = acquireDeepBlueBarSlot(blackKey);
            if (slot === null) return;
            const initialHeight = DEEP_BLUE_BAR_BASE_HEIGHT;
            const minFloatingHeight = 0.2 + ((midi % 12) / 12) * 0.1;
            const color = getEffectColor(midi);
            const queuedLaunchY = getQueuedLaunchY(midi, launchPoint.y, initialHeight);
            const coreColor = color.clone().lerp(WHITE_COLOR, 0.08);
            spawnDeepBlueJet(launchPoint, midi, blackKey);

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

            updateDeepBlueBarInstance(bar, bar.glowBaseOpacity);
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
                    bar.positionY = bar.entryY + bar.currentHeight * 0.5;
                    targetGlowBaseOpacity = 0.88;

                    bar.jetPulseTimer -= 1 / 60;
                    if (bar.jetPulseTimer <= 0) {
                        spawnDeepBlueJet({ x: bar.x, y: bar.entryY }, bar.midi, isBlackKeyMidi(bar.midi), true);
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
                updateDeepBlueBarInstance(bar, bar.glowBaseOpacity);

                if (bar.positionY > upperBound) {
                    releaseDeepBlueBarInstance(bar);
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
        const pooledSparks = [];
        const pooledMists = [];
        const DEEP_BLUE_JET_MAX_PARTICLES = 960;
        let impactIdx = 0;

        const perfMonitor = createPerfMonitor({
            renderer,
            getThemeLabel: () => getCurrentBackgroundTheme().label,
            getPixelRatio: () => renderer.getPixelRatio(),
            getStateSnapshot: () => ({
                activeBars: activeDeepBlueBars.length,
                activeSparks: activeSparks.length,
                activeMists: activeMists.length,
                activeJets: activeDeepBlueJets.length,
                recordedEvents: recordSlotController?.getStats().recordedEvents ?? 0,
                isPlaybackActive: (recordSlotController?.getStats().playingSlots ?? 0) > 0
            })
        });

        function getEffectColor(midi) {
            return EFFECT_COLOR_PALETTE[Math.abs(midi) % EFFECT_COLOR_PALETTE.length].clone();
        }

        function createDeepBlueJetBatch(renderOrder) {
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES * 3);
            const vel = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES * 3);
            const drift = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES * 3);
            const sizes = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES);
            const alphas = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES);
            const colors = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES * 3);
            const ages = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES);
            const phases = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES);
            const swirl = new Float32Array(DEEP_BLUE_JET_MAX_PARTICLES);
            const freeIndices = [];

            for (let i = DEEP_BLUE_JET_MAX_PARTICLES - 1; i >= 0; i--) {
                freeIndices.push(i);
            }

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const points = new THREE.Points(geo, deepBlueJetMaterial);
            points.renderOrder = renderOrder;
            points.visible = false;
            scene.add(points);

            return {
                points,
                pos,
                vel,
                drift,
                sizes,
                alphas,
                colors,
                ages,
                phases,
                swirl,
                freeIndices,
                posAttr: geo.attributes.position,
                sizeAttr: geo.attributes.aSize,
                alphaAttr: geo.attributes.aAlpha,
                colorAttr: geo.attributes.aColor
            };
        }

        const deepBlueJetBatches = {
            white: createDeepBlueJetBatch(8),
            black: createDeepBlueJetBatch(11)
        };

        function acquireDeepBlueJetIndices(batch, count) {
            if (batch.freeIndices.length < count) {
                return null;
            }

            const indices = new Array(count);
            for (let i = 0; i < count; i++) {
                indices[i] = batch.freeIndices.pop();
            }
            batch.points.visible = true;
            return indices;
        }

        function releaseDeepBlueJetEffect(effect) {
            const { batch, indices } = effect;
            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];
                batch.alphas[index] = 0;
                batch.sizes[index] = 0;
                batch.pos[index * 3] = 0;
                batch.pos[index * 3 + 1] = 0;
                batch.pos[index * 3 + 2] = 0;
                batch.freeIndices.push(index);
            }

            batch.alphaAttr.needsUpdate = true;
            batch.sizeAttr.needsUpdate = true;
            batch.posAttr.needsUpdate = true;
            if (batch.freeIndices.length === DEEP_BLUE_JET_MAX_PARTICLES) {
                batch.points.visible = false;
            }
        }

        function createSparkEffect(count) {
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

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aType', new THREE.BufferAttribute(types, 1));
            geo.setAttribute('aRotX', new THREE.BufferAttribute(rx, 1));
            geo.setAttribute('aRotY', new THREE.BufferAttribute(ry, 1));
            geo.setAttribute('aRotZ', new THREE.BufferAttribute(rz, 1));

            const points = new THREE.Points(geo, sparkMaterial);
            points.renderOrder = 2;
            points.visible = false;

            return {
                points,
                geo,
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
                rvz,
                posAttr: geo.attributes.position,
                sizeAttr: geo.attributes.aSize,
                alphaAttr: geo.attributes.aAlpha,
                typeAttr: geo.attributes.aType,
                rotXAttr: geo.attributes.aRotX,
                rotYAttr: geo.attributes.aRotY,
                rotZAttr: geo.attributes.aRotZ
            };
        }

        function acquireSparkEffect(count) {
            const effect = pooledSparks.pop() ?? createSparkEffect(count);
            effect.points.visible = true;
            scene.add(effect.points);
            return effect;
        }

        function releaseSparkEffect(effect) {
            scene.remove(effect.points);
            effect.points.visible = false;
            pooledSparks.push(effect);
        }

        function createMistEffect(count) {
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            const drift = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const alphas = new Float32Array(count);
            const colors = new Float32Array(count * 3);

            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
            geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const points = new THREE.Points(geo, mistMaterial);
            points.renderOrder = 1;
            points.visible = false;

            return {
                points,
                geo,
                pos,
                drift,
                sizes,
                alphas,
                colors,
                posAttr: geo.attributes.position,
                sizeAttr: geo.attributes.aSize,
                alphaAttr: geo.attributes.aAlpha,
                colorAttr: geo.attributes.aColor
            };
        }

        function acquireMistEffect(count) {
            const effect = pooledMists.pop() ?? createMistEffect(count);
            effect.points.visible = true;
            scene.add(effect.points);
            return effect;
        }

        function releaseMistEffect(effect) {
            scene.remove(effect.points);
            effect.points.visible = false;
            pooledMists.push(effect);
        }

        function clearActiveSparks() {
            for (let i = activeSparks.length - 1; i >= 0; i--) {
                releaseSparkEffect(activeSparks[i]);
            }
            activeSparks.length = 0;
        }

        function clearActiveMists() {
            for (let i = activeMists.length - 1; i >= 0; i--) {
                releaseMistEffect(activeMists[i]);
            }
            activeMists.length = 0;
        }

        function clearActiveDeepBlueJets() {
            for (let i = activeDeepBlueJets.length - 1; i >= 0; i--) {
                releaseDeepBlueJetEffect(activeDeepBlueJets[i]);
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

            triggerTimedHighlight(source, midi);
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
            const batch = isBlackKey ? deepBlueJetBatches.black : deepBlueJetBatches.white;
            const indices = acquireDeepBlueJetIndices(batch, count);
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
                pos[offset + 2] = DEEP_BLUE_BAR_PLANE_Z + 0.008 + (Math.random() - 0.5) * 0.006;

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

            activeDeepBlueJets.push({
                batch,
                indices,
                isHeldPulse
            });
        }

        function spawnSparks(point) {
            if (!usesLegacyGridEffects()) return;

            const count = 8;
            const effect = acquireSparkEffect(count);
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
            const effect = acquireMistEffect(count);
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
                        releaseSparkEffect(s);
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
                        releaseMistEffect(m);
                        activeMists.splice(i, 1);
                    }
                }
            }

            if (activeDeepBlueJets.length > 0) {
                for (let i = activeDeepBlueJets.length - 1; i >= 0; i--) {
                    const jet = activeDeepBlueJets[i];
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
                        releaseDeepBlueJetEffect(jet);
                        activeDeepBlueJets.splice(i, 1);
                    }
                }
            }

            updateDeepBlueBars();

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
            updateDeepBlueMask();
        });
