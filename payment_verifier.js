// payment_verifier.js (Updated with Robust JSON Extraction)
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

// This prompt is designed to force the AI to return ONLY valid JSON
const ANALYSIS_PROMPT = `
CRITICAL INSTRUCTION: Analyze the provided GCash receipt. 
Read the Reference Number (13 digits), the Amount Sent, and the Date.
Check for signs of digital manipulation (editing).

YOU MUST reply ONLY with a valid JSON object. 
Do not add any introductory text, markdown, or explanations. 

Format:
{
    "extracted_info": {
        "reference_number": "The 13-digit reference number, or 'Not Found'",
        "amount": "The amount, or 'Not Found'",
        "date": "The date and time, or 'Not Found'"
    },
    "verification_status": "APPROVED/FLAGGED/REJECTED",
    "reasoning": "A brief explanation for your decision."
}
`;

/**
 * Resizes the image to save bandwidth and encodes it to Base64 for the Gemini API.
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
 * Helper to extract JSON from AI text that might contain markdown or conversational filler.
 */
function extractJsonFromText(text) {
    try {
        // Find the first '{' and the last '}'
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (jsonMatch && jsonMatch[0]) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error("No JSON object found in response");
    } catch (e) {
        console.error("Failed to parse AI response as JSON. Raw text:", text);
        return null;
    }
}

/**
 * Primary API: Norch Project (External Gemini Wrapper)
 */
async function sendNorchRequest(imageUrl) {
    console.log("Attempting analysis with Primary API (Norch)...");
    
    const encodedPrompt = encodeURIComponent(ANALYSIS_PROMPT);
    const encodedImageUrl = encodeURIComponent(imageUrl);
    const API_URL = `https://norch-project.gleeze.com/api/gemini?prompt=${encodedPrompt}&imageurl=${encodedImageUrl}`;

    try {
        const response = await axios.get(API_URL, { timeout: 45000 });
        
        if (response.data && response.data.response) {
            const parsed = extractJsonFromText(response.data.response);
            if (parsed && parsed.verification_status) return parsed;
        }
        throw new Error("Invalid response format from Norch.");
    } catch (error) {
        console.error("Primary API (Norch) request failed:", error.message);
        throw error; 
    }
}

/**
 * Fallback API: Google Gemini Direct (Vision API)
 */
async function sendGeminiRequest(image_b64) {
    console.log("Attempting analysis with Fallback API (Gemini Direct)...");
    const payload = {
        "contents": [{
            "parts": [
                { "text": ANALYSIS_PROMPT },
                { "inline_data": { "mime_type": "image/png", "data": image_b64 } }
            ]
        }]
    };

    try {
        const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 60000 });
        
        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const rawText = response.data.candidates[0].content.parts[0].text;
            const parsed = extractJsonFromText(rawText);
            if (parsed && parsed.verification_status) return parsed;
        }
        throw new Error("Invalid response structure from Gemini API.");
    } catch (error) {
        console.error("Gemini Direct request failed:", error.message);
        throw error;
    }
}

/**
 * Main function that tries the Primary API first, then falls back to Gemini Direct.
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    try {
        // 1. Try Norch (Primary)
        return await sendNorchRequest(imageUrl);
    } catch (primaryError) {
        console.warn("Primary API failed. Proceeding to Fallback API...");
        try {
            // 2. Try Google Gemini (Fallback)
            return await sendGeminiRequest(image_b64);
        } catch (fallbackError) {
            console.error("Both analysis APIs failed.");
            return {
                extracted_info: {},
                verification_status: "FLAGGED",
                reasoning: "System Error: Both AI analysis endpoints are currently unavailable. Manual check required."
            };
        }
    }
}

module.exports = {
    encodeImage,
    analyzeReceiptWithFallback
};
