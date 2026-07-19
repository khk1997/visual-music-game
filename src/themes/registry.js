function createThemeId(label) {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function defineTheme(theme) {
    return {
        ...theme,
        id: theme.id ?? createThemeId(theme.label)
    };
}

// visualSystem 決定 main.js 掛載哪一套背景視覺模組:
//   'legacy-grid' → 波紋網格 + 火花 + 霧氣
//   'piano-roll'  → 音軌長條 + 噴射粒子
//   'fluid-ink'   → 流體墨水模擬
// forcedInstrument(選填)進入該主題時強制切換音色。
// previewVideo(選填)主題選擇頁右側的示範影片路徑;無檔案時顯示 previewBackground 漸層。
export const BACKGROUND_THEMES = [
    defineTheme({
        label: 'PlayStation Style',
        visualSystem: 'legacy-grid',
        color: 0x000000,
        exposure: 2.0,
        description: '經典霧化符號背景，亮度高、對比強，適合自由演奏時快速看清互動反饋。',
        previewVideo: 'assets/previews/playstation-style.webm',
        previewBackground: 'radial-gradient(circle at 22% 18%, rgba(255,255,255,0.2), transparent 28%), radial-gradient(circle at 76% 70%, rgba(98, 142, 255, 0.24), transparent 34%), linear-gradient(180deg, rgba(30,36,48,0.96), rgba(14,18,26,0.96))'
    }),
    defineTheme({
        label: 'Piano Roll',
        visualSystem: 'piano-roll',
        color: 0x03111f,
        exposure: 1.75,
        forcedInstrument: 'piano',
        description: '藍色長條與光暈音軌為主，節奏感更聚焦，適合 piano roll 視覺演出。',
        previewVideo: 'assets/previews/piano-roll.webm',
        previewBackground: 'radial-gradient(circle at 70% 24%, rgba(115, 202, 255, 0.2), transparent 34%), radial-gradient(circle at 22% 76%, rgba(40, 124, 210, 0.24), transparent 38%), linear-gradient(180deg, rgba(8, 25, 42, 0.97), rgba(3, 13, 24, 0.97))'
    }),
    defineTheme({
        label: 'Fluid Ink',
        visualSystem: 'fluid-ink',
        color: 0x05060d,
        exposure: 1.7,
        description: '流體墨水模擬，按下琴鍵時彩色墨流從琴鍵位置向上噴發暈染，按住可持續注入墨流。',
        previewVideo: 'assets/previews/fluid-ink.webm',
        previewBackground: 'radial-gradient(ellipse at 30% 85%, rgba(64, 224, 208, 0.3), transparent 42%), radial-gradient(ellipse at 62% 70%, rgba(186, 85, 255, 0.26), transparent 46%), radial-gradient(ellipse at 78% 88%, rgba(255, 96, 160, 0.22), transparent 38%), linear-gradient(180deg, rgba(8, 9, 18, 0.97), rgba(4, 5, 11, 0.98))'
    })
];
