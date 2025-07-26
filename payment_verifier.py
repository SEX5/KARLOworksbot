# payment_verifier.py
import sys, os, base64, json, requests, io
from PIL import Image
API_KEY = sys.argv[1] if len(sys.argv) > 1 else None
IMAGE_PATH = sys.argv[2] if len(sys.argv) > 2 else None
BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent"
ANALYSIS_PROMPT = """You are a highly-attentive payment verification assistant. Your task is to analyze payment receipt screenshots to check for legitimacy. INSTRUCTIONS: 1. Read all visible text, paying close attention to: Reference Number (Ref No), Amount Sent, Recipient, Sender, Date, and Time. 2. Critically assess the image for signs of digital manipulation. Look for: mismatched fonts, blurry areas, pixelation, and misaligned text. 3. Make a final recommendation. DECISION CRITERIA: - **APPROVED:** The receipt looks completely legitimate. - **FLAGGED:** The receipt might be real, but something is suspicious (blurry text, odd alignment). Requires human review. - **REJECTED:** The receipt is clearly fake (obvious digital editing, critical information missing). Respond in this exact JSON format. Do not include any other text or markdown. { "extracted_info": { "reference_number": "The 13-digit reference number you read, or 'Not Found'", "amount": "The amount you read, or 'Not Found'", "date": "The date and time you read, or 'Not Found'" }, "verification_status": "APPROVED/FLAGGED/REJECTED", "reasoning": "A brief, specific explanation for your decision." } """
def log_error(message): print(message, file=sys.stderr)
def encode_image(image_path):
    try:
        with open(image_path, 'rb') as image_file:
            img = Image.open(image_file)
            if img.width > 1024: img = img.resize((1024, int(img.height * 1024 / img.width)), Image.Resampling.LANCZOS)
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='PNG')
            return base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
    except Exception as e: log_error(f"Image encoding error: {e}"); return None
def send_gemini_request(image_data, prompt):
    try:
        headers = {'Content-Type': 'application/json'}
        payload = {"contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/png", "data": image_data}}]}]}
        url = f"{BASE_URL}?key={API_KEY}"
        log_error("Sending request to Gemini Vision API...")
        response = requests.post(url, headers=headers, json=payload, timeout=45)
        if response.status_code == 200:
            content = response.json()['candidates'][0]['content']['parts'][0]['text']
            return json.loads(content.strip().replace('```json', '').replace('```', ''))
        else: log_error(f"Gemini API error: {response.status_code} - {response.text}"); return None
    except Exception as e: log_error(f"Gemini request failed: {e}"); return None
def create_error_json(reason): return {"extracted_info": {}, "verification_status": "FLAGGED", "reasoning": f"Script Error: {reason}"}
def main():
    if not API_KEY or not IMAGE_PATH: print(json.dumps(create_error_json("API key or Image path is missing."))); sys.exit(1)
    image_data = encode_image(IMAGE_PATH)
    if not image_data: print(json.dumps(create_error_json("Failed to encode image."))); sys.exit(1)
    analysis_result = send_gemini_request(image_data, ANALYSIS_PROMPT)
    if analysis_result: print(json.dumps(analysis_result))
    else: print(json.dumps(create_error_json("AI analysis failed or returned an invalid response.")))
if __name__ == "__main__": main()