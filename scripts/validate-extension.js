const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const checks = [];

function read(filePath) {
    return fs.readFileSync(path.join(ROOT, filePath), 'utf8');
}

function exists(filePath) {
    return fs.existsSync(path.join(ROOT, filePath));
}

function addCheck(condition, message) {
    checks.push({ ok: Boolean(condition), message });
}

function requireIncludes(text, value, message) {
    addCheck(text.includes(value), message);
}

function requireExcludes(text, value, message) {
    addCheck(!text.includes(value), message);
}

const manifest = JSON.parse(read('manifest.json'));
const serviceWorker = read('background/service_worker.js');
const popupHtml = read('popup/popup.html');
const offscreenHtml = read('offscreen/offscreen.html');
const offscreenJs = read('offscreen/offscreen.js');
const voiceTabJs = read('offscreen/voice_tab.js');
const sharedMatcher = read('shared/command_matcher.js');

addCheck(manifest.manifest_version === 3, 'Manifest stays on MV3');
addCheck(manifest.background?.service_worker === 'background/service_worker.js', 'Background service worker path is valid');
addCheck(manifest.action?.default_popup === 'popup/popup.html', 'Popup path is valid');
addCheck(Array.isArray(manifest.permissions) && manifest.permissions.includes('offscreen'), 'Offscreen permission is declared');
addCheck(exists('popup/gallery.html'), 'Gallery page exists');
addCheck(exists('editor/editor.html'), 'Editor page exists');
addCheck(exists('viewer/viewer.html'), 'Viewer page exists');
addCheck(exists('offscreen/voice.html'), 'Voice engine page exists');

requireIncludes(serviceWorker, "case 'VOICE_LISTENING_ENABLE':", 'Background handles voice enable');
requireIncludes(serviceWorker, "type: 'OFFSCREEN_COPY_TO_CLIPBOARD'", 'Background routes clipboard copy to the offscreen document');
requireIncludes(serviceWorker, "case 'VOICE_TAB_READY':", 'Background listens for voice tab readiness');
requireIncludes(serviceWorker, "case 'capture_hover':", 'Background supports hovered-element capture');
requireIncludes(serviceWorker, "case 'copy_last':", 'Background supports copying the last screenshot');
requireIncludes(serviceWorker, "case 'preview_last':", 'Background supports previewing the last screenshot');
requireIncludes(serviceWorker, "case 'preview':", 'Background supports opening the preview viewer');

requireIncludes(popupHtml, 'data-action="capture_visible"', 'Popup exposes visible-tab quick capture');
requireIncludes(popupHtml, 'data-action="capture_full_page"', 'Popup exposes full-page quick capture');
requireIncludes(popupHtml, 'data-action="capture_area"', 'Popup exposes area quick capture');
requireIncludes(popupHtml, 'data-action="capture_hover"', 'Popup exposes hovered-element quick capture');
requireIncludes(popupHtml, 'data-action="capture_image"', 'Popup exposes image quick capture');
requireIncludes(popupHtml, 'data-action="capture_code"', 'Popup exposes code quick capture');
requireExcludes(popupHtml, 'tailwind.css', 'Popup no longer depends on tailwind.css');

requireExcludes(offscreenHtml, 'compromise.min.js', 'Offscreen clipboard document no longer loads voice/NLP assets');
requireIncludes(offscreenJs, "request.type !== 'OFFSCREEN_COPY_TO_CLIPBOARD'", 'Offscreen document is clipboard-only');
requireExcludes(offscreenJs, 'SpeechRecognition', 'Offscreen document no longer carries dead voice-engine code');

requireIncludes(voiceTabJs, "parseCommandText", 'Voice tab uses the shared command parser');
requireIncludes(sharedMatcher, "command('copy_last'", 'Voice parser supports copying the last screenshot');
requireIncludes(sharedMatcher, "command('download_last'", 'Voice parser supports downloading the last screenshot');
requireIncludes(sharedMatcher, "command('edit_last'", 'Voice parser supports editing the last screenshot');
requireIncludes(sharedMatcher, "command('preview_last'", 'Voice parser supports previewing the last screenshot');

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`);
}

if (failed.length > 0) {
    console.error(`\nValidation failed with ${failed.length} issue(s).`);
    process.exit(1);
}

console.log(`\nValidation passed with ${checks.length} checks.`);


