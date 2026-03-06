// popup.js — Handles UI state, history, and voice mode toggle for VoiceSnap

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let shouldContinueListening = false;

function parseVoiceCommand(text) {
    const doc = window.nlp(text.toLowerCase());
    
    if (doc.has('stop listening') || (doc.has('stop') && doc.has('listening'))) {
        return { intent: 'stop_listening', options: {} };
    }
    if (doc.has('full page') || (doc.has('entire') && doc.has('page'))) {
        return { intent: 'capture_full_page', options: {} };
    }
    if (doc.has('area')) {
        return { intent: 'capture_area', options: {} };
    }
    if (doc.has('left')) {
        return { intent: 'capture_region', options: { region: 'left' } };
    }
    if (doc.has('right')) {
        return { intent: 'capture_region', options: { region: 'right' } };
    }
    if (doc.has('middle') || doc.has('center')) {
        return { intent: 'capture_region', options: { region: 'middle' } };
    }
    if (doc.has('top')) {
        return { intent: 'capture_region', options: { region: 'top' } };
    }
    if (doc.has('bottom')) {
        return { intent: 'capture_region', options: { region: 'bottom' } };
    }
    if (doc.has('image') || doc.has('picture')) {
        return { intent: 'capture_element', options: { target: 'image' } };
    }
    if (doc.has('screenshot') || doc.has('capture') || doc.has('grab') || (doc.has('save') && doc.has('screen'))) {
        return { intent: 'capture_screen', options: {} };
    }
    return null;
}

function handlePopupVoiceCommand(command) {
    if (command.intent === 'stop_listening') {
        stopPopupVoice();
        return;
    }
    
    chrome.runtime.sendMessage({
        type: 'VOICE_COMMAND',
        command
    });
}

function startPopupVoice() {
    if (!SpeechRecognition) {
        chrome.storage.local.set({ isListening: false, errorState: 'Speech API not supported. Use Chrome browser.' });
        return;
    }

    if (recognition) {
        shouldContinueListening = true;
        try { recognition.start(); } catch (e) { 
            console.error('Recognition start error:', e);
        }
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        console.log('Speech recognition started');
        shouldContinueListening = true;
        chrome.storage.local.set({ isListening: true, errorState: null, assistantStatus: 'listening' });
    };

    recognition.onresult = (event) => {
        console.log('Speech result:', event);
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0]?.transcript || '';
                console.log('Voice command:', text);
                const command = parseVoiceCommand(text);
                if (command) {
                    handlePopupVoiceCommand(command);
                }
            }
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech error:', event.error, event);
        shouldContinueListening = false;
        if (event.error === 'not-allowed') {
            chrome.storage.local.set({ isListening: false, errorState: 'Mic access denied. Please allow microphone access.' });
        } else if (event.error === 'no-speech') {
            console.log('No speech detected, continuing...');
            shouldContinueListening = true;
        } else {
            chrome.storage.local.set({ isListening: false, errorState: `Speech error: ${event.error}` });
        }
    };

    recognition.onend = () => {
        console.log('Speech recognition ended, shouldContinue:', shouldContinueListening);
        if (shouldContinueListening) {
            try { recognition.start(); } catch (e) {
                console.error('Restart error:', e);
                shouldContinueListening = false;
                chrome.storage.local.set({ isListening: false, assistantStatus: 'idle' });
            }
        } else {
            chrome.storage.local.set({ isListening: false, assistantStatus: 'idle' });
        }
    };

    try {
        recognition.start();
        console.log('Recognition start called');
    } catch (e) {
        console.error('Start failed:', e);
        chrome.storage.local.set({ isListening: false, errorState: 'Unable to start speech recognition: ' + e.message });
    }
}

