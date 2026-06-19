
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

function injectUI(problemData) {
    // 1. Create the Floating "Ask AI" Button
    const askBtn = document.createElement("button");
    askBtn.id = "cp-ask-ai-btn";
    askBtn.innerHTML = "🤖 Ask AI";
    document.body.appendChild(askBtn);

    // 2. Create the Hint Container (Hidden by default)
    const panel = document.createElement("div");
    panel.id = "cp-hint-panel";
    panel.innerHTML = `
        <div class="cp-panel-header">
            <h3>First Principles Coach</h3>
            <button id="cp-panel-close">&times;</button>
        </div>
        <div id="cp-panel-body">
            <div id="cp-loader" style="display: none;">
                <div class="spinner"></div>
                <p>Deriving from first principles...</p>
            </div>
            <div id="cp-hints-container"></div>
        </div>
    `;
    document.body.appendChild(panel);

    // DOM Elements
    const closeBtn = document.getElementById("cp-panel-close");
    const panelBody = document.getElementById("cp-panel-body");
    const loader = document.getElementById("cp-loader");
    const hintsContainer = document.getElementById("cp-hints-container");

    let hintsFetched = false;

    // 3. Button Click Event: Open panel and fetch hints
    askBtn.onclick = () => {
        panel.classList.add("open");

        if (!hintsFetched) {
            loader.style.display = "flex";
            hintsContainer.innerHTML = "";

            // Send message to background.js
            chrome.runtime.sendMessage({ action: "fetchHints", problemData }, (response) => {
                loader.style.display = "none";

                if (response && response.success) {
                    renderAccordions(response.hints, hintsContainer);
                    hintsFetched = true;
                } else {
                    hintsContainer.innerHTML = `<p class="cp-error">${response?.error || 'Failed to connect to AI.'}</p>`;
                    // Allow retry if it failed
                    const retryBtn = document.createElement("button");
                    retryBtn.innerText = "Try Again";
                    retryBtn.className = "cp-retry-btn";
                    retryBtn.onclick = () => { hintsFetched = false; askBtn.click(); };
                    hintsContainer.appendChild(retryBtn);
                }
            });
        }
    };

    // Close panel event
    closeBtn.onclick = () => panel.classList.remove("open");
}

// 4. The Accordion Builder Logic
function renderAccordions(rawText, container) {
    // Assuming the AI returns hints separated by newlines and bullet points (*)
    const hintsArray = rawText.split(/\n\s*\*\s*/).filter(h => h.trim() !== '');

    hintsArray.forEach((hintText, index) => {
        // Clean up the string and bold any Markdown
        let cleanText = hintText.replace(/^Hint\s*\d*[:\-]\s*/i, '').trim();
        cleanText = cleanText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Create Accordion Item
        const item = document.createElement("div");
        item.className = "cp-accordion-item";

        // Create Header (The clickable dropdown)
        const header = document.createElement("button");
        header.className = "cp-accordion-header";
        header.innerHTML = `Hint ${index + 1} <span class="cp-icon">+</span>`;

        // Create Body (The retracted content)
        const content = document.createElement("div");
        content.className = "cp-accordion-content";
        content.innerHTML = `<p>${cleanText}</p>`;

        // The Click Logic for retracting/expanding
        header.onclick = () => {
            const isOpen = content.style.maxHeight;

            // Close all other accordions (optional, but keeps UI clean)
            document.querySelectorAll('.cp-accordion-content').forEach(c => c.style.maxHeight = null);
            document.querySelectorAll('.cp-icon').forEach(icon => icon.innerText = "+");
            document.querySelectorAll('.cp-accordion-header').forEach(h => h.classList.remove('active'));

            if (!isOpen) {
                // Open this one
                content.style.maxHeight = content.scrollHeight + "px";
                header.querySelector('.cp-icon').innerText = "−";
                header.classList.add('active');
            }
        };

        item.appendChild(header);
        item.appendChild(content);
        container.appendChild(item);
    });
}

// 5. Fire the injection if problem data exists
const problem = getProblemData();
if (problem) {
    injectUI(problem);
}