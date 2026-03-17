import {
    captureVisibleTab,
    captureFullPage,
    handleCaptureArea,
    handleCaptureElement,
    handleDownloadScreenshot,
    handleElementRectCapture,
    buildScreenshotFileName
} from './capture.js';
import {
    deleteScreenshot,
    getScreenshotById,
    handleClearScreenshots,
    saveToHistory,
    toggleFavoriteScreenshot
} from './history.js';
import { notifyUser, sendCapturePreview } from './notify.js';
import { normalizeTranscript, parseCommandText } from '../shared/command_matcher.js';

const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';
const VOICE_TAB_PATH = '/offscreen/voice.html';
const DEFAULT_CAPTURE_SETTINGS = {
    autoCopy: true,
    showPreview: true,
    closePopupAfterAction: false
};

let voiceTabId = null;
let voiceStartRequested = false;

chrome.runtime.onInstalled.addListener(async () => {
    const { captureSettings, recentCommands } = await chrome.storage.local.get([
        'captureSettings',
        'recentCommands'
    ]);

    await chrome.storage.local.set({
        captureSettings: { ...DEFAULT_CAPTURE_SETTINGS, ...(captureSettings || {}) },
        recentCommands: Array.isArray(recentCommands) ? recentCommands : []
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== voiceTabId) return;
    voiceTabId = null;
    voiceStartRequested = false;
    void chrome.storage.local.set({ isListening: false, assistantStatus: 'idle' });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== voiceTabId || changeInfo.status !== 'complete' || !voiceStartRequested) return;
    void handleVoiceTabReady(tabId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'VOICE_TAB_READY':
            void handleVoiceTabReady(sender.tab?.id || null);
            return false;
        case 'START_VOICE':
            void handleVoiceListeningEnable();
            return false;
        case 'VOICE_COMMAND':
            void handleVoiceCommand(request.command);
            return false;
        case 'VOICE_COMMAND_DETECTED':
            void handleVoiceCommandFromTranscript(request.transcript || '');
            return false;
        case 'EXECUTE_COMMAND_TEXT':
            void handleVoiceCommandFromTranscript(request.text || '');
            return false;
        case 'EXECUTE_CAPTURE_ACTION':
            void handleCaptureAction(request.action, request.options || {});
            return false;
        case 'VOICE_COMMAND_CAPTURE_MIDDLE':
            void handleCaptureRegionFlow('middle');
            return false;
        case 'VOICE_COMMAND_CAPTURE_LEFT':
            void handleCaptureRegionFlow('left');
            return false;
        case 'VOICE_LISTENING_ENABLE':
            void handleVoiceListeningEnable();
            return false;
        case 'VOICE_LISTENING_DISABLE':
            void handleVoiceListeningDisable();
            return false;
        case 'UPDATE_STATE':
            void chrome.storage.local.set(request.payload || {});
            return false;
        case 'COPY_TO_CLIPBOARD':
            void handlePublicCopyToClipboard(request.dataUrl, sendResponse);
            return true;
        case 'CROP_REGION_SELECTED':
            if (request.rect && sender.tab) {
                void handleSelectedAreaCapture(request.rect, sender.tab, sendResponse);
                return true;
            }
            sendResponse({ success: false, error: 'Missing crop selection payload.' });
            return true;
        case 'HOVER_CAPTURE_SELECTED':
            if (request.rect && sender.tab) {
                void handleHoveredSelectionCapture(request.rect, sender.tab, sendResponse);
                return true;
            }
            sendResponse({ success: false, error: 'Missing hovered element payload.' });
            return true;
        case 'PREVIEW_ACTION':
            void handlePreviewAction(request.action, request.payload || {});
            return false;
        case 'DOWNLOAD_SCREENSHOT':
            handleDownloadScreenshot(request.dataUrl, request.fileNameHint);
            return false;
        case 'CLEAR_SCREENSHOTS':
            void handleClearScreenshotsFlow();
            return false;
        case 'DELETE_SCREENSHOT':
            void deleteScreenshotRequest(request.id, sendResponse);
            return true;
        case 'TOGGLE_FAVORITE_SCREENSHOT':
            void toggleFavoriteRequest(request.id, sendResponse);
            return true;
        case 'SAVE_EDITED_SCREENSHOT':
            void handleSaveEditedScreenshot(request.dataUrl, request.sourceId, sendResponse);
            return true;
        default:
            return false;
    }
});

