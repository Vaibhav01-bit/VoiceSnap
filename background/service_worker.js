// background/service_worker.js - Core logic for VoiceSnap

const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

// ─── Status Manager ───────────────────────────────────────────────────────────
const setStatus = async (listening, error = null) => {
    await chrome.storage.local.set({ isListening: listening, errorState: error });
};

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'VOICE_COMMAND':
            if (request.command) {
                handleVoiceCommand(request.command);
            }
            break;
        case 'VOICE_COMMAND_DETECTED':
            handleCaptureScreenshotFlow();
            break;
        case 'VOICE_COMMAND_CAPTURE_MIDDLE':
            handleCapturePresetRegion('middle');
            break;
        case 'VOICE_COMMAND_CAPTURE_LEFT':
            handleCapturePresetRegion('left');
            break;
        case 'VOICE_COMMAND_CROP_DETECTED':
            handleCropScreenshotStart();
            break;
        case 'VOICE_LISTENING_ENABLE':
            handleVoiceListeningEnable();
            break;
        case 'VOICE_LISTENING_DISABLE':
            handleVoiceListeningDisable();
            break;
        case 'UPDATE_STATE':
            chrome.storage.local.set(request.payload);
            break;
        case 'COPY_TO_CLIPBOARD':
            // Proxy between popup and offscreen
            handleProxyCopyToClipboard(request.dataUrl);
            break;
        case 'CROP_REGION_SELECTED':
            if (request.rect && request.viewport && sender.tab) {
                handleCropRegionSelected(request.rect, request.viewport, sender.tab);
            }
            break;
        case 'PREVIEW_ACTION':
            handlePreviewAction(request.action, request.payload || {});
            break;
        case 'DOWNLOAD_SCREENSHOT':
            handleDownloadScreenshot(request.dataUrl, request.fileNameHint);
            break;
        case 'CLEAR_SCREENSHOTS':
            handleClearScreenshots();
            break;
    }
    return false;
});

// ─── Voice Engine Lifecycle ───────────────────────────────────────────────────

function handleVoiceCommand(command) {
    const intent = command.intent;
    const options = command.options || {};

    switch (intent) {
        case 'capture_full_page':
            handleCaptureFullPage();
            break;
        case 'capture_area':
            handleCaptureArea();
            break;
        case 'capture_element':
            handleCaptureElement(options);
            break;
        case 'capture_region':
            handleCaptureRegion(options.region);
            break;
        case 'timer_capture':
            handleTimerCapture(options);
            break;
        case 'record_start':
        case 'record_stop':
            handleRecordingCommand(intent, options);
            break;
        case 'capture_screen':
        default:
            handleCaptureScreenshotFlow();
            break;
    }
}

async function handleVoiceListeningEnable() {
    try {
        await setupOffscreenDocument();
        chrome.runtime.sendMessage({ type: 'START_VOICE_ENGINE' });
        await setStatus(true, null);
    } catch (err) {
        console.error('Failed to enable voice listening:', err);
        await setStatus(false, 'Unable to start voice engine.');
    }
}

async function handleVoiceListeningDisable() {
    try {
        chrome.runtime.sendMessage({ type: 'STOP_VOICE_ENGINE' });
        await setStatus(false, null);
    } catch (err) {
        console.error('Failed to disable voice listening:', err);
        await setStatus(false, 'Unable to stop voice engine.');
    }
}

// ─── Offscreen Document Management ───────────────────────────────────────────

async function setupOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });

    if (contexts.length > 0) return;

    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA', 'CLIPBOARD'],
        justification: 'Voice recognition processing and clipboard access'
    });
}

async function closeOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) {
        await chrome.offscreen.closeDocument();
    }
}

// ─── Screenshot Pipeline ──────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleCaptureScreenshotFlow() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;

        const activeTab = tabs[0];

        // 1. Capture
        let dataUrl;
        try {
            dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        } catch (e) {
            notifyUser('error', 'Restricted page - cannot capture');
            return;
        }

        // 2. Clipboard
        await handleProxyCopyToClipboard(dataUrl);

        // 3. History
        await saveToHistory(dataUrl, activeTab);

    } catch (err) {
        console.error('Pipeline error:', err);
    }
}

// Placeholder implementations for advanced commands.
// Subsequent tasks will extend these with full functionality.

