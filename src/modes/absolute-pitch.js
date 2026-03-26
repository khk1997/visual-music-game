import {
    ABSOLUTE_PITCH_BASE_MIDI,
    ABSOLUTE_PITCH_MODES,
    ABSOLUTE_PITCH_NOTES,
    ABSOLUTE_PITCH_NOTE_LABELS,
    ABSOLUTE_PITCH_TIME_LIMIT,
    ABSOLUTE_PITCH_TOTAL_QUESTIONS
} from '../core/config.js';

export function createAbsolutePitchModule({
    container,
    createInstrumentInstance,
    disposeLofiChain,
    initAudio,
    nowSeconds,
    playMidiWithInstrument,
    playVisualFeedback
}) {
    const apProgressValue = document.getElementById('ap-progress-value');
    const apCorrectValue = document.getElementById('ap-correct-value');
    const apTimerValue = document.getElementById('ap-timer-value');
    const apTimerBar = document.getElementById('ap-timer-bar');
    const apPrompt = document.getElementById('ap-prompt');
    const apSubprompt = document.getElementById('ap-subprompt');
    const apFeedback = document.getElementById('ap-feedback');
    const apModeEasyButton = document.getElementById('ap-mode-easy');
    const apModeHardButton = document.getElementById('ap-mode-hard');
    const apStartButton = document.getElementById('ap-start-button');
    const apReplayButton = document.getElementById('ap-replay-button');
    const apAnswerGrid = document.getElementById('ap-answer-grid');
    const apResults = document.getElementById('ap-results');
    const apResultAccuracy = document.getElementById('ap-result-accuracy');
    const apResultTime = document.getElementById('ap-result-time');
    const apResultWeak = document.getElementById('ap-result-weak');
    const apResultWeakNote = document.getElementById('ap-result-weak-note');

    let absolutePitchInstrument = null;
    let absolutePitchLofiVibrato = null;
    let absolutePitchLofiFilter = null;
    let absolutePitchQuestions = [];
    let absolutePitchQuestionIndex = -1;
    let absolutePitchCorrectCount = 0;
    let absolutePitchResponses = [];
    let absolutePitchQuestionStartedAt = 0;
    let absolutePitchTimerId = null;
    let absolutePitchTimerEndsAt = 0;
    let absolutePitchCurrentMidi = null;
    let absolutePitchAwaitingAnswer = false;
    let absolutePitchRunning = false;
    let absolutePitchAdvanceTimeoutId = null;
    let absolutePitchMode = 'easy';
    let absolutePitchSelectedNotes = [];

    function buildAnswerGrid() {
        for (const noteName of ABSOLUTE_PITCH_NOTES) {
            const noteLabel = ABSOLUTE_PITCH_NOTE_LABELS[noteName];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'absolute-pitch-answer';
            button.dataset.note = noteName;
            button.innerHTML = `
                <span class="absolute-pitch-answer-primary">${noteName}</span>
                <span class="absolute-pitch-answer-secondary">${noteLabel.solfege} / ${noteLabel.degree}</span>
            `;
            button.disabled = true;
            button.addEventListener('click', () => {
                submitAnswer(noteName);
            });
            apAnswerGrid.appendChild(button);
        }
    }

    function getAnswerButtons() {
        return Array.from(apAnswerGrid.querySelectorAll('.absolute-pitch-answer'));
    }

    function resetAnswerButtons() {
        for (const button of getAnswerButtons()) {
            button.disabled = !absolutePitchAwaitingAnswer;
            button.classList.remove('correct', 'wrong', 'selected');
        }
    }

    function setMode(nextMode) {
        absolutePitchMode = nextMode;
        apModeEasyButton.classList.toggle('is-selected', nextMode === 'easy');
        apModeHardButton.classList.toggle('is-selected', nextMode === 'hard');
        apModeEasyButton.disabled = absolutePitchRunning;
        apModeHardButton.disabled = absolutePitchRunning;
        updateModeCopy();
    }

    function updateModeCopy() {
        const modeConfig = ABSOLUTE_PITCH_MODES[absolutePitchMode];
        const modeDescription = absolutePitchMode === 'easy'
            ? '每題只會播放 1 個音。'
            : '每題會隨機播放 2 個音，請把兩個都選出來。';

        apFeedback.textContent = absolutePitchRunning
            ? apFeedback.textContent
            : `目前是${modeConfig.label}模式，${modeDescription}`;
        apSubprompt.textContent = absolutePitchRunning
            ? apSubprompt.textContent
            : `固定使用鋼琴音色。${modeDescription} 每題 10 秒，時間到會自動換下一題。`;
    }

    function clearTimer() {
        if (absolutePitchTimerId !== null) {
            clearInterval(absolutePitchTimerId);
            absolutePitchTimerId = null;
        }
    }

    function clearAdvanceTimeout() {
        if (absolutePitchAdvanceTimeoutId !== null) {
            clearTimeout(absolutePitchAdvanceTimeoutId);
            absolutePitchAdvanceTimeoutId = null;
        }
    }

    function disposeInstrument() {
        disposeLofiChain(absolutePitchLofiVibrato, absolutePitchLofiFilter);
        if (absolutePitchInstrument && typeof absolutePitchInstrument.dispose === 'function') {
            absolutePitchInstrument.dispose();
        }
        absolutePitchInstrument = null;
        absolutePitchLofiVibrato = null;
        absolutePitchLofiFilter = null;
    }

    async function ensureInstrument() {
        if (absolutePitchInstrument) return;
        const created = await createInstrumentInstance('piano');
        absolutePitchInstrument = created.instrument;
        absolutePitchLofiVibrato = created.lofiVibrato;
        absolutePitchLofiFilter = created.lofiFilter;
    }

    function createQuestions() {
        const questions = [];
        const noteCount = ABSOLUTE_PITCH_MODES[absolutePitchMode].noteCount;
        let previousSignature = '';

        while (questions.length < ABSOLUTE_PITCH_TOTAL_QUESTIONS) {
            const pcs = [];
            while (pcs.length < noteCount) {
                const pc = Math.floor(Math.random() * ABSOLUTE_PITCH_NOTES.length);
                if (pcs.includes(pc)) continue;
                pcs.push(pc);
            }

            pcs.sort((a, b) => a - b);
            const signature = pcs.join('-');
            if (signature === previousSignature) continue;

            previousSignature = signature;
            questions.push({
                midis: pcs.map((pc) => ABSOLUTE_PITCH_BASE_MIDI + pc),
                noteNames: pcs.map((pc) => ABSOLUTE_PITCH_NOTES[pc])
            });
        }

        return questions;
    }

    function updateHud() {
        const progressCount = Math.min(Math.max(absolutePitchQuestionIndex + (absolutePitchRunning ? 1 : 0), 0), ABSOLUTE_PITCH_TOTAL_QUESTIONS);
        apProgressValue.textContent = `${progressCount} / ${ABSOLUTE_PITCH_TOTAL_QUESTIONS}`;
        apCorrectValue.textContent = String(absolutePitchCorrectCount);
    }

    function renderTimer() {
        if (!absolutePitchRunning || !absolutePitchAwaitingAnswer) {
            apTimerValue.textContent = `${ABSOLUTE_PITCH_TIME_LIMIT.toFixed(1)}s`;
            apTimerValue.classList.remove('timer-alert');
            apTimerBar.style.transform = 'scaleX(1)';
            apTimerBar.classList.remove('warning');
            return;
        }

        const remaining = Math.max(0, absolutePitchTimerEndsAt - nowSeconds());
        const progress = Math.max(0, Math.min(1, remaining / ABSOLUTE_PITCH_TIME_LIMIT));
        apTimerValue.textContent = `${remaining.toFixed(1)}s`;
        apTimerValue.classList.toggle('timer-alert', remaining <= 3);
        apTimerBar.style.transform = `scaleX(${progress})`;
        apTimerBar.classList.toggle('warning', remaining <= 3);

        if (remaining <= 0) {
            submitAnswer(null);
        }
    }

    function updateIdleState() {
        absolutePitchRunning = false;
        absolutePitchAwaitingAnswer = false;
        absolutePitchCurrentMidi = null;
        absolutePitchSelectedNotes = [];
        clearTimer();
        clearAdvanceTimeout();
        updateHud();
        renderTimer();
        resetAnswerButtons();
        setMode(absolutePitchMode);
    }

    function resetIntro() {
        apPrompt.textContent = '按下開始後，系統會播放第一個音。';
        apFeedback.textContent = '準備好就開始。';
        apStartButton.textContent = 'Start Test';
        apReplayButton.disabled = true;
        apResults.classList.add('ui-hidden');
        apTimerValue.textContent = `${ABSOLUTE_PITCH_TIME_LIMIT.toFixed(1)}s`;
        apTimerValue.classList.remove('timer-alert');
        apTimerBar.style.transform = 'scaleX(1)';
        apTimerBar.classList.remove('warning');
        updateModeCopy();
    }

    function getWeakSpot() {
        const missCounts = new Map();

        for (const response of absolutePitchResponses) {
            if (response.correct) continue;
            for (const noteName of response.correctNotes) {
                const count = missCounts.get(noteName) ?? 0;
                missCounts.set(noteName, count + 1);
            }
        }

        let worstNote = null;
        let worstCount = 0;
        for (const [noteName, count] of missCounts.entries()) {
            if (count > worstCount) {
                worstNote = noteName;
                worstCount = count;
            }
        }

        return { worstNote, worstCount };
    }

    function showResults() {
        const accuracy = absolutePitchResponses.length === 0
            ? 0
            : Math.round((absolutePitchCorrectCount / absolutePitchResponses.length) * 100);
        const avgTime = absolutePitchResponses.length === 0
            ? 0
            : absolutePitchResponses.reduce((sum, response) => sum + response.responseTime, 0) / absolutePitchResponses.length;
        const { worstNote, worstCount } = getWeakSpot();

        apPrompt.textContent = `測驗完成，答對 ${absolutePitchCorrectCount} / ${ABSOLUTE_PITCH_TOTAL_QUESTIONS} 題。`;
        apSubprompt.textContent = `本次使用${ABSOLUTE_PITCH_MODES[absolutePitchMode].label}模式，可以直接再測一次，或回自由演奏模式換個節奏。`;
        apFeedback.textContent = accuracy >= 80
            ? '很穩，已經有明顯的音名直覺了。'
            : '結果會受音色熟悉度影響，重測幾輪會更有參考價值。';
        apResults.classList.remove('ui-hidden');
        apResultAccuracy.textContent = `${accuracy}%`;
        apResultTime.textContent = `${avgTime.toFixed(1)}s`;
        apResultWeak.textContent = worstNote ?? '-';
        apResultWeakNote.textContent = worstNote
            ? `${worstNote} 被答錯 ${worstCount} 次，可以多針對這個音做練習。`
            : '這次沒有答錯任何音。';
        apStartButton.textContent = 'Restart Test';
        apReplayButton.disabled = true;
        updateIdleState();
        absolutePitchQuestionIndex = ABSOLUTE_PITCH_TOTAL_QUESTIONS;
        updateHud();
    }

    async function playCurrentNote() {
        if (absolutePitchCurrentMidi === null) return;
        await ensureInstrument();
        const currentQuestion = absolutePitchQuestions[absolutePitchQuestionIndex];
        if (!currentQuestion) return;

        currentQuestion.midis.forEach((midi, index) => {
            const visualX = currentQuestion.midis.length === 1 ? 0 : (index === 0 ? -0.55 : 0.55);
            playVisualFeedback('playback', midi, visualX, 0.3);
            playMidiWithInstrument(absolutePitchInstrument, 'piano', midi);
        });
    }

    async function advanceQuestion() {
        absolutePitchQuestionIndex += 1;

        if (absolutePitchQuestionIndex >= absolutePitchQuestions.length) {
            showResults();
            return;
        }

        const currentQuestion = absolutePitchQuestions[absolutePitchQuestionIndex];
        absolutePitchCurrentMidi = currentQuestion?.midis[0] ?? null;
        absolutePitchAwaitingAnswer = true;
        absolutePitchSelectedNotes = [];
        absolutePitchQuestionStartedAt = nowSeconds();
        absolutePitchTimerEndsAt = absolutePitchQuestionStartedAt + ABSOLUTE_PITCH_TIME_LIMIT;
        apPrompt.textContent = absolutePitchMode === 'easy'
            ? `第 ${absolutePitchQuestionIndex + 1} 題，這是什麼音？`
            : `第 ${absolutePitchQuestionIndex + 1} 題，這兩個音是什麼？`;
        apSubprompt.textContent = absolutePitchMode === 'easy'
            ? '請直接選擇 12 個音名之一。每題 10 秒，時間到會自動換下一題。'
            : '請從下方選出這題出現的 2 個音。兩個都選完後會自動判定。';
        apFeedback.textContent = '正在播放題目音。';
        apResults.classList.add('ui-hidden');
        updateHud();
        resetAnswerButtons();
        renderTimer();
        clearTimer();
        absolutePitchTimerId = setInterval(renderTimer, 100);
        await playCurrentNote();
    }

    async function startTest() {
        try {
            await initAudio();
            await ensureInstrument();
        } catch (err) {
            console.error('Absolute pitch audio init failed:', err);
            apFeedback.textContent = '音訊初始化失敗，請重新開始或檢查瀏覽器音訊權限。';
            return;
        }

        absolutePitchQuestions = createQuestions();
        absolutePitchQuestionIndex = -1;
        absolutePitchCorrectCount = 0;
        absolutePitchResponses = [];
        absolutePitchSelectedNotes = [];
        absolutePitchRunning = true;
        apStartButton.textContent = 'Restart Test';
        apReplayButton.disabled = false;
        setMode(absolutePitchMode);
        apResults.classList.add('ui-hidden');
        await advanceQuestion();
    }

    function finishQuestion(selectedNote) {
        if (!absolutePitchAwaitingAnswer || absolutePitchCurrentMidi === null) return;

        const currentQuestion = absolutePitchQuestions[absolutePitchQuestionIndex];
        if (!currentQuestion) return;

        const requiredSelections = currentQuestion.noteNames.length;

        if (selectedNote !== null) {
            if (absolutePitchSelectedNotes.includes(selectedNote)) {
                absolutePitchSelectedNotes = absolutePitchSelectedNotes.filter((note) => note !== selectedNote);
            } else if (absolutePitchSelectedNotes.length < requiredSelections) {
                absolutePitchSelectedNotes = [...absolutePitchSelectedNotes, selectedNote];
            }

            resetAnswerButtons();
            for (const button of getAnswerButtons()) {
                if (absolutePitchSelectedNotes.includes(button.dataset.note)) {
                    button.classList.add('selected');
                }
            }

            if (absolutePitchSelectedNotes.length < requiredSelections) {
                apFeedback.textContent = absolutePitchMode === 'easy'
                    ? `已選 ${absolutePitchSelectedNotes[0]}。`
                    : `已選 ${absolutePitchSelectedNotes.join('、')}，還要再選 ${requiredSelections - absolutePitchSelectedNotes.length} 個音。`;
                return;
            }
        }

        absolutePitchAwaitingAnswer = false;
        clearTimer();
        const responseTime = Math.min(ABSOLUTE_PITCH_TIME_LIMIT, nowSeconds() - absolutePitchQuestionStartedAt);
        const selectedNotes = selectedNote === null ? [] : [...absolutePitchSelectedNotes].sort();
        const correctNotes = [...currentQuestion.noteNames].sort();
        const correct = selectedNotes.length === correctNotes.length
            && selectedNotes.every((note, index) => note === correctNotes[index]);

        if (correct) {
            absolutePitchCorrectCount += 1;
        }

        absolutePitchResponses.push({
            selectedNotes,
            correctNotes,
            responseTime,
            correct
        });

        resetAnswerButtons();
        for (const button of getAnswerButtons()) {
            const noteName = button.dataset.note;
            if (correctNotes.includes(noteName)) {
                button.classList.add('correct');
            } else if (selectedNotes.includes(noteName)) {
                button.classList.add('wrong');
            }
        }

        const answerText = correctNotes.join('、');
        apFeedback.textContent = correct
            ? `答對了，答案是 ${answerText}。`
            : selectedNote === null
                ? `時間到，答案是 ${answerText}。`
                : `答錯了，答案是 ${answerText}。`;
        apCorrectValue.textContent = String(absolutePitchCorrectCount);

        absolutePitchAdvanceTimeoutId = setTimeout(() => {
            absolutePitchAdvanceTimeoutId = null;
            advanceQuestion().catch((err) => {
                console.error('Absolute pitch advance failed:', err);
            });
        }, 900);
    }

    function submitAnswer(selectedNote) {
        finishQuestion(selectedNote);
    }

    function bindControls() {
        apModeEasyButton.addEventListener('click', () => {
            if (absolutePitchRunning) return;
            setMode('easy');
            resetIntro();
        });

        apModeHardButton.addEventListener('click', () => {
            if (absolutePitchRunning) return;
            setMode('hard');
            resetIntro();
        });

        apStartButton.addEventListener('click', () => {
            startTest().catch((err) => {
                console.error('Absolute pitch start failed:', err);
            });
        });

        apReplayButton.addEventListener('click', () => {
            playCurrentNote().catch((err) => {
                console.error('Absolute pitch replay failed:', err);
            });
        });
    }

    buildAnswerGrid();
    bindControls();
    resetIntro();

    return {
        container,
        disposeInstrument,
        isRunning: () => absolutePitchRunning,
        resetIntro,
        startTest,
        updateIdleState
    };
}
