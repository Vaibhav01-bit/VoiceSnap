import { normalizeTranscript, parseCommandText } from '../shared/command_matcher.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const DUPLICATE_COMMAND_WINDOW_MS = 2500;
const TTS_GUARD_MS = 1400;

let recognition = null;
let shouldContinueListening = false;
let conversationState = 'idle';
let lastActionCommand = null;
let lastCommandKey = '';
let lastCommandAt = 0;
let ignoreTranscriptsUntil = 0;

function setListeningState(listening, error = null) {
    chrome.storage.local.set({ isListening: listening, errorState: error || null });
}

function setAssistantStatus(status) {
    chrome.storage.local.set({ assistantStatus: status });
}

function speak(text, options = {}) {
    if (!text || !('speechSynthesis' in window)) return;

    const { guardMs = TTS_GUARD_MS } = options;

    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1;
        utterance.pitch = 1;
        ignoreTranscriptsUntil = Date.now() + guardMs;
        utterance.onend = () => {
            ignoreTranscriptsUntil = Math.max(ignoreTranscriptsUntil, Date.now() + 150);
        };
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.error('Speech synthesis error:', error);
    }
}

function commandKey(command) {
    return JSON.stringify({
        intent: command.intent,
        options: command.options || {}
    });
}

function isDuplicateCommand(command) {
    const key = commandKey(command);
    const now = Date.now();
    const duplicate = key === lastCommandKey && now - lastCommandAt < DUPLICATE_COMMAND_WINDOW_MS;

    if (!duplicate) {
        lastCommandKey = key;
        lastCommandAt = now;
    }

    return duplicate;
}

function executeCommand(command) {
    if (!command) return;
    lastActionCommand = command;
    setAssistantStatus('processing');
    chrome.runtime.sendMessage({ type: 'VOICE_COMMAND', command });
}

function handleConversation(rawTranscript) {
    if (!rawTranscript) return;
    if (Date.now() < ignoreTranscriptsUntil) return;

    const text = normalizeTranscript(rawTranscript);
    if (!text) return;

    const nlp = window.nlp;
    const doc = nlp(text);

    if (doc.has('stop listening') || (doc.has('stop') && doc.has('listening'))) {
        shouldContinueListening = false;
        if (recognition) {
            try { recognition.stop(); } catch (error) { }
        }
        conversationState = 'idle';
        setListeningState(false, null);
        setAssistantStatus('idle');
        speak('Voice listening stopped.');
        return;
    }

    if (doc.has('again') || doc.has('repeat') || text.includes('one more time')) {
        if (lastActionCommand) {
            speak('Repeating your last action.');
            executeCommand(lastActionCommand);
        } else {
            speak('There is no last action to repeat yet.');
            setAssistantStatus('ready');
        }
        return;
    }

    if (conversationState === 'waiting-region') {
        const found = ['left', 'right', 'middle', 'center', 'top', 'bottom'].find((region) => doc.has(region));
        if (!found) {
            if (doc.has('cancel')) {
                conversationState = 'idle';
                speak('Okay, cancelled.');
            } else {
                speak('I did not understand the region. Say left, right, middle, top, or bottom.');
            }
            return;
        }

        const region = found === 'center' ? 'middle' : found;
        conversationState = 'idle';
        speak(`Capturing the ${region} section.`);
        executeCommand({ intent: 'capture_region', options: { region } });
        return;
    }

    if (conversationState === 'confirm-delete') {
        if (doc.has('yes') || doc.has('confirm') || text.includes('do it')) {
            conversationState = 'idle';
            chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' });
            speak('Deleting all screenshots.');
        } else if (doc.has('no') || doc.has('cancel')) {
            conversationState = 'idle';
            speak('Okay, your screenshots are safe.');
        } else {
            speak('Please say yes or no.');
        }
        setAssistantStatus('ready');
        return;
    }

    if (
        (text.includes('take screenshot') || text.includes('capture screenshot') || text.includes('grab screenshot')) &&
        !/(full page|entire page|left|right|middle|center|top|bottom|area|image|form|code|chart|navigation|navbar|hovered)/.test(text)
    ) {
        conversationState = 'waiting-region';
        speak('Which part should I capture? Say full page, left, right, middle, top, bottom, area, image, or code block.');
        return;
    }

    const command = parseCommandText(text);
    if (!command) {
        speak('I did not understand that. Try take screenshot, full page, select area, hovered element, or open gallery.');
        setAssistantStatus('ready');
        return;
    }

    console.log('[VoiceSnap][Voice] transcript:', rawTranscript);
    console.log('[VoiceSnap][Voice] normalized:', text);
    console.log('[VoiceSnap][Voice] command matched:', command);

    if (isDuplicateCommand(command)) {
        return;
    }

    switch (command.intent) {
        case 'open_gallery':
            speak('Opening screenshot gallery.');
            break;
        case 'copy_last':
            speak('Copying your latest screenshot.');
            break;
        case 'download_last':
            speak('Downloading your latest screenshot.');
            break;
        case 'edit_last':
            speak('Opening your latest screenshot in the editor.');
            break;
        case 'preview_last':
            speak('Opening your latest screenshot preview.');
            break;
        case 'clear_history':
            conversationState = 'confirm-delete';
            speak('Are you sure you want to delete all screenshots?');
            setAssistantStatus('ready');
            return;
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
            else if (command.options?.target === 'hover') speak('Hover over the element and click to capture it.');
            break;
        case 'capture_region':
            speak(`Capturing the ${command.options?.region || 'selected'} section.`);
            break;
        case 'timer_capture': {
            const seconds = Math.max(1, Math.round((command.options?.delayMs || 3000) / 1000));
            speak(`Okay, capturing in ${seconds} seconds.`);
            break;
        }
        case 'capture_screen':
            speak('Capturing the screen.');
            break;
        case 'record_start':
        case 'record_stop':
            speak('Screen recording is not available yet.');
            break;
        default:
            break;
    }

    executeCommand(command);

    if (['capture_full_page', 'capture_area', 'capture_element', 'capture_region', 'capture_screen'].includes(command.intent)) {
        setTimeout(() => speak('Done.'), 900);
    }
}

