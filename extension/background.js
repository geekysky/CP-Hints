function generateUUID() {
    return crypto.randomUUID();
}

// initialize uuid upon installing
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['uuid'], (result) => {
        if (!result.uuid) {
            chrome.storage.local.set({ uuid: generateUUID() });
        }
    });
});

// check if a CF contest is Live
async function isContestLive(contestID) {
    if (!contestID) {
        return false;
    }

    const cacheKey = `cf_contest_${contestID}`;
    const cache = await chrome.storage.local.get([cacheKey]);
    const cachedData = cache[cacheKey] || {};
    const now = Date.now();

    // if data is less than 15 minutes old, return it
    if (cachedData && (now - cachedData.lastCheck) < 15 * 60 * 1000) {
        return cachedData.isLive;
    }
}