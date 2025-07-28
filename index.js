// index.js (Truly Complete & Final - using Node.js AI Verifier)
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- Our custom modules ---
const dbManager = require('./database');
const stateManager = require('./state_manager');
const userHandler = require('./user_handler');
const adminHandler = require('./admin_handler');
const secrets = require('./secrets.js'); // Using secrets.js for debugging

// --- NEW: Import our Node.js verifier ---
const paymentVerifier = require('./payment_verifier.js'); // This is the JS verifier!

const app = express();
app.use(express.json());

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, ADMIN_ID, GEMINI_API_KEY } = secrets;

// --- UTILITY FUNCTIONS ---

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending message:", error.response?.data || error.message);
    }
}

// --- UPDATED: handleReceiptSubmission uses Node.js verifier ---
async function handleReceiptSubmission(sender_psid, imageUrl) {
    await sendText(sender_psid, "Thank you! Analyzing your receipt now, this may take up to a minute...");
    
    try {
        // 1. Download the image into a buffer
        const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');

        // 2. Save the image permanently
        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
        const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageBuffer); // Use writeFileSync for simplicity in bot context

        // 3. Process with our new JavaScript verifier
        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);
        if (!image_b64) throw new Error(paymentVerifier.createErrorJson("Failed to encode image."));

        const analysis = await paymentVerifier.sendGeminiRequest(image_b64);
        if (!analysis) throw new Error(paymentVerifier.createErrorJson("AI analysis failed or returned invalid response."));
        
        // 4. Send reports
        const report = `🔔 New Payment Received\n---------------------------\nBuyer ID: ${sender_psid}\n\nAI Verdict: *${analysis.verification_status}*\nReason: _${analysis.reasoning}_\n\nRef No: ${analysis.extracted_info?.reference_number || 'N/A'}\nAmount: ${analysis.extracted_info?.amount || 'N/A'}\n\nReceipt saved permanently. Please review.`;
        await sendText(ADMIN_ID, report);
        await sendText(sender_psid, `Your receipt has been submitted for final review. We will process your order shortly. Thank you!`);

    } catch (error) {
        console.error("Error in handleReceiptSubmission:", error.message);
        // Attempt to parse error as JSON if it came from verifier
        let errorReason = "An unknown error occurred during verification.";
        try {
            const parsedError = JSON.parse(error.message); // Verifier might throw JSON errors
            errorReason = parsedError.reasoning || errorReason;
        } catch (e) { /* not a JSON error from verifier */ }

        await sendText(ADMIN_ID, `Admin Alert: Receipt verification failed for user ${sender_psid}. Reason: ${errorReason}`);
        await sendText(sender_psid, "Sorry, there was an issue verifying your receipt. An admin has been notified.");
    }
}

// --- MAIN MESSAGE ROUTER ---

