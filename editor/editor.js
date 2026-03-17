const urlParams = new URLSearchParams(location.search);
const sourceId = urlParams.get('id');

const baseCanvas = document.getElementById('base');
const overlayCanvas = document.getElementById('overlay');
const baseCtx = baseCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');
const colorPicker = document.getElementById('color-picker');
const textInput = document.getElementById('text-value');

let currentTool = 'arrow';
let drawing = false;
let startX = 0;
let startY = 0;
let originalImageDataUrl = '';
let historyStack = [];
let historyIndex = -1;

document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
});

document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('reset-btn').addEventListener('click', resetCanvas);
document.getElementById('copy-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({
        type: 'COPY_TO_CLIPBOARD',
        dataUrl: baseCanvas.toDataURL('image/png')
    });
});
document.getElementById('download-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SCREENSHOT',
        dataUrl: baseCanvas.toDataURL('image/png'),
        fileNameHint: null
    });
});
document.getElementById('save-version-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({
        type: 'SAVE_EDITED_SCREENSHOT',
        dataUrl: baseCanvas.toDataURL('image/png'),
        sourceId
    });
});

document.addEventListener('keydown', (event) => {
    const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
    if (isUndo) {
        event.preventDefault();
        undo();
        return;
    }

    if (event.key === 'Escape') {
        drawing = false;
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
});

overlayCanvas.addEventListener('mousedown', (event) => {
    if (!baseCanvas.width || !baseCanvas.height) return;

    const point = getCanvasPoint(event);
    startX = point.x;
    startY = point.y;
    drawing = true;

    if (currentTool === 'text') {
        const text = (textInput.value || 'Note').trim();
        if (text) {
            overlayCtx.fillStyle = colorPicker.value;
            overlayCtx.font = 'bold 28px "Space Grotesk", sans-serif';
            overlayCtx.fillText(text, startX + 6, startY + 30);
            commitOverlay();
        }
        drawing = false;
    }
});

overlayCanvas.addEventListener('mousemove', (event) => {
    if (!drawing || currentTool === 'text') return;

    const point = getCanvasPoint(event);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.strokeStyle = colorPicker.value;
    overlayCtx.fillStyle = colorPicker.value;
    overlayCtx.lineWidth = currentTool === 'highlight' ? 10 : 4;
    overlayCtx.lineJoin = 'round';
    overlayCtx.lineCap = 'round';

    if (currentTool === 'arrow') {
        drawArrow(startX, startY, point.x, point.y);
        return;
    }

    const width = point.x - startX;
    const height = point.y - startY;

    if (currentTool === 'blur') {
        overlayCtx.fillStyle = 'rgba(2, 6, 23, 0.88)';
        overlayCtx.fillRect(startX, startY, width, height);
        return;
    }

    if (currentTool === 'highlight') {
        overlayCtx.fillStyle = `${hexToRgba(colorPicker.value, 0.18)}`;
        overlayCtx.fillRect(startX, startY, width, height);
    }

    overlayCtx.strokeRect(startX, startY, width, height);
});

overlayCanvas.addEventListener('mouseup', () => {
    if (!drawing) return;
    drawing = false;
    commitOverlay();
});

setTool('arrow');
void loadScreenshot();

async function loadScreenshot() {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    const entry = screenshots.find((item) => String(item.id) === String(sourceId));
    if (!entry) return;

    originalImageDataUrl = entry.imageData;
    await drawDataUrl(entry.imageData);
    pushHistory();
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('[data-tool]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === tool);
    });
}

function getCanvasPoint(event) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}

function drawArrow(x1, y1, x2, y2) {
    const head = 16;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();

    overlayCtx.beginPath();
    overlayCtx.moveTo(x2, y2);
    overlayCtx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    overlayCtx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    overlayCtx.closePath();
    overlayCtx.fill();
}

function commitOverlay() {
    baseCtx.drawImage(overlayCanvas, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    pushHistory();
}

function pushHistory() {
    const snapshot = baseCanvas.toDataURL('image/png');
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snapshot);
    historyIndex = historyStack.length - 1;
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    void drawDataUrl(historyStack[historyIndex], { preserveHistory: true });
}

function resetCanvas() {
    if (!originalImageDataUrl) return;
    historyStack = [];
    historyIndex = -1;
    void drawDataUrl(originalImageDataUrl).then(() => pushHistory());
}

async function drawDataUrl(dataUrl, options = {}) {
    const image = await loadImage(dataUrl);
    baseCanvas.width = image.width;
    baseCanvas.height = image.height;
    overlayCanvas.width = image.width;
    overlayCanvas.height = image.height;
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    baseCtx.drawImage(image, 0, 0);

    if (!options.preserveHistory) {
        historyStack = [];
        historyIndex = -1;
    }
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
    });
}

function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const value = clean.length === 3
        ? clean.split('').map((char) => `${char}${char}`).join('')
        : clean;

    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
