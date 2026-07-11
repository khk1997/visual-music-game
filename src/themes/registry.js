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
//   'legacy-grid'    → 波紋網格 + 火花 + 霧氣
//   'piano-roll'     → 音軌長條 + 噴射粒子
//   'fireworks'      → 音符煙火爆發
//   'geometry-pulse' → 中央幾何體律動
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
        label: 'Fireworks',
        visualSystem: 'fireworks',
        color: 0x050510,
        exposure: 1.85,
        description: '每個音符化成一場煙火，音高決定色彩、彈得越密天空越熱鬧，適合節奏強烈的演奏。',
        previewVideo: 'assets/previews/fireworks.webm',
        previewBackground: 'radial-gradient(circle at 30% 26%, rgba(255, 168, 92, 0.26), transparent 30%), radial-gradient(circle at 72% 60%, rgba(255, 92, 168, 0.22), transparent 34%), linear-gradient(180deg, rgba(16, 12, 34, 0.97), rgba(5, 5, 16, 0.98))'
    }),
    defineTheme({
        label: 'Geometry Pulse',
        visualSystem: 'geometry-pulse',
        color: 0x070b14,
        exposure: 1.7,
        description: '中央幾何體隨音符呼吸、旋轉、變色，低音撼動形體、高音點亮稜線，適合慢速沉浸演奏。',
        previewVideo: 'assets/previews/geometry-pulse.webm',
        previewBackground: 'radial-gradient(circle at 50% 42%, rgba(120, 220, 255, 0.24), transparent 36%), radial-gradient(circle at 24% 74%, rgba(122, 92, 255, 0.2), transparent 32%), linear-gradient(180deg, rgba(10, 16, 30, 0.97), rgba(6, 9, 18, 0.98))'
    })
];
