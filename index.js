// index.js (Updated Version)
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dbManager = require('./database.js');
const stateManager = require('./state_manager.js');
const userHandler = require('./user_handler.js');
const adminHandler = require('./admin_handler.js');
const secrets = require('./secrets.js');
const paymentVerifier = require('./payment_verifier.js');
const app = express();
app.use(express.json());
const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, ADMIN_ID, GEMINI_API_KEY } = secrets;

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData); }
    catch (error) { console.error("Error sending text message:", error.response?.data || error.message); }
}

async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } },
        messaging_type: "RESPONSE"
    };
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData); }
    catch (error) { console.error("Error sending image message:", error.response?.data || error.message); }
}

async function handleReceiptSubmission(sender_psid, imageUrl) {
    await sendText(sender_psid, "Thank you! Analyzing your receipt, this may take a moment...");
    try {
        const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);
        if (!image_b64) throw new Error("Failed to encode image.");
        const analysis = await paymentVerifier.sendGeminiRequest(image_b64);
        if (!analysis) throw new Error("AI analysis returned null.");
        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
        const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageBuffer);
        await userHandler.handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID);
    } catch (error) {
        console.error("Error in handleReceiptSubmission, starting manual flow:", error.message);
        await userHandler.startManualEntryFlow(sender_psid, sendText, imageUrl);
    }
}

