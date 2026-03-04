// offscreen/offscreen.js - Clipboard + Voice engine (wake-word)

import { copyToClipboard } from '../clipboard/clipboard.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let shouldContinueListening = false;

// Conversational assistant state
let assistantActive = false;
let conversationState = 'idle'; // 'idle' | 'waiting-region' | 'confirm-delete'
let lastActionCommand = null;

function setListeningState(listening, error = null) {
    chrome.storage.local.set({ isListening: listening, errorState: error || null });
}

function setAssistantStatus(status) {
    chrome.storage.local.set({ assistantStatus: status });
}

function speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.error('Speech synthesis error:', e);
    }
}

function parseVoiceCommand(commandTextRaw) {
    if (!commandTextRaw) return null;

    // Use compromise (loaded globally via script tag)
    const nlp = window.nlp;
    const doc = nlp(commandTextRaw.toLowerCase());

    // Stop listening
    if (doc.has('stop listening') || (doc.has('stop') && doc.has('listening'))) {
        return { intent: 'stop_listening', options: {} };
    }

    // Full page
    if (doc.has('full page') || (doc.has('entire') && doc.has('page'))) {
        return { intent: 'capture_full_page', options: {} };
    }

    // Area selection
    if (doc.has('area')) {
        return { intent: 'capture_area', options: {} };
    }

    // Element targets
    if (doc.has('image') || doc.has('picture')) {
        return { intent: 'capture_element', options: { target: 'image' } };
    }

    if (doc.has('login') || doc.has('form')) {
        return { intent: 'capture_element', options: { target: 'login_form' } };
    }

    if (doc.has('code')) {
        return { intent: 'capture_element', options: { target: 'code' } };
    }

    if (doc.has('chart') || doc.has('graph')) {
        return { intent: 'capture_element', options: { target: 'chart' } };
    }

    if (doc.has('nav') || doc.has('navigation')) {
        return { intent: 'capture_element', options: { target: 'navbar' } };
    }

    if (doc.has('this') || doc.has('hover') || doc.has('mouse')) {
        return { intent: 'capture_element', options: { target: 'hover' } };
    }

    // Smart regions
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

    // Timers: e.g. "capture in 3 seconds" / "capture full page in 5 seconds"
    const timerMatch = commandTextRaw.toLowerCase().match(/capture(?: (full page|area))? in (\d+)\s*second/);
    if (timerMatch) {
        const mode = timerMatch[1] || 'screen';
        const seconds = parseInt(timerMatch[2], 10);
        return {
            intent: 'timer_capture',
            options: {
                delayMs: Number.isFinite(seconds) ? seconds * 1000 : 3000,
                mode
            }
        };
    }

    // Recording
    if (doc.has('start recording') || doc.has('record screen')) {
        return { intent: 'record_start', options: {} };
    }

    if (doc.has('stop recording')) {
        return { intent: 'record_stop', options: {} };
    }

    // Default: simple screenshot
    if (
        doc.has('screenshot') ||
        doc.has('capture') ||
        doc.has('grab') ||
        doc.has('save') && doc.has('screen')
    ) {
        return { intent: 'capture_screen', options: {} };
    }

    return null;
}

function executeCommand(command) {
    if (!command) return;
    lastActionCommand = command;
    setAssistantStatus('processing');
    chrome.runtime.sendMessage({
        type: 'VOICE_COMMAND',
        command
    });
}

