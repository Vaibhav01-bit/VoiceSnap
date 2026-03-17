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
let voicesnapCropInfo = null;
let voicesnapCropMeasure = null;
let voicesnapCropRestoreStyles = null;
let voicesnapCropStartX = 0;
let voicesnapCropStartY = 0;
let voicesnapCropping = false;
let voicesnapHoverTarget = null;
let voicesnapHoverRect = null;
let voicesnapPreviewTimeout = null;
let voicesnapHoverCaptureActive = false;
let voicesnapHoverCaptureOutline = null;
let voicesnapHoverCaptureInfo = null;

function logAreaStep(step, payload) {
    if (payload === undefined) {
        console.log(`[VoiceSnap][Area] ${step}`);
        return;
    }
    console.log(`[VoiceSnap][Area] ${step}:`, payload);
}

function updateHoverTarget(event) {
    const x = event.clientX;
    const y = event.clientY;
    const el = getSelectableElementAtPoint(x, y);
    if (!el || !(el instanceof Element)) {
        voicesnapHoverTarget = null;
        voicesnapHoverRect = null;
        return;
    }
    voicesnapHoverTarget = el;
    voicesnapHoverRect = rectFromElement(el);
}

window.addEventListener('mousemove', updateHoverTarget, { passive: true });

function cleanupCropOverlay() {
    if (voicesnapCropOverlay) {
        voicesnapCropOverlay.remove();
    }
    if (voicesnapCropRestoreStyles) {
        document.documentElement.style.overflow = voicesnapCropRestoreStyles.htmlOverflow;
        document.documentElement.style.cursor = voicesnapCropRestoreStyles.htmlCursor;
        document.body.style.overflow = voicesnapCropRestoreStyles.bodyOverflow;
        document.body.style.userSelect = voicesnapCropRestoreStyles.bodyUserSelect;
        document.body.style.cursor = voicesnapCropRestoreStyles.bodyCursor;
        voicesnapCropRestoreStyles = null;
    }
    voicesnapCropOverlay = null;
    voicesnapCropBox = null;
    voicesnapCropInfo = null;
    voicesnapCropMeasure = null;
    voicesnapCropping = false;
}

function cleanupHoverCaptureMode() {
    voicesnapHoverCaptureActive = false;

    if (voicesnapHoverCaptureOutline) {
        voicesnapHoverCaptureOutline.remove();
    }
    if (voicesnapHoverCaptureInfo) {
        voicesnapHoverCaptureInfo.remove();
    }

    voicesnapHoverCaptureOutline = null;
    voicesnapHoverCaptureInfo = null;
    document.documentElement.style.cursor = '';
    document.body.style.cursor = '';
}

function hideCropOverlayForCapture() {
    if (!voicesnapCropOverlay) return;
    voicesnapCropOverlay.style.opacity = '0';
    voicesnapCropOverlay.style.pointerEvents = 'none';
}

function rectFromElement(element) {
    const rect = element.getBoundingClientRect();
    return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX || window.pageXOffset || 0,
        scrollY: window.scrollY || window.pageYOffset || 0
    };
}

function detectStickyHeaderHeight() {
    const candidates = Array.from(document.querySelectorAll('*'));
    let stickyTopHeight = 0;

    for (const element of candidates) {
        if (!(element instanceof Element)) continue;
        if (element.hasAttribute('data-voicesnap-ui')) continue;

        const style = window.getComputedStyle(element);
        if (!['fixed', 'sticky'].includes(style.position)) continue;
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const rect = element.getBoundingClientRect();
        if (rect.height < 24 || rect.height > window.innerHeight * 0.35) continue;
        if (rect.bottom <= 0 || rect.top > 24) continue;
        if (rect.width < window.innerWidth * 0.35) continue;

        stickyTopHeight = Math.max(stickyTopHeight, Math.round(rect.bottom));
    }

    return stickyTopHeight;
}

function isSelectableElement(element) {
    return element instanceof Element &&
        !element.hasAttribute('data-voicesnap-ui') &&
        element.getBoundingClientRect().width > 4 &&
        element.getBoundingClientRect().height > 4;
}

function getSelectableElementAtPoint(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!isSelectableElement(element)) return null;
    return element;
}

