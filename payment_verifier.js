// payment_verifier.js (Node.js Version - Corrected Gemini API URL)
const axios = require('axios');
const fs = require('fs/promises'); // Using fs.promises for async file operations
const sharp = require('sharp');
const secrets = require('./secrets.js');

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
// --- THIS IS THE CORRECTED BASE_URL ---
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=";


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

        // --- NEW: Use the BASE_URL directly with the API key ---
        const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 45000 });
        
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
        throw new Error(errorMessage); // Re-throw to be caught by handleReceiptSubmission
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