async function handleMessage(sender_psid, webhook_event) {
    const messageText = webhook_event.message?.text?.trim();
    const lowerCaseText = messageText?.toLowerCase();

    // --- SPECIAL SETUP AND DEBUG COMMANDS (RUNS FIRST) ---
    if (lowerCaseText === 'setup admin') {
        if (sender_psid === ADMIN_ID) {
            await dbManager.updateAdminInfo(sender_psid, "09xx-xxx-xxxx"); // Adds your ID to the database
            await sendText(sender_psid, "✅ You have been successfully registered as the admin! The bot will now recognize you.");
            return adminHandler.showAdminMenu(sender_psid, sendText);
        } else {
            return sendText(sender_psid, "You are not authorized to perform this setup. Make sure your Facebook ID is correctly set in the ADMIN_ID variable.");
        }
    }
    if (lowerCaseText === 'my id') {
        return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}\n\nUse this value for the ADMIN_ID variable if you are the main admin.`);
    }

    // --- REGULAR BOT LOGIC ---
    const isAdmin = await dbManager.isAdmin(sender_psid);
    const userStateObj = stateManager.getUserState(sender_psid);

    // --- Image Attachment Handling ---
    if (webhook_event.message?.attachments?.[0].type === 'image') {
        const imageUrl = webhook_event.message.attachments[0].payload.url;
        await handleReceiptSubmission(sender_psid, imageUrl);
        return;
    }

    // --- Text Message Handling ---
    if (!messageText) return; // Ignore non-text, non-image messages

    if (lowerCaseText === 'menu') {
        stateManager.clearUserState(sender_psid);
        return isAdmin ? adminHandler.showAdminMenu(sender_psid, sendText) : userHandler.showUserMenu(sender_psid, sendText);
    }
    
    if (isAdmin) {
        const state = userStateObj?.state;
        if (state) {
            switch (state) {
                case 'awaiting_bulk_accounts_mod_id': return adminHandler.processBulkAccounts_Step2_GetAccounts(sender_psid, messageText, sendText);
                case 'awaiting_bulk_accounts_list': return adminHandler.processBulkAccounts_Step3_SaveAccounts(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod': return adminHandler.processEditMod(sender_psid, messageText, sendText);
                case 'awaiting_add_ref': return adminHandler.processAddRef(sender_psid, messageText, sendText);
                case 'awaiting_edit_admin': return adminHandler.processEditAdmin(sender_psid, messageText, sendText);
                case 'awaiting_edit_ref': return adminHandler.processEditRef(sender_psid, messageText, sendText);
                case 'awaiting_add_mod': return adminHandler.processAddMod(sender_psid, messageText, sendText);
            }
        }
        switch (lowerCaseText) {
            case '1': return adminHandler.handleViewReferences(sender_psid, sendText);
            case '2': return adminHandler.promptForBulkAccounts_Step1_ModId(sender_psid, sendText);
            case '3': return adminHandler.promptForEditMod(sender_psid, sendText);
            case '4': return adminHandler.promptForAddRef(sender_psid, sendText);
            case '5': return adminHandler.promptForEditAdmin(sender_psid, sendText);
            case '6': return adminHandler.promptForEditRef(sender_psid, sendText);
            case '7': return adminHandler.promptForAddMod(sender_psid, sendText);
            default: return adminHandler.showAdminMenu(sender_psid, sendText);
        }
    } else {
        const state = userStateObj?.state;
        if (state) {
            switch (state) {
                case 'awaiting_want_mod': return userHandler.handleWantMod(sender_psid, messageText, sendText);
                case 'awaiting_payment_for_mod': return userHandler.processRefForSubmit(sender_psid, messageText, sendText);
                case 'awaiting_ref_for_submit': return userHandler.processRefForSubmit(sender_psid, messageText, sendText);
                case 'awaiting_mod_for_submit': return userHandler.processModForSubmit(sender_psid, messageText, sendText);
                case 'awaiting_ref_for_check': return userHandler.processCheckClaims(sender_psid, messageText, sendText);
                case 'awaiting_ref_for_replacement': return userHandler.processReplacementRequest(sender_psid, messageText, sendText);
                case 'awaiting_admin_message': return userHandler.forwardMessageToAdmin(sender_psid, messageText, sendText, ADMIN_ID);
            }
        }
        switch (lowerCaseText) {
            case '1': return userHandler.handleViewMods(sender_psid, sendText);
            case '2': return userHandler.promptForRefSubmit(sender_psid, sendText);
            case '3': return userHandler.promptForCheckClaims(sender_psid, sendText);
            case '4': return userHandler.promptForReplacement(sender_psid, sendText);
            case '5': return userHandler.promptForAdminMessage(sender_psid, sendText);
            default: return userHandler.showUserMenu(sender_psid, sendText);
        }
    }
}

// --- SERVER SETUP AND START ---

async function startServer() {
    try {
        await dbManager.setupDatabase();

        // Health Check Route for hosting platforms
        app.get('/', (req, res) => {
            res.status(200).send('Bot is online and healthy.');
        });

        // Facebook Webhook Verification
        app.get('/webhook', (req, res) => {
            const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log("Webhook verified successfully!");
                res.status(200).send(challenge);
            } else {
                console.error("Webhook verification failed. Make sure your VERIFY_TOKEN in secrets.js matches the one in your Meta App.");
                res.sendStatus(403);
            }
        });

        // Facebook Webhook Message Receiver
        app.post('/webhook', (req, res) => {
            if (req.body.object === 'page') {
                req.body.entry.forEach(entry => {
                    const event = entry.messaging[0];
                    if (event?.sender?.id && event.message) {
                        handleMessage(event.sender.id, event);
                    }
                });
                res.status(200).send('EVENT_RECEIVED');
            } else {
                res.sendStatus(404);
            }
        });

        const PORT = process.env.PORT || 3000;
        const HOST = process.env.HOST || '0.0.0.0';

        // Final Listener for hosting platforms
        app.listen(PORT, HOST, () => {
            console.log(`✅ Bot is listening on port ${PORT} at host ${HOST}.`);
        });
        
    } catch (error) {
        console.error("Server failed to start:", error);
    }
}

startServer();