async function deleteScreenshotRequest(id, sendResponse) {
    try {
        await deleteScreenshot(id);
        sendResponse({ success: true });
    } catch (error) {
        console.error('Delete screenshot failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function toggleFavoriteRequest(id, sendResponse) {
    try {
        const item = await toggleFavoriteScreenshot(id);
        sendResponse({ success: true, item });
    } catch (error) {
        console.error('Toggle favorite failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSaveEditedScreenshot(dataUrl, sourceId, sendResponse) {
    try {
        if (!dataUrl) {
            sendResponse({ success: false, error: 'Missing edited image data.' });
            return;
        }

        const source = sourceId ? await getScreenshotById(sourceId) : null;
        const baseTitle = source?.pageTitle || 'Edited capture';
        const entry = await finalizeCapturedImage(
            dataUrl,
            {
                url: source?.pageUrl || '',
                title: `${baseTitle} (Edited)`
            },
            {
                captureMode: 'edited',
                captureLabel: 'Edited',
                isEdited: true
            }
        );

        sendResponse({ success: true, entry });
    } catch (error) {
        console.error('Save edited screenshot failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handlePublicCopyToClipboard(dataUrl, sendResponse) {
    try {
        const success = await handleProxyCopyToClipboard(dataUrl);
        sendResponse({ success });
    } catch (error) {
        console.error('Clipboard copy failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleVoiceListeningEnable() {
    try {
        await setupOffscreenDocument();
        voiceStartRequested = true;
        await ensureVoiceTab();
        await chrome.storage.local.set({
            isListening: false,
            errorState: null,
            assistantStatus: 'processing'
        });
    } catch (error) {
        console.error('Failed to enable voice listening:', error);
        await chrome.storage.local.set({
            isListening: false,
            assistantStatus: 'idle',
            errorState: 'Unable to start voice engine. Open the permission helper, allow the microphone, then try again.'
        });
    }
}

async function handleVoiceListeningDisable() {
    try {
        voiceStartRequested = false;
        await chrome.runtime.sendMessage({ type: 'STOP_VOICE_ENGINE' });

        if (voiceTabId) {
            try {
                await chrome.tabs.remove(voiceTabId);
            } catch (error) {
                console.warn('Unable to close voice tab:', error);
            }
            voiceTabId = null;
        }

        await chrome.storage.local.set({ isListening: false, assistantStatus: 'idle', errorState: null });
    } catch (error) {
        console.error('Failed to disable voice listening:', error);
        await chrome.storage.local.set({ isListening: false, assistantStatus: 'idle', errorState: 'Unable to stop voice engine.' });
    }
}

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

async function ensureVoiceTab() {
    if (voiceTabId) {
        try {
            const existing = await chrome.tabs.get(voiceTabId);
            if (existing?.id) {
                await chrome.runtime.sendMessage({ type: 'START_VOICE_ENGINE' });
                return existing.id;
            }
        } catch (error) {
            voiceTabId = null;
        }
    }

    const tab = await chrome.tabs.create({
        url: chrome.runtime.getURL(VOICE_TAB_PATH),
        active: false,
        pinned: true
    });

    voiceTabId = tab.id || null;
    return voiceTabId;
}

async function handleVoiceTabReady(tabId) {
    if (tabId) {
        voiceTabId = tabId;
    }

    if (!voiceStartRequested) return;

    try {
        await chrome.runtime.sendMessage({ type: 'START_VOICE_ENGINE' });
    } catch (error) {
        console.error('Voice tab failed to start:', error);
        await chrome.storage.local.set({
            isListening: false,
            assistantStatus: 'idle',
            errorState: 'Unable to start voice engine. Check microphone permission and try again.'
        });
    }
}

async function getCaptureSettings() {
    const { captureSettings = {} } = await chrome.storage.local.get(['captureSettings']);
    return { ...DEFAULT_CAPTURE_SETTINGS, ...captureSettings };
}

async function setAssistantProcessing() {
    await chrome.storage.local.set({ assistantStatus: 'processing', errorState: null });
}

async function resetAssistantStatus() {
    const { isListening = false } = await chrome.storage.local.get(['isListening']);
    await chrome.storage.local.set({ assistantStatus: isListening ? 'listening' : 'idle' });
}

function buildCaptureMeta(mode, label, extra = {}) {
    return {
        captureMode: mode,
        captureLabel: label,
        ...extra
    };
}

function inferDownloadName(entry) {
    if (!entry?.imageData) return null;
    const extension = entry.imageData.startsWith('data:image/jpeg') ? 'jpg'
        : entry.imageData.startsWith('data:image/webp') ? 'webp'
            : 'png';
    return buildScreenshotFileName(entry.pageTitle || 'voicesnap', entry.timestamp || Date.now(), extension);
}

async function finalizeCapturedImage(dataUrl, tab, meta) {
    const settings = await getCaptureSettings();

    if (settings.autoCopy) {
        await handleProxyCopyToClipboard(dataUrl, { silent: true });
    }

    const entry = await saveToHistory(dataUrl, tab, meta);

    if (settings.showPreview) {
        await sendCapturePreview(entry);
    } else {
        notifyUser('success', settings.autoCopy ? 'Screenshot copied to clipboard' : 'Screenshot saved to history');
    }

    return entry;
}

async function handleCaptureScreenshotFlow(meta = buildCaptureMeta('visible', 'Visible')) {
    await setAssistantProcessing();

    try {
        const activeTab = await getActiveTab();
        if (!activeTab) {
            notifyUser('error', 'No active tab found.');
            return;
        }

        const dataUrl = await captureVisibleTab(activeTab.windowId ?? null);
        await finalizeCapturedImage(dataUrl, activeTab, meta);
    } catch (error) {
        console.error('Visible capture failed:', error);
        notifyUser('error', error.message || 'Capture failed.');
    } finally {
        await resetAssistantStatus();
    }
}

async function handleCaptureRegionFlow(region) {
    await setAssistantProcessing();

    try {
        const activeTab = await getActiveTab();
        if (!activeTab?.id) {
            notifyUser('error', 'No active tab found.');
            return;
        }

        const dataUrl = await captureVisibleTab(activeTab.windowId ?? null);
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        const metrics = await requestRuntimeResult(
            'PAGE_METRICS',
            () => chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_METRICS' })
        );

        if (!metrics) {
            notifyUser('error', 'Unable to read page metrics.');
            return;
        }

        const scaleX = bitmap.width / metrics.viewportWidth;
        const scaleY = bitmap.height / metrics.viewportHeight;

        let x = 0;
        let y = 0;
        let width = metrics.viewportWidth;
        let height = metrics.viewportHeight;

        switch (region) {
            case 'left':
                width /= 2;
                break;
            case 'right':
                x = width / 2;
                width /= 2;
                break;
            case 'middle':
                width *= 0.5;
                height *= 0.5;
                x = (metrics.viewportWidth - width) / 2;
                y = (metrics.viewportHeight - height) / 2;
                break;
            case 'top':
                height /= 2;
                break;
            case 'bottom':
                y = height / 2;
                height /= 2;
                break;
            default:
                break;
        }

        const canvas = new OffscreenCanvas(
            Math.max(1, Math.round(width * scaleX)),
            Math.max(1, Math.round(height * scaleY))
        );
        const context = canvas.getContext('2d');
        context.drawImage(
            bitmap,
            x * scaleX,
            y * scaleY,
            width * scaleX,
            height * scaleY,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const croppedDataUrl = await blobToDataUrl(croppedBlob);
        await finalizeCapturedImage(
            croppedDataUrl,
            activeTab,
            buildCaptureMeta('region', `Region: ${capitalize(region)}`, { region })
        );
    } catch (error) {
        console.error('Region capture failed:', error);
        notifyUser('error', 'Region capture failed.');
    } finally {
        await resetAssistantStatus();
    }
}

async function handleSelectedAreaCapture(rect, tab, sendResponse) {
    await setAssistantProcessing();

    try {
        console.log('[VoiceSnap][Area] background received selection:', rect);

        const result = await handleElementRectCapture(
            rect,
            tab,
            maybeCopyToClipboard,
            (dataUrl, sourceTab) => saveToHistory(
                dataUrl,
                sourceTab,
                buildCaptureMeta('area', 'Area')
            ),
            maybeSendCapturePreview
        );
        sendResponse({ success: true, dataUrl: result?.dataUrl || null, entryId: result?.entry?.id || null });
    } catch (error) {
        console.error('Selected area capture failed:', error);
        notifyUser('error', 'Area capture failed.');
        sendResponse({ success: false, error: error.message || 'Area capture failed.' });
    } finally {
        await resetAssistantStatus();
    }
}

async function maybeCopyToClipboard(dataUrl) {
    const settings = await getCaptureSettings();
    if (!settings.autoCopy) return true;
    return handleProxyCopyToClipboard(dataUrl, { silent: true });
}

async function maybeSendCapturePreview(entry) {
    const settings = await getCaptureSettings();
    if (settings.showPreview) {
        await sendCapturePreview(entry);
    } else {
        notifyUser('success', settings.autoCopy ? 'Screenshot copied to clipboard' : 'Screenshot saved to history');
    }
}

async function handleProxyCopyToClipboard(dataUrl, options = {}) {
    if (!dataUrl) return false;

    const { silent = false } = options;

    try {
        await setupOffscreenDocument();
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'OFFSCREEN_COPY_TO_CLIPBOARD',
                    dataUrl
                },
                (result) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    resolve(result);
                }
            );
        });

        const success = Boolean(response?.success);
        if (!silent && success) {
            notifyUser('success', 'Copied to clipboard');
        }
        if (!success) {
            notifyUser('error', response?.error || 'Clipboard copy failed');
        }
        return success;
    } catch (error) {
        console.error('Clipboard proxy failed:', error);
        notifyUser('error', 'Clipboard copy failed');
        return false;
    }
}

async function handleClearScreenshotsFlow() {
    const result = await handleClearScreenshots();
    notifyUser(result.success ? 'success' : 'error', result.success ? 'All screenshots deleted' : 'Failed to clear screenshots');
}

async function handlePreviewAction(action, payload) {
    switch (action) {
        case 'copy':
            if (payload.dataUrl) {
                await handleProxyCopyToClipboard(payload.dataUrl);
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
        case 'preview':
            {
                const query = payload.id ? `?id=${encodeURIComponent(payload.id)}` : '';
                const url = chrome.runtime.getURL(`viewer/viewer.html${query}`);
                chrome.tabs.create({ url });
            }
            break;
        case 'gallery':
            chrome.tabs.create({ url: chrome.runtime.getURL('popup/gallery.html') });
            break;
        default:
            break;
    }
}

async function handleCaptureAction(action, options = {}) {
    console.log('[VoiceSnap][QuickCapture] action:', action, options);

    switch (action) {
        case 'capture_visible':
            await handleCaptureScreenshotFlow(buildCaptureMeta('visible', 'Visible'));
            break;
        case 'capture_full_page':
            await handleVoiceCommand({ intent: 'capture_full_page', options: {} });
            break;
        case 'capture_area':
            await handleVoiceCommand({ intent: 'capture_area', options: {} });
            break;
        case 'capture_left':
            await handleCaptureRegionFlow('left');
            break;
        case 'capture_right':
            await handleCaptureRegionFlow('right');
            break;
        case 'capture_middle':
            await handleCaptureRegionFlow('middle');
            break;
        case 'capture_top':
            await handleCaptureRegionFlow('top');
            break;
        case 'capture_bottom':
            await handleCaptureRegionFlow('bottom');
            break;
        case 'capture_image':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'image' } });
            break;
        case 'capture_form':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'login_form' } });
            break;
        case 'capture_code':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'code' } });
            break;
        case 'capture_chart':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'chart' } });
            break;
        case 'capture_nav':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'navbar' } });
            break;
        case 'capture_hover':
            await handleVoiceCommand({ intent: 'capture_element', options: { target: 'hover' } });
            break;
        case 'gallery':
            await handlePreviewAction('gallery', {});
            break;
        case 'copy_last':
            await handleLastScreenshotAction('copy');
            break;
        case 'download_last':
            await handleLastScreenshotAction('download');
            break;
        case 'edit_last':
            await handleLastScreenshotAction('edit');
            break;
        case 'preview_last':
            await handleLastScreenshotAction('preview');
            break;
        case 'clear_history':
            await handleClearScreenshotsFlow();
            break;
        default:
            break;
    }
}