function createHoverCaptureUi() {
    if (!voicesnapHoverCaptureOutline) {
        voicesnapHoverCaptureOutline = document.createElement('div');
        voicesnapHoverCaptureOutline.setAttribute('data-voicesnap-ui', 'true');
        voicesnapHoverCaptureOutline.style.position = 'fixed';
        voicesnapHoverCaptureOutline.style.zIndex = '2147483647';
        voicesnapHoverCaptureOutline.style.pointerEvents = 'none';
        voicesnapHoverCaptureOutline.style.border = '2px solid #22d3ee';
        voicesnapHoverCaptureOutline.style.borderRadius = '10px';
        voicesnapHoverCaptureOutline.style.boxShadow = '0 0 0 9999px rgba(2,6,23,0.22), 0 0 0 1px rgba(15,23,42,0.72), 0 0 24px rgba(34,211,238,0.35)';
        document.body.appendChild(voicesnapHoverCaptureOutline);
    }

    if (!voicesnapHoverCaptureInfo) {
        voicesnapHoverCaptureInfo = document.createElement('div');
        voicesnapHoverCaptureInfo.setAttribute('data-voicesnap-ui', 'true');
        voicesnapHoverCaptureInfo.style.position = 'fixed';
        voicesnapHoverCaptureInfo.style.top = '12px';
        voicesnapHoverCaptureInfo.style.left = '50%';
        voicesnapHoverCaptureInfo.style.transform = 'translateX(-50%)';
        voicesnapHoverCaptureInfo.style.padding = '8px 14px';
        voicesnapHoverCaptureInfo.style.borderRadius = '999px';
        voicesnapHoverCaptureInfo.style.background = 'rgba(15,23,42,0.92)';
        voicesnapHoverCaptureInfo.style.border = '1px solid rgba(34,211,238,0.28)';
        voicesnapHoverCaptureInfo.style.color = '#e5e7eb';
        voicesnapHoverCaptureInfo.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        voicesnapHoverCaptureInfo.style.fontSize = '12px';
        voicesnapHoverCaptureInfo.style.boxShadow = '0 10px 30px rgba(0,0,0,0.45)';
        voicesnapHoverCaptureInfo.style.pointerEvents = 'none';
        voicesnapHoverCaptureInfo.textContent = 'Hover over an element and click to capture it. Press Esc to cancel.';
        document.body.appendChild(voicesnapHoverCaptureInfo);
    }
}

function updateHoverCaptureUi(element) {
    createHoverCaptureUi();

    if (!element) {
        voicesnapHoverCaptureOutline.style.display = 'none';
        voicesnapHoverCaptureInfo.textContent = 'Move your cursor over an element, then click to capture it.';
        return;
    }

    const rect = element.getBoundingClientRect();
    voicesnapHoverCaptureOutline.style.display = 'block';
    voicesnapHoverCaptureOutline.style.left = `${rect.left}px`;
    voicesnapHoverCaptureOutline.style.top = `${rect.top}px`;
    voicesnapHoverCaptureOutline.style.width = `${rect.width}px`;
    voicesnapHoverCaptureOutline.style.height = `${rect.height}px`;
    voicesnapHoverCaptureInfo.textContent = `Hovered element: ${Math.round(rect.width)} x ${Math.round(rect.height)} px. Click to capture.`;
}

function startHoverCaptureSelection() {
    if (voicesnapHoverCaptureActive) return;
    voicesnapHoverCaptureActive = true;

    document.documentElement.style.cursor = 'crosshair';
    document.body.style.cursor = 'crosshair';
    createHoverCaptureUi();

    const onMouseMove = (event) => {
        const element = getSelectableElementAtPoint(event.clientX, event.clientY);
        voicesnapHoverTarget = element;
        voicesnapHoverRect = element ? rectFromElement(element) : null;
        updateHoverCaptureUi(element);
    };

    const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const element = getSelectableElementAtPoint(event.clientX, event.clientY) || voicesnapHoverTarget;
        if (!element) {
            showNotification('error', 'No hovered element found.');
            stop();
            return;
        }

        const rect = rectFromElement(element);
        cleanupHoverCaptureMode();
        removeListeners();
        chrome.runtime.sendMessage({ type: 'HOVER_CAPTURE_SELECTED', rect }, (response) => {
            if (chrome.runtime.lastError) {
                showNotification('error', 'Hovered element capture failed.');
                return;
            }
            if (!response?.success) {
                showNotification('error', response?.error || 'Hovered element capture failed.');
            }
        });
    };

    const onKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        stop();
        showNotification('error', 'Hovered element capture cancelled');
    };

    const stop = () => {
        cleanupHoverCaptureMode();
        removeListeners();
    };

    const removeListeners = () => {
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    updateHoverCaptureUi(voicesnapHoverTarget);
}

