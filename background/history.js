// background/history.js - Screenshot storage management

const HISTORY_LIMIT = 50;

export async function getScreenshots() {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    return screenshots;
}

export async function saveToHistory(dataUrl, tab = {}, meta = {}) {
    const screenshots = await getScreenshots();
    const timestamp = meta.timestamp || Date.now();
    const entry = {
        id: meta.id || timestamp,
        imageData: dataUrl,
        pageUrl: tab.url || meta.pageUrl || '',
        pageTitle: tab.title || meta.pageTitle || 'Untitled page',
        timestamp,
        captureMode: meta.captureMode || 'visible',
        captureLabel: meta.captureLabel || 'Visible',
        favorite: Boolean(meta.favorite),
        isEdited: Boolean(meta.isEdited)
    };

    const newList = [entry, ...screenshots].slice(0, HISTORY_LIMIT);
    await chrome.storage.local.set({ screenshots: newList, lastScreenshotId: entry.id });
    return entry;
}

export async function deleteScreenshot(id) {
    const screenshots = await getScreenshots();
    const next = screenshots.filter((item) => String(item.id) !== String(id));
    const nextLastId = next[0]?.id || null;
    await chrome.storage.local.set({ screenshots: next, lastScreenshotId: nextLastId });
    return next;
}

export async function toggleFavoriteScreenshot(id) {
    const screenshots = await getScreenshots();
    const next = screenshots.map((item) => {
        if (String(item.id) !== String(id)) return item;
        return { ...item, favorite: !item.favorite };
    });
    await chrome.storage.local.set({ screenshots: next });
    return next.find((item) => String(item.id) === String(id)) || null;
}

export async function getScreenshotById(id) {
    const screenshots = await getScreenshots();
    return screenshots.find((item) => String(item.id) === String(id)) || null;
}

export async function handleClearScreenshots() {
    try {
        await chrome.storage.local.set({ screenshots: [], lastScreenshotId: null });
        return { success: true };
    } catch (err) {
        console.error('Failed to clear screenshots:', err);
        return { success: false, error: err.message };
    }
}
