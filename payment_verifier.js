// payment_verifier.js (Updated with Llama 3.2 and the Original Detailed Prompt)
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
const secrets = require('./secrets.js');

const { OPENROUTER_API_KEY, SITE_URL, SPACE_OCR_API_KEY } = secrets;

// --- OpenRouter Configuration ---
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Using Meta's new Llama 3.2 Vision model.
const MODEL_TO_USE = 'meta-llama/llama-3.2-11b-vision-instruct:free';

// --- THIS IS THE UPDATED, ORIGINAL DETAILED PROMPT ---
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
        "reference_number": "The 13-digit reference number you read, with any spaces removed, or 'Not Found'",
        "amount": "The amount you read, or 'Not Found'",
        "date": "The date and time you read, or 'Not Found'"
    },
    "verification_status": "APPROVED/FLAGGED/REJECTED",
    "reasoning": "A brief but specific explanation for your decision. Mention any suspicious elements you found (e.g., 'Fonts in amount seem different', 'Reference number is blurry')."
}
`;

// --- Space OCR Configuration (for fallback) ---
const OCR_URL = 'https://api.ocr.space/parse/image';


async function encodeImage(imageBuffer) {
    try {
        let resizedBuffer = await sharp(imageBuffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .png()
            .toBuffer();
        return resizedBuffer.toString('base64');
    } catch (error) {
        console.error("Image processing error with sharp:", error);
        return null;
    }
}

/**
 * [INTERNAL] Tries to analyze the receipt using the OpenRouter API.
 */
async function _analyzeWithOpenRouter(image_b64) {
    if (!OPENROUTER_API_KEY || !SITE_URL) {
        throw new Error("OpenRouter API Key or Site URL is not configured in secrets.js.");
    }

    const headers = {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': SITE_URL, 
        'X-Title': 'ModShop Bot', 
    };

    const payload = {
        model: MODEL_TO_USE,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: ANALYSIS_PROMPT },
                {
                    type: "image_url",
                    image_url: { "url": `data:image/png;base64,${image_b64}` }
                }
            ]
        }]
    };

    console.log(`Attempting receipt analysis with OpenRouter (Model: ${MODEL_TO_USE})...`);
    const response = await axios.post(OPENROUTER_API_URL, payload, { headers, timeout: 45000 });

    if (response.data?.choices?.[0]?.message?.content) {
        let content = response.data.choices[0].message.content;
        content = content.trim().replace(/```json/g, '').replace(/```/g, ''); // Use global replace for safety
        console.log("OpenRouter analysis successful.");
        const parsed = JSON.parse(content);
        if (parsed.extracted_info?.reference_number) {
            parsed.extracted_info.reference_number = parsed.extracted_info.reference_number.replace(/\s/g, '');
        }
        return parsed;
    } else {
        console.error("Invalid response structure from OpenRouter API:", response.data);
        throw new Error("Invalid response structure from OpenRouter.");
    }
}


/**
 * [INTERNAL] The same reliable OCR fallback logic.
 */
async function _analyzeWithOcr(image_b64) {
    if (!SPACE_OCR_API_KEY || !SPACE_OCR_API_KEY.startsWith('K8')) {
        throw new Error("Space OCR API Key is missing or invalid.");
    }
    const form = new FormData();
    form.append('apikey', SPACE_OCR_API_KEY);
    form.append('base64Image', `data:image/jpeg;base64,${image_b64}`);
    
    console.log("Attempting receipt analysis with Space OCR API (fallback)...");
    const response = await axios.post(OCR_URL, form, { headers: form.getHeaders(), timeout: 30000 });

    const data = response.data;
    if (data.IsErroredOnProcessing || !data.ParsedResults || data.ParsedResults.length === 0) {
        throw new Error(data.ErrorMessage ? data.ErrorMessage.join('; ') : 'No parsed results from OCR.');
    }
    
    const parsedText = data.ParsedResults[0].ParsedText;
    const lines = parsedText.split(/[\r\n]+/);
    let refNumber = null, amount = null;
    const amountRegex = /(?:PHP|₱|Amount(?: Sent)?)?\s*([\d,]+\.\d{2})\b/;

    for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('ref no')) {
            const extractedDigits = line.replace(/\D/g, ''); 
            if (extractedDigits.length === 13) refNumber = extractedDigits;
        }
        const amountMatch = line.match(amountRegex);
        if (amountMatch && amountMatch[1]) {
            if (lowerLine.includes('total') || !amount) {
                amount = amountMatch[1].replace(/,/g, '');
            }
        }
    }
    
    if (!refNumber || !amount) {
        throw new Error(`OCR could not reliably extract both values. Found Ref: ${refNumber}, Found Amount: ${amount}`);
    }

    console.log("Space OCR analysis successful.");
    return {
        extracted_info: { reference_number: refNumber, amount: amount, date: "Not Found via OCR" },
        verification_status: "APPROVED", // Fallback always assumes approved, relies on admin to check image.
        reasoning: "Data extracted via Space OCR fallback. Admin should verify receipt."
    };
}


/**
 * [PUBLIC] Main analysis function with the new OpenRouter primary.
 */
async function analyzeReceipt(image_b64) {
    try {
        const openRouterResult = await _analyzeWithOpenRouter(image_b64);
        if (openRouterResult && openRouterResult.extracted_info?.reference_number && openRouterResult.extracted_info?.amount) {
            openRouterResult.extracted_info.reference_number = openRouterResult.extracted_info.reference_number.replace(/\s/g, '');
            if (/^\d{13}$/.test(openRouterResult.extracted_info.reference_number)) {
                return openRouterResult;
            }
        }
        throw new Error("OpenRouter returned a malformed or incomplete result.");
    } catch (openRouterError) {
        console.warn(`OpenRouter API failed: ${openRouterError.message}. Attempting fallback to Space OCR...`);
        try {
            return await _analyzeWithOcr(image_b64);
        } catch (ocrError) {
            console.error(`Space OCR fallback also failed: ${ocrError.message}`);
            throw new Error("Both OpenRouter and OCR services failed to analyze the receipt.");
        }
    }
}

module.exports = {
    encodeImage,
    analyzeReceipt
};