function startCropSelection() {
    if (voicesnapCropping) return;
    voicesnapCropping = true;

    cleanupCropOverlay();

    voicesnapCropRestoreStyles = {
        htmlOverflow: document.documentElement.style.overflow,
        htmlCursor: document.documentElement.style.cursor,
        bodyOverflow: document.body.style.overflow,
        bodyUserSelect: document.body.style.userSelect,
        bodyCursor: document.body.style.cursor
    };

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.cursor = 'crosshair';
    document.body.style.overflow = 'hidden';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'crosshair';

    voicesnapCropOverlay = document.createElement('div');
    voicesnapCropOverlay.style.position = 'fixed';
    voicesnapCropOverlay.style.inset = '0';
    voicesnapCropOverlay.style.zIndex = '2147483647';
    voicesnapCropOverlay.style.cursor = 'crosshair';
    voicesnapCropOverlay.style.background = 'rgba(2,6,23,0.18)';
    voicesnapCropOverlay.style.backdropFilter = 'blur(1px)';
    voicesnapCropOverlay.style.pointerEvents = 'all';
    voicesnapCropOverlay.style.touchAction = 'none';
    voicesnapCropOverlay.style.overscrollBehavior = 'none';

    voicesnapCropInfo = document.createElement('div');
    voicesnapCropInfo.textContent = 'Selection mode active. Drag to select an area, then release to capture. Press Esc to cancel.';
    voicesnapCropInfo.style.position = 'fixed';
    voicesnapCropInfo.style.top = '12px';
    voicesnapCropInfo.style.left = '50%';
    voicesnapCropInfo.style.transform = 'translateX(-50%)';
    voicesnapCropInfo.style.padding = '8px 14px';
    voicesnapCropInfo.style.borderRadius = '999px';
    voicesnapCropInfo.style.background = 'rgba(15,23,42,0.9)';
    voicesnapCropInfo.style.border = '1px solid rgba(34,211,238,0.28)';
    voicesnapCropInfo.style.color = '#e5e7eb';
    voicesnapCropInfo.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    voicesnapCropInfo.style.fontSize = '12px';
    voicesnapCropInfo.style.boxShadow = '0 10px 30px rgba(0,0,0,0.45)';
    voicesnapCropOverlay.appendChild(voicesnapCropInfo);

    document.body.appendChild(voicesnapCropOverlay);

    const removeCropKeyListener = () => {
        document.removeEventListener('keydown', onKeyDown, true);
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        voicesnapCropStartX = e.clientX;
        voicesnapCropStartY = e.clientY;
        logAreaStep('selection start', {
            startX: voicesnapCropStartX,
            startY: voicesnapCropStartY,
            scrollX: window.scrollX || window.pageXOffset || 0,
            scrollY: window.scrollY || window.pageYOffset || 0
        });

        if (!voicesnapCropBox) {
            voicesnapCropBox = document.createElement('div');
            voicesnapCropBox.style.position = 'fixed';
            voicesnapCropBox.style.border = '2px solid #22d3ee';
            voicesnapCropBox.style.background = 'rgba(34,211,238,0.14)';
            voicesnapCropBox.style.boxShadow = '0 0 0 9999px rgba(2,6,23,0.38), 0 0 0 1px rgba(15,23,42,0.75), 0 0 32px rgba(34,211,238,0.55)';
            voicesnapCropBox.style.borderRadius = '10px';
            voicesnapCropOverlay.appendChild(voicesnapCropBox);

            voicesnapCropMeasure = document.createElement('div');
            voicesnapCropMeasure.style.position = 'absolute';
            voicesnapCropMeasure.style.top = '-32px';
            voicesnapCropMeasure.style.right = '0';
            voicesnapCropMeasure.style.padding = '4px 8px';
            voicesnapCropMeasure.style.borderRadius = '999px';
            voicesnapCropMeasure.style.background = 'rgba(15,23,42,0.92)';
            voicesnapCropMeasure.style.border = '1px solid rgba(34,211,238,0.28)';
            voicesnapCropMeasure.style.color = '#e5e7eb';
            voicesnapCropMeasure.style.fontSize = '11px';
            voicesnapCropMeasure.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            voicesnapCropMeasure.style.whiteSpace = 'nowrap';
            voicesnapCropBox.appendChild(voicesnapCropMeasure);
        }

        const onMouseMove = (event) => {
            event.preventDefault();
            event.stopPropagation();
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
            if (voicesnapCropMeasure) {
                voicesnapCropMeasure.textContent = `${Math.round(width)} x ${Math.round(height)}`;
            }
            if (voicesnapCropInfo) {
                voicesnapCropInfo.textContent = `Selecting area: ${Math.round(width)} x ${Math.round(height)} px`;
            }
        };

        const onMouseUp = (event) => {
            event.preventDefault();
            event.stopPropagation();
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            removeCropKeyListener();

            const endX = event.clientX;
            const endY = event.clientY;

            const x = Math.min(voicesnapCropStartX, endX);
            const y = Math.min(voicesnapCropStartY, endY);
            const width = Math.abs(endX - voicesnapCropStartX);
            const height = Math.abs(endY - voicesnapCropStartY);
            const selection = {
                startX: voicesnapCropStartX,
                startY: voicesnapCropStartY,
                endX,
                endY,
                x,
                y,
                width,
                height,
                scrollX: window.scrollX || window.pageXOffset || 0,
                scrollY: window.scrollY || window.pageYOffset || 0,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1
            };
            logAreaStep('selection end', selection);

            if (width < 5 || height < 5) {
                logAreaStep('selection rejected', { reason: 'too small', width, height });
                cleanupCropOverlay();
                showNotification('error', 'Selected area is too small.');
                return;
            }

            hideCropOverlayForCapture();
            logAreaStep('message sent', selection);

            chrome.runtime.sendMessage(
                {
                    type: 'CROP_REGION_SELECTED',
                    rect: selection
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[VoiceSnap][Area] background response error:', chrome.runtime.lastError);
                        cleanupCropOverlay();
                        showNotification('error', 'Area screenshot failed.');
                        return;
                    }

                    logAreaStep('capture response', response);
                    cleanupCropOverlay();

                    if (!response?.success) {
                        showNotification('error', response?.error || 'Area screenshot failed.');
                        return;
                    }

                    if (response.dataUrl) {
                        logAreaStep('cropped image returned', {
                            length: response.dataUrl.length,
                            entryId: response.entryId || null
                        });
                    }
                }
            );
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            removeCropKeyListener();
            voicesnapCropping = false;
            cleanupCropOverlay();
            showNotification('error', 'Crop cancelled');
        }
    };

    voicesnapCropOverlay.addEventListener('mousedown', onMouseDown, true);
    voicesnapCropOverlay.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
    voicesnapCropOverlay.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
    voicesnapCropOverlay.addEventListener('contextmenu', (event) => event.preventDefault(), true);
    document.addEventListener('keydown', onKeyDown, true);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
        sendResponse({ ok: true });
    } else if (request.type === 'SHOW_NOTIFICATION') {
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
                devicePixelRatio: window.devicePixelRatio || 1,
                scrollY: window.scrollY || window.pageYOffset || 0,
                stickyTopHeight: detectStickyHeaderHeight()
            }
        });
    } else if (request.type === 'SCROLL_TO') {
        const y = request.y || 0;
        window.scrollTo(0, y);
        requestAnimationFrame(() => {
            chrome.runtime.sendMessage({ type: 'SCROLL_DONE', y: window.scrollY || window.pageYOffset || 0 });
        });
    } else if (request.type === 'START_HOVER_CAPTURE_SELECTION') {
        startHoverCaptureSelection();
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

        const pickPreferredVisible = (selectors, options = {}) => {
            const selectorList = Array.isArray(selectors) ? selectors : [selectors];

            if (options.preferHover && voicesnapHoverTarget instanceof Element) {
                const hoveredMatch = voicesnapHoverTarget.closest(selectorList.join(','));
                if (hoveredMatch && isVisible(hoveredMatch)) {
                    return hoveredMatch;
                }
            }

            let best = null;
            let bestArea = -1;

            for (const selector of selectorList) {
                const nodes = document.querySelectorAll(selector);
                for (const node of nodes) {
                    if (!isVisible(node)) continue;
                    const rect = node.getBoundingClientRect();
                    const area = rect.width * rect.height;
                    if (area > bestArea) {
                        best = node;
                        bestArea = area;
                    }
                }
            }

            return best;
        };

        switch (target) {
            case 'image':
                el = pickPreferredVisible(['img', 'picture img'], { preferHover: true });
                break;
            case 'login_form':
                el = pickPreferredVisible(['form input[type=\"password\"]', 'form'], { preferHover: true });
                if (el && el.tagName.toLowerCase() !== 'form') {
                    el = el.closest('form') || el;
                }
                break;
            case 'form':
                el = pickPreferredVisible('form', { preferHover: true });
                break;
            case 'code':
                el = pickPreferredVisible([
                    'pre',
                    'pre code',
                    '.highlight',
                    '.highlight pre',
                    '.code-block',
                    '.codeBlock',
                    '[class*=\"code-block\"]',
                    '[class*=\"snippet\"]',
                    '[data-testid*=\"code\"]',
                    '.blob-code',
                    'table.highlight'
                ], { preferHover: true });
                break;
            case 'chart':
                el = pickPreferredVisible('canvas, svg', { preferHover: true });
                break;
            case 'navbar':
                el = pickPreferredVisible('nav, header, [role=\"navigation\"]', { preferHover: true });
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

        const previewBtn = mkBtn('Preview');
        const copyBtn = mkBtn('Copy');
        const downloadBtn = mkBtn('Download');
        const editBtn = mkBtn('Edit');
        const galleryBtn = mkBtn('Open Gallery');

        previewBtn.onclick = () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'preview',
                payload: { id: request.preview.id }
            });
        };

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

        buttons.appendChild(previewBtn);
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

    return false;
});