async function handleCaptureFullPage() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;
        const activeTab = tabs[0];

        // Ask content script for page metrics
        const metrics = await new Promise((resolve) => {
            const listener = (request) => {
                if (request.type === 'PAGE_METRICS' && request.metrics) {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve(request.metrics);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
            chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_METRICS' });
        });

        const totalHeight = metrics.totalHeight;
        const viewportHeight = metrics.viewportHeight;
        const devicePixelRatio = metrics.devicePixelRatio || 1;

        let y = 0;
        const bitmaps = [];

        while (y < totalHeight - 1) {
            await new Promise((resolve) => {
                const listener = (request) => {
                    if (request.type === 'SCROLL_DONE') {
                        chrome.runtime.onMessage.removeListener(listener);
                        resolve();
                    }
                };
                chrome.runtime.onMessage.addListener(listener);
                chrome.tabs.sendMessage(activeTab.id, { type: 'SCROLL_TO', y });
            });

            await sleep(150);

            let dataUrl;
            try {
                dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
            } catch (e) {
                notifyUser('error', 'Restricted page - cannot capture');
                return;
            }

            const blob = await (await fetch(dataUrl)).blob();
            const bitmap = await createImageBitmap(blob);
            bitmaps.push({ bitmap, y });

            y += viewportHeight;
        }

        if (!bitmaps.length) {
            await handleCaptureScreenshotFlow();
            return;
        }

        const fullWidth = bitmaps[0].bitmap.width;
        const totalPxHeight = Math.round(totalHeight * devicePixelRatio);

        const canvas = new OffscreenCanvas(fullWidth, totalPxHeight);
        const ctx = canvas.getContext('2d');

        for (const segment of bitmaps) {
            const offsetY = Math.round(segment.y * devicePixelRatio);
            ctx.drawImage(segment.bitmap, 0, offsetY);
        }

        const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
        const finalDataUrl = await blobToDataUrl(finalBlob);

        await handleProxyCopyToClipboard(finalDataUrl);
        await saveToHistory(finalDataUrl, activeTab);
    } catch (err) {
        console.error('Full page capture error:', err);
        notifyUser('error', 'Full page capture failed.');
    }
}

async function handleCaptureArea() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;
        const activeTab = tabs[0];

        // Reuse crop selection overlay to select area
        await new Promise((resolve, reject) => {
            const listener = async (request, sender) => {
                if (request.type === 'CROP_REGION_SELECTED' && sender.tab && sender.tab.id === activeTab.id) {
                    chrome.runtime.onMessage.removeListener(listener);
                    try {
                        await handleCropRegionSelected(request.rect, request.viewport, activeTab);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            };
            chrome.runtime.onMessage.addListener(listener);
            chrome.tabs.sendMessage(activeTab.id, { type: 'START_CROP_SELECTION' }, () => {
                if (chrome.runtime.lastError) {
                    chrome.runtime.onMessage.removeListener(listener);
                    reject(chrome.runtime.lastError);
                }
            });
        });
    } catch (err) {
        console.error('Area capture error:', err);
        notifyUser('error', 'Area capture failed.');
    }
}

