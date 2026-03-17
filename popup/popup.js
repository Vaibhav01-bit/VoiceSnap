const DEFAULT_CAPTURE_SETTINGS = {
    autoCopy: true,
    showPreview: true,
    closePopupAfterAction: false
};

const DEFAULT_COMMANDS = [
    'capture full page',
    'capture left side',
    'capture image',
    'download last screenshot'
];

const state = {
    isListening: false,
    assistantStatus: 'idle',
    errorState: null,
    screenshots: [],
    recentCommands: [],
    captureSettings: { ...DEFAULT_CAPTURE_SETTINGS }
};

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        micBtn: document.getElementById('mic-btn'),
        statusBadge: document.getElementById('status-badge'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
        voiceTitle: document.getElementById('voice-title'),
        voiceHint: document.getElementById('voice-hint'),
        tabTitle: document.getElementById('tab-title'),
        tabDomain: document.getElementById('tab-domain'),
        statsTotal: document.getElementById('stats-total'),
        statsToday: document.getElementById('stats-today'),
        statsMode: document.getElementById('stats-mode'),
        errorMsg: document.getElementById('error-msg'),
        historyGrid: document.getElementById('history-grid'),
        commandInput: document.getElementById('command-input'),
        recentCommands: document.getElementById('recent-commands'),
        autoCopy: document.getElementById('setting-auto-copy'),
        showPreview: document.getElementById('setting-show-preview'),
        closePopup: document.getElementById('setting-close-popup')
    };

    bindActionButtons(elements);
    bindSettings(elements);
    bindCommandRunner(elements);
    bindVoiceToggle(elements);

    await loadInitialState(elements);
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;

        if (changes.isListening) state.isListening = changes.isListening.newValue;
        if (changes.assistantStatus) state.assistantStatus = changes.assistantStatus.newValue;
        if (changes.errorState) state.errorState = changes.errorState.newValue;
        if (changes.screenshots) state.screenshots = changes.screenshots.newValue || [];
        if (changes.recentCommands) state.recentCommands = changes.recentCommands.newValue || [];
        if (changes.captureSettings) {
            state.captureSettings = { ...DEFAULT_CAPTURE_SETTINGS, ...(changes.captureSettings.newValue || {}) };
        }

        render(elements);
    });
});

async function loadInitialState(elements) {
    const stored = await chrome.storage.local.get([
        'isListening',
        'assistantStatus',
        'errorState',
        'screenshots',
        'recentCommands',
        'captureSettings'
    ]);

    state.isListening = Boolean(stored.isListening);
    state.assistantStatus = stored.assistantStatus || 'idle';
    state.errorState = stored.errorState || null;
    state.screenshots = stored.screenshots || [];
    state.recentCommands = stored.recentCommands || [];
    state.captureSettings = { ...DEFAULT_CAPTURE_SETTINGS, ...(stored.captureSettings || {}) };

    await renderActiveTab(elements);
    render(elements);
}

async function renderActiveTab(elements) {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
            elements.tabTitle.textContent = 'No active page';
            elements.tabDomain.textContent = 'Open any tab to capture it';
            return;
        }

        elements.tabTitle.textContent = truncate(activeTab.title || 'Untitled page', 58);
        elements.tabDomain.textContent = getDisplayUrl(activeTab.url);
    } catch (error) {
        elements.tabTitle.textContent = 'Unable to read tab info';
        elements.tabDomain.textContent = 'The popup still works without tab metadata';
    }
}

function bindActionButtons(elements) {
    document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
            const action = button.getAttribute('data-action');
            if (!action) return;

            await chrome.storage.local.set({ errorState: null, assistantStatus: 'processing' });
            chrome.runtime.sendMessage({
                type: 'EXECUTE_CAPTURE_ACTION',
                action
            });
            closeAfterPageAction(action);
        });
    });

    document.getElementById('open-gallery').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_CAPTURE_ACTION', action: 'gallery' });
        closePopupSoon();
    });

    document.getElementById('clear-history').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' });
    });

    document.getElementById('copy-last').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_CAPTURE_ACTION', action: 'copy_last' });
        closeIfNeeded();
    });

    document.getElementById('download-last').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_CAPTURE_ACTION', action: 'download_last' });
        closeIfNeeded();
    });

    document.getElementById('edit-last').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_CAPTURE_ACTION', action: 'edit_last' });
        closePopupSoon();
    });

    document.getElementById('preview-last').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_CAPTURE_ACTION', action: 'preview_last' });
        closePopupSoon();
    });

    document.querySelectorAll('.suggested-command').forEach((chip) => {
        chip.addEventListener('click', () => {
            const command = chip.getAttribute('data-command');
            if (!command) return;
            elements.commandInput.value = command;
            void runCommand(command);
        });
    });
}

