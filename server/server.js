// server/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Schema } = mongoose;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// 1. Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB Database'))
    .catch(err => console.error('MongoDB Connection Error:', err));


// DB schema...
// We need to define how a User looks in our database for the Token Bucket.
const userSchema = new Schema(
    {
        userID: {
            type: String,
            required: true,
            unique: true,
        },
        tokens: {
            type: Number,
            default: 5,
        },
        lastRefillTimestamp: {
            type: Number,
            default: Date.now,
        }
    }
);

const User = mongoose.model('User', userSchema);

const MAX_TOKENS = 5;
const REFILL_RATE = 15 * 60000;
const COST_HINT = 1;

// MIDDLEWARE FOR API RATE LIMITING 
async function tokenBucketLimiter(req, res, next) {
    const extensionId = req.headers['extension-id'];

    if (!extensionId) {
        return res.status(401).json({
            success: false,
            error: "Missing Extension ID"
        });
    }

    try {
        const currentTime = Date.now();

        let user = await User.findOne({ userID: extensionId });

        if (!user) {
            // new user 
            // let's create the user 
            user = new User({
                userID: extensionId,
                tokens: MAX_TOKENS,
                lastRefillTimestamp: currentTime,
            });
        }

        const timePassed = currentTime - user.lastRefillTimestamp;

        // check for >= 1 token to be added 
        if (timePassed >= REFILL_RATE) {
            let tokenstoAdd = Math.floor(timePassed / REFILL_RATE);

            user.tokens = Math.min(MAX_TOKENS, user.tokens + tokenstoAdd);

            user.lastRefillTimestamp += tokenstoAdd * REFILL_RATE;
        }

        // token deduction...
        if (user.tokens >= 1) {
            user.tokens -= COST_HINT;
            await user.save();

            next();
        } else {
            await user.save();

            // time till next token...
            // how much time has passed since last refill and the difference between that and the refill rate 
            const timetillnextToken = REFILL_RATE - (currentTime - user.lastRefillTimestamp);

            return res.status(403).json({
                success: false,
                error: "Rate Limit Exceeded. Please try again later.",
                tokens: user.tokens,
                timeTillNextToken: Math.ceil(timetillnextToken / 1000),
            });
        }


    } catch (error) {
        console.log("Rate Limiting Error: ", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}


// Models to try in order — falls back if a model is overloaded (503/429)
const MODEL_FALLBACK_CHAIN = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-flash",
];

const MAX_RETRIES_PER_MODEL = 2;
const INITIAL_RETRY_DELAY_MS = 1500;

// Returns true if the error is a transient server-side overload
function isOverloadError(error) {
    const msg = (error?.message || "").toLowerCase();
    const status = error?.status || error?.response?.status;
    return (
        status === 503 ||
        status === 429 ||
        msg.includes("503") ||
        msg.includes("429") ||
        msg.includes("overloaded") ||
        msg.includes("high demand") ||
        msg.includes("service unavailable") ||
        msg.includes("resource_exhausted")
    );
}

// Tries a single model with exponential backoff retries
async function tryModelWithRetry(modelName, prompt) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        try {
            console.log(`[Gemini] Trying model: ${modelName} (attempt ${attempt}/${MAX_RETRIES_PER_MODEL})`);

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                const err = new Error(data?.error?.message || `HTTP ${res.status}`);
                err.status = res.status;
                err.reason = data?.error?.details?.[0]?.reason;
                throw err;
            }

            return data.candidates[0].content.parts[0].text;

        } catch (error) {
            lastError = error;
            if (isOverloadError(error) && attempt < MAX_RETRIES_PER_MODEL) {
                const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                console.warn(`[Gemini] ${modelName} overloaded. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }
    throw lastError;
}

// Walks through the fallback chain until one model succeeds
async function generateWithFallback(prompt) {
    let lastError;

    for (const modelName of MODEL_FALLBACK_CHAIN) {
        try {
            const text = await tryModelWithRetry(modelName, prompt);
            console.log(`[Gemini] Success with model: ${modelName}`);
            return { text, modelUsed: modelName };
        } catch (error) {
            lastError = error;
            if (isOverloadError(error)) {
                console.warn(`[Gemini] Model ${modelName} failed with overload — trying next in chain...`);
            } else {
                // Non-overload error (e.g. bad API key, invalid prompt) — fail fast
                console.error(`[Gemini] Model ${modelName} failed with non-retryable error:`, error.message);
                throw error;
            }
        }
    }

    // All models exhausted
    const err = new Error("All Gemini models are currently overloaded. Please try again later.");
    err.allModelsExhausted = true;
    throw err;
}


// Route
app.post('/api/hints', tokenBucketLimiter, async (req, res) => {
    const { platform, title, body } = req.body;

    if (!title || !body) {
        return res.status(400).json(
            {
                success: false,
                error: "Missing problem data from extension!"
            }
        );
    }

    // system prompt
    const prompt = `You are an elite competitive programming coach. Your goal is to guide the user using First Principles Thinking.
    Do NOT provide the final code or the exact solution.

    STRICT FORMATTING RULES (follow exactly):
    - Output EXACTLY 5 hints as a bulleted list, each starting with "* " on its own line.
    - Do NOT use LaTeX or dollar-sign math notation (e.g. never write $a_1$ or $\\le$).
    - Write all math and variables in plain English or use backtick inline code (e.g. \`a[i]\`, \`n-1\`, \`a[i] > a[i+1]\`).
    - You may use **bold** for key terms and \`backticks\` for variable/formula names.
    - Do not include introductory or concluding conversational text.
    - Do not add numbered sub-lists inside hints; keep each hint as a single focused paragraph.

    The 5 hints must be progressive:
    1. High-level intuition — what kind of problem is this?
    2. Identifying the core constraints / bottlenecks.
    3. Key mathematical or logical deduction.
    4. Choosing the right data structure or algorithm.
    5. Pseudocode structure — sketch the approach.

    Problem Platform: ${platform}
    Problem Title: ${title}
    Problem Description: ${body}
    `;

    try {
        const { text, modelUsed } = await generateWithFallback(prompt);

        console.log(`[Gemini] Response from ${modelUsed}:`, text);

        return res.status(200).json({
            success: true,
            hints: text,
            modelUsed,
        });

    } catch (error) {
        console.error("Error generating hints:", error.message);

        if (error.allModelsExhausted) {
            return res.status(503).json({
                success: false,
                error: "All AI models are currently experiencing high demand. Please wait a moment and try again.",
            });
        }

        return res.status(500).json({
            success: false,
            error: "Failed to generate hints",
        });
    }
});


// Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});