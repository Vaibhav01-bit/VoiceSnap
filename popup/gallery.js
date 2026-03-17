const state = {
    screenshots: [],
    filter: 'all',
    query: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        grid: document.getElementById('grid'),
        empty: document.getElementById('empty'),
        search: document.getElementById('search'),
        statTotal: document.getElementById('stat-total'),
        statFavorites: document.getElementById('stat-favorites'),
        statToday: document.getElementById('stat-today'),
        statEdited: document.getElementById('stat-edited')
    };

    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    state.screenshots = screenshots;

    elements.search.addEventListener('input', (event) => {
        state.query = event.target.value || '';
        render(elements);
    });

    document.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            state.filter = button.getAttribute('data-filter') || 'all';
            document.querySelectorAll('[data-filter]').forEach((chip) => chip.classList.remove('active'));
            button.classList.add('active');
            render(elements);
        });
    });

    document.getElementById('clear-all').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_SCREENSHOTS' });
    });

    document.getElementById('open-popup').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.screenshots) {
            state.screenshots = changes.screenshots.newValue || [];
            render(elements);
        }
    });

    render(elements);
});

function render(elements) {
    renderStats(elements);

    const list = getFilteredList();
    elements.grid.innerHTML = '';

    if (!list.length) {
        elements.empty.style.display = 'block';
        return;
    }

    elements.empty.style.display = 'none';

    list.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'card';

        const thumb = document.createElement('img');
        thumb.className = 'thumb';
        thumb.src = item.imageData;
        thumb.alt = item.pageTitle || 'Screenshot';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = item.pageTitle || 'Untitled capture';

        const pills = document.createElement('div');
        pills.className = 'pill-row';
        pills.appendChild(makePill(item.captureLabel || 'Visible'));
        if (item.favorite) pills.appendChild(makePill('Favorite'));
        if (item.isEdited) pills.appendChild(makePill('Edited'));

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = formatTimestamp(item.timestamp);

        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = getDisplayUrl(item.pageUrl);

        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.appendChild(makeAction('Preview', () => {
            const url = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(item.id)}`);
            chrome.tabs.create({ url });
        }));
        actions.appendChild(makeAction('Copy', () => {
            chrome.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', dataUrl: item.imageData });
        }));
        actions.appendChild(makeAction('Download', () => {
            chrome.runtime.sendMessage({
                type: 'DOWNLOAD_SCREENSHOT',
                dataUrl: item.imageData,
                fileNameHint: null
            });
        }));
        actions.appendChild(makeAction('Edit', () => {
            const url = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(item.id)}`);
            chrome.tabs.create({ url });
        }));
        actions.appendChild(makeAction(item.favorite ? 'Unstar' : 'Star', () => {
            chrome.runtime.sendMessage({
                type: 'TOGGLE_FAVORITE_SCREENSHOT',
                id: item.id
            });
        }, item.favorite));

        if (item.pageUrl) {
            actions.appendChild(makeAction('Open page', () => {
                chrome.tabs.create({ url: item.pageUrl });
            }));
        }

        actions.appendChild(makeAction('Delete', () => {
            chrome.runtime.sendMessage({
                type: 'DELETE_SCREENSHOT',
                id: item.id
            });
        }));

        card.appendChild(thumb);
        card.appendChild(title);
        card.appendChild(pills);
        card.appendChild(meta);
        card.appendChild(url);
        card.appendChild(actions);

        elements.grid.appendChild(card);
    });
}

function renderStats(elements) {
    elements.statTotal.textContent = String(state.screenshots.length);
    elements.statFavorites.textContent = String(state.screenshots.filter((item) => item.favorite).length);
    elements.statToday.textContent = String(state.screenshots.filter((item) => isToday(item.timestamp)).length);
    elements.statEdited.textContent = String(state.screenshots.filter((item) => item.isEdited).length);
}

function getFilteredList() {
    const query = state.query.trim().toLowerCase();

    return state.screenshots.filter((item) => {
        if (state.filter === 'today' && !isToday(item.timestamp)) return false;
        if (state.filter === 'favorites' && !item.favorite) return false;
        if (state.filter === 'edited' && !item.isEdited) return false;

        if (!query) return true;

        return [
            item.pageTitle,
            item.pageUrl,
            item.captureMode,
            item.captureLabel
        ].some((value) => String(value || '').toLowerCase().includes(query));
    });
}

function makePill(text) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = text;
    return pill;
}

function makeAction(label, onClick, favorite = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = favorite ? 'action favorite' : 'action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
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
        return `${parsed.hostname}${path}`.slice(0, 72);
    } catch {
        return String(url).slice(0, 72);
    }
}

function isToday(timestamp) {
    const date = new Date(timestamp || 0);
    const today = new Date();
    return date.toDateString() === today.toDateString();
}
