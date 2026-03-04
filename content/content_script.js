function showNotification(status, message) {
    let container = document.getElementById('voicesnap-notification');

    if (!container) {
        container = document.createElement('div');
        container.id = 'voicesnap-notification';
        document.body.appendChild(container);
    }

    // Set icons based on status
    const iconHtml = status === 'success'
        ? '<svg class="voicesnap-icon" viewBox="0 0 20 20" fill="#22d3ee"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>'
        : '<svg class="voicesnap-icon" viewBox="0 0 20 20" fill="#ef4444"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>';

    container.innerHTML = `<div class="voicesnap-icon">${iconHtml}</div><span>${message}</span>`;
    container.className = status === 'error' ? 'voicesnap-error' : 'voicesnap-success';

    void container.offsetWidth;
    container.classList.add('voicesnap-show');

    setTimeout(() => {
        container.classList.remove('voicesnap-show');
    }, 4000);
}

let voicesnapCropOverlay = null;
let voicesnapCropBox = null;
let voicesnapCropStartX = 0;
let voicesnapCropStartY = 0;
let voicesnapCropping = false;
let voicesnapHoverTarget = null;
let voicesnapHoverRect = null;
let voicesnapPreviewTimeout = null;

function updateHoverTarget(event) {
    const x = event.clientX;
    const y = event.clientY;
    const el = document.elementFromPoint(x, y);
    if (!el || !(el instanceof Element)) {
        voicesnapHoverTarget = null;
        voicesnapHoverRect = null;
        return;
    }
    voicesnapHoverTarget = el;
    const rect = el.getBoundingClientRect();
    voicesnapHoverRect = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
    };
}

window.addEventListener('mousemove', updateHoverTarget, { passive: true });

function cleanupCropOverlay() {
    if (voicesnapCropOverlay) {
        voicesnapCropOverlay.remove();
    }
    voicesnapCropOverlay = null;
    voicesnapCropBox = null;
    voicesnapCropping = false;
}

