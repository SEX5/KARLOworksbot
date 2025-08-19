// index.js (Minimal Bot for Live Testing)
const express = require('express');
const axios = require('axios');

// --- CONFIGURATION ---
// These will be set in the Render environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// The prompt for the Rapido API
const RECEIPT_PROMPT = `
Analyze the attached GCash receipt image and extract the amount and the 13-digit reference number.
Return the result ONLY in a valid JSON object format:
{ "extracted_info": { "amount": "...", "reference_number": "..." } }
Do not add any text before or after the JSON.
`;

const app = express();
app.use(express.json());

// --- FACEBOOK WEBHOOK SETUP (Handles Verification) ---
app.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// --- FACEBOOK WEBHOOK SETUP (Handles Messages) ---
app.post('/webhook', (req, res) => {
    if (req.body.object === 'page') {
        req.body.entry.forEach(entry => {
            const event = entry.messaging[0];
            if (event?.sender?.id && event.message) {
                handleMessage(event.sender.id, event.message);
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

/**
 * Main function to handle incoming messages from users.
 */
async function handleMessage(sender_psid, message) {
    // If the message has an image attachment, process it.
    if (message.attachments && message.attachments[0].type === 'image') {
        const imageUrl = message.attachments[0].payload.url;
        await sendText(sender_psid, "✅ Image received. Analyzing with Rapido API, please wait...");

        const analysisResult = await analyzeReceiptWithRapido(imageUrl);

        if (analysisResult && analysisResult.extracted_info) {
            const amount = analysisResult.extracted_info.amount || 'Not found';
            const ref = analysisResult.extracted_info.reference_number || 'Not found';
            const successMessage = `✅ Analysis Success!\n\nAmount: ${amount}\nReference No: ${ref}`;
            await sendText(sender_psid, successMessage);
        } else {
            await sendText(sender_psid, "❌ Analysis Failed. The API could not extract the required information. Please try another image.");
        }
    } else {
        // If the message is just text, reply with instructions.
        await sendText(sender_psid, "Hello! This is a test bot. Please send a GCash receipt image to test the Rapido API analysis.");
    }
}

/**
 * The core function that calls the Rapido API.
 */
async function analyzeReceiptWithRapido(imageUrl) {
    console.log(`Analyzing image URL: ${imageUrl}`);
    const encodedPrompt = encodeURIComponent(RECEIPT_PROMPT);
    const encodedImageUrl = encodeURIComponent(imageUrl);
    const RAPIDO_API_URL = `https://rapido.zetsu.xyz/api/gemini?chat=${encodedPrompt}&imageUrl=${encodedImageUrl}`;

    try {
        const response = await axios.get(RAPIDO_API_URL);
        if (!response.data || response.data.status === false || !response.data.response) {
            throw new Error(`API returned an error: ${response.data.error || 'No response data'}`);
        }
        const rawText = response.data.response;
        console.log(`Raw API Response: ${rawText}`);

        const jsonMatch = rawText.match(/({[\s\S]*})/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1]);
        } else {
            throw new Error("No JSON object found in the response.");
        }
    } catch (error) {
        console.error("Error during Rapido API call or parsing:", error.message);
        return null;
    }
}

/**
 * Helper function to send a text message back to the user.
 */
async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text } };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending message:", error.response?.data?.error || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Test bot is listening on port ${PORT}.`));