async function handleMessage(sender_psid, webhook_event) {
    // --- Fix 1: Check for Images FIRST, conditionally ---
    // Get user state early to check if we are expecting a receipt
    const userStateObj_preCheck = stateManager.getUserState(sender_psid);
    const expectingReceipt = userStateObj_preCheck?.state === 'awaiting_receipt_for_purchase';

    // Handle image attachments (receipts) ONLY if expecting one
    if (expectingReceipt && webhook_event.message?.attachments?.[0]?.type === 'image') {
        // Optional: Add extra check to avoid processing sticker attachments if any slip through
        // Although typically stickers have message.sticker_id, being cautious
        if (!webhook_event.message?.sticker_id) {
            const imageUrl = webhook_event.message.attachments[0].payload.url;
            await handleReceiptSubmission(sender_psid, imageUrl);
        }
        return; // Important: return after handling image or deciding not to
    }
    // --- End Fix 1 ---

    // --- Fix 2: Robustly check for message content ---
    // Get message text, ensuring it's a string and trimmed
    const messageText = typeof webhook_event.message?.text === 'string' ? webhook_event.message.text.trim() : null;
    const lowerCaseText = messageText?.toLowerCase();

    // --- Fix 3: Handle non-text messages (likes/stickers) by sending the menu ---
    // Check for sticker_id or lack of text content (AFTER checking for images)
    if (!messageText || messageText === '' || webhook_event.message?.sticker_id) {
        console.log(`Non-text message (like/sticker) detected from ${sender_psid}, sending menu.`);
        // Clear state to ensure menu is shown
        stateManager.clearUserState(sender_psid);
        // Determine if user is admin and send appropriate menu
        const isAdmin = await dbManager.isAdmin(sender_psid);
        if (isAdmin) {
            return adminHandler.showAdminMenu(sender_psid, sendText);
        } else {
            return userHandler.showUserMenu(sender_psid, sendText);
        }
        // Important: Return after sending the menu to prevent further processing
        return; // Ensure ONLY the menu is sent for likes/stickers
    }
    // --- End Fix 3 ---

    if (lowerCaseText === 'setup admin') {
        if (sender_psid === ADMIN_ID) {
            // --- Fix 4: Improved default setup message ---
            // Prompt admin to enter their actual GCash details instead of hardcoding
            await sendText(sender_psid, "✅ Setup initiated!\nPlease enter your GCash number and name in the format:\n`<11 or 13 digit number> <Your Name>`\n(e.g., 09123456789 John Doe)");
            // Set state to await the admin's input for their details
            stateManager.setUserState(sender_psid, 'awaiting_edit_admin');
            // Optionally show the admin menu after the prompt
            // await adminHandler.showAdminMenu(sender_psid, sendText);
            return;
            // --- End Fix 4 ---
        } else {
            return sendText(sender_psid, "You are not authorized to perform this setup.");
        }
    }

    if (lowerCaseText === 'my id') {
        return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`);
    }

    const isAdmin = await dbManager.isAdmin(sender_psid);
    const userStateObj = stateManager.getUserState(sender_psid);

    // --- Removed redundant image check ---
    // The conditional image check is now done at the very beginning.
    // The unconditional image check `if (webhook_event.message?.attachments?.[0].type === 'image')` is removed.
    // --- End removed check ---

    // --- Redundant check removed ---
    // The robust check at the beginning handles the case where messageText is missing/empty.
    // The specific handling for likes/stickers also returns early.
    // Therefore, if execution reaches here, messageText is valid.
    // The original `if (!messageText) return;` is now redundant and removed.
    // --- End Redundant check note ---

    if (lowerCaseText === 'menu') {
        stateManager.clearUserState(sender_psid);
        return isAdmin ? adminHandler.showAdminMenu(sender_psid, sendText) : userHandler.showUserMenu(sender_psid, sendText);
    }

    if (isAdmin) {
        const state = userStateObj?.state;
        if (state) {
            switch (state) {
                case 'viewing_references': const currentPage = userStateObj.page || 1; if (lowerCaseText === '1') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage + 1); if (lowerCaseText === '2') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage - 1); break;
                case 'awaiting_bulk_accounts_mod_id': return adminHandler.processBulkAccounts_Step2_GetAccounts(sender_psid, messageText, sendText);
                case 'awaiting_bulk_accounts_list': return adminHandler.processBulkAccounts_Step3_SaveAccounts(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_id': return adminHandler.processEditMod_Step2_AskDetail(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_detail_choice': return adminHandler.processEditMod_Step3_AskValue(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_new_value': return adminHandler.processEditMod_Step4_SaveValue(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_continue': return adminHandler.processEditMod_Step5_Continue(sender_psid, messageText, sendText);
                case 'awaiting_add_ref_number': return adminHandler.processAddRef_Step2_GetMod(sender_psid, messageText, sendText);
                case 'awaiting_add_ref_mod_id': return adminHandler.processAddRef_Step3_Save(sender_psid, messageText, sendText);
                // --- Fix 5: Ensure admin input during setup is processed ---
                case 'awaiting_edit_admin':
                    // This will now correctly route to the admin handler when in this state
                    return adminHandler.processEditAdmin(sender_psid, messageText, sendText);
                // --- End Fix 5 ---
                case 'awaiting_edit_ref': return adminHandler.processEditRef(sender_psid, messageText, sendText);
                case 'awaiting_add_mod': return adminHandler.processAddMod(sender_psid, messageText, sendText);
                case 'awaiting_delete_ref': return adminHandler.processDeleteRef(sender_psid, messageText, sendText);
            }
        }
        switch (lowerCaseText) {
            case '1': return adminHandler.handleViewReferences(sender_psid, sendText, 1);
            case '2': return adminHandler.promptForBulkAccounts_Step1_ModId(sender_psid, sendText);
            case '3': return adminHandler.promptForEditMod_Step1_ModId(sender_psid, sendText);
            case '4': return adminHandler.promptForAddRef_Step1_GetRef(sender_psid, sendText);
            case '5': return adminHandler.promptForEditAdmin(sender_psid, sendText);
            case '6': return adminHandler.promptForEditRef(sender_psid, sendText);
            case '7': return adminHandler.promptForAddMod(sender_psid, sendText);
            case '8': return adminHandler.promptForDeleteRef(sender_psid, sendText);
            default: return adminHandler.showAdminMenu(sender_psid, sendText);
        }
    } else {
        const state = userStateObj?.state;
        if (state) {
            switch (state) {
                case 'awaiting_manual_ref': return userHandler.handleManualReference(sender_psid, messageText, sendText);
                case 'awaiting_manual_mod': return userHandler.handleManualModSelection(sender_psid, messageText, sendText, sendImage, ADMIN_ID);
                case 'awaiting_email_for_purchase': return userHandler.handleEmailForPurchase(sender_psid, messageText, sendText);
                case 'awaiting_password_for_purchase': return userHandler.handlePasswordForPurchase(sender_psid, messageText, sendText);
                case 'awaiting_mod_confirmation': return userHandler.handleModConfirmation(sender_psid, messageText, sendText, ADMIN_ID);
                case 'awaiting_mod_clarification': return userHandler.handleModClarification(sender_psid, messageText, sendText, ADMIN_ID);
                case 'awaiting_want_mod': return userHandler.handleWantMod(sender_psid, messageText, sendText);
                case 'awaiting_ref_for_check': return userHandler.processCheckClaims(sender_psid, messageText, sendText);
                case 'awaiting_ref_for_replacement': return userHandler.processReplacementRequest(sender_psid, messageText, sendText);
                case 'awaiting_admin_message': return userHandler.forwardMessageToAdmin(sender_psid, messageText, sendText, ADMIN_ID);
            }
        }
        switch (lowerCaseText) {
            case '1': return userHandler.handleViewMods(sender_psid, sendText);
            case '2': return userHandler.promptForCheckClaims(sender_psid, sendText);
            case '3': return userHandler.promptForReplacement(sender_psid, sendText);
            case '4': return userHandler.promptForAdminMessage(sender_psid, sendText);
            default: return userHandler.showUserMenu(sender_psid, sendText);
        }
    }
}

async function startServer() {
    try {
        await dbManager.setupDatabase();
        app.get('/', (req, res) => { res.status(200).send('Bot is online and healthy.'); });
        app.get('/webhook', (req, res) => {
            const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log("Webhook verified successfully!");
                res.status(200).send(challenge);
            } else { res.sendStatus(403); }
        });
        app.post('/webhook', (req, res) => {
            if (req.body.object === 'page') {
                req.body.entry.forEach(entry => {
                    const event = entry.messaging[0];
                    if (event?.sender?.id && event.message) { handleMessage(event.sender.id, event); }
                });
                res.status(200).send('EVENT_RECEIVED');
            } else { res.sendStatus(404); }
        });
        const PORT = process.env.PORT || 3000;
        const HOST = '0.0.0.0';
        app.listen(PORT, HOST, () => { console.log(`✅ Bot is listening on port ${PORT} at host ${HOST}.`); });
    } catch (error) { console.error("Server failed to start:", error); }
}

startServer();