async function handleLastScreenshotAction(action) {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    const last = screenshots[0];

    if (!last) {
        notifyUser('error', 'No screenshots in history yet.');
        return;
    }

    switch (action) {
        case 'copy':
            await handleProxyCopyToClipboard(last.imageData);
            break;
        case 'download':
            handleDownloadScreenshot(last.imageData, inferDownloadName(last));
            break;
        case 'edit':
            await handlePreviewAction('edit', { id: last.id });
            break;
        case 'preview':
            await handlePreviewAction('preview', { id: last.id });
            break;
        default:
            break;
    }
}

async function handleVoiceCommand(command) {
    if (!command?.intent) return;

    const { intent, options = {} } = command;
    console.log('[VoiceSnap][Voice] feature triggered:', intent, options);
    await setAssistantProcessing();

    try {
        const activeTab = await getActiveTab();

        switch (intent) {
            case 'stop_listening':
                await handleVoiceListeningDisable();
                break;
            case 'capture_full_page':
                if (!activeTab) {
                    notifyUser('error', 'No active tab found.');
                    break;
                }
                if (!await ensureContentScript(activeTab)) {
                    notifyUser('error', 'This page does not allow advanced capture commands. Refresh the page or try a regular website.');
                    break;
                }
                await captureFullPage(
                    notifyUser,
                    maybeCopyToClipboard,
                    (dataUrl, tab) => saveToHistory(
                        dataUrl,
                        tab,
                        buildCaptureMeta('full_page', 'Full page')
                    ),
                    maybeSendCapturePreview,
                    activeTab
                );
                break;
            case 'capture_area':
                if (!activeTab) {
                    notifyUser('error', 'No active tab found.');
                    break;
                }
                if (!await ensureContentScript(activeTab)) {
                    notifyUser('error', 'This page does not allow area selection. Refresh the page or try a regular website.');
                    break;
                }
                if (await handleCaptureArea(activeTab)) {
                    notifyUser('success', 'Drag on the page to select an area.');
                } else {
                    notifyUser('error', 'Area selection is not available on this page.');
                }
                break;
            case 'capture_element':
                if (!activeTab) {
                    notifyUser('error', 'No active tab found.');
                    break;
                }
                if (!await ensureContentScript(activeTab)) {
                    notifyUser('error', 'This page does not allow element capture. Refresh the page or try a regular website.');
                    break;
                }
                if (options.target === 'hover') {
                    await handleHoverElementCapture(activeTab);
                    break;
                }
                const found = await handleCaptureElement(
                    options.target,
                    activeTab,
                    (rect, tab) => handleElementRectCapture(
                        rect,
                        tab,
                        maybeCopyToClipboard,
                        (dataUrl, sourceTab) => saveToHistory(
                            dataUrl,
                            sourceTab,
                            buildCaptureMeta('element', `Element: ${elementLabel(options.target)}`)
                        ),
                        maybeSendCapturePreview
                    )
                );
                if (!found) {
                    notifyUser('error', 'No matching element found on this page.');
                }
                break;
            case 'capture_region':
                if (!activeTab) {
                    notifyUser('error', 'No active tab found.');
                    break;
                }
                if (!await ensureContentScript(activeTab)) {
                    notifyUser('error', 'This page does not allow region capture. Refresh the page or try a regular website.');
                    break;
                }
                await handleCaptureRegionFlow(options.region || 'middle');
                break;
            case 'open_gallery':
                await handlePreviewAction('gallery', {});
                break;
            case 'copy_last':
                await handleLastScreenshotAction('copy');
                break;
            case 'download_last':
                await handleLastScreenshotAction('download');
                break;
            case 'edit_last':
                await handleLastScreenshotAction('edit');
                break;
            case 'preview_last':
                await handleLastScreenshotAction('preview');
                break;
            case 'clear_history':
                await handleClearScreenshotsFlow();
                break;
            case 'record_start':
            case 'record_stop':
                notifyUser('error', 'Screen recording is not available yet in this extension.');
                break;
            case 'timer_capture':
                setTimeout(() => {
                    const mode = options.mode || 'screen';
                    if (mode === 'full page') {
                        void handleVoiceCommand({ intent: 'capture_full_page', options: {} });
                    } else if (mode === 'area') {
                        void handleVoiceCommand({ intent: 'capture_area', options: {} });
                    } else {
                        void handleCaptureScreenshotFlow(buildCaptureMeta('timer', 'Timed capture'));
                    }
                }, Number(options.delayMs) || 3000);
                break;
            case 'capture_screen':
            default:
                await handleCaptureScreenshotFlow(buildCaptureMeta('visible', 'Visible'));
                break;
        }
    } catch (error) {
        console.error('Voice command failed:', error);
        notifyUser('error', error.message || 'Command failed.');
    } finally {
        await resetAssistantStatus();
    }
}