function bindSettings(elements) {
    elements.autoCopy.addEventListener('change', persistSettings);
    elements.showPreview.addEventListener('change', persistSettings);
    elements.closePopup.addEventListener('change', persistSettings);

    async function persistSettings() {
        state.captureSettings = {
            autoCopy: elements.autoCopy.checked,
            showPreview: elements.showPreview.checked,
            closePopupAfterAction: elements.closePopup.checked
        };
        await chrome.storage.local.set({ captureSettings: state.captureSettings });
    }
}

function bindCommandRunner(elements) {
    document.getElementById('run-command').addEventListener('click', () => {
        void runCommand(elements.commandInput.value);
    });

    elements.commandInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void runCommand(elements.commandInput.value);
        }
    });
}

function bindVoiceToggle(elements) {
    elements.micBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ errorState: null });

        if (state.isListening) {
            chrome.runtime.sendMessage({ type: 'VOICE_LISTENING_DISABLE' });
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            chrome.runtime.sendMessage({ type: 'VOICE_LISTENING_ENABLE' });
        } catch (error) {
            await chrome.storage.local.set({
                errorState: 'Microphone access is blocked. Open the permission helper and allow mic access.'
            });
        }
    });
}

async function runCommand(rawValue) {
    const command = String(rawValue || '').trim();
    if (!command) return;

    const nextRecent = [command, ...state.recentCommands.filter((item) => item !== command)].slice(0, 6);
    state.recentCommands = nextRecent;

    await chrome.storage.local.set({
        recentCommands: nextRecent,
        assistantStatus: 'processing',
        errorState: null
    });

    chrome.runtime.sendMessage({
        type: 'EXECUTE_COMMAND_TEXT',
        text: command
    });

    document.getElementById('command-input').value = '';
    closePopupSoon();
}

function render(elements) {
    renderStatus(elements);
    renderSettings(elements);
    renderStats(elements);
    renderRecentCommands(elements);
    renderHistory(elements);
}

function renderStatus(elements) {
    const { statusBadge, statusDot, statusText, voiceTitle, voiceHint, errorMsg, micBtn } = elements;

    const error = state.errorState;
    if (error) {
        statusBadge.style.borderColor = 'rgba(251, 113, 133, 0.38)';
        statusBadge.style.background = 'rgba(127, 29, 29, 0.34)';
        statusDot.style.background = 'var(--danger)';
        statusDot.style.boxShadow = '0 0 0 6px rgba(251, 113, 133, 0.12)';
        statusText.textContent = 'Error';
        voiceTitle.textContent = 'Voice mode needs attention';
        voiceHint.textContent = 'Fix the microphone permission issue or use typed/manual capture.';
        micBtn.classList.remove('active');
        renderError(errorMsg, error);
        return;
    }

    errorMsg.style.display = 'none';
    errorMsg.innerHTML = '';

    if (state.isListening) {
        statusBadge.style.borderColor = 'rgba(34, 197, 94, 0.32)';
        statusBadge.style.background = 'rgba(20, 83, 45, 0.3)';
        statusDot.style.background = 'var(--accent-2)';
        statusDot.style.boxShadow = '0 0 0 6px rgba(34, 197, 94, 0.12)';
        statusText.textContent = state.assistantStatus === 'processing' ? 'Processing' : 'Listening';
        voiceTitle.textContent = state.assistantStatus === 'processing' ? 'Handling your last command' : 'Voice mode is active';
        voiceHint.textContent = 'Try: “capture code block”, “copy last screenshot”, or “open gallery”.';
        micBtn.classList.add('active');
        return;
    }

    statusBadge.style.borderColor = 'rgba(125, 211, 252, 0.28)';
    statusBadge.style.background = 'rgba(4, 19, 33, 0.72)';
    statusDot.style.background = 'var(--accent)';
    statusDot.style.boxShadow = '0 0 0 6px rgba(56, 189, 248, 0.12)';
    statusText.textContent = state.assistantStatus === 'processing' ? 'Processing' : 'Ready';
    voiceTitle.textContent = state.assistantStatus === 'processing' ? 'Running capture action' : 'Voice mode is idle';
    voiceHint.textContent = 'Open voice mode when you want always-on commands, or use the quick actions below.';
    micBtn.classList.remove('active');
}

function renderError(errorNode, error) {
    const hasMicError = /microphone|mic|voice engine/i.test(error);
    if (!hasMicError) {
        errorNode.textContent = error;
        errorNode.style.display = 'block';
        return;
    }

    errorNode.innerHTML = `${escapeHtml(error)}<br><button class="inline-btn" id="open-permission" type="button" style="margin-top:10px;">Open permission helper</button>`;
    errorNode.style.display = 'block';
    document.getElementById('open-permission')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    });
}

