// background/history.js - Screenshot storage management

export async function saveToHistory(dataUrl, tab) {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    const entry = {
        id: Date.now(),
        imageData: dataUrl,
        pageUrl: tab.url,
        pageTitle: tab.title,
        timestamp: Date.now()
    };

    const newList = [entry, ...screenshots].slice(0, 50);
    await chrome.storage.local.set({ screenshots: newList, lastScreenshotId: entry.id });
    return entry;
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
