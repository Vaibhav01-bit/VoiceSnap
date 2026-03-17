// background/capture.js - Core screenshot capture logic

export async function captureVisibleTab(windowId = null) {
    try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
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

export async function captureFullPage(notifyUser, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview, activeTabOverride = null) {
    let activeTab = null;
    let originalScrollY = 0;

    try {
        activeTab = activeTabOverride;
        if (!activeTab) {
            [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        }
        if (!activeTab) {
            [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        }
        if (!activeTab) return;

        const metrics = await waitForRuntimeMessage(
            'PAGE_METRICS',
            () => chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_METRICS' })
        );

        if (!metrics) {
            throw new Error('Unable to read page metrics');
        }

        const totalHeight = metrics.totalHeight;
        const viewportHeight = metrics.viewportHeight;
        const devicePixelRatio = metrics.devicePixelRatio || 1;
        originalScrollY = metrics.scrollY || 0;
        const stickyTopHeight = metrics.stickyTopHeight || 0;
        const maxScrollY = Math.max(0, totalHeight - viewportHeight);
        const targetPositions = [];

        console.log('[VoiceSnap][FullPage] metrics:', {
            totalHeight,
            viewportHeight,
            devicePixelRatio,
            originalScrollY,
            stickyTopHeight
        });

        for (let y = 0; y <= maxScrollY; y += viewportHeight) {
            targetPositions.push(Math.min(y, maxScrollY));
        }

        if (!targetPositions.length) {
            targetPositions.push(0);
        }

        const bitmaps = [];
        const seenScrollPositions = new Set();

        for (const targetY of targetPositions) {
            const scrolled = await waitForRuntimeMessage(
                'SCROLL_DONE',
                () => chrome.tabs.sendMessage(activeTab.id, { type: 'SCROLL_TO', y: targetY })
            );

            if (!scrolled) {
                throw new Error('Unable to scroll page');
            }

            const actualScrollY = typeof scrolled.y === 'number' ? scrolled.y : targetY;
            console.log('[VoiceSnap][FullPage] scroll step:', { targetY, actualScrollY });
            if (seenScrollPositions.has(actualScrollY)) {
                continue;
            }
            seenScrollPositions.add(actualScrollY);

            await new Promise(r => setTimeout(r, 275));

            let dataUrl = await captureVisibleTab(activeTab.windowId ?? null);
            const blob = await (await fetch(dataUrl)).blob();
            const bitmap = await createImageBitmap(blob);
            bitmaps.push({ bitmap, y: actualScrollY });
        }

        if (!bitmaps.length) {
            throw new Error('No page segments captured');
        }

        const fullWidth = bitmaps[0].bitmap.width;
        const totalPxHeight = Math.round(totalHeight * devicePixelRatio);

        const canvas = new OffscreenCanvas(fullWidth, totalPxHeight);
        const ctx = canvas.getContext('2d');

        for (let index = 0; index < bitmaps.length; index += 1) {
            const segment = bitmaps[index];
            const offsetY = Math.round(segment.y * devicePixelRatio);
            const stickyTopPx = index === 0 ? 0 : Math.round(stickyTopHeight * devicePixelRatio);
            const remainingHeightPx = Math.max(0, totalPxHeight - offsetY);
            const sourceHeight = Math.min(Math.max(0, segment.bitmap.height - stickyTopPx), remainingHeightPx);
            if (sourceHeight <= 0) continue;
            ctx.drawImage(
                segment.bitmap,
                0,
                stickyTopPx,
                segment.bitmap.width,
                sourceHeight,
                0,
                offsetY + stickyTopPx,
                segment.bitmap.width,
                sourceHeight
            );
        }

        const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
        const finalDataUrl = await blobToDataUrl(finalBlob);
        console.log('[VoiceSnap][FullPage] stitch completed');

        await handleProxyCopyToClipboard(finalDataUrl);
        const entry = await saveToHistory(finalDataUrl, activeTab);
        await sendCapturePreview(entry);
    } catch (err) {
        console.error('Full page capture error:', err);
        notifyUser('error', 'Full page capture failed.');
    } finally {
        if (activeTab?.id) {
            await waitForRuntimeMessage(
                'SCROLL_DONE',
                () => chrome.tabs.sendMessage(activeTab.id, { type: 'SCROLL_TO', y: originalScrollY }),
                2000
            );
        }
    }
}

export async function handleCaptureArea(activeTab) {
    return await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { type: 'START_CROP_SELECTION' }, () => {
            if (chrome.runtime.lastError) {
                console.error('Failed to start crop selection:', chrome.runtime.lastError);
                resolve(false);
                return;
            }
            resolve(true);
        });
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
        return true;
    }

    return false;
}

export async function handleElementRectCapture(rect, tab, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview) {
    try {
        console.log('[VoiceSnap][Area] capture requested:', rect);

        if (!rect?.viewportWidth || !rect?.viewportHeight) {
            throw new Error('Missing viewport metrics for crop selection');
        }

        let dataUrl = await captureVisibleTab(tab?.windowId ?? null);
        console.log('[VoiceSnap][Area] screenshot captured');
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
        console.log('[VoiceSnap][Area] crop completed');

        await handleProxyCopyToClipboard(croppedDataUrl);
        const entry = await saveToHistory(croppedDataUrl, tab);
        await sendCapturePreview(entry);
        return { dataUrl: croppedDataUrl, entry };
    } catch (err) {
        console.error('Rect capture error:', err);
        throw err;
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

function waitForRuntimeMessage(expectedType, trigger, timeoutMs = 4000) {
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(null);
        }, timeoutMs);

        function listener(message) {
            if (message.type !== expectedType) return;
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(message.metrics || message.result || message);
        }

        chrome.runtime.onMessage.addListener(listener);

        try {
            trigger();
        } catch (error) {
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(null);
        }
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
