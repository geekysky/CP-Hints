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

    try {
        const url = `https://codeforces.com/api/contest.standings?contestId=${contestID}&from=0&count=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "OK") {
            const phase = data.result.contest.phase;
            const isLive = (phase === "CODING" || phase === "PENDING_SYSTEM_TEST" || phase === "SYSTEM_TEST");

            await chrome.storage.local.set({
                [cacheKey]: {
                    isLive,
                    lastCheck: now
                }
            });

            return isLive;
        }
        return false;
    } catch (error) {
        console.log("Codeforces API erro:", error);
        return false;
    }

    // listen for messages from content.js 
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "fetchHints") {
            (async () => {
                const problem = request.problemData;

                // check contest staus first
                if (problem.platform === "Codeforces" && problem.contestID) {
                    const live = await isContestLive(problem.contestID);

                    if (live) {
                        // block the request as contest is live
                        sendResponse({ success: false, error: "Contest is currently LIVE!" });
                        return;
                    }
                }

                // get the user's UUID 
                const storage = await chrome.storage.local.get(['uuid']);
                const userUUID = storage.uuid;

                if (!userUUID) {
                    sendResponse({ success: false, error: "User is not registered. Please login first." });
                    return;
                }

                // now make the actual request
                try {
                    const response = await fetch("http://localhost:3000/api/hints", {
                        method: "POST",
                        headers: {
                            'Content-Type': 'application/json',
                            'Extension-ID': userUUID
                        },
                        body: JSON.stringify(problem)
                    });

                    const resdata = await response.json();
                    sendResponse(resdata);

                } catch (error) {
                    console.log("Backend fetch error:", error);
                    sendResponse({ success: false, error: "Failed to fetch hints. Please try again" })
                }

            })();

            return true;
        }
    });

}