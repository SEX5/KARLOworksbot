// messenger_api.js
const axios = require('axios');
const secrets = require('./secrets.js');

const { PAGE_ACCESS_TOKEN } = secrets;

/**
 * Sends a text message to a user.
 * @param {string} psid - This is the user's unique Page-Scoped ID (PSID).
 * @param {string} text - The message to send.
 * @param {string} [tag=null] - An optional message tag for notifications (e.g., "POST_PURCHASE_UPDATE").
 */
async function sendText(psid, text, tag = null) {
    const messageData = {
        recipient: { id: psid }, // The PSID is used here to identify the recipient.
        message: { text: text },
        messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE"
    };

    if (tag) {
        messageData.tag = tag;
    }

    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending text message:", error.response?.data || error.message);
        // CRITICAL FIX: Re-throw the error so the calling function (the poller) knows the message failed.
        throw error;
    }
}

/**
 * Sends a text message with quick reply buttons.
 * @param {string} psid - The user's Page-Scoped ID.
 * @param {string} text - The message to send.
 * @param {Array<Object>} replies - An array of quick reply objects.
 */
async function sendQuickReplies(psid, text, replies) {
    const quickReplies = replies.map(reply => ({
        content_type: "text",
        title: reply.title,
        payload: reply.payload
    }));

    const messageData = {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: {
            text: text,
            quick_replies: quickReplies
        }
    };

    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending quick replies:", error.response?.data || error.message);
    }
}

/**
 * Sends an image message to a user.
 * @param {string} psid - The user's Page-Scoped ID.
 * @param {string} imageUrl - The public URL of the image to send.
 */
async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } },
        messaging_type: "RESPONSE"
    };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    }
    catch (error) {
        console.error("Error sending image message:", error.response?.data || error.message);
    }
}

/**
 * Fetches a user's first and last name from the Messenger API.
 * @param {string} psid - The user's Page-Scoped ID.
 */
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
            userProfileCache.set(psid, fullName); // Cache the name
            return fullName;
        }
    } catch (error) {
        console.error(`Failed to fetch user profile for ${psid}:`, error.response?.data || error.message);
        return psid; // Fallback to the ID if the API call fails
    }
    return psid; // Fallback
}

module.exports = {
    sendText,
    sendImage,
    getUserProfile,
    sendQuickReplies
};
