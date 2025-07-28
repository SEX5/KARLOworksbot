// payment_verifier.js (Node.js Version)
const axios = require('axios');
const fs = require('fs/promises');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
const BASE_URL = "https://generativelenanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent";

const ANALYSIS_PROMPT = `You are a highly-attentive payment verification assistant... (Your full prompt from the Python file goes here)`;

/**
 * Resizes and encodes an image to base64.
 * @param {Buffer} imageBuffer - The raw buffer of the image.
 * @returns {Promise<string|null>} The base64 encoded string or null on error.
 */
async function encodeImage(imageBuffer) {
    try {
        let resizedBuffer = await sharp(imageBuffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .png()
            .toBuffer();
        
        return resizedBuffer.toString('base64');
    } catch (error) {
        console.error("Image processing error:", error);
        return null;
    }
}

/**
 * Sends the analysis request to the Gemini API.
 * @param {string} image_b64 - The base64 encoded image data.
 * @returns {Promise<object|null>} The parsed JSON analysis or null on error.
 */
async function sendGeminiRequest(image_b64) {
    try {
        console.log("Sending request to Gemini Vision API...");
        const payload = {
            "contents": [{
                "parts": [
                    { "text": ANALYSIS_PROMPT },
                    { "inline_data": { "mime_type": "image/png", "data": image_b64 } }
                ]
            }]
        };

        const response = await axios.post(`${BASE_URL}?key=${GEMINI_API_KEY}`, payload, { timeout: 45000 });
        
        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            let content = response.data.candidates[0].content.parts[0].text;
            content = content.trim().replace('```json', '').replace('```', '');
            return JSON.parse(content);
        } else {
            console.error("Invalid response structure from Gemini API:", response.data);
            return null;
        }
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("Gemini request failed:", errorMessage);
        return null;
    }
}

/**
 * Creates a standardized error JSON output.
 * @param {string} reason - The reason for the error.
 * @returns {object} The error object.
 */
function createErrorJson(reason) {
    return {
        extracted_info: {},
        verification_status: "FLAGGED",
        reasoning: `Script Error: ${reason}`
    };
}


// --- Main export ---
module.exports = {
    encodeImage,
    sendGeminiRequest,
    createErrorJson
};
