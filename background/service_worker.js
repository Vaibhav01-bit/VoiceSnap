// background/service_worker.js - Core logic for VoiceSnap

import { saveToHistory, handleClearScreenshots } from './history.js';
import {
    captureVisibleTab,
    handleCapturePresetRegion,
    handleDownloadScreenshot,
    captureFullPage,
    handleCaptureArea,
    handleCaptureElement,
    handleElementRectCapture
} from './capture.js';
import { notifyUser, sendCapturePreview } from './notify.js';

const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';
const VOICE_TAB_PATH = '/offscreen/voice.html';

let voiceTabId = null;

// ─── Status Manager ───────────────────────────────────────────────────────────
const setStatus = async (listening, error = null) => {
    await chrome.storage.local.set({ isListening: listening, errorState: error });
};

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'VOICE_TAB_READY':
            chrome.runtime.sendMessage({ type: 'START_VOICE_ENGINE' });
            break;
        case 'VOICE_COMMAND':
            if (request.command) {
                handleVoiceCommand(request.command);
            }
            break;
        case 'VOICE_COMMAND_DETECTED':
            console.log('VOICE_COMMAND_DETECTED received:', request.transcript);
            if (request.transcript) {
                console.log('Parsing transcript:', request.transcript);
                handleVoiceCommandFromTranscript(request.transcript);
            } else {
                console.log('No transcript, taking default screenshot');
                handleCaptureScreenshotFlow();
            }
            break;
        case 'VOICE_COMMAND_CAPTURE_MIDDLE':
            handleCapturePresetRegionFlow('middle');
            break;
        case 'VOICE_COMMAND_CAPTURE_LEFT':
            handleCapturePresetRegionFlow('left');
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
            handleProxyCopyToClipboard(request.dataUrl);
            break;
        case 'CROP_REGION_SELECTED':
            if (request.rect && request.viewport && sender.tab) {
                handleElementRectCapture(request.rect, sender.tab, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview);
            }
            break;
        case 'PREVIEW_ACTION':
            handlePreviewAction(request.action, request.payload || {});
            break;
        case 'DOWNLOAD_SCREENSHOT':
            handleDownloadScreenshot(request.dataUrl, request.fileNameHint);
            break;
        case 'CLEAR_SCREENSHOTS':
            handleClearScreenshotsFlow();
            break;
    }
    return false;
});

// ─── Voice Tab Lifecycle ──────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === voiceTabId) {
        voiceTabId = null;
        chrome.storage.local.set({ isListening: false, assistantStatus: 'idle' });
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === voiceTabId && changeInfo.status === 'complete') {
        chrome.runtime.sendMessage({ type: 'START_VOICE_ENGINE' });
    }
});

// ─── Voice Engine Lifecycle ───────────────────────────────────────────────────

function handleVoiceCommand(command) {
    console.log('=== handleVoiceCommand CALLED ===');
    console.log('Intent:', command.intent);
    console.log('Options:', command.options);
    
    const intent = command.intent;
    const options = command.options || {};

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        console.log('Query result - tabs found:', tabs?.length);
        if (!tabs[0]) {
            console.error('No active tab!');
            return;
        }
        const activeTab = tabs[0];
        console.log('Active tab:', activeTab.title);

        switch (intent) {
            case 'capture_full_page':
                console.log('Executing: capture_full_page');
                captureFullPage(notifyUser, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview);
                break;
            case 'capture_area':
                console.log('Executing: capture_area');
                handleCaptureArea(activeTab);
                break;
            case 'capture_element':
                console.log('Executing: capture_element', options.target);
                handleCaptureElement(options.target, activeTab, (rect, tab) =>
                    handleElementRectCapture(rect, tab, handleProxyCopyToClipboard, saveToHistory, sendCapturePreview)
                );
                break;
            case 'capture_region':
                console.log('Executing: capture_region', options.region);
                handleCaptureRegionFlow(options.region);
                break;
            case 'capture_screen':
                console.log('Executing: capture_screen (default)');
                handleCaptureScreenshotFlow();
                break;
            default:
                console.log('Executing: default -> capture_screen');
                handleCaptureScreenshotFlow();
                break;
        }
    });
}

// Parse transcript from manual command triggers (e.g., clicking command tags)
function handleVoiceCommandFromTranscript(transcript) {
    console.log('Parsing command:', transcript);
    // Simplified parsing since we can't import nlp in service worker
    const text = transcript.toLowerCase().trim();
    console.log('Normalized text:', text);
    
    let intent = 'capture_screen';
    let options = {};
    
    // Check for gallery first
    if (text.includes('gallery') || text.includes('screenshots')) {
        console.log('Gallery command detected');
        chrome.runtime.sendMessage({
            type: 'PREVIEW_ACTION',
            action: 'gallery',
            payload: {}
        });
        notifyUser('success', 'Opening gallery...');
        return;
    }
    
    // Full page
    if (text.includes('full page') || text.includes('entire page')) {
        intent = 'capture_full_page';
        console.log('Intent: capture_full_page');
    }
    // Area selection
    else if (text.includes('area') || text.includes('select')) {
        intent = 'capture_area';
        console.log('Intent: capture_area');
    }
    // Region captures
    else if (text.includes('left side') || text === 'capture left' || (text.includes('left') && !text.includes('right'))) {
        intent = 'capture_region';
        options = { region: 'left' };
        console.log('Intent: capture_region left');
    }
    else if (text.includes('right side') || text === 'capture right' || (text.includes('right') && !text.includes('left'))) {
        intent = 'capture_region';
        options = { region: 'right' };
        console.log('Intent: capture_region right');
    }
    else if (text.includes('middle') || text.includes('center')) {
        intent = 'capture_region';
        options = { region: 'middle' };
        console.log('Intent: capture_region middle');
    }
    else if (text.includes('top')) {
        intent = 'capture_region';
        options = { region: 'top' };
        console.log('Intent: capture_region top');
    }
    else if (text.includes('bottom')) {
        intent = 'capture_region';
        options = { region: 'bottom' };
        console.log('Intent: capture_region bottom');
    }
    // Element captures
    else if (text.includes('image') || text.includes('picture')) {
        intent = 'capture_element';
        options = { target: 'image' };
        console.log('Intent: capture_element image');
    }
    else if (text.includes('login') || text.includes('form')) {
        intent = 'capture_element';
        options = { target: 'login_form' };
        console.log('Intent: capture_element login_form');
    }
    else if (text.includes('code')) {
        intent = 'capture_element';
        options = { target: 'code' };
        console.log('Intent: capture_element code');
    }
    else if (text.includes('chart') || text.includes('graph')) {
        intent = 'capture_element';
        options = { target: 'chart' };
        console.log('Intent: capture_element chart');
    }
    else if (text.includes('nav') || text.includes('navigation')) {
        intent = 'capture_element';
        options = { target: 'navbar' };
        console.log('Intent: capture_element navbar');
    }
    else {
        console.log('Intent: capture_screen (default)');
    }
    
    console.log('Executing command with intent:', intent, options);
    handleVoiceCommand({ intent, options });
}

