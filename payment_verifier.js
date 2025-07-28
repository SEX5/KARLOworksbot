// payment_verifier.js (Node.js Version - Upgraded to Gemini 1.5 Pro)
const axios = require('axios');
const fs = require('fs/promises'); // Using fs.promises for async file operations
const sharp = require('sharp');
const secrets = require('./secrets.js'); // Keeping this as you requested

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
// --- THIS IS THE UPGRADED MODEL ---
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=";


const ANALYSIS_PROMPT = `
You are a highly-attentive payment verification assistant. Your task is to analyze payment receipt screenshots to check for legitimacy.

INSTRUCTIONS:
1.  Read all visible text from the receipt. Pay extremely close attention to:
    - Reference Number (Ref No)
    - Amount Sent
    - Recipient's Name or Number
    - Sender's Name or Number
    - Date and Time

2.  Critically assess the image for signs of digital manipulation or forgery. Look for:
    - Mismatched fonts, colors, or font sizes, especially in the amount or reference number.
    - Blurry areas, smudges, or pixelation that could indicate editing.
    - Text that is not perfectly aligned.
    - An unusually clean or generic-looking template.

3.  Make a final recommendation based on your findings.

DECISION CRITERIA:
-   **APPROVED:** The receipt looks completely legitimate, text is clear, and there are no obvious signs of editing.
-   **FLAGGED:** The receipt might be real, but something is suspicious. For example, some text is blurry, the alignment is slightly off, a detail is missing, or the amount seems incorrect. This requires human review.
-   **REJECTED:** The receipt is clearly fake. There are obvious signs of digital editing (like different fonts on the same line), or critical information like the reference number is completely missing.

Respond in this exact JSON format. Do not include any other text, comments, or markdown formatting.
{
    "extracted_info": {
        "reference_number": "The 13-digit reference number you read, or 'Not Found'",
        "amount": "The amount you read, or 'Not Found'",
        "date": "The date and time you read, or 'Not Found'"
    },
    "verification_status": "APPROVED/FLAGGED/REJECTED",
    "reasoning": "A brief but specific explanation for your decision. Mention any suspicious elements you found (e.g., 'Fonts in amount seem different', 'Reference number is blurry')."
}
`; // End of ANALYSIS_PROMPT


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

// Helper function to create a delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sends the analysis request to the Gemini API with retry logic.
 * @param {string} image_b64 - The base64 encoded image data.
 * @returns {Promise<object|null>} The parsed JSON analysis or null on error.
 */
async function sendGeminiRequest(image_b64) {
    const maxRetries = 3;
    const payload = {
        "contents": [{
            "parts": [
                { "text": ANALYSIS_PROMPT },
                { "inline_data": { "mime_type": "image/png", "data": image_b64 } }
            ]
        }]
    };
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Sending request to Gemini Vision API (Attempt ${attempt}/${maxRetries})...`);
            const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 60000 }); // Increased timeout for Pro model
            
            if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                let content = response.data.candidates[0].content.parts[0].text;
                content = content.trim().replace('```json', '').replace('```', '');
                return JSON.parse(content); // Success, so we exit the loop
            } else {
                console.error("Invalid response structure from Gemini API:", response.data);
                throw new Error("Invalid response structure from Gemini.");
            }
        } catch (error) {
            const isOverloaded = error.response?.status === 503;
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;

            console.error(`Gemini request failed on attempt ${attempt}:`, errorMessage);

            if (isOverloaded && attempt < maxRetries) {
                const delayTime = 1500 * attempt;
                console.log(`Model is overloaded. Retrying in ${delayTime / 1000} seconds...`);
                await delay(delayTime);
            } else {
                throw new Error(errorMessage);
            }
        }
    }
}

function createErrorJson(reason) {
    return {
        extracted_info: {},
        verification_status: "FLAGGED",
        reasoning: `Script Error: ${reason}`
    };
}

module.exports = {
    encodeImage,
    sendGeminiRequest,
    createErrorJson
};
