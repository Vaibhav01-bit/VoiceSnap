const NORMALIZATION_RULES = [
    [/screen\s*shot/g, 'screenshot'],
    [/full\s*page/g, 'full page'],
    [/entire\s*page/g, 'full page'],
    [/visible\s*(tab|page|screen)/g, 'visible tab'],
    [/(select|choose)\s*(the\s*)?(an|a)?\s*area/g, 'select area'],
    [/(hover|hovered|pointed|pointing)\s*(over\s*)?(element|item|section)?/g, 'hovered element'],
    [/code\s*(snippet|section|area)/g, 'code block'],
    [/(open|show)\s*(the\s*)?gallery/g, 'open gallery'],
    [/(copy|download|edit)\s*(the\s*)?(last|latest|previous)\s*screenshot/g, '$1 last screenshot']
];

const WAKE_WORDS = ['hey voicesnap', 'ok voicesnap', 'hello voicesnap', 'voicesnap'];

export function normalizeTranscript(rawText) {
    let text = String(rawText || '')
        .toLowerCase()
        .replace(/[.,!?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    for (const wakeWord of WAKE_WORDS) {
        if (text === wakeWord) {
            return '';
        }
        if (text.startsWith(`${wakeWord} `)) {
            text = text.slice(wakeWord.length).trim();
            break;
        }
    }

    for (const [pattern, replacement] of NORMALIZATION_RULES) {
        text = text.replace(pattern, replacement);
    }

    return text.trim();
}

export function parseCommandText(rawText) {
    const text = normalizeTranscript(rawText);
    if (!text) return null;

    if (hasAny(text, ['stop listening', 'stop voice', 'disable voice'])) {
        return command('stop_listening', {}, text);
    }

    if (hasAny(text, ['open gallery', 'show gallery', 'open screenshots', 'gallery'])) {
        return command('open_gallery', {}, text);
    }

    if (hasAny(text, ['copy last screenshot', 'copy last', 'copy previous screenshot', 'copy latest screenshot'])) {
        return command('copy_last', {}, text);
    }

    if (hasAny(text, ['download last screenshot', 'download last', 'download previous screenshot', 'download latest screenshot'])) {
        return command('download_last', {}, text);
    }

    if (hasAny(text, ['edit last screenshot', 'edit last', 'edit previous screenshot', 'edit latest screenshot'])) {
        return command('edit_last', {}, text);
    }

    if (hasAny(text, ['preview last screenshot', 'preview last', 'show last screenshot', 'open last screenshot', 'preview latest screenshot'])) {
        return command('preview_last', {}, text);
    }

    if (includesAll(text, ['clear', 'history']) || includesAll(text, ['delete', 'screenshots'])) {
        return command('clear_history', {}, text);
    }

    if (hasAny(text, ['visible tab', 'visible page', 'visible screenshot', 'visible screen', 'capture visible', 'take visible'])) {
        return command('capture_screen', {}, text);
    }

    if (hasAny(text, ['full page', 'capture full page', 'take full page screenshot', 'capture entire page', 'full page screenshot'])) {
        return command('capture_full_page', {}, text);
    }

    if (hasAny(text, ['select area', 'capture area', 'select area screenshot', 'area screenshot', 'select screenshot area', 'area capture'])) {
        return command('capture_area', {}, text);
    }

    if (hasAny(text, ['capture hovered element', 'capture hover element', 'capture element under cursor', 'hovered element', 'hover element', 'under cursor'])) {
        return command('capture_element', { target: 'hover' }, text);
    }

    if (hasAny(text, ['capture code block', 'capture code snippet', 'capture code', 'code block', 'code snippet'])) {
        return command('capture_element', { target: 'code' }, text);
    }

    if (hasAny(text, ['capture image', 'capture picture'])) {
        return command('capture_element', { target: 'image' }, text);
    }

    if (hasAny(text, ['capture login form', 'capture form', 'capture sign in form'])) {
        return command('capture_element', { target: 'login_form' }, text);
    }

    if (hasAny(text, ['capture chart', 'capture graph'])) {
        return command('capture_element', { target: 'chart' }, text);
    }

    if (hasAny(text, ['capture navigation', 'capture navbar', 'capture header'])) {
        return command('capture_element', { target: 'navbar' }, text);
    }

    if (text.includes('left')) {
        return command('capture_region', { region: 'left' }, text);
    }
    if (text.includes('right')) {
        return command('capture_region', { region: 'right' }, text);
    }
    if (text.includes('middle') || text.includes('center')) {
        return command('capture_region', { region: 'middle' }, text);
    }
    if (text.includes('top')) {
        return command('capture_region', { region: 'top' }, text);
    }
    if (text.includes('bottom')) {
        return command('capture_region', { region: 'bottom' }, text);
    }

    const timerMatch = text.match(/(?:capture|take|grab)(?: a)?(?: (full page|area|visible tab))?(?: screenshot)? in (\d+)\s*seconds?/);
    if (timerMatch) {
        const mode = timerMatch[1] || 'screen';
        const seconds = Number.parseInt(timerMatch[2], 10);
        return command('timer_capture', {
            delayMs: Number.isFinite(seconds) ? seconds * 1000 : 3000,
            mode
        }, text);
    }

    if (hasAny(text, ['start recording', 'record screen'])) {
        return command('record_start', {}, text);
    }

    if (hasAny(text, ['stop recording'])) {
        return command('record_stop', {}, text);
    }

    if (/(screenshot|capture|grab|save screen)/.test(text)) {
        return command('capture_screen', {}, text);
    }

    return null;
}

function hasAny(text, phrases) {
    return phrases.some((phrase) => text.includes(phrase));
}

function includesAll(text, required) {
    return required.every((phrase) => text.includes(phrase));
}

function command(intent, options, spokenText) {
    return { intent, options, spokenText };
}
