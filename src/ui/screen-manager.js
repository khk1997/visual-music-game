export function createScreenManager({
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
    themeUi,
    onPlayBackHomeClickSound,
    onPlayModeCardClickSound,
    stopRecordSlots
}) {
    let currentScreen = 'home';
    let isFreePlayThemeSelection = false;
    let isModeTransitioning = false;
    const modeTransitionTimers = [];

    function getCurrentScreen() {
        return currentScreen;
    }

    function getIsFreePlayThemeSelection() {
        return isFreePlayThemeSelection;
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

    function setScreen(nextScreen, options = {}) {
        const { skipThemeSelection = false, forceThemeSelection = false } = options;
        const previousScreen = currentScreen;
        currentScreen = nextScreen;

        const isHome = nextScreen === 'home';
        const isFreePlay = nextScreen === 'free-play';
        const isAbsolutePitch = nextScreen === 'absolute-pitch';
        const isExperienceScreen = isFreePlay || isAbsolutePitch;
        const enteringFreePlay = isFreePlay && previousScreen !== 'free-play';

        if (isFreePlay) {
            isFreePlayThemeSelection = forceThemeSelection || (enteringFreePlay && !skipThemeSelection);
            if (isFreePlayThemeSelection) {
                themeUi.beginThemeSelectionFlow();
            }
        } else {
            isFreePlayThemeSelection = false;
            themeUi.resetThemeSelectionFlow();
        }

        if (isFreePlayThemeSelection) {
            stopRecordSlots?.();
        }

        if (!isFreePlay) {
            stopRecordSlots?.();
        }

        if (!isAbsolutePitch) {
            absolutePitch.updateIdleState();
            absolutePitch.resetIntro();
        }

        if (isHome) {
            resetModeTransitionState();
        }

        if (isFreePlayThemeSelection || !isFreePlay) {
            themeUi.resetThemeSelectionVisualState();
        }

        modeScreen.classList.toggle('hidden', !isHome);
        playbackScreen.classList.toggle('active', isExperienceScreen);
        playbackScreen.classList.toggle('theme-selecting', isFreePlay && isFreePlayThemeSelection);
        bottomUi.classList.toggle('hidden', !isFreePlay || isFreePlayThemeSelection);
        absolutePitchUi.classList.toggle('active', isAbsolutePitch);
        backgroundToggleButton.classList.toggle('ui-hidden', !isFreePlay || isFreePlayThemeSelection);

        if (!isFreePlay) {
            themeUi.closeThemePanel();
        } else if (isFreePlayThemeSelection) {
            themeUi.openThemePanel();
        } else {
            themeUi.closeThemePanel();
        }

        modeStatus.textContent = isFreePlayThemeSelection
            ? 'Select Theme'
            : isAbsolutePitch
                ? 'Perfect Pitch'
                : 'Free Play';
        document.body.style.cursor = isFreePlay && !isFreePlayThemeSelection ? 'crosshair' : 'default';
        themeUi.updateThemePanelSelection();
    }

    function transitionFromHome(selectedCard, nextScreen) {
        if (isModeTransitioning || currentScreen !== 'home') return;

        isModeTransitioning = true;
        void onPlayModeCardClickSound();
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

    function bindUi() {
        freePlayCard.addEventListener('click', () => {
            transitionFromHome(freePlayCard, 'free-play');
        });

        absolutePitchCard.addEventListener('click', () => {
            transitionFromHome(absolutePitchCard, 'absolute-pitch');
        });

        backHomeButton.addEventListener('click', () => {
            void onPlayBackHomeClickSound();
            if (currentScreen === 'free-play' && !isFreePlayThemeSelection) {
                setScreen('free-play', { forceThemeSelection: true });
            } else {
                setScreen('home');
            }
        });
    }

    return {
        bindUi,
        getCurrentScreen,
        getIsFreePlayThemeSelection,
        isInteractivePlayback,
        setScreen,
        transitionFromHome
    };
}