async function handleHoverElementCapture(activeTab) {
    if (!await ensureContentScript(activeTab)) {
        notifyUser('error', 'This page does not allow hover capture. Refresh the page or try a regular website.');
        return;
    }

    chrome.tabs.sendMessage(activeTab.id, { type: 'START_HOVER_CAPTURE_SELECTION' }, () => {
        if (chrome.runtime.lastError) {
            notifyUser('error', 'Hovered element capture is not available on this page.');
            return;
        }
        notifyUser('success', 'Hover over an element and click to capture it.');
    });
}

async function handleHoveredSelectionCapture(rect, tab, sendResponse) {
    await setAssistantProcessing();

    try {
        const result = await handleElementRectCapture(
            rect,
            tab,
            maybeCopyToClipboard,
            (dataUrl, sourceTab) => saveToHistory(
                dataUrl,
                sourceTab,
                buildCaptureMeta('element', 'Element: Hover target')
            ),
            maybeSendCapturePreview
        );
        sendResponse({ success: true, dataUrl: result?.dataUrl || null, entryId: result?.entry?.id || null });
    } catch (error) {
        console.error('Hovered selection capture failed:', error);
        notifyUser('error', 'Hovered element capture failed.');
        sendResponse({ success: false, error: error.message || 'Hovered element capture failed.' });
    } finally {
        await resetAssistantStatus();
    }
}

