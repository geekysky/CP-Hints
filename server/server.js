// server/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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

            user.tokens = Math.min(MAX_TOKENS, user.tokens + tokensToAdd);

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

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // system prompt 
        const prompt = `You are an elite competitive programming coach. Your goal is to guide the user using First Principles Thinking.
        Do NOT provide the final code or the exact solution. 
        
        Analyze the problem and provide EXACTLY 5 progressive hints:
        1. High-level intuition.
        2. Identifying the core constraints / bottlenecks.
        3. Mathematical or logical deductions.
        4. Choosing the right data structure/algorithm.
        5. Pseudocode structure.

        Format the output strictly as a bulleted list using an asterisk (*) for each hint, separated by newlines. 
        Do not include introductory or concluding conversational text.

        Problem Platform: ${platform}
        Problem Title: ${title}
        Problem Description: ${body}
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return res.status(200).json({
            success: true,
            data: responseText
        });

    } catch (error) {
        console.log("Error generating hints: ", error);
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