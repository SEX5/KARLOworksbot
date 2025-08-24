// messenger_api.js
const axios = require('axios');
const secrets = require('./secrets.js');

const { PAGE_ACCESS_TOKEN } = secrets;

/**
 * Sends a text message to a user.
 * @param {string} psid - The user's Page-Scoped ID.
 * @param {string} text - The message to send.
 */
async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending text message:", error.response?.data || error.message);
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
 * Caches the result to avoid repeated API calls for the same user.
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
    getUserProfile
};