function renderSettings(elements) {
    elements.autoCopy.checked = Boolean(state.captureSettings.autoCopy);
    elements.showPreview.checked = Boolean(state.captureSettings.showPreview);
    elements.closePopup.checked = Boolean(state.captureSettings.closePopupAfterAction);
}

function renderStats(elements) {
    const total = state.screenshots.length;
    const todayCount = state.screenshots.filter((item) => isToday(item.timestamp)).length;
    const lastMode = state.screenshots[0]?.captureLabel || 'None';

    elements.statsTotal.textContent = String(total);
    elements.statsToday.textContent = String(todayCount);
    elements.statsMode.textContent = truncate(lastMode, 14);
}

function renderRecentCommands(elements) {
    const commands = state.recentCommands.length ? state.recentCommands : DEFAULT_COMMANDS;
    elements.recentCommands.innerHTML = '';

    commands.forEach((command) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = command;
        chip.addEventListener('click', () => {
            elements.commandInput.value = command;
            void runCommand(command);
        });
        elements.recentCommands.appendChild(chip);
    });
}

function renderHistory(elements) {
    const list = state.screenshots.slice(0, 3);
    elements.historyGrid.innerHTML = '';

    if (!list.length) {
        elements.historyGrid.innerHTML = '<div class="empty">No captures yet. Start with a visible tab shot or try a typed command.</div>';
        return;
    }

    list.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'history-card';

        const thumb = document.createElement('img');
        thumb.className = 'history-thumb';
        thumb.src = item.imageData;
        thumb.alt = item.pageTitle || 'Screenshot';

        const copy = document.createElement('div');
        copy.className = 'history-copy';

        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'preview',
                payload: { id: item.id }
            });
            closePopupSoon();
        });

        const title = document.createElement('div');
        title.className = 'history-title';
        title.textContent = item.pageTitle || 'Untitled page';

        const pills = document.createElement('div');
        pills.className = 'pill-row';
        pills.appendChild(createPill(item.captureLabel || 'Visible'));
        if (item.favorite) {
            pills.appendChild(createPill('Favorite'));
        }

        const meta = document.createElement('div');
        meta.className = 'history-meta';
        meta.textContent = `${formatTimestamp(item.timestamp)} • ${getDisplayUrl(item.pageUrl)}`;

        const actions = document.createElement('div');
        actions.className = 'history-actions';

        actions.appendChild(createActionButton('Preview', () => {
            chrome.runtime.sendMessage({
                type: 'PREVIEW_ACTION',
                action: 'preview',
                payload: { id: item.id }
            });
            closePopupSoon();
        }));

        actions.appendChild(createActionButton('Copy', () => {
            chrome.runtime.sendMessage({
                type: 'COPY_TO_CLIPBOARD',
                dataUrl: item.imageData
            });
        }));

        actions.appendChild(createActionButton('Download', () => {
            chrome.runtime.sendMessage({
                type: 'DOWNLOAD_SCREENSHOT',
                dataUrl: item.imageData,
                fileNameHint: null
            });
        }));

        actions.appendChild(createActionButton('Edit', () => {
            const url = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(item.id)}`);
            chrome.tabs.create({ url });
            closeIfNeeded();
        }));

        const favoriteBtn = createActionButton(item.favorite ? 'Unstar' : 'Star', async () => {
            await chrome.runtime.sendMessage({
                type: 'TOGGLE_FAVORITE_SCREENSHOT',
                id: item.id
            });
        });
        if (item.favorite) {
            favoriteBtn.classList.add('favorite');
        }
        actions.appendChild(favoriteBtn);

        copy.appendChild(title);
        copy.appendChild(pills);
        copy.appendChild(meta);
        copy.appendChild(actions);

        card.appendChild(thumb);
        card.appendChild(copy);
        elements.historyGrid.appendChild(card);
    });
}

function createPill(text) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = text;
    return pill;
}

function createActionButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function closeIfNeeded() {
    if (!state.captureSettings.closePopupAfterAction) return;
    closePopupSoon();
}

function closeAfterPageAction(action) {
    if (action.startsWith('capture_') || action === 'gallery' || action === 'edit_last') {
        closePopupSoon();
        return;
    }
    closeIfNeeded();
}

function closePopupSoon() {
    setTimeout(() => window.close(), 120);
}

function isToday(timestamp) {
    const date = new Date(timestamp || 0);
    const today = new Date();
    return date.toDateString() === today.toDateString();
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
    if (!url) return 'Unknown source';

    try {
        const parsed = new URL(url);
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        return `${parsed.hostname}${path}`.slice(0, 48);
    } catch {
        return truncate(url, 48);
    }
}

function truncate(value, max) {
    if (!value || value.length <= max) return value || '';
    return `${value.slice(0, max - 1)}…`;
}

function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
