// messenger_api.js
const axios = require('axios');
const secrets = require('./secrets.js');
const { PAGE_ACCESS_TOKEN } = secrets;
const API_URL = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text } };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
        console.error("Error sending text message:", error.response?.data?.error || error.message);
    }
}

async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } }
    };
    try {
        await axios.post(API_URL, messageData);
    } catch (error) {
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

module.exports = { sendText, sendImage, sendVideo, sendGenericTemplate };
