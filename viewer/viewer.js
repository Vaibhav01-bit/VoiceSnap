const params = new URLSearchParams(location.search);
const requestedId = params.get('id');
let currentEntry = null;

const titleNode = document.getElementById('title');
const metaNode = document.getElementById('meta');
const imageNode = document.getElementById('image');
const emptyNode = document.getElementById('empty');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const editBtn = document.getElementById('edit-btn');
const openPageBtn = document.getElementById('open-page-btn');

copyBtn.addEventListener('click', () => {
    if (!currentEntry?.imageData) return;
    chrome.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', dataUrl: currentEntry.imageData });
});

downloadBtn.addEventListener('click', () => {
    if (!currentEntry?.imageData) return;
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_SCREENSHOT', dataUrl: currentEntry.imageData, fileNameHint: null });
});

editBtn.addEventListener('click', () => {
    if (!currentEntry?.id) return;
    const url = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(currentEntry.id)}`);
    chrome.tabs.create({ url });
});

openPageBtn.addEventListener('click', () => {
    if (!currentEntry?.pageUrl) return;
    chrome.tabs.create({ url: currentEntry.pageUrl });
});

void loadEntry();

async function loadEntry() {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    currentEntry = requestedId
        ? screenshots.find((item) => String(item.id) === String(requestedId)) || null
        : screenshots[0] || null;

    if (!currentEntry) {
        renderEmpty('Screenshot not found. Capture something first or reopen this preview from the popup or gallery.');
        return;
    }

    titleNode.textContent = currentEntry.pageTitle || 'Untitled capture';
    metaNode.textContent = [
        currentEntry.captureLabel || 'Visible',
        formatTimestamp(currentEntry.timestamp),
        getDisplayUrl(currentEntry.pageUrl)
    ].filter(Boolean).join(' • ');

    imageNode.src = currentEntry.imageData;
    imageNode.hidden = false;
    emptyNode.hidden = true;
    openPageBtn.disabled = !currentEntry.pageUrl;
}

function renderEmpty(message) {
    titleNode.textContent = 'Preview unavailable';
    metaNode.textContent = 'No capture was available for this preview request.';
    emptyNode.textContent = message;
    emptyNode.hidden = false;
    imageNode.hidden = true;
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    editBtn.disabled = true;
    openPageBtn.disabled = true;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown time';
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function getDisplayUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        const displayPath = parsed.pathname === '/' ? '' : parsed.pathname;
        return `${parsed.hostname}${displayPath}`.slice(0, 80);
    } catch {
        return String(url).slice(0, 80);
    }
}
