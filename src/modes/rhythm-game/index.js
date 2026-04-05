const LANE_KEYS = ['d', 'f', 'j', 'k'];
const LANE_MIDIS = [60, 64, 67, 72];
const LANE_VISUAL_X = [-1.8, -0.62, 0.62, 1.8];
const JUDGE_WINDOWS = {
    perfect: 0.04,
    good: 0.09,
    miss: 0.15
};
const TRAVEL_TIME = 1.8;
const LEAD_IN = 1.6;
const HOLD_VISUAL_GAP_PCT = 5;
const NOTE_VISUAL_GAP_PCT = 4;
const TAP_VISUAL_HEIGHT_PCT = 4;

function createDemoChart() {
    const entries = [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 },
        { beat: 3, lane: 3 },
        { beat: 4, lane: 0, durationBeats: 2 },
        { beat: 6.5, lane: 2 },
        { beat: 7, lane: 1 },
        { beat: 7.5, lane: 3 },
        { beat: 8, lane: 0 },
        { beat: 8.5, lane: 1 },
        { beat: 9, lane: 2 },
        { beat: 9.5, lane: 3 },
        { beat: 10, lane: 1, durationBeats: 3 },
        { beat: 10.5, lane: 3 },
        { beat: 11, lane: 0 },
        { beat: 11.5, lane: 2 },
        { beat: 13.5, lane: 3 },
        { beat: 14, lane: 0 },
        { beat: 14.5, lane: 1 },
        { beat: 15, lane: 2, durationBeats: 2 },
        { beat: 15.5, lane: 3 },
        { beat: 16, lane: 1 },
        { beat: 16.5, lane: 0 },
        { beat: 17, lane: 2 },
        { beat: 17.5, lane: 3 }
    ];

    return {
        bpm: 120,
        title: 'Warmup Ladder + Hold Notes',
        notes: entries.map((entry) => ({
            lane: entry.lane,
            time: entry.beat * 0.5,
            duration: entry.durationBeats ? entry.durationBeats * 0.5 : 0,
            type: entry.durationBeats ? 'hold' : 'tap'
        }))
    };
}

function getJudgeBucket(deltaSeconds) {
    const absDelta = Math.abs(deltaSeconds);
    if (absDelta <= JUDGE_WINDOWS.perfect) {
        return 'perfect';
    }
    if (absDelta <= JUDGE_WINDOWS.good) {
        return 'good';
    }
    return 'miss';
}

function getTapReward(bucket) {
    if (bucket === 'perfect') {
        return { score: 1000, weight: 1, label: 'Perfect' };
    }
    if (bucket === 'good') {
        return { score: 650, weight: 0.72, label: 'Good' };
    }
    return { score: 0, weight: 0, label: 'Miss' };
}

function getHoldReward(bucket) {
    if (bucket === 'perfect') {
        return { score: 1400, weight: 1, label: 'Perfect Hold' };
    }
    if (bucket === 'good') {
        return { score: 980, weight: 0.82, label: 'Good Hold' };
    }
    return { score: 0, weight: 0, label: 'Miss' };
}