function startCropSelection() {
    if (voicesnapCropping) return;
    voicesnapCropping = true;

    cleanupCropOverlay();

    voicesnapCropOverlay = document.createElement('div');
    voicesnapCropOverlay.style.position = 'fixed';
    voicesnapCropOverlay.style.inset = '0';
    voicesnapCropOverlay.style.zIndex = '2147483647';
    voicesnapCropOverlay.style.cursor = 'crosshair';
    voicesnapCropOverlay.style.background = 'rgba(15,23,42,0.25)';
    voicesnapCropOverlay.style.backdropFilter = 'blur(1px)';

    const info = document.createElement('div');
    info.textContent = 'Drag to select area, press Esc to cancel';
    info.style.position = 'fixed';
    info.style.top = '12px';
    info.style.left = '50%';
    info.style.transform = 'translateX(-50%)';
    info.style.padding = '6px 12px';
    info.style.borderRadius = '999px';
    info.style.background = 'rgba(15,23,42,0.85)';
    info.style.color = '#e5e7eb';
    info.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    info.style.fontSize = '12px';
    info.style.boxShadow = '0 10px 30px rgba(0,0,0,0.45)';
    voicesnapCropOverlay.appendChild(info);

    document.body.appendChild(voicesnapCropOverlay);

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        voicesnapCropStartX = e.clientX;
        voicesnapCropStartY = e.clientY;

        if (!voicesnapCropBox) {
            voicesnapCropBox = document.createElement('div');
            voicesnapCropBox.style.position = 'fixed';
            voicesnapCropBox.style.border = '2px solid #22d3ee';
            voicesnapCropBox.style.background = 'rgba(15,23,42,0.25)';
            voicesnapCropBox.style.boxShadow = '0 0 0 1px rgba(15,23,42,0.75), 0 0 32px rgba(34,211,238,0.55)';
            voicesnapCropOverlay.appendChild(voicesnapCropBox);
        }

        const onMouseMove = (event) => {
            const currentX = event.clientX;
            const currentY = event.clientY;

            const left = Math.min(voicesnapCropStartX, currentX);
            const top = Math.min(voicesnapCropStartY, currentY);
            const width = Math.abs(currentX - voicesnapCropStartX);
            const height = Math.abs(currentY - voicesnapCropStartY);

            voicesnapCropBox.style.left = `${left}px`;
            voicesnapCropBox.style.top = `${top}px`;
            voicesnapCropBox.style.width = `${width}px`;
            voicesnapCropBox.style.height = `${height}px`;
        };

        const onMouseUp = (event) => {
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);

            const endX = event.clientX;
            const endY = event.clientY;

            const x = Math.min(voicesnapCropStartX, endX);
            const y = Math.min(voicesnapCropStartY, endY);
            const width = Math.abs(endX - voicesnapCropStartX);
            const height = Math.abs(endY - voicesnapCropStartY);

            cleanupCropOverlay();

            if (width < 5 || height < 5) {
                voicesnapCropping = false;
                return;
            }

            chrome.runtime.sendMessage({
                type: 'CROP_REGION_SELECTED',
                rect: { x, y, width, height },
                viewport: { width: window.innerWidth, height: window.innerHeight }
            });
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', onKeyDown, true);
            voicesnapCropping = false;
            cleanupCropOverlay();
            chrome.runtime.sendMessage({
                type: 'SHOW_NOTIFICATION',
                status: 'error',
                message: 'Crop cancelled'
            });
        }
    };

    voicesnapCropOverlay.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'SHOW_NOTIFICATION') {
        showNotification(request.status, request.message);
    } else if (request.type === 'START_CROP_SELECTION') {
        startCropSelection();
    } else if (request.type === 'GET_PAGE_METRICS') {
        const totalHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
        );
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        chrome.runtime.sendMessage({
            type: 'PAGE_METRICS',
            metrics: {
                totalHeight,
                viewportHeight,
                viewportWidth,
                devicePixelRatio: window.devicePixelRatio || 1
            }
        });
    } else if (request.type === 'SCROLL_TO') {
        const y = request.y || 0;
        window.scrollTo({ top: y, behavior: 'instant' });
        requestAnimationFrame(() => {
            chrome.runtime.sendMessage({ type: 'SCROLL_DONE', y });
        });
    } else if (request.type === 'FIND_ELEMENT') {
        const target = request.target;
        let el = null;

        const isVisible = (elem) => {
            if (!elem || !(elem instanceof Element)) return false;
            const rect = elem.getBoundingClientRect();
            return rect.width > 4 && rect.height > 4 &&
                rect.bottom > 0 && rect.right > 0 &&
                rect.top < window.innerHeight && rect.left < window.innerWidth;
        };

        const pickFirstVisible = (selector) => {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                if (isVisible(node)) return node;
            }
            return nodes[0] || null;
        };

        switch (target) {
            case 'image':
                el = pickFirstVisible('img');
                break;
            case 'login_form':
                el = pickFirstVisible('form input[type=\"password\"], form');
                if (el && el.tagName.toLowerCase() !== 'form') {
                    el = el.closest('form') || el;
                }
                break;
            case 'form':
                el = pickFirstVisible('form');
                break;
            case 'code':
                el = pickFirstVisible('pre, code');
                break;
            case 'chart':
                el = pickFirstVisible('canvas, svg');
                break;
            case 'navbar':
                el = pickFirstVisible('nav, header, [role=\"navigation\"]');
                break;
            default:
                break;
        }

        if (el) {
            const rect = el.getBoundingClientRect();
            chrome.runtime.sendMessage({
                type: 'ELEMENT_FOUND',
                result: {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                }
            });
        } else {
            chrome.runtime.sendMessage({
                type: 'ELEMENT_FOUND',
                result: null
            });
        }
    } else if (request.type === 'HOVER_TARGET') {
        chrome.runtime.sendMessage({
            type: 'HOVER_TARGET_RESULT',
            result: voicesnapHoverRect
        });
    } else if (request.type === 'SHOW_CAPTURE_PREVIEW' && request.preview) {
        const existing = document.getElementById('voicesnap-preview');
        if (existing) existing.remove();

        const preview = document.createElement('div');
        preview.id = 'voicesnap-preview';
        preview.style.position = 'fixed';
        preview.style.right = '16px';
        preview.style.bottom = '16px';
        preview.style.zIndex = '2147483647';
        preview.style.background = 'rgba(15,23,42,0.95)';
        preview.style.borderRadius = '12px';
        preview.style.border = '1px solid rgba(148,163,184,0.4)';
        preview.style.boxShadow = '0 20px 40px rgba(0,0,0,0.45)';
        preview.style.padding = '10px';
        preview.style.width = '220px';
        preview.style.color = '#e5e7eb';
        preview.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        preview.style.fontSize = '11px';
        preview.style.display = 'flex';
        preview.style.flexDirection = 'column';
        preview.style.gap = '8px';

        const header = document.createElement('div');
        header.textContent = 'Screenshot captured';
        header.style.fontWeight = '600';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.border = 'none';
        closeBtn.style.background = 'transparent';
        closeBtn.style.color = '#9ca3af';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '14px';
        closeBtn.onclick = () => {
            if (voicesnapPreviewTimeout) clearTimeout(voicesnapPreviewTimeout);
            preview.remove();
        };
        header.appendChild(closeBtn);

        const thumb = document.createElement('img');
        thumb.src = request.preview.imageData;
        thumb.style.width = '100%';
        thumb.style.borderRadius = '8px';
        thumb.style.maxHeight = '120px';
        thumb.style.objectFit = 'cover';

        const buttons = document.createElement('div');
        buttons.style.display = 'grid';
        buttons.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        buttons.style.gap = '6px';

        const mkBtn = (label) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.fontSize = '11px';
            btn.style.borderRadius = '999px';
            btn.style.border = '1px solid rgba(148,163,184,0.5)';
            btn.style.background = 'rgba(15,23,42,0.9)';
            btn.style.color = '#e5e7eb';
            btn.style.padding = '4px 8px';
            btn.style.cursor = 'pointer';
            btn.onmouseenter = () => { btn.style.borderColor = '#22d3ee'; };
            btn.onmouseleave = () => { btn.style.borderColor = 'rgba(148,163,184,0.5)'; };
            return btn;
        };

        const copyBtn = mkBtn('Copy');
        const downloadBtn = mkBtn('Download');
        const editBtn = mkBtn('Edit');
        const galleryBtn = mkBtn('Open Gallery');

        copyBtn.onclick = () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'copy',
                payload: { dataUrl: request.preview.imageData }
            });
        };

        downloadBtn.onclick = () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'download',
                payload: {
                    dataUrl: request.preview.imageData,
                    fileNameHint: null
                }
            });
        };

        editBtn.onclick = () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'edit',
                payload: { id: request.preview.id }
            });
        };

        galleryBtn.onclick = () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'gallery',
                payload: {}
            });
        };

        buttons.appendChild(copyBtn);
        buttons.appendChild(downloadBtn);
        buttons.appendChild(editBtn);
        buttons.appendChild(galleryBtn);

        preview.appendChild(header);
        preview.appendChild(thumb);
        preview.appendChild(buttons);

        document.body.appendChild(preview);

        if (voicesnapPreviewTimeout) clearTimeout(voicesnapPreviewTimeout);
        voicesnapPreviewTimeout = setTimeout(() => {
            preview.remove();
        }, 5000);
    }
});