function startVoiceEngine() {
    if (!SpeechRecognition) {
        setListeningState(false, 'Speech API not supported in this browser.');
        return;
    }

    if (recognition) {
        shouldContinueListening = true;
        try { recognition.start(); } catch (error) { }
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
        shouldContinueListening = true;
        setListeningState(true, null);
        setAssistantStatus('listening');
        speak('Voice system ready.', { guardMs: 900 });
    };

    recognition.onresult = (event) => {
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (!result?.isFinal) continue;

            const alternatives = Array.from(result);
            alternatives.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
            if (alternatives[0]?.transcript) {
                finalTranscript += ` ${alternatives[0].transcript}`;
            }
        }

        finalTranscript = finalTranscript.trim();
        if (!finalTranscript) return;

        handleConversation(finalTranscript);
    };

    recognition.onerror = (event) => {
        console.error('Voice tab speech error:', event.error);

        if (event.error === 'no-speech' || event.error === 'aborted') {
            shouldContinueListening = true;
            return;
        }

        if (event.error === 'audio-capture') {
            shouldContinueListening = false;
            setListeningState(false, 'No microphone was found.');
            setAssistantStatus('idle');
            return;
        }

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            shouldContinueListening = false;
            setListeningState(false, 'Microphone access was denied. Open the permission helper and allow the microphone.');
            setAssistantStatus('idle');
            return;
        }

        if (event.error === 'network') {
            shouldContinueListening = true;
            setAssistantStatus('listening');
            return;
        }

        shouldContinueListening = false;
        setListeningState(false, `Speech error: ${event.error}`);
        setAssistantStatus('idle');
    };

    recognition.onend = () => {
        if (!shouldContinueListening) {
            setListeningState(false, null);
            setAssistantStatus('idle');
            return;
        }

        try {
            recognition.start();
        } catch (error) {
            console.error('Voice tab restart failed:', error);
            setTimeout(() => {
                if (!shouldContinueListening) return;
                try {
                    recognition.start();
                } catch (restartError) {
                    console.error('Voice tab second restart failed:', restartError);
                    shouldContinueListening = false;
                    setListeningState(false, 'Speech engine stopped unexpectedly.');
                    setAssistantStatus('idle');
                }
            }, 350);
        }
    };

    try {
        recognition.start();
    } catch (error) {
        console.error('Voice tab start failed:', error);
        setListeningState(false, 'Unable to start speech recognition.');
        setAssistantStatus('idle');
    }
}

function stopVoiceEngine() {
    shouldContinueListening = false;
    window.speechSynthesis?.cancel();
    if (recognition) {
        try { recognition.stop(); } catch (error) { }
    }
    conversationState = 'idle';
    setListeningState(false, null);
    setAssistantStatus('idle');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_VOICE_ENGINE') {
        startVoiceEngine();
        sendResponse({ ok: true });
    }

    if (request.type === 'STOP_VOICE_ENGINE') {
        stopVoiceEngine();
        sendResponse({ ok: true });
    }

    return false;
});

chrome.runtime.sendMessage({ type: 'VOICE_TAB_READY' });