async function handleVoiceCommandFromTranscript(transcript) {
    const normalized = normalizeTranscript(transcript);
    console.log('[VoiceSnap][Voice] voice detected:', transcript);
    console.log('[VoiceSnap][Voice] normalized:', normalized);

    if (!normalized) {
        await resetAssistantStatus();
        return;
    }

    const command = parseCommandText(normalized);
    console.log('[VoiceSnap][Voice] command matched:', command);

    if (command) {
        await handleVoiceCommand(command);
        return;
    }

    notifyUser('error', 'Command not recognized. Try "visible tab", "full page", "select area", or "hovered element".');
    await resetAssistantStatus();
}

async function getActiveTab() {
    const candidates = [];
    const seen = new Set();

    const pushTabs = (tabs = []) => {
        tabs.forEach((tab) => {
            if (!tab?.id || seen.has(tab.id)) return;
            seen.add(tab.id);
            candidates.push(tab);
        });
    };

    pushTabs(await chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    pushTabs(await chrome.tabs.query({ active: true, currentWindow: true }));
    pushTabs(await chrome.tabs.query({ active: true }));

    const preferred = candidates.find((tab) => isScriptableTab(tab.url));
    return preferred || candidates[0] || null;
}

async function ensureContentScript(tab) {
    if (!tab?.id || !isScriptableTab(tab.url)) {
        return false;
    }

    await waitForTabComplete(tab.id);

    const ready = await pingContentScript(tab.id);
    if (ready) {
        return true;
    }

    try {
        await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['styles/notification.css']
        });
    } catch (error) {
        // CSS may already be present or the page may reject style injection.
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content_script.js']
        });
    } catch (error) {
        console.error('Failed to inject content script:', error);
        return false;
    }

    await delay(75);
    return await pingContentScript(tab.id);
}

async function pingContentScript(tabId) {
    return await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
            if (chrome.runtime.lastError) {
                resolve(false);
                return;
            }
            resolve(Boolean(response?.ok));
        });
    });
}

function isScriptableTab(url) {
    if (!url) return false;
    return /^(https?:|file:)/i.test(url);
}

async function waitForTabComplete(tabId, timeoutMs = 2500) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === 'complete') {
            return true;
        }
    } catch (error) {
        return false;
    }

    return await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(true);
        }

        chrome.tabs.onUpdated.addListener(listener);
    });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestRuntimeResult(expectedType, trigger, timeoutMs = 4000) {
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

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function elementLabel(target) {
    switch (target) {
        case 'login_form':
            return 'Login form';
        case 'navbar':
            return 'Navigation';
        default:
            return capitalize(target || 'Element');
    }
}