async function handleVoiceListeningEnable() {
    try {
        await setupOffscreenDocument();
        
        if (voiceTabId) {
            try {
                await chrome.tabs.remove(voiceTabId);
            } catch (e) {}
            voiceTabId = null;
        }
        
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
        
        if (voiceTabId) {
            try {
                await chrome.tabs.remove(voiceTabId);
            } catch (e) {}
            voiceTabId = null;
        }
        
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

// ─── Screenshot Pipeline ──────────────────────────────────────────────────────

async function handleCaptureScreenshotFlow() {
    console.log('=== handleCaptureScreenshotFlow START ===');
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('Active tabs:', tabs);
        if (!tabs[0]) {
            console.error('No active tab found!');
            return;
        }

        const activeTab = tabs[0];
        console.log('Capturing tab:', activeTab.title);

        let dataUrl;
        try {
            console.log('Calling captureVisibleTab...');
            dataUrl = await captureVisibleTab();
            console.log('✓ Capture successful, dataUrl length:', dataUrl.length);
        } catch (e) {
            console.error('captureVisibleTab failed:', e);
            notifyUser('error', e.message);
            return;
        }

        console.log('Copying to clipboard...');
        await handleProxyCopyToClipboard(dataUrl);

        console.log('Saving to history...');
        const entry = await saveToHistory(dataUrl, activeTab);
        console.log('Entry saved:', entry);
        
        console.log('Sending preview...');
        await sendCapturePreview(entry);
        console.log('=== handleCaptureScreenshotFlow COMPLETE ===');

    } catch (err) {
        console.error('Pipeline error:', err);
        console.error('Stack trace:', err.stack);
    }
}

async function handleCapturePresetRegionFlow(preset) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;

        const activeTab = tabs[0];

        let dataUrl;
        try {
            dataUrl = await captureVisibleTab();
        } catch (e) {
            notifyUser('error', e.message);
            return;
        }

        const croppedDataUrl = await handleCapturePresetRegion(preset, dataUrl);

        await handleProxyCopyToClipboard(croppedDataUrl);
        const entry = await saveToHistory(croppedDataUrl, activeTab);
        await sendCapturePreview(entry);
    } catch (err) {
        console.error('Preset region capture error:', err);
        notifyUser('error', 'Region capture failed.');
    }
}

async function handleCaptureRegionFlow(region) {
    console.log('=== handleCaptureRegionFlow START ===', region);
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;
        const activeTab = tabs[0];
        console.log('Active tab:', activeTab.title);

        let dataUrl = await captureVisibleTab();
        console.log('✓ Capture successful');
        
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);

        const metrics = await new Promise((resolve) => {
            chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_METRICS' });
            const listener = (request) => {
                if (request.type === 'PAGE_METRICS') {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve(request.metrics);
                }
            };
            chrome.runtime.onMessage.addListener(listener);
        });

        const scaleX = bitmap.width / metrics.viewportWidth;
        const scaleY = bitmap.height / metrics.viewportHeight;

        let x = 0, y = 0, w = metrics.viewportWidth, h = metrics.viewportHeight;

        switch (region) {
            case 'left': w /= 2; break;
            case 'right': x = w / 2; w /= 2; break;
            case 'middle': w *= 0.5; h *= 0.5; x = (metrics.viewportWidth - w) / 2; y = (metrics.viewportHeight - h) / 2; break;
            case 'top': h /= 2; break;
            case 'bottom': y = h / 2; h /= 2; break;
        }

        const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scaleX)), Math.max(1, Math.round(h * scaleY)));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, canvas.width, canvas.height);

        const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
        const croppedDataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(croppedBlob);
        });

        console.log('Cropped image created');
        await handleProxyCopyToClipboard(croppedDataUrl);
        const entry = await saveToHistory(croppedDataUrl, activeTab);
        await sendCapturePreview(entry);
        console.log('=== handleCaptureRegionFlow COMPLETE ===');
    } catch (err) {
        console.error('Region capture error:', err);
        notifyUser('error', 'Region capture failed.');
    }
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

async function handleClearScreenshotsFlow() {
    const res = await handleClearScreenshots();
    if (res.success) {
        notifyUser('success', 'All screenshots deleted');
    } else {
        notifyUser('error', 'Failed to clear screenshots');
    }
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
