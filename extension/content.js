function getProblemData() {
    const host = window.location.hostname;

    // --- CODEFORCES LOGIC ---
    if (host.includes("codeforces.com")) {
        const urlMatch = window.location.pathname.match(/(?:contest|problemset\/problem)\/(\d+)/);
        const contestID = urlMatch ? urlMatch[1] : null;

        const problemStatement = document.querySelector(".problem-statement");
        if (!problemStatement) return null;

        const title = problemStatement.querySelector(".header .title")?.innerText || "Unknown Title";
        const rawBody = problemStatement.querySelector("div:nth-child(2)")?.innerText || "";

        return {
            platform: "Codeforces",
            contestID: contestID,
            title: title,
            body: rawBody.trim().replace(/\s+/g, ' ')
        };
    }

    // --- LEETCODE LOGIC ---
    else if (host.includes("leetcode.com")) {
        // Detect if the URL matches the contest structure
        const isContestPage = window.location.pathname.includes("/contest/");

        const titleElement = document.querySelector('h1');
        const urlMatch = window.location.pathname.match(/\/problems\/([^/]+)/);
        const fallbackTitle = urlMatch ? urlMatch[1].replace(/-/g, ' ') : "Unknown LC Problem";
        const title = titleElement ? titleElement.innerText : fallbackTitle;

        const descriptionDiv = document.querySelector('[data-track-load="description_content"]');
        const rawBody = descriptionDiv ? descriptionDiv.innerText : "";
        const cleanBody = rawBody.trim().replace(/\s+/g, ' ');

        if (!cleanBody) return null;

        return {
            platform: "LeetCode",
            contestID: null,
            isContest: isContestPage,
            title: title,
            body: cleanBody
        };
    }

    return null;
}