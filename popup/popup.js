// popup.js — Handles UI state, history, and voice mode toggle for VoiceSnap

document.addEventListener('DOMContentLoaded', async () => {
    const micBtn = document.getElementById('mic-btn');
    const micIndicator = document.getElementById('mic-indicator');
    const statusText = document.getElementById('status-text');
    const statusBadge = document.getElementById('status-badge');
    const historyGrid = document.getElementById('history-grid');
    const clearHistoryBtn = document.getElementById('clear-history');
    const errorMsg = document.getElementById('error-msg');

    // Load initial state
    const { isListening, errorState, screenshots, assistantStatus } = await chrome.storage.local.get(['isListening', 'errorState', 'screenshots', 'assistantStatus']);

    let currentListening = isListening || false;
    let currentAssistantStatus = assistantStatus || 'idle';

    const renderHistory = (items) => {
        if (!items || items.length === 0) {
            historyGrid.innerHTML = '<div class="w-full h-16 rounded-lg glass border-white/10 flex justify-center items-center text-slate-400 text-[11px] border-dashed">No captures yet</div>';
            return;
        }

        historyGrid.innerHTML = '';
        items.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = 'min-w-[100px] h-16 rounded-lg glass overflow-hidden relative group border-white/10 cursor-pointer';
            div.innerHTML = `
                <img src="${item.imageData}" alt="Screenshot" class="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity">
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="text-[9px] font-bold text-white uppercase tracking-wider">Copy</span>
                </div>
            `;
            div.title = `Captured from: ${item.pageTitle || 'Unknown'}`;

            div.addEventListener('click', async () => {
                // Copy to clipboard again if clicked
                chrome.runtime.sendMessage({
                    type: 'COPY_TO_CLIPBOARD',
                    dataUrl: item.imageData
                });
                statusText.textContent = 'Copied!';
                setTimeout(() => updateUI(currentListening, null), 1500);
            });

            historyGrid.appendChild(div);
        });
    };

    const updateUI = (listening, error) => {
        const micAura = document.getElementById('mic-aura');
        const statusDot = document.getElementById('status-dot');

        if (error) {
            statusText.textContent = 'Error';
            statusBadge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 transition-all duration-300';
            statusText.className = 'text-[10px] font-bold uppercase tracking-wider text-red-500';
            statusDot.className = 'size-2 rounded-full bg-red-500 transition-all duration-300';

            micIndicator.classList.remove('neon-glow');
            if (micAura) micAura.classList.remove('animate-pulse');

            if (error.toLowerCase().includes('denied') || error.toLowerCase().includes('mic')) {
                errorMsg.innerHTML = `${error}<br><button class="mt-4 bg-primary text-slate-900 px-4 py-2 rounded-lg font-bold w-full hover:brightness-110 transition-all shadow-[0_0_15px_rgba(13,185,242,0.4)]" id="force-permission">Open Permission Page</button>`;
                // Need to use a small timeout to let the DOM update before adding listener
                setTimeout(() => {
                    document.getElementById('force-permission')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
                    });
                }, 10);
            } else {
                errorMsg.textContent = error;
            }
            errorMsg.style.display = 'block';
        } else if (listening) {
            statusBadge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 transition-all duration-300';
            statusText.className = 'text-[10px] font-bold uppercase tracking-wider text-green-400';
            statusDot.className = 'size-2 rounded-full bg-green-500 transition-all duration-300 animate-pulse';

            micIndicator.classList.add('neon-glow');
            if (micAura) micAura.classList.add('animate-pulse');
            errorMsg.style.display = 'none';

            if (currentAssistantStatus === 'processing') {
                statusText.textContent = 'Processing...';
            } else if (currentAssistantStatus === 'listening') {
                statusText.textContent = 'Listening...';
            } else if (currentAssistantStatus === 'idle') {
                statusText.textContent = 'Waiting for Wake Word...';
            } else {
                statusText.textContent = 'Ready';
            }
        } else {
            statusBadge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 transition-all duration-300';
            statusText.className = 'text-[10px] font-bold uppercase tracking-wider text-primary';
            statusDot.className = 'size-2 rounded-full bg-primary transition-all duration-300';

            micIndicator.classList.remove('neon-glow');
            if (micAura) micAura.classList.remove('animate-pulse');
            errorMsg.style.display = 'none';

            if (currentAssistantStatus === 'processing') {
                statusText.textContent = 'Processing...';
            } else {
                statusText.textContent = 'Ready';
            }
        }
    };

    // Initial Render
    updateUI(currentListening, errorState);
    renderHistory(screenshots);

    // Storage Change Listener
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if ('isListening' in changes) {
                currentListening = changes.isListening.newValue;
                updateUI(currentListening, null);
            }
            if ('errorState' in changes) {
                updateUI(currentListening, changes.errorState.newValue);
            }
            if ('screenshots' in changes) {
                renderHistory(changes.screenshots.newValue);
            }
            if ('assistantStatus' in changes) {
                currentAssistantStatus = changes.assistantStatus.newValue;
                updateUI(currentListening, null);
            }
        }
    });

    // ─── Mic Button Click / Voice Mode Toggle ─────────────────────────────────
    micBtn.addEventListener('click', async (e) => {
        // Don't trigger if we clicked the internal button
        if (e.target.id === 'force-permission') return;

        await chrome.storage.local.set({ errorState: null });
        const { isListening: current } = await chrome.storage.local.get(['isListening']);

        // If currently listening, stop voice engine
        if (current) {
            chrome.runtime.sendMessage({ type: 'VOICE_LISTENING_DISABLE' });
            return;
        }

        // Not currently listening: request mic permission once, then enable offscreen engine
        statusText.textContent = 'Requesting...';

        try {
            // Request mic explicitly – this shows the permission prompt with a clear user gesture.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());

            chrome.runtime.sendMessage({ type: 'VOICE_LISTENING_ENABLE' });
        } catch (err) {
            console.error('Permission error trigger:', err);
            // If failed in popup, open the dedicated tab
            chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
        }
    });

    // ─── Common Commands Click ─────────────────────────────────────────────────
    const commandTags = document.querySelectorAll('.command-tag');
    commandTags.forEach(tag => {
        tag.addEventListener('click', async () => {
            const commandText = tag.getAttribute('data-command');
            if (!commandText) return;

            // Trigger the command in the background/offscreen
            chrome.runtime.sendMessage({
                type: 'VOICE_COMMAND_DETECTED',
                transcript: commandText
            });

            // Update UI to show processing since we simulated a voice command
            const { isListening: current } = await chrome.storage.local.get(['isListening']);
            if (!current) {
                await chrome.storage.local.set({ assistantStatus: 'processing' });
            }
        });
    });

    // ─── Clear History ─────────────────────────────────────────────────────────
    clearHistoryBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ screenshots: [] });
    });
});