function stopPopupVoice() {
    shouldContinueListening = false;
    if (recognition) {
        try { recognition.stop(); } catch (e) { }
    }
    chrome.storage.local.set({ isListening: false, assistantStatus: 'idle' });
}

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
            historyGrid.innerHTML = '<div class="w-full h-16 rounded-lg glass-premium border-white/10 flex justify-center items-center text-slate-400 text-[11px] border-dashed">No captures yet</div>';
            historyGrid.className = 'flex gap-3 pb-2 no-scrollbar'; // Reset to standard flex
            return;
        }

        historyGrid.innerHTML = '';

        // If we have more than 3 items, enable marquee scroll
        if (items.length > 3) {
            historyGrid.className = 'marquee-content';

            // To make infinite marquee, we duplicate items
            const displayItems = [...items.slice(0, 10), ...items.slice(0, 10)];

            displayItems.forEach((item, index) => {
                const div = createHistoryCard(item);
                historyGrid.appendChild(div);
            });
        } else {
            historyGrid.className = 'flex gap-3 pb-2 no-scrollbar';
            items.forEach(item => {
                const div = createHistoryCard(item);
                historyGrid.appendChild(div);
            });
        }
    };

    const createHistoryCard = (item) => {
        const div = document.createElement('div');
        div.className = 'min-w-[100px] h-16 rounded-lg glass-premium overflow-hidden relative group border-white/10 cursor-pointer';
        div.innerHTML = `
            <img src="${item.imageData}" alt="Screenshot" class="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity">
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span class="text-[9px] font-bold text-white uppercase tracking-wider">Copy</span>
            </div>
        `;
        div.title = `Captured from: ${item.pageTitle || 'Unknown'}`;

        div.addEventListener('click', async () => {
            chrome.runtime.sendMessage({
                type: 'COPY_TO_CLIPBOARD',
                dataUrl: item.imageData
            });
            statusText.textContent = 'Copied!';
            setTimeout(() => updateUI(currentListening, null), 1500);
        });
        return div;
    };

    const updateUI = (listening, error) => {
        const micAura = document.getElementById('mic-aura');
        const statusDot = document.getElementById('status-dot');
        const borderBeam = document.getElementById('border-beam');

        if (error) {
            statusText.textContent = 'Error';
            statusBadge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 transition-all duration-300';
            statusText.className = 'text-[10px] font-bold uppercase tracking-wider text-red-500';
            statusDot.className = 'size-2 rounded-full bg-red-500 transition-all duration-300';

            micIndicator.classList.remove('neon-glow');
            if (micAura) micAura.classList.remove('animate-pulse');
            if (borderBeam) borderBeam.classList.remove('active');

            if (error.toLowerCase().includes('denied') || error.toLowerCase().includes('mic')) {
                errorMsg.innerHTML = `${error}<br><button class="mt-4 bg-primary text-slate-900 px-4 py-2 rounded-lg font-bold w-full hover:brightness-110 transition-all shadow-[0_0_15px_rgba(13,185,242,0.4)]" id="force-permission">Open Permission Page</button>`;
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
            if (borderBeam) borderBeam.classList.add('active');
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
            if (borderBeam) borderBeam.classList.remove('active');
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
        if (e.target.id === 'force-permission') return;

        await chrome.storage.local.set({ errorState: null });
        const { isListening: current } = await chrome.storage.local.get(['isListening']);

        if (current) {
            stopPopupVoice();
            return;
        }

        statusText.textContent = 'Requesting...';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            startPopupVoice();
        } catch (err) {
            console.error('Permission error:', err);
            chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
        }
    });

    // ─── Common Commands Click ─────────────────────────────────────────────────
    const commandTags = document.querySelectorAll('.command-tag');
    commandTags.forEach(tag => {
        tag.addEventListener('click', async () => {
            const commandText = tag.getAttribute('data-command');
            if (!commandText) return;

            console.log('Command tag clicked:', commandText);
            
            // Trigger the command in the background/offscreen
            // Don't wait for response since service worker doesn't send one back
            chrome.runtime.sendMessage({
                type: 'VOICE_COMMAND_DETECTED',
                transcript: commandText
            }).catch(err => {
                console.error('Message error (expected):', err.message);
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
