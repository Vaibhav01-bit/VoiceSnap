// background/notify.js - Messaging to content scripts

export function notifyUser(status, message) {
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

export async function sendCapturePreview(entry) {
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
