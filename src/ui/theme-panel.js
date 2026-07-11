export function createThemePanelController({
    backgroundToggleButton,
    themeList,
    themePanel,
    themePreviewDescription,
    themePreviewMedia,
    themePreviewTitle,
    themes,
    getUiState,
    onApplyTheme,
    onPlaySelectSound,
    requestScreenChange
}) {
    let currentBackgroundIndex = 0;
    let hoveredThemeIndex = null;
    let themePanelActiveIndex = 0;
    let themeDragState = null;
    let suppressThemeClickUntil = 0;
    let hasConfirmedThemeSelectionInCurrentFlow = false;
    let isThemeSelectionTransitioning = false;
    const transitionTimers = [];
    let previewVideoEl = null;
    let previewVideoSrc = null;

    function updatePreviewVideo(theme) {
        if (!themePreviewMedia) return;

        if (!theme.previewVideo) {
            if (previewVideoEl) {
                previewVideoEl.pause();
                previewVideoEl.remove();
                previewVideoEl = null;
                previewVideoSrc = null;
            }
            return;
        }

        if (!previewVideoEl) {
            previewVideoEl = document.createElement('video');
            previewVideoEl.className = 'theme-preview-video';
            previewVideoEl.muted = true;
            previewVideoEl.loop = true;
            previewVideoEl.autoplay = true;
            previewVideoEl.playsInline = true;
            previewVideoEl.setAttribute('aria-hidden', 'true');
            previewVideoEl.addEventListener('loadeddata', () => {
                previewVideoEl?.classList.add('is-ready');
            });
            previewVideoEl.addEventListener('error', () => {
                // 影片缺檔或載入失敗時退回漸層背景
                previewVideoEl?.classList.remove('is-ready');
            });
            themePreviewMedia.appendChild(previewVideoEl);
        }

        if (previewVideoSrc !== theme.previewVideo) {
            previewVideoSrc = theme.previewVideo;
            previewVideoEl.classList.remove('is-ready');
            previewVideoEl.src = theme.previewVideo;
            void previewVideoEl.play().catch(() => {});
        }
    }

    function getCurrentBackgroundTheme() {
        return themes[currentBackgroundIndex];
    }

    function getThemePanelPreviewIndex() {
        return hoveredThemeIndex === null ? themePanelActiveIndex : hoveredThemeIndex;
    }

    function updateThemeListVisuals(activeIndex) {
        if (!themeList) return;
        const themeButtons = themeList.querySelectorAll('.theme-list-item');

        for (const button of themeButtons) {
            const buttonIndex = Number(button.dataset.themeIndex);
            const offset = buttonIndex - activeIndex;
            const absOffset = Math.abs(offset);
            const clampedOffset = Math.max(-3, Math.min(3, offset));
            const translateY = clampedOffset * 96;
            const rotateX = clampedOffset * -16;
            const scale = 1 - Math.min(absOffset, 3) * 0.08;
            const opacity = absOffset === 0
                ? 1
                : absOffset === 1
                    ? 0.78
                    : absOffset === 2
                        ? 0.32
                        : 0.08;

            button.style.transform = `translateY(${translateY}px) rotateX(${rotateX}deg) scale(${scale})`;
            button.style.opacity = String(absOffset > 3 ? 0 : opacity);
            button.style.filter = absOffset === 0
                ? 'brightness(1.03)'
                : `blur(${Math.min(absOffset, 3) * 0.65}px) brightness(${1 - Math.min(absOffset, 3) * 0.08})`;
            button.style.zIndex = String(30 - Math.min(absOffset, 30));
            button.classList.toggle('is-faded', absOffset > 2);
            button.classList.toggle('is-active', buttonIndex === activeIndex);
            button.parentElement?.style.setProperty('z-index', String(30 - Math.min(absOffset, 30)));
        }
    }

    function setThemePanelActiveIndex(index, options = {}) {
        const { syncHover = true } = options;
        const boundedIndex = Math.max(0, Math.min(themes.length - 1, index));
        themePanelActiveIndex = boundedIndex;
        if (syncHover) {
            hoveredThemeIndex = null;
        }
        updateThemePanelSelection();
    }

    function updateThemePanelSelection() {
        const currentTheme = getCurrentBackgroundTheme();
        const previewIndex = getThemePanelPreviewIndex();
        const previewTheme = themes[(previewIndex + themes.length) % themes.length];
        const { currentScreen, isFreePlayThemeSelection } = getUiState();

        backgroundToggleButton.textContent = `Theme: ${currentTheme.label}`;

        if (themePreviewTitle) {
            themePreviewTitle.textContent = previewTheme.label;
        }
        if (themePreviewDescription) {
            themePreviewDescription.textContent = previewTheme.description || 'Theme preview';
        }
        if (themePreviewMedia) {
            themePreviewMedia.style.background = previewTheme.previewBackground || '';
            updatePreviewVideo(previewTheme);
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

        updateThemeListVisuals(previewIndex);
    }

    function clearThemeSelectionTransitionTimers() {
        while (transitionTimers.length) {
            clearTimeout(transitionTimers.pop());
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
            button.classList.remove('is-selected', 'is-muted', 'is-active', 'is-faded');
            button.style.removeProperty('transform');
            button.style.removeProperty('opacity');
            button.style.removeProperty('filter');
            button.style.removeProperty('z-index');
        }
    }

    function applyBackgroundTheme(index) {
        currentBackgroundIndex = (index + themes.length) % themes.length;
        const theme = getCurrentBackgroundTheme();
        onApplyTheme(theme);
        updateThemePanelSelection();
    }

    function startThemeSelectionTransition(index) {
        if (!themePanel || !themeList || isThemeSelectionTransitioning) return;
        const themeButtons = Array.from(themeList.querySelectorAll('.theme-list-item'));
        if (themeButtons.length === 0) return;

        void onPlaySelectSound();

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

        transitionTimers.push(window.setTimeout(() => {
            if (!themePanel) return;
            themePanel.classList.add('is-exiting');
        }, 300));

        transitionTimers.push(window.setTimeout(() => {
            resetThemeSelectionVisualState();
            requestScreenChange('free-play', { skipThemeSelection: true });
        }, 760));
    }

    function closeThemePanel() {
        if (!themePanel) return;
        themePanel.classList.remove('is-open');
        themePanel.setAttribute('aria-hidden', 'true');
        previewVideoEl?.pause();
        backgroundToggleButton.classList.remove('is-active');
        hoveredThemeIndex = null;
        themeDragState = null;
        updateThemePanelSelection();
    }

    function openThemePanel() {
        if (!themePanel) return;
        themePanel.classList.add('is-open');
        themePanel.setAttribute('aria-hidden', 'false');
        if (previewVideoEl) void previewVideoEl.play().catch(() => {});
        backgroundToggleButton.classList.add('is-active');
        themePanelActiveIndex = currentBackgroundIndex;
        hoveredThemeIndex = null;
        updateThemePanelSelection();
    }

    function beginThemeSelectionFlow() {
        hasConfirmedThemeSelectionInCurrentFlow = false;
    }

    function resetThemeSelectionFlow() {
        hasConfirmedThemeSelectionInCurrentFlow = false;
    }

    function setupThemePanel() {
        if (!themeList) return;
        themeList.innerHTML = '';

        const handleThemeDragMove = (clientY) => {
            if (!themeDragState) return;
            const deltaY = clientY - themeDragState.startY;
            const nextIndex = Math.max(
                0,
                Math.min(
                    themes.length - 1,
                    themeDragState.startIndex - Math.round(deltaY / 86)
                )
            );

            if (nextIndex !== themePanelActiveIndex) {
                themePanelActiveIndex = nextIndex;
                hoveredThemeIndex = null;
                updateThemePanelSelection();
            }

            if (Math.abs(deltaY) > 10) {
                themeDragState.dragged = true;
            }
        };

        themeList.addEventListener('pointerdown', (event) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (!event.target.closest('.theme-list-item')) return;

            themeDragState = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startIndex: themePanelActiveIndex,
                dragged: false,
                targetIndex: Number(event.target.closest('.theme-list-item')?.dataset.themeIndex ?? -1),
                targetWasActive: event.target.closest('.theme-list-item')?.classList.contains('is-active') ?? false
            };
            themeList.setPointerCapture(event.pointerId);
        });

        themeList.addEventListener('pointermove', (event) => {
            if (!themeDragState || themeDragState.pointerId !== event.pointerId) return;
            handleThemeDragMove(event.clientY);
        });

        const finishThemeDrag = (event) => {
            if (!themeDragState || themeDragState.pointerId !== event.pointerId) return;

            if (themeDragState.dragged) {
                suppressThemeClickUntil = performance.now() + 180;
            } else if (
                themeDragState.targetIndex >= 0
                && performance.now() >= suppressThemeClickUntil
            ) {
                if (!themeDragState.targetWasActive || themePanelActiveIndex !== themeDragState.targetIndex) {
                    setThemePanelActiveIndex(themeDragState.targetIndex);
                } else {
                    startThemeSelectionTransition(themeDragState.targetIndex);
                }
            }

            if (themeList.hasPointerCapture(event.pointerId)) {
                themeList.releasePointerCapture(event.pointerId);
            }
            themeDragState = null;
        };

        themeList.addEventListener('pointerup', finishThemeDrag);
        themeList.addEventListener('pointercancel', finishThemeDrag);
        themeList.addEventListener('wheel', (event) => {
            event.preventDefault();
            if (isThemeSelectionTransitioning) return;

            const direction = event.deltaY > 0 ? 1 : -1;
            if (direction === 0) return;

            const nextIndex = Math.max(
                0,
                Math.min(themes.length - 1, themePanelActiveIndex + direction)
            );

            if (nextIndex !== themePanelActiveIndex) {
                themePanelActiveIndex = nextIndex;
                hoveredThemeIndex = null;
                updateThemePanelSelection();
            }
        }, { passive: false });

        themes.forEach((theme, index) => {
            const item = document.createElement('li');
            item.className = 'theme-list-slot';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theme-list-item';
            button.dataset.themeIndex = String(index);
            button.textContent = theme.label;
            button.addEventListener('focus', () => {
                setThemePanelActiveIndex(index);
            });
            button.addEventListener('blur', () => {
                hoveredThemeIndex = null;
                updateThemePanelSelection();
            });
            item.appendChild(button);
            themeList.appendChild(item);
        });

        themePanelActiveIndex = currentBackgroundIndex;
        updateThemePanelSelection();
    }

    return {
        applyBackgroundTheme,
        beginThemeSelectionFlow,
        closeThemePanel,
        getCurrentBackgroundTheme,
        openThemePanel,
        resetThemeSelectionFlow,
        resetThemeSelectionVisualState,
        setupThemePanel,
        updateThemePanelSelection
    };
}