function handleConversation(rawTranscript) {
    if (!rawTranscript) return;

    let transcript = rawTranscript.trim().toLowerCase();
    if (!transcript) return;

    // Use compromise global
    const nlp = window.nlp;

    const hasWake = transcript.includes('hey snap');

    if (hasWake) {
        assistantActive = true;
        setAssistantStatus('listening');
        speak('Yes, how can I help?');
        transcript = transcript.replace(/hey snap/gi, '').trim();
        if (!transcript) return;
    }

    // Require wake-word unless already active
    if (!assistantActive) return;

    const text = transcript.replace(/\s+/g, ' ').trim();
    if (!text) return;

    const doc = nlp(text);

    // Global stop listening
    if (doc.has('stop listening') || (doc.has('stop') && doc.has('listening'))) {
        shouldContinueListening = false;
        assistantActive = false;
        if (recognition) {
            try { recognition.stop(); } catch (e) { /* ignore */ }
        }
        setListeningState(false, null);
        setAssistantStatus('idle');
        speak('Voice listening stopped.');
        return;
    }

    // Command memory: "again"
    if (doc.has('again') || doc.has('repeat') || doc.has('one more time')) {
        if (lastActionCommand) {
            speak('Repeating your last action.');
            executeCommand(lastActionCommand);
        } else {
            speak('There is no last action to repeat yet.');
        }
        setAssistantStatus('ready');
        return;
    }

    // Conversation: waiting for region answer
    if (conversationState === 'waiting-region') {
        const regions = ['left', 'right', 'middle', 'center', 'top', 'bottom'];
        const found = regions.find(r => doc.has(r));
        if (!found) {
            if (doc.has('cancel')) {
                conversationState = 'idle';
                speak('Okay, cancelled.');
            } else {
                speak('I did not understand the region. You can say left, right, middle, top, or bottom.');
            }
            return;
        }
        const region = found === 'center' ? 'middle' : found;
        speak(`Capturing the ${region} section.`);
        const cmd = { intent: 'capture_region', options: { region } };
        executeCommand(cmd);
        conversationState = 'idle';
        setAssistantStatus('ready');
        speak('Screenshot captured and copied to clipboard.');
        return;
    }

    // Conversation: confirm delete screenshots
    if (conversationState === 'confirm-delete') {
        if (doc.has('yes') || doc.has('confirm') || doc.has('do it')) {
            chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' });
            speak('Deleting all screenshots.');
            conversationState = 'idle';
            setAssistantStatus('ready');
        } else if (doc.has('no') || doc.has('cancel')) {
            speak('Okay, your screenshots are safe.');
            conversationState = 'idle';
            setAssistantStatus('ready');
        } else {
            speak('Please say yes or no.');
        }
        return;
    }

    // Delete history intent
    if ((doc.has('delete') || doc.has('clear')) && (doc.has('screenshot') || doc.has('history'))) {
        speak('Are you sure you want to delete all screenshots?');
        conversationState = 'confirm-delete';
        return;
    }

    // Open gallery
    if (doc.has('open gallery') || doc.has('show gallery') || doc.has('open screenshots')) {
        speak('Opening screenshot gallery.');
        chrome.runtime.sendMessage({
            type: 'PREVIEW_ACTION',
            action: 'gallery',
            payload: {}
        });
        setAssistantStatus('ready');
        return;
    }

    // Capture screenshot with follow-up question (conversation mode)
    // Only ask if they just say "take screenshot" without any modifiers
    if ((doc.has('capture screenshot') || doc.has('take screenshot') || doc.has('capture the screen') || doc.has('grab screenshot'))) {
        const hasRegionModifier = doc.has('full page') || doc.has('entire page') || doc.has('left') || doc.has('right') || doc.has('middle') || doc.has('center') || doc.has('top') || doc.has('bottom') || doc.has('area') || doc.has('image') || doc.has('form') || doc.has('code');
        if (!hasRegionModifier) {
            speak('Which part should I capture? You can say full page, left, right, middle, or an element like image.');
            conversationState = 'waiting-region';
            return;
        }
    }

    // Generic intent detection
    const command = parseVoiceCommand(text);
    if (!command) {
        speak('Sorry, I did not understand that. You can say take screenshot, capture full page, capture middle, or open gallery.');
        return;
    }

    // Voice feedback per intent
    switch (command.intent) {
        case 'capture_full_page':
            speak('Capturing the full page.');
            break;
        case 'capture_area':
            speak('Starting area selection. Drag to select the region.');
            break;
        case 'capture_element':
            if (command.options?.target === 'image') speak('Capturing the image.');
            else if (command.options?.target === 'login_form') speak('Capturing the login form.');
            else if (command.options?.target === 'code') speak('Capturing the code block.');
            else if (command.options?.target === 'chart') speak('Capturing the chart.');
            else if (command.options?.target === 'navbar') speak('Capturing the navigation bar.');
            else if (command.options?.target === 'hover') speak('Capturing the element under your cursor.');
            break;
        case 'capture_region':
            if (command.options?.region) speak(`Capturing the ${command.options.region} section.`);
            break;
        case 'timer_capture':
            if (command.options?.delayMs) {
                const seconds = Math.round(command.options.delayMs / 1000);
                speak(`Okay, capturing in ${seconds} seconds.`);
            } else {
                speak('Starting a delayed capture.');
            }
            break;
        case 'capture_screen':
            speak('Capturing the screen and copying it to your clipboard.');
            break;
        case 'record_start':
            speak('Starting screen recording.');
            break;
        case 'record_stop':
            speak('Stopping screen recording.');
            break;
        default:
            break;
    }

    executeCommand(command);

    // Smart suggestion after screenshot-related commands
    if (['capture_full_page', 'capture_area', 'capture_element', 'capture_region', 'capture_screen'].includes(command.intent)) {
        setTimeout(() => {
            speak('Screenshot captured and copied to clipboard.');
        }, 1000); // Slight delay for the capture to happen
    }

    setAssistantStatus('ready');
}

function startVoiceEngine() {
    if (!SpeechRecognition) {
        setListeningState(false, 'Speech API not supported in this browser.');
        return;
    }

    if (recognition) {
        // Already initialised – just ensure it will continue.
        shouldContinueListening = true;
        try { recognition.start(); } catch (e) { /* ignore re-start errors */ }
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        shouldContinueListening = true;
        assistantActive = true;
        setListeningState(true, null);
        setAssistantStatus('listening');
        speak('Listening activated.');
    };

    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0]?.transcript || '';
                handleConversation(text);
            }
        }
    };

    recognition.onerror = (event) => {
        console.error('Offscreen speech error:', event.error);
        shouldContinueListening = false;
        if (event.error === 'not-allowed') {
            setListeningState(false, 'Mic access denied. Please allow microphone access in Chrome site settings and retry.');
        } else {
            setListeningState(false, `Speech error: ${event.error}`);
        }
    };

    recognition.onend = () => {
        if (shouldContinueListening) {
            try {
                recognition.start();
            } catch (e) {
                console.error('Offscreen restart failed:', e);
                shouldContinueListening = false;
                setListeningState(false, 'Speech engine stopped unexpectedly.');
            }
        } else {
            assistantActive = false;
            setListeningState(false, null);
            setAssistantStatus('idle');
        }
    };

    try {
        recognition.start();
    } catch (e) {
        console.error('Offscreen start failed:', e);
        setListeningState(false, 'Unable to start speech recognition.');
    }
}

function stopVoiceEngine() {
    shouldContinueListening = false;
    if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignore */ }
    }
    assistantActive = false;
    setListeningState(false, null);
    setAssistantStatus('idle');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'COPY_TO_CLIPBOARD') {
        copyToClipboard(request.dataUrl)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.error('Offscreen clipboard error:', err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    if (request.type === 'START_VOICE_ENGINE') {
        startVoiceEngine();
        sendResponse({ ok: true });
        return false;
    }

    if (request.type === 'STOP_VOICE_ENGINE') {
        stopVoiceEngine();
        sendResponse({ ok: true });
        return false;
    }

    return false;
});
