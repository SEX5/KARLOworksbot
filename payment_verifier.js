// payment_verifier.js
const axios = require('axios');
const sharp = require('sharp');
const secrets = require('./secrets.js');

const GEMINI_API_KEY = secrets.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=";

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
`; 

const RAPIDO_ANALYSIS_PROMPT = `
You are a payment verification assistant. Analyze the provided GCash receipt screenshot.

INSTRUCTIONS:
1. Extract the Reference Number, Amount, and Date.
2. Check for signs of digital editing like mismatched fonts, blurriness, or misalignment.
3. Make a final decision: APPROVED (looks real), FLAGGED (suspicious, needs human check), or REJECTED (clearly fake).

Respond ONLY in this exact JSON format. No extra text or markdown.
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
            const response = await axios.post(`${BASE_URL}${GEMINI_API_KEY}`, payload, { timeout: 60000 });
            
            if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                let content = response.data.candidates[0].content.parts[0].text;
                content = content.trim().replace('```json', '').replace('```', '');
                return JSON.parse(content);
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

async function sendRapidoRequest(imageUrl) {
    console.log("Attempting analysis with Primary API (Rapido)...");
    const encodedPrompt = encodeURIComponent(RAPIDO_ANALYSIS_PROMPT);
    const encodedImageUrl = encodeURIComponent(imageUrl);
    const RAPIDO_API_URL = `https://rapido.zetsu.xyz/api/gemini?chat=${encodedPrompt}&imageUrl=${encodedImageUrl}`;

    try {
        const response = await axios.get(RAPIDO_API_URL, { timeout: 45000 });

        if (!response.data || response.data.status === false || !response.data.response) {
            throw new Error(`Rapido API responded with an error: ${response.data.error || 'No response data'}`);
        }

        const rawText = response.data.response;
        const jsonMatch = rawText.match(/({[\s\S]*})/);
        if (jsonMatch) {
            const parsedJson = JSON.parse(jsonMatch[1]);
            if (parsedJson.verification_status && parsedJson.extracted_info) {
                console.log("Primary API (Rapido) analysis successful.");
                return parsedJson;
            }
        }
        throw new Error("Response from Rapido API did not contain a valid JSON object.");

    } catch (error) {
        console.error("Primary API (Rapido) request failed:", error.message);
        throw error;
    }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    try {
        const primaryResult = await sendRapidoRequest(imageUrl);
        return primaryResult;
    } catch (primaryError) {
        console.warn("Primary API (Rapido) failed. Proceeding to Fallback API (Gemini)...");
        try {
            const fallbackResult = await sendGeminiRequest(image_b64);
            return fallbackResult;
        } catch (fallbackError) {
            console.error("Fallback API (Gemini) also failed. Analysis could not be completed.");
            return createErrorJson("Both primary and fallback analysis APIs failed.");
        }
    }
}

module.exports = {
    encodeImage,
    analyzeReceiptWithFallback
};
