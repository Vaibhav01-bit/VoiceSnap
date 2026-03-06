// background/capture.js - Core screenshot capture logic

export async function captureVisibleTab() {
    try {
        return await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    } catch (e) {
        throw new Error('Restricted page - cannot capture');
    }
}

export async function handleCapturePresetRegion(preset, dataUrl) {
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
    return await blobToDataUrl(croppedBlob);
}

export async function captureFullPage(notifyUser, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview) {
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

            await new Promise(r => setTimeout(r, 150));

            let dataUrl = await captureVisibleTab();
            const blob = await (await fetch(dataUrl)).blob();
            const bitmap = await createImageBitmap(blob);
            bitmaps.push({ bitmap, y });

            y += viewportHeight;
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
        const entry = await saveToHistory(finalDataUrl, activeTab);
        await sendCapturePreview(entry);
    } catch (err) {
        console.error('Full page capture error:', err);
        notifyUser('error', 'Full page capture failed.');
    }
}

export async function handleCaptureArea(activeTab) {
    chrome.tabs.sendMessage(activeTab.id, { type: 'START_CROP_SELECTION' }, () => {
        if (chrome.runtime.lastError) {
            console.error('Failed to start crop selection:', chrome.runtime.lastError);
        }
    });
}

export async function handleCaptureElement(target, activeTab, handleElementRectCapture) {
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

    if (result) {
        await handleElementRectCapture(result, activeTab);
    }
}

export async function handleElementRectCapture(rect, tab, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview) {
    try {
        let dataUrl = await captureVisibleTab();
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
        const entry = await saveToHistory(croppedDataUrl, tab);
        await sendCapturePreview(entry);
    } catch (err) {
        console.error('Rect capture error:', err);
    }
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function buildScreenshotFileName(pageTitle, timestamp, extension) {
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

export function handleDownloadScreenshot(dataUrl, fileNameHint) {
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
