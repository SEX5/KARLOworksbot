// messenger_api.js (Final Version with Smart Message Splitting)

const axios = require('axios');
const secrets = require('./secrets.js');
const { PAGE_ACCESS_TOKEN } = secrets;

const API_URL = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
const MESSAGE_CHAR_LIMIT = 10000; // Facebook's character limit

/**
 * Sends a text message. If the message is too long, it splits it into
 * multiple smaller messages and sends them sequentially.
 * @param {string} psid - The user's Page-Scoped ID.
 * @param {string} text - The text to send.
 */
async function sendText(psid, text) {
    // If the text is safely under the limit, send it in one go.
    if (text.length <= MESSAGE_CHAR_LIMIT) {
        await sendTextChunk(psid, text);
        return;
    }

    console.log("Message is too long. Splitting into multiple chunks...");
    // If the text is too long, split it into chunks.
    const chunks = splitTextIntoChunks(text, MESSAGE_CHAR_LIMIT);

    // Send each chunk one by one.
    for (const chunk of chunks) {
        await sendTextChunk(psid, chunk);
        // Add a small delay between messages to ensure they arrive in order.
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5-second delay
    }
}

/**
 * A helper function to split text into chunks that respect word boundaries.
 * @param {string} text - The full text to split.
 * @param {number} limit - The character limit for each chunk.
 * @returns {string[]} An array of text chunks.
 */
function splitTextIntoChunks(text, limit) {
    const chunks = [];
    let currentChunk = "";

    const words = text.split(' ');
    for (const word of words) {
        // Check if adding the next word (plus a space) would exceed the limit.
        if ((currentChunk.length + word.length + 1) > limit) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
        currentChunk += word + " ";
    }
    // Add the last remaining chunk
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }
    return chunks;
}


/**
 * The core function that sends a single message chunk to the Messenger API.
 * @param {string} psid - The user's Page-Scoped ID.
 * @param {string} textChunk - The piece of text to send (must be under 2000 chars).
 */
async function sendTextChunk(psid, textChunk) {
    const messageData = { 
        recipient: { id: psid }, 
        message: { text: textChunk },
        messaging_type: "RESPONSE" // Ensure it's a direct reply
    };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
        console.error("Error sending text message chunk:", error.response?.data?.error || error.message);
    }
}


// --- The rest of the functions remain the same ---

async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } }
    };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
        console.error("Error sending image message:", error.response?.data?.error || error.message);
        await sendText(psid, `I couldn't display the image, but here is the link: ${imageUrl}`);
    }
}

async function sendVideo(psid, videoUrl, title) {
    await sendText(psid, "Sending video, please wait...");
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "video", payload: { url: videoUrl, is_reusable: false } } }
    };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
        console.error("Error sending video attachment:", error.response?.data?.error || error.message);
        await sendText(psid, `I couldn't send the video directly (it might be too large). Here is the download link for "*${title}*":\n\n${videoUrl}`);
    }
}

async function sendGenericTemplate(psid, elements) {
    const messageData = {
        recipient: { id: psid },
        message: {
            attachment: {
                type: "template",
                payload: { template_type: "generic", elements: elements }
            }
        }
    };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
        console.error("Error sending generic template:", error.response?.data?.error || error.message);
    }
}

module.exports = {
    sendText,
    sendImage,
    sendVideo,
    sendGenericTemplate
};