async function handleCaptureElement(options) {
    const target = options && options.target;
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;
        const activeTab = tabs[0];

        if (target === 'hover') {
            // Ask for last hover target rect
            const rect = await new Promise((resolve) => {
                const listener = (request) => {
                    if (request.type === 'HOVER_TARGET_RESULT') {
                        chrome.runtime.onMessage.removeListener(listener);
                        resolve(request.result || null);
                    }
                };
                chrome.runtime.onMessage.addListener(listener);
                chrome.tabs.sendMessage(activeTab.id, { type: 'HOVER_TARGET' });
            });

            if (!rect) {
                notifyUser('error', 'No hover target detected');
                return;
            }

            await handleElementRectCapture(rect, activeTab);
            return;
        }

        // Find element by intent in content script
        const result = await new Promise((resolve) => {
            const listener = (request) => {
                if (request.type === 'ELEMENT_FOUND') {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve(request.result || null);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
            chrome.tabs.sendMessage(activeTab.id, { type: 'FIND_ELEMENT', target }, () => {
                if (chrome.runtime.lastError) {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve(null);
                }
            });
        });

        if (!result) {
            notifyUser('error', 'No matching element found');
            return;
        }

        await handleElementRectCapture(result, activeTab);
    } catch (err) {
        console.error('Element capture error:', err);
        notifyUser('error', 'Element capture failed.');
    }
}

async function handleCaptureRegion(region) {
    if (!region) {
        await handleCaptureScreenshotFlow();
        return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;
        const activeTab = tabs[0];

        let dataUrl;
        try {
            dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        } catch (e) {
            notifyUser('error', 'Restricted page - cannot capture');
            return;
        }

        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);

        const viewport = await new Promise((resolve) => {
            chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_METRICS' }, () => {
                // Metrics will be delivered via PAGE_METRICS; we only need viewport values
            });
            const listener = (request) => {
                if (request.type === 'PAGE_METRICS' && request.metrics) {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve({
                        width: request.metrics.viewportWidth,
                        height: request.metrics.viewportHeight
                    });
                }
            };
            chrome.runtime.onMessage.addListener(listener);
        });

        const scaleX = bitmap.width / viewport.width;
        const scaleY = bitmap.height / viewport.height;

        let x = 0;
        let y = 0;
        let w = viewport.width;
        let h = viewport.height;

        switch (region) {
            case 'left':
                w = viewport.width / 2;
                break;
            case 'right':
                x = viewport.width / 2;
                w = viewport.width / 2;
                break;
            case 'middle':
                w = viewport.width * 0.5;
                h = viewport.height * 0.5;
                x = (viewport.width - w) / 2;
                y = (viewport.height - h) / 2;
                break;
            case 'top':
                h = viewport.height / 2;
                break;
            case 'bottom':
                y = viewport.height / 2;
                h = viewport.height / 2;
                break;
            default:
                break;
        }

        const sx = x * scaleX;
        const sy = y * scaleY;
        const sw = w * scaleX;
        const sh = h * scaleY;

        const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const croppedDataUrl = await blobToDataUrl(croppedBlob);

        await handleProxyCopyToClipboard(croppedDataUrl);
        await saveToHistory(croppedDataUrl, activeTab);
    } catch (err) {
        console.error('Region capture error:', err);
        notifyUser('error', 'Region capture failed.');
    }
}

async function handleTimerCapture(options) {
    const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 3000;
    const mode = options.mode || 'screen';

    setTimeout(() => {
        switch (mode) {
            case 'full page':
                handleCaptureFullPage();
                break;
            case 'area':
                handleCaptureArea();
                break;
            default:
                handleCaptureScreenshotFlow();
                break;
        }
    }, delayMs);
}

async function handleRecordingCommand(intent, options) {
    // Screen recording will be implemented in a later task.
    console.warn('Recording command not yet implemented:', intent, options);
}

async function handleCapturePresetRegion(preset) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;

        const activeTab = tabs[0];

        let dataUrl;
        try {
            dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        } catch (e) {
            notifyUser('error', 'Restricted page - cannot capture');
            return;
        }

        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);

        let sx = 0;
        let sy = 0;
        let sw = bitmap.width;
        let sh = bitmap.height;

        if (preset === 'middle') {
            sw = Math.round(bitmap.width * 0.5);
            sh = Math.round(bitmap.height * 0.5);
            sx = Math.round((bitmap.width - sw) / 2);
            sy = Math.round((bitmap.height - sh) / 2);
        } else if (preset === 'left') {
            sw = Math.round(bitmap.width * 0.5);
            sh = bitmap.height;
            sx = 0;
            sy = 0;
        }

        const canvas = new OffscreenCanvas(sw, sh);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const croppedDataUrl = await blobToDataUrl(croppedBlob);

        await handleProxyCopyToClipboard(croppedDataUrl);
        await saveToHistory(croppedDataUrl, activeTab);
    } catch (err) {
        console.error('Preset region capture error:', err);
        notifyUser('error', 'Region capture failed.');
    }
}

async function handleCropScreenshotStart() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;

        const activeTab = tabs[0];

        chrome.tabs.sendMessage(activeTab.id, {
            type: 'START_CROP_SELECTION'
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('Failed to start crop selection:', chrome.runtime.lastError);
                notifyUser('error', 'Unable to start crop selection on this page.');
            } else {
                notifyUser('success', 'Drag to select crop region');
            }
        });
    } catch (err) {
        console.error('Crop start error:', err);
        notifyUser('error', 'Unable to start crop selection.');
    }
}

