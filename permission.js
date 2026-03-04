document.getElementById('grant-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    statusEl.textContent = "Requesting...";
    statusEl.className = "";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop()); // Stop immediately

        statusEl.textContent = "Permission Granted! You can close this tab and use the extension.";
        statusEl.className = "success";

        // Clear any previous error states in storage so the popup doesn't get stuck
        chrome.storage.local.set({ errorState: null });

        // Notify background script to start voice recognition immediately
        chrome.runtime.sendMessage({ type: 'START_VOICE' });

        // Auto-close tab after 2 seconds
        setTimeout(() => {
            window.close();
        }, 2000);
    } catch (err) {
        console.error("Permission denied:", err);
        statusEl.textContent = "Permission Denied. Please check your browser settings.";
        statusEl.className = "error";
    }
});
