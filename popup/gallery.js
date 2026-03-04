document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const searchInput = document.getElementById('search');

    let allShots = [];

    function render(list) {
        grid.innerHTML = '';
        if (!list.length) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        list.forEach(item => {
            const card = document.createElement('div');
            card.className = 'card';

            const img = document.createElement('img');
            img.className = 'thumb';
            img.src = item.imageData;
            img.alt = item.pageTitle || 'Screenshot';

            const metaTitle = document.createElement('div');
            metaTitle.className = 'meta-title';
            metaTitle.textContent = item.pageTitle || 'Untitled';

            const metaUrl = document.createElement('div');
            metaUrl.className = 'meta-url';
            metaUrl.textContent = item.pageUrl || '';

            const metaTime = document.createElement('div');
            metaTime.className = 'meta-time';
            const d = new Date(item.timestamp || item.id);
            metaTime.textContent = d.toLocaleString();

            const actions = document.createElement('div');
            actions.className = 'actions';

            const mkBtn = (label) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                return btn;
            };

            const copyBtn = mkBtn('Copy');
            const dlBtn = mkBtn('Download');
            const editBtn = mkBtn('Edit');
            const delBtn = mkBtn('Delete');

            copyBtn.onclick = () => {
                chrome.runtime.sendMessage({
                    type: 'COPY_TO_CLIPBOARD',
                    dataUrl: item.imageData
                });
            };

            dlBtn.onclick = () => {
                chrome.runtime.sendMessage({
                    type: 'DOWNLOAD_SCREENSHOT',
                    dataUrl: item.imageData,
                    fileNameHint: null
                });
            };

            editBtn.onclick = () => {
                const url = chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(item.id)}`);
                chrome.tabs.create({ url });
            };

            delBtn.onclick = async () => {
                allShots = allShots.filter(s => s.id !== item.id);
                await chrome.storage.local.set({ screenshots: allShots });
                applyFilter();
            };

            actions.appendChild(copyBtn);
            actions.appendChild(dlBtn);
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);

            card.appendChild(img);
            card.appendChild(metaTitle);
            if (item.pageUrl) card.appendChild(metaUrl);
            card.appendChild(metaTime);
            card.appendChild(actions);

            grid.appendChild(card);
        });
    }

    function applyFilter() {
        const q = (searchInput.value || '').toLowerCase().trim();
        if (!q) {
            render(allShots);
            return;
        }
        const filtered = allShots.filter(s =>
            (s.pageTitle || '').toLowerCase().includes(q) ||
            (s.pageUrl || '').toLowerCase().includes(q)
        );
        render(filtered);
    }

    const { screenshots = [] } = await chrome.storage.local.get(['screenshots']);
    allShots = screenshots;
    render(allShots);

    searchInput.addEventListener('input', applyFilter);
});

