// messenger_api.js
const axios = require('axios');
const secrets = require('./secrets.js');

const { PAGE_ACCESS_TOKEN, ADMIN_ID } = secrets;

// Helper to pause execution (for retries)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Generic helper for API requests with basic error logging
async function callSendAPI(messageData) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
        return true; // Success
    } catch (error) {
        console.error("Facebook API Error:", error.response?.data || error.message);
        return false; // Failed
    }
}

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    return await callSendAPI(messageData);
}

async function sendQuickReplies(psid, text, replies) {
    const messageData = {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: {
            text: text,
            quick_replies: replies.map(reply => ({
                content_type: "text",
                title: reply.title,
                payload: reply.payload
            }))
        }
    };
    return await callSendAPI(messageData);
}

async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } },
        messaging_type: "RESPONSE"
    };
    return await callSendAPI(messageData);
}

// --- NEW: ROBUST ADMIN NOTIFICATION SYSTEM ---
// Tries to send a message to the admin up to 3 times if it fails.
async function notifyAdmin(text) {
    const messageData = { recipient: { id: ADMIN_ID }, message: { text: text }, messaging_type: "RESPONSE" };
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
            return; // Sent successfully, exit function
        } catch (error) {
            console.error(`[Admin Alert Failed] Attempt ${attempt}/3:`, error.message);
            if (attempt < 3) await sleep(1500); // Wait 1.5 seconds before retrying
        }
    }
    console.error("CRITICAL: Could not send message to Admin after 3 attempts.");
}

const userProfileCache = new Map();
async function getUserProfile(psid) {
    if (userProfileCache.has(psid)) {
        return userProfileCache.get(psid);
    }
    try {
        const url = `https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`;
        const response = await axios.get(url);
        if (response.data) {
            const fullName = `${response.data.first_name} ${response.data.last_name}`;
            userProfileCache.set(psid, fullName);
            return fullName;
        }
    } catch (error) {
        console.error(`Failed to fetch user profile for ${psid}:`, error.message);
        return "User";
    }
    return psid;
}

module.exports = {
    sendText,
    sendImage,
    getUserProfile,
    sendQuickReplies,
    notifyAdmin // Export the new function
};
