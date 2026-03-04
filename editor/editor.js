const urlParams = new URLSearchParams(location.search);
const id = urlParams.get('id');

const baseCanvas = document.getElementById('base');
const overlayCanvas = document.getElementById('overlay');
const baseCtx = baseCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

let currentTool = 'arrow';
let drawing = false;
let startX = 0;
let startY = 0;
let currentText = '';

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

setTool('arrow');

overlayCanvas.addEventListener('mousedown', (e) => {
    drawing = true;
    const rect = overlayCanvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    if (currentTool === 'text') {
        const text = prompt('Text label:');
        if (text) {
            overlayCtx.fillStyle = '#e5e7eb';
            overlayCtx.font = '14px Inter, system-ui, sans-serif';
            overlayCtx.fillText(text, startX + 4, startY + 4);
            commitOverlay();
        }
        drawing = false;
    }
});

overlayCanvas.addEventListener('mousemove', (e) => {
    if (!drawing || currentTool === 'text') return;
    const rect = overlayCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.strokeStyle = currentTool === 'highlight' ? 'rgba(250, 204, 21, 0.8)' : '#22d3ee';
    overlayCtx.lineWidth = currentTool === 'highlight' ? 8 : 3;

    if (currentTool === 'arrow') {
        drawArrow(startX, startY, x, y);
    } else if (currentTool === 'rect' || currentTool === 'highlight' || currentTool === 'blur') {
        const w = x - startX;
        const h = y - startY;
        if (currentTool === 'blur') {
            overlayCtx.fillStyle = 'rgba(15,23,42,0.85)';
            overlayCtx.fillRect(startX, startY, w, h);
        } else {
            overlayCtx.strokeRect(startX, startY, w, h);
            if (currentTool === 'highlight') {
                overlayCtx.fillStyle = 'rgba(250, 204, 21, 0.2)';
                overlayCtx.fillRect(startX, startY, w, h);
            }
        }
    }
});

overlayCanvas.addEventListener('mouseup', () => {
    if (!drawing) return;
    drawing = false;
    commitOverlay();
});

function drawArrow(x1, y1, x2, y2) {
    const headlen = 10;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.moveTo(x2, y2);
    overlayCtx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    overlayCtx.moveTo(x2, y2);
    overlayCtx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    overlayCtx.stroke();
}

function commitOverlay() {
    baseCtx.drawImage(overlayCanvas, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

async function loadScreenshot() {
    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    const entry = screenshots.find(s => String(s.id) === String(id));
    if (!entry) return;

    const img = new Image();
    img.onload = () => {
        baseCanvas.width = img.width;
        baseCanvas.height = img.height;
        overlayCanvas.width = img.width;
        overlayCanvas.height = img.height;
        baseCtx.drawImage(img, 0, 0);
    };
    img.src = entry.imageData;
}

loadScreenshot();

document.getElementById('copy-btn').addEventListener('click', () => {
    const dataUrl = baseCanvas.toDataURL('image/png');
    chrome.runtime.sendMessage({
        type: 'COPY_TO_CLIPBOARD',
        dataUrl
    });
});

document.getElementById('download-btn').addEventListener('click', () => {
    const dataUrl = baseCanvas.toDataURL('image/png');
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SCREENSHOT',
        dataUrl,
        fileNameHint: null
    });
});