export function createRhythmGameModule({
    container,
    initAudio,
    nowSeconds,
    createInstrumentInstance,
    disposeLofiChain,
    playMidiWithInstrument,
    playVisualFeedback
}) {
    const panel = container;
    const startButton = document.getElementById('rg-start-button');
    const scoreValue = document.getElementById('rg-score-value');
    const comboValue = document.getElementById('rg-combo-value');
    const accuracyValue = document.getElementById('rg-result-accuracy');
    const perfectValue = document.getElementById('rg-perfect-count');
    const goodValue = document.getElementById('rg-good-count');
    const missValue = document.getElementById('rg-miss-count');
    const progressValue = document.getElementById('rg-progress-value');
    const progressFill = document.getElementById('rhythm-progress-fill');
    const progressText = document.getElementById('rhythm-progress-text');
    const statusCopy = document.getElementById('rg-status-copy');
    const judgementValue = document.getElementById('rg-judgement-value');
    const judgementDetail = document.getElementById('rg-judgement-detail');
    const sessionHint = document.getElementById('rg-session-hint');
    const results = document.getElementById('rg-results');
    const resultGrade = document.getElementById('rg-result-grade');
    const resultBias = document.getElementById('rg-result-bias');
    const resultCombo = document.getElementById('rg-result-combo');
    const leaderboardList = document.getElementById('rg-leaderboard-list');
    const playerIdInput = document.getElementById('rg-player-id-input');
    const laneElements = Array.from(container.querySelectorAll('.rhythm-game-lane'));
    const laneRailElements = laneElements.map((lane) => lane.querySelector('.rhythm-game-lane-rail'));

    const chart = createDemoChart();
    const chartDuration = chart.notes.reduce((maxTime, note) => Math.max(maxTime, note.time + (note.duration ?? 0)), 0);

    let rhythmInstrument = null;
    let rhythmLofiVibrato = null;
    let rhythmLofiFilter = null;
    let isActive = false;
    let isRunning = false;
    let runStartAt = 0;
    let animationFrameId = null;
    let autoStartTimerId = null;
    let laneFlashTimers = [];
    let notes = [];
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let judgedCount = 0;
    let totalAccuracyWeight = 0;
    let timingOffsets = [];
    let perfectCount = 0;
    let goodCount = 0;
    let missCount = 0;
    const activeHoldNotes = new Map();
    const holdSprayTimers = new Map();
    const LEADERBOARD_LIMIT = 10;
    const LEADERBOARD_STORAGE_KEY = 'visual-music-game.rhythm.leaderboard.v1';
    const PLAYER_ID_STORAGE_KEY = 'visual-music-game.rhythm.player-id.v1';
    let playerId = 'Guest';
    let leaderboardEntries = [];

    function readStoredJson(storageKey, fallbackValue) {
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) return fallbackValue;
            return JSON.parse(raw);
        } catch {
            return fallbackValue;
        }
    }

    function writeStoredJson(storageKey, value) {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
            // Local storage can be unavailable in private mode; the leaderboard still works in-memory.
        }
    }

    function normalizePlayerId(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 16);
    }

    function loadPlayerId() {
        const storedId = readStoredJson(PLAYER_ID_STORAGE_KEY, null);
        const nextId = normalizePlayerId(typeof storedId === 'string' ? storedId : '');
        const resolvedId = nextId || 'Guest';
        writeStoredJson(PLAYER_ID_STORAGE_KEY, resolvedId);
        if (playerIdInput) {
            playerIdInput.value = resolvedId;
        }
        return resolvedId;
    }

    function savePlayerId(value) {
        const nextId = normalizePlayerId(value);
        playerId = nextId || 'Guest';
        writeStoredJson(PLAYER_ID_STORAGE_KEY, playerId);
        return playerId;
    }

    function normalizeLeaderboardEntry(entry) {
        return {
            playerId: entry && typeof entry.playerId === 'string' && entry.playerId.trim() ? entry.playerId.trim() : 'Guest',
            score: entry && Number.isFinite(entry.score) ? entry.score : 0,
            result: entry && typeof entry.result === 'string' && entry.result.trim() ? entry.result.trim() : '-',
            createdAt: entry && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now()
        };
    }

    function compareLeaderboardEntries(a, b) {
        return b.score - a.score || b.createdAt - a.createdAt;
    }

    function loadLeaderboardEntries() {
        const storedEntries = readStoredJson(LEADERBOARD_STORAGE_KEY, []);
        if (!Array.isArray(storedEntries)) {
            return [];
        }

        return storedEntries
            .map(normalizeLeaderboardEntry)
            .sort(compareLeaderboardEntries)
            .slice(0, LEADERBOARD_LIMIT);
    }

    function renderLeaderboardEntries() {
        if (!leaderboardList) return;

        if (leaderboardEntries.length === 0) {
            leaderboardList.replaceChildren();
            const emptyRow = document.createElement('div');
            emptyRow.className = 'rhythm-game-leaderboard-row is-empty';

            const emptyRank = document.createElement('span');
            emptyRank.className = 'rhythm-game-leaderboard-rank';
            emptyRank.textContent = '-';

            const emptyId = document.createElement('span');
            emptyId.textContent = 'No scores yet';

            const emptyScore = document.createElement('span');
            emptyScore.textContent = '-';

            const emptyResult = document.createElement('span');
            emptyResult.textContent = '-';

            emptyRow.append(emptyRank, emptyId, emptyScore, emptyResult);
            leaderboardList.append(emptyRow);
            return;
        }

        const rows = leaderboardEntries.map((entry, index) => {
            const rankNumber = index + 1;
            const row = document.createElement('div');
            row.className = 'rhythm-game-leaderboard-row';
            if (rankNumber <= 3) {
                row.classList.add(`is-rank-${rankNumber}`);
            }

            const rankCell = document.createElement('span');
            rankCell.className = 'rhythm-game-leaderboard-rank';
            rankCell.textContent = `#${rankNumber}`;

            const idCell = document.createElement('span');
            idCell.className = 'rhythm-game-leaderboard-id';
            idCell.textContent = entry.playerId;
            idCell.title = entry.playerId;

            const scoreCell = document.createElement('span');
            scoreCell.className = 'rhythm-game-leaderboard-score';
            scoreCell.textContent = entry.score.toLocaleString();

            const resultCell = document.createElement('span');
            resultCell.className = 'rhythm-game-leaderboard-result';
            resultCell.textContent = entry.result;

            row.append(rankCell, idCell, scoreCell, resultCell);
            return row;
        });

        leaderboardList.replaceChildren(...rows);
    }

    function recordLeaderboardEntry(scoreValue, resultValue) {
        const nextEntry = normalizeLeaderboardEntry({
            playerId,
            score: scoreValue,
            result: resultValue,
            createdAt: Date.now()
        });

        leaderboardEntries = [nextEntry, ...leaderboardEntries]
            .sort(compareLeaderboardEntries)
            .slice(0, LEADERBOARD_LIMIT);

        writeStoredJson(LEADERBOARD_STORAGE_KEY, leaderboardEntries);
        renderLeaderboardEntries();
    }

    function focusPlayerIdInput(selectAll = false) {
        if (!playerIdInput) return;

        playerIdInput.focus();
        if (selectAll && typeof playerIdInput.select === 'function') {
            playerIdInput.select();
        }
    }

    function isTypingInTextField(event) {
        const target = event?.target;
        if (!target || !(target instanceof HTMLElement)) {
            return false;
        }

        if (target === playerIdInput) {
            return true;
        }

        if (target.isContentEditable) {
            return true;
        }

        const tagName = target.tagName;
        return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
    }

    if (playerIdInput) {
        playerIdInput.addEventListener('input', () => {
            savePlayerId(playerIdInput.value);
        });

        playerIdInput.addEventListener('blur', () => {
            playerIdInput.value = savePlayerId(playerIdInput.value);
        });

        playerIdInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                playerIdInput.value = savePlayerId(playerIdInput.value);
                playerIdInput.blur();
            }
        });
    }

    playerId = loadPlayerId();
    leaderboardEntries = loadLeaderboardEntries();
    renderLeaderboardEntries();

    function buildNotes() {
        notes = chart.notes.map((note, index) => ({
            ...note,
            id: index,
            endTime: note.time + (note.duration ?? 0),
            state: 'pending',
            element: null,
            keyHeld: false,
            holdBucket: null,
            holdStartedAt: null,
            releaseReason: null
        }));

        activeHoldNotes.clear();

        laneRailElements.forEach((rail) => {
            if (rail) {
                rail.innerHTML = '';
            }
        });

        for (const note of notes) {
            const el = document.createElement('div');
            el.className = note.type === 'hold' ? 'rhythm-game-note hold' : 'rhythm-game-note';
            el.dataset.noteId = String(note.id);

            if (note.type === 'hold') {
                const holdPercent = Math.max(14, (note.duration / TRAVEL_TIME) * 100 - HOLD_VISUAL_GAP_PCT);
                el.style.height = `${holdPercent}%`;
            }

            note.element = el;
            laneRailElements[note.lane]?.appendChild(el);
        }
    }

    function setJudgement(label, detail) {
        judgementValue.textContent = label;
        judgementDetail.textContent = detail;
    }

    function updateHud() {
        scoreValue.textContent = String(score);
        comboValue.textContent = String(combo);
        progressValue.textContent = `${judgedCount} / ${notes.length}`;
        const accuracy = judgedCount === 0
            ? 100
            : Math.round((totalAccuracyWeight / judgedCount) * 100);
        accuracyValue.textContent = `${accuracy}%`;
        if (perfectValue) perfectValue.textContent = String(perfectCount);
        if (goodValue) goodValue.textContent = String(goodCount);
        if (missValue) missValue.textContent = String(missCount);
    }

    function updateProgressBar(runTime) {
        if (!progressFill || !progressText) return;

        const totalRunDuration = LEAD_IN + chartDuration + 0.8;
        const elapsed = Math.max(0, Math.min(runTime + LEAD_IN, totalRunDuration));
        const percent = totalRunDuration <= 0 ? 0 : Math.max(0, Math.min(100, (elapsed / totalRunDuration) * 100));

        progressFill.style.width = `${percent.toFixed(2)}%`;
        progressText.textContent = `${Math.round(percent)}%`;
    }

    function resetStats() {
        score = 0;
        combo = 0;
        maxCombo = 0;
        judgedCount = 0;
        totalAccuracyWeight = 0;
        timingOffsets = [];
        perfectCount = 0;
        goodCount = 0;
        missCount = 0;
        updateHud();
    }

    function setLaneHeld(laneIndex, held) {
        const lane = laneElements[laneIndex];
        if (!lane) return;
        lane.classList.toggle('is-held', held);
    }

    function clearLaneFlashes() {
        while (laneFlashTimers.length) {
            clearTimeout(laneFlashTimers.pop());
        }

        for (const lane of laneElements) {
            lane.classList.remove('is-hit', 'is-held');
        }
    }


    function spawnHitBurst(laneIndex, strength = 'tap') {
        const lane = laneElements[laneIndex];
        if (!lane) return;

        const burst = document.createElement('div');
        burst.className = 'rg-hit-burst';

        const count = strength === 'holdStart'
            ? 14
            : strength === 'hold'
                ? 12
                : 9;

        for (let i = 0; i < count; i++) {
            const particle = document.createElement('span');
            particle.className = 'rg-hit-particle';

            const angle = (Math.random() * Math.PI) - Math.PI; // upward fan
            const speed = strength === 'hold'
                ? 44 + Math.random() * 44
                : 36 + Math.random() * 38;

            const dx = Math.cos(angle) * speed * (0.55 + Math.random() * 0.55);
            const dy = Math.sin(angle) * speed - (24 + Math.random() * 34);

            const hue = 38 + Math.random() * 38;
            const size = strength === 'holdStart'
                ? 6 + Math.random() * 5
                : 5 + Math.random() * 4;

            const duration = strength === 'hold'
                ? 620 + Math.floor(Math.random() * 220)
                : 500 + Math.floor(Math.random() * 180);

            const delay = Math.floor(Math.random() * 80);

            particle.style.setProperty('--dx', `${dx.toFixed(1)}px`);
            particle.style.setProperty('--dy', `${dy.toFixed(1)}px`);
            particle.style.setProperty('--h', `${hue.toFixed(1)}`);
            particle.style.setProperty('--s', `${size.toFixed(1)}px`);
            particle.style.setProperty('--dur', `${duration}ms`);
            particle.style.setProperty('--dly', `${delay}ms`);
            particle.style.setProperty('--sc', `${(1.05 + Math.random() * 0.45).toFixed(2)}`);

            burst.appendChild(particle);
        }

        lane.appendChild(burst);
        window.setTimeout(() => {
            burst.remove();
        }, 980);
    }

    function startHoldSpray(laneIndex) {
        if (holdSprayTimers.has(laneIndex)) return;
        const timer = window.setInterval(() => {
            spawnHitBurst(laneIndex, 'hold');
        }, 120);
        holdSprayTimers.set(laneIndex, timer);
    }

    function stopHoldSpray(laneIndex) {
        const timer = holdSprayTimers.get(laneIndex);
        if (timer) {
            clearInterval(timer);
        }
        holdSprayTimers.delete(laneIndex);
    }
    function pulseLane(laneIndex, duration = 120) {
        const lane = laneElements[laneIndex];
        if (!lane) return;
        lane.classList.add('is-hit');
        const timer = window.setTimeout(() => {
            lane.classList.remove('is-hit');
        }, duration);
        laneFlashTimers.push(timer);
    }

    function resetNoteState() {
        buildNotes();
        resetStats();
        updateProgressBar(-LEAD_IN);
        results.classList.remove('active');
        panel.classList.remove('playing');
        startButton.textContent = 'Start Run';
        setJudgement('Ready', '????????');
        statusCopy.textContent = '?? Start Run ??????? lead-in????????? note?';
        if (sessionHint) {
            sessionHint.textContent = '????? D F J K?????????????????????? hold note?';
        }
        clearLaneFlashes();
    }


    function clearAutoStartTimer() {
        if (autoStartTimerId !== null) {
            window.clearTimeout(autoStartTimerId);
            autoStartTimerId = null;
        }
    }

    function scheduleAutoStart() {
        clearAutoStartTimer();
        autoStartTimerId = window.setTimeout(() => {
            autoStartTimerId = null;
            if (!isActive || isRunning) return;
            startRun().catch((err) => {
                console.error('Rhythm game auto-start failed:', err);
                setJudgement('Audio Error', '音訊初始化失敗，請確認瀏覽器允許播放音效。');
            });
        }, 1200);
    }
    function disposeInstrument() {
        disposeLofiChain(rhythmLofiVibrato, rhythmLofiFilter);
        if (rhythmInstrument && typeof rhythmInstrument.dispose === 'function') {
            rhythmInstrument.dispose();
        }
        rhythmInstrument = null;
        rhythmLofiVibrato = null;
        rhythmLofiFilter = null;
    }

    async function ensureAudioTools() {
        await initAudio();

        if (!rhythmInstrument) {
            const created = await createInstrumentInstance('chiptune_lead');
            rhythmInstrument = created.instrument;
            rhythmLofiVibrato = created.lofiVibrato;
            rhythmLofiFilter = created.lofiFilter;
        }
    }

    function currentRunTime() {
        return nowSeconds() - runStartAt;
    }

    function playLaneSound(laneIndex) {
        if (!rhythmInstrument) return;
        const midi = LANE_MIDIS[laneIndex] ?? 60;
        const visualX = LANE_VISUAL_X[laneIndex] ?? 0;
        playVisualFeedback('user', midi, visualX, -1.9);
        playMidiWithInstrument(rhythmInstrument, 'chiptune_lead', midi);
    }

    function recordFinalResult(note, bucket, label, detail, scoreDelta, accuracyWeight, offsetSeconds = null) {
        note.state = bucket === 'miss' ? 'miss' : 'hit';
        judgedCount += 1;
        totalAccuracyWeight += accuracyWeight;

        if (bucket === 'perfect') {
            perfectCount += 1;
        } else if (bucket === 'good') {
            goodCount += 1;
        } else {
            missCount += 1;
        }

        if (bucket === 'miss') {
            combo = 0;
        } else {
            combo += 1;
            maxCombo = Math.max(maxCombo, combo);
            score += scoreDelta;
            if (typeof offsetSeconds === 'number') {
                timingOffsets.push(offsetSeconds);
            }
            playLaneSound(note.lane);
            spawnHitBurst(note.lane, note.type === 'hold' ? 'hold' : 'tap');
            pulseLane(note.lane, note.type === 'hold' ? 180 : 120);
        }

        if (note.type === 'hold') {
            stopHoldSpray(note.lane);
            activeHoldNotes.delete(note.lane);
            setLaneHeld(note.lane, false);
        }

        if (note.element) {
            note.element.classList.remove('is-visible', 'is-holding');
            note.element.classList.add(bucket === 'miss' ? 'is-miss' : 'is-hit');
            const elementRef = note.element;
            window.setTimeout(() => {
                if (elementRef && elementRef.isConnected) {
                    elementRef.remove();
                }
            }, 720);
            note.element = null;
        }

        setJudgement(label, detail);
        updateHud();
    }

    function finalizeTap(note, deltaSeconds) {
        const bucket = getJudgeBucket(deltaSeconds);
        const reward = getTapReward(bucket);
        const detail = bucket === 'miss'
            ? `偏差 ${Math.round(deltaSeconds * 1000)}ms`
            : `命中偏差 ${Math.round(deltaSeconds * 1000)}ms`;
        recordFinalResult(note, bucket, reward.label, detail, reward.score, reward.weight, deltaSeconds);
    }

    function startHold(note, deltaSeconds) {
        const bucket = getJudgeBucket(deltaSeconds);
        if (bucket === 'miss') {
            recordFinalResult(note, 'miss', 'Hold Miss', `起點偏差 ${Math.round(deltaSeconds * 1000)}ms`, 0, 0, deltaSeconds);
            return;
        }

        note.state = 'holding';
        note.keyHeld = true;
        note.holdBucket = bucket;
        note.holdStartedAt = currentRunTime();
        activeHoldNotes.set(note.lane, note);
        setLaneHeld(note.lane, true);
        pulseLane(note.lane, 180);
        playLaneSound(note.lane);

        if (note.element) {
            note.element.classList.add('is-holding', 'is-visible');
        }

        spawnHitBurst(note.lane, 'holdStart');
        startHoldSpray(note.lane);

        const startLabel = bucket === 'perfect' ? 'Hold Start' : 'Hold Start';
        setJudgement(startLabel, `按住到尾端，長度 ${Math.round(note.duration * 1000)}ms`);
    }

    function completeHold(note, releaseOffset = 0, autoCompleted = false) {
        const bucket = note.holdBucket ?? 'good';
        const reward = getHoldReward(bucket);
        const detail = autoCompleted
            ? `長按完成，尾端穩定接住了。`
            : `尾端偏差 ${Math.round(releaseOffset * 1000)}ms`;
        recordFinalResult(note, bucket, reward.label, detail, reward.score, reward.weight, note.holdStartedAt !== null ? note.holdStartedAt - note.time : 0);
    }

    function failHoldRelease(note, runTime) {
        const earlyMs = Math.max(0, Math.round((note.endTime - runTime) * 1000));
        recordFinalResult(note, 'miss', 'Hold Break', `太早放開，提早了 ${earlyMs}ms`, 0, 0, runTime - note.time);
    }
    function processAutoMisses(runTime) {
        for (const note of notes) {
            if (note.state === 'pending' && runTime - note.time > JUDGE_WINDOWS.miss) {
                if (note.type === 'hold') {
                    recordFinalResult(note, 'miss', 'Hold Miss', `沒有按到 hold 起點`, 0, 0, runTime - note.time);
                } else {
                    finalizeTap(note, runTime - note.time);
                }
                continue;
            }

            // If a hold has been started, it should resolve at its tail timing (not linger at the bottom).
            if (note.state === 'holding' && runTime >= note.endTime) {
                completeHold(note, 0, true);
                continue;
            }

            // Failsafe: if a hold somehow stays "holding" past its tail for too long, mark it as miss and remove.
            if (note.state === 'holding' && runTime - note.endTime > JUDGE_WINDOWS.miss) {
                recordFinalResult(note, 'miss', 'Hold Miss', `沒有按住到尾端`, 0, 0, runTime - note.time);
            }
        }
    }

    function getVisualNoteHeightPercent(note, runTime) {
        if (note.type === 'hold') {
            if (note.state === 'holding') {
                const remaining = Math.max(0, note.endTime - runTime);
                return Math.max(0, (remaining / TRAVEL_TIME) * 100 - HOLD_VISUAL_GAP_PCT);
            }

            return Math.max(0, (note.duration / TRAVEL_TIME) * 100 - HOLD_VISUAL_GAP_PCT);
        }

        return TAP_VISUAL_HEIGHT_PCT;
    }

    function updateNotePositions(runTime) {
        const laneState = new Map();

        for (const note of notes) {
            if (!note.element) continue;
            if (note.state === 'hit' || note.state === 'miss') continue;

            const timeUntilHit = note.time - runTime;
            const progress = 1 - (timeUntilHit / TRAVEL_TIME);
            const naturalBottomPercent = (1 - progress) * 100;
            const noteHeightPercent = getVisualNoteHeightPercent(note, runTime);
            const holdExtra = note.type === 'hold' ? (note.duration / TRAVEL_TIME) * 100 : 0;
            const laneBottomLimit = laneState.get(note.lane) ?? -10_000;
            const visualBottomPercent = laneBottomLimit <= -9_000
                ? naturalBottomPercent
                : Math.max(naturalBottomPercent, laneBottomLimit);
            const visible = progress >= -0.08 && visualBottomPercent >= -(holdExtra + 18) && visualBottomPercent <= 118;

            note.element.classList.toggle('is-visible', visible || note.state === 'holding');

            if (note.type === 'hold' && note.state === 'holding') {
                note.element.style.bottom = `0%`;
                note.element.style.height = `${noteHeightPercent}%`;
            } else {
                note.element.style.bottom = `${visualBottomPercent}%`;
                if (note.type === 'hold') {
                    note.element.style.height = `${noteHeightPercent}%`;
                }
            }

            laneState.set(note.lane, visualBottomPercent + noteHeightPercent + NOTE_VISUAL_GAP_PCT);
        }
    }


    function step() {
        animationFrameId = window.requestAnimationFrame(step);

        if (!isActive || !isRunning) return;

        const runTime = currentRunTime();
        updateNotePositions(runTime);
        updateProgressBar(runTime);
        if (runTime >= 0) {
            processAutoMisses(runTime);
        }

        if (judgedCount === notes.length && runTime > chartDuration + 0.8) {
            finishRun();
        }
    }

    function startLoop() {
        if (animationFrameId !== null) return;
        animationFrameId = window.requestAnimationFrame(step);
    }

    function stopLoop() {
        if (animationFrameId !== null) {
            window.cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    async function startRun() {
        clearAutoStartTimer();
        await ensureAudioTools();
        clearAutoStartTimer();
        resetNoteState();
        isRunning = true;
        panel.classList.add('playing');
        results.classList.remove('active');
        startButton.textContent = 'Running...';
        runStartAt = nowSeconds() + LEAD_IN;
        statusCopy.textContent = `${chart.title} 已載入。這輪除了 tap，也有幾顆 hold note 會混進來。`;
        setJudgement('Lead In', '先熟悉落點與判定節奏。');
        if (sessionHint) {
            sessionHint.textContent = 'tap 是短按，hold 要從起點接住後一路按到尾端。這樣比較接近真正節奏遊戲的手感。';
        }
        updateHud();
        updateProgressBar(-LEAD_IN);
        startLoop();
    }

    function resetRun() {
        clearAutoStartTimer();
        isRunning = false;
        clearAutoStartTimer();
        for (const timer of holdSprayTimers.values()) { clearInterval(timer); }
        holdSprayTimers.clear();
        activeHoldNotes.clear();
        resetNoteState();
        updateProgressBar(-LEAD_IN);
    }

    function activate() {
        if (!isRunning) {
            scheduleAutoStart();
        }
        isActive = true;
        if (!isRunning) {
            scheduleAutoStart();
        }
        startLoop();
    }

    function deactivate() {
        clearAutoStartTimer();
        isActive = false;
        clearAutoStartTimer();
        isRunning = false;
        for (const timer of holdSprayTimers.values()) { clearInterval(timer); }
        holdSprayTimers.clear();
        activeHoldNotes.clear();
        panel.classList.remove('playing');
        panel.classList.remove('finished');
        clearLaneFlashes();
        updateProgressBar(-LEAD_IN);
        stopLoop();
    }

    function pickCandidate(laneIndex, runTime) {
        let candidate = null;
        let candidateDelta = Infinity;

        for (const note of notes) {
            if (note.lane !== laneIndex || note.state !== 'pending') continue;
            const delta = runTime - note.time;
            const absDelta = Math.abs(delta);

            if (absDelta > JUDGE_WINDOWS.miss) continue;
            if (absDelta < candidateDelta) {
                candidate = note;
                candidateDelta = absDelta;
            }
        }

        return candidate;
    }

    function handleKeyDown(event) {
        const key = event.key.toLowerCase();
        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex === -1) return false;

        if (isTypingInTextField(event)) return false;

        event.preventDefault();
        if (!isActive) return true;
        if (event.repeat) return true;

        spawnHitBurst(laneIndex, 'input');

        if (!isRunning) {
            pulseLane(laneIndex);
            setJudgement('Idle', '先按 Start Run 再開始判定。');
            return true;
        }

        if (activeHoldNotes.has(laneIndex)) {
            return true;
        }

        const runTime = currentRunTime();
        if (runTime < -0.08) {
            pulseLane(laneIndex);
            setJudgement('Too Soon', '還在 lead-in，等第一拍落下再按。');
            return true;
        }

        const candidate = pickCandidate(laneIndex, runTime);
        if (!candidate) {
            combo = 0;
            updateHud();
            pulseLane(laneIndex);
            setJudgement('Empty', '這個 lane 現在沒有可判定的 note。');
            return true;
        }

        if (candidate.type === 'hold') {
            startHold(candidate, runTime - candidate.time);
        } else {
            finalizeTap(candidate, runTime - candidate.time);
        }
        return true;
    }

    function handleKeyUp(event) {
        const key = event.key.toLowerCase();
        const laneIndex = LANE_KEYS.indexOf(key);
        if (laneIndex === -1) return false;

        if (isTypingInTextField(event)) return false;

        event.preventDefault();
        if (!isActive || !isRunning) return true;

        const activeHold = activeHoldNotes.get(laneIndex);
        if (!activeHold) {
            return true;
        }

        stopHoldSpray(laneIndex);

        activeHold.keyHeld = false;
        setLaneHeld(laneIndex, false);

        const runTime = currentRunTime();
        const releaseOffset = runTime - activeHold.endTime;
        if (releaseOffset >= -JUDGE_WINDOWS.good) {
            completeHold(activeHold, releaseOffset, false);
        } else {
            failHoldRelease(activeHold, runTime);
        }

        return true;
    }

    function finishRun() {
        isRunning = false;
        panel.classList.remove('playing');
        panel.classList.add('finished');
        startButton.textContent = 'Retry';
        // Defensive cleanup: ensure no hold glow/bar stays stuck after the run completes.
        for (const timer of holdSprayTimers.values()) {
            clearInterval(timer);
        }
        holdSprayTimers.clear();
        activeHoldNotes.clear();
        clearLaneFlashes();
        updateProgressBar(chartDuration + 0.8);
        window.setTimeout(() => {
            for (const rail of laneRailElements) {
                if (!rail) continue;
                for (const node of Array.from(rail.querySelectorAll('.rhythm-game-note, .rg-hit-burst'))) {
                    node.remove();
                }
            }
        }, 120);
        const accuracy = judgedCount === 0 ? 0 : Math.round((totalAccuracyWeight / judgedCount) * 100);
        const averageOffsetMs = timingOffsets.length === 0
            ? 0
            : Math.round((timingOffsets.reduce((sum, offset) => sum + offset, 0) / timingOffsets.length) * 1000);
        const biasLabel = averageOffsetMs === 0
            ? 'Centered'
            : averageOffsetMs < 0
                ? `Early ${Math.abs(averageOffsetMs)}ms`
                : `Late ${averageOffsetMs}ms`;
        const grade = accuracy >= 92
            ? 'A'
            : accuracy >= 82
                ? 'B'
                : accuracy >= 70
                    ? 'C'
                    : 'D';

        resultGrade.textContent = grade;
        resultBias.textContent = biasLabel;
        resultCombo.textContent = String(maxCombo);
        recordLeaderboardEntry(score, grade);
        results.classList.add('active');
        setJudgement('Complete', `Perfect ${perfectCount} / Good ${goodCount} / Miss ${missCount}`);
        statusCopy.textContent = `這輪結束了。現在你可以一起感受 tap 與 hold 的節奏壓力，再決定判定窗和 note speed 要怎麼修。`;
        sessionHint.textContent = '如果 hold 常常斷掉，我們下一步可以調尾端容錯、長條可讀性，或是把 hold 的收尾提示做得更明顯。';
    }

    function bindControls() {
        startButton.addEventListener('click', () => {
            if (isRunning) return;
            startRun().catch((err) => {
                console.error('Rhythm game start failed:', err);
                setJudgement('Audio Error', '音訊初始化失敗，請確認瀏覽器允許播放音效。');
            });
        });
    }

    buildNotes();
    bindControls();
    renderLeaderboardEntries();
    resetRun();

    return {
        activate,
        deactivate,
        disposeInstrument,
        handleKeyDown,
        handleKeyUp,
        reset: resetRun
    };
}


