export async function copyToClipboard(dataUrl) {
    try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();

        // Copy the blob immediately using Clipboard API
        const item = new ClipboardItem({ [blob.type]: blob });
        await navigator.clipboard.write([item]);
        console.log("Copied payload to clipboard inside offscreen document.");
        return true;
    } catch (error) {
        console.error("Clipboard copy failed inside offscreen:", error);
        throw error;
    }
}