async function handleCropRegionSelected(rect, viewport, tab) {
    try {
        let dataUrl;
        try {
            dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        } catch (e) {
            notifyUser('error', 'Restricted page - cannot capture');
            return;
        }

        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);

        const scaleX = bitmap.width / viewport.width;
        const scaleY = bitmap.height / viewport.height;

        const sx = rect.x * scaleX;
        const sy = rect.y * scaleY;
        const sw = rect.width * scaleX;
        const sh = rect.height * scaleY;

        const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const croppedDataUrl = await blobToDataUrl(croppedBlob);

        await handleProxyCopyToClipboard(croppedDataUrl);
        await saveToHistory(croppedDataUrl, tab);
    } catch (err) {
        console.error('Crop pipeline error:', err);
        notifyUser('error', 'Crop failed.');
    }
}

async function handleElementRectCapture(rect, tab) {
    let dataUrl;
    try {
        dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    } catch (e) {
        notifyUser('error', 'Restricted page - cannot capture');
        return;
    }

    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);

    const scaleX = bitmap.width / rect.viewportWidth;
    const scaleY = bitmap.height / rect.viewportHeight;

    const sx = rect.x * scaleX;
    const sy = rect.y * scaleY;
    const sw = rect.width * scaleX;
    const sh = rect.height * scaleY;

    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const croppedDataUrl = await blobToDataUrl(croppedBlob);

    await handleProxyCopyToClipboard(croppedDataUrl);
    await saveToHistory(croppedDataUrl, tab);
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function handleProxyCopyToClipboard(dataUrl) {
    try {
        await setupOffscreenDocument();
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'COPY_TO_CLIPBOARD',
                    dataUrl
                },
                (res) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(res);
                    }
                }
            );
        });

        if (response?.success) {
            notifyUser('success', '✔ Copied to clipboard');
        } else {
            notifyUser('error', 'Clipboard copy failed');
        }
    } catch (err) {
        console.error('Clipboard capture proxy failed:', err);
        notifyUser('error', 'Clipboard copy failed');
    }
}

async function saveToHistory(dataUrl, tab) {
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
    await sendCapturePreview(entry);
}

// ─── User Notification ────────────────────────────────────────────────────────

function notifyUser(status, message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) {
            fallbackNotification(status, message);
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SHOW_NOTIFICATION',
            status,
            message
        }, (res) => {
            if (chrome.runtime.lastError) fallbackNotification(status, message);
        });
    });
}

function fallbackNotification(status, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: status === 'error' ? 'VoiceSnap Error' : 'VoiceSnap',
        message: message
    });
}

async function sendCapturePreview(entry) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return;
        chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SHOW_CAPTURE_PREVIEW',
            preview: {
                id: entry.id,
                imageData: entry.imageData,
                pageTitle: entry.pageTitle,
                pageUrl: entry.pageUrl,
                timestamp: entry.timestamp
            }
        }, () => { /* ignore errors on pages without content script */ });
    });
}

function buildScreenshotFileName(pageTitle, timestamp, extension) {
    const date = new Date(timestamp || Date.now());
    const parts = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0')
    ];
    const safeTitle = (pageTitle || 'voicesnap').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'voicesnap';
    const stamp = parts.slice(0, 3).join('-') + '-' + parts.slice(3).join('-');
    return `${safeTitle}-${stamp}.${extension || 'png'}`;
}

function handleDownloadScreenshot(dataUrl, fileNameHint) {
    if (!dataUrl) return;
    const extension = dataUrl.startsWith('data:image/jpeg') ? 'jpg'
        : dataUrl.startsWith('data:image/webp') ? 'webp'
        : 'png';
    const fileName = fileNameHint || buildScreenshotFileName('voicesnap', Date.now(), extension);
    chrome.downloads.download({
        url: dataUrl,
        filename: `VoiceSnap/${fileName}`,
        saveAs: false
    });
}

function handlePreviewAction(action, payload) {
    switch (action) {
        case 'copy':
            if (payload.dataUrl) {
                handleProxyCopyToClipboard(payload.dataUrl);
            }
            break;
        case 'download':
            handleDownloadScreenshot(payload.dataUrl, payload.fileNameHint);
            break;
        case 'edit':
            if (payload.id) {
                const url = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(payload.id)}`);
                chrome.tabs.create({ url });
            }
            break;
        case 'gallery':
            {
                const url = chrome.runtime.getURL('popup/gallery.html');
                chrome.tabs.create({ url });
            }
            break;
        default:
            break;
    }
}

async function handleClearScreenshots() {
    try {
        await chrome.storage.local.set({ screenshots: [], lastScreenshotId: null });
        notifyUser('success', 'All screenshots deleted');
    } catch (err) {
        console.error('Failed to clear screenshots:', err);
        notifyUser('error', 'Failed to clear screenshots');
    }
}
