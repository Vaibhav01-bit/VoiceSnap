import { copyToClipboard } from '../clipboard/clipboard.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== 'OFFSCREEN_COPY_TO_CLIPBOARD') {
        return false;
    }

    copyToClipboard(request.dataUrl)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
            console.error('Offscreen clipboard error:', error);
            sendResponse({ success: false, error: error.message });
        });

    return true;
});
