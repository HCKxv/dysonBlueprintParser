export async function fetchTextFile(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    return text;
}