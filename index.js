// index.js (Corrected Logic)
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
const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, ADMIN_ID } = secrets;

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
    const userState = stateManager.getUserState(sender_psid);
    const userLang = userState?.lang || 'en';
    
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

        if (userState?.state === 'awaiting_receipt_for_custom_mod') {
             await userHandler.handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang);
        } else {
             await userHandler.handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID, userLang);
        }

    } catch (error) {
        console.error("Error in handleReceiptSubmission:", error.message);
        const userState = stateManager.getUserState(sender_psid);
        if (userState?.state === 'awaiting_receipt_for_purchase') {
            await userHandler.startManualEntryFlow(sender_psid, sendText, imageUrl, userLang);
        } else {
            await sendText(sender_psid, "An error occurred while analyzing your receipt. An admin has been notified and will assist you shortly.");
            await sendText(ADMIN_ID, `An unexpected error occurred for user ${sender_psid} during a custom mod receipt submission. Please check the logs and contact the user.`);
        }
    }
}

async function handleMessage(sender_psid, webhook_event) {
    const messageText = typeof webhook_event.message?.text === 'string' ? webhook_event.message.text.trim() : null;
    const lowerCaseText = messageText?.toLowerCase();
    
    // --- FIX: MOVED ADMIN CHECK TO THE TOP ---
    const isAdmin = await dbManager.isAdmin(sender_psid);

    if (isAdmin) {
        // --- ADMIN LOGIC ---
        // If the user is an admin, completely bypass language selection and user menus.
        const userStateObj = stateManager.getUserState(sender_psid);
        const state = userStateObj?.state;

        if (lowerCaseText === 'menu') {
            stateManager.clearUserState(sender_psid);
            return adminHandler.showAdminMenu(sender_psid, sendText);
        }

        if (lowerCaseText === 'my id') {
            return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`);
        }
        
        if (state) {
            switch (state) {
                case 'awaiting_reply_psid': return adminHandler.promptForReply_Step2_GetUsername(sender_psid, messageText, sendText);
                case 'awaiting_reply_username': return adminHandler.promptForReply_Step3_GetPassword(sender_psid, messageText, sendText);
                case 'awaiting_reply_password': return adminHandler.processReply_Step4_Send(sender_psid, messageText, sendText);
                case 'viewing_references': const currentPage = userStateObj.page || 1; if (lowerCaseText === '1') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage + 1); if (lowerCaseText === '2') return adminHandler.handleViewReferences(sender_psid, sendText, currentPage - 1); break;
                case 'awaiting_bulk_accounts_mod_id': return adminHandler.processBulkAccounts_Step2_GetAccounts(sender_psid, messageText, sendText);
                case 'awaiting_bulk_accounts_list': return adminHandler.processBulkAccounts_Step3_SaveAccounts(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_id': return adminHandler.processEditMod_Step2_AskDetail(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_detail_choice': return adminHandler.processEditMod_Step3_AskValue(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_new_value': return adminHandler.processEditMod_Step4_SaveValue(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod_continue': return adminHandler.processEditMod_Step5_Continue(sender_psid, messageText, sendText);
                case 'awaiting_add_ref_number': return adminHandler.processAddRef_Step2_GetMod(sender_psid, messageText, sendText);
                case 'awaiting_add_ref_mod_id': return adminHandler.processAddRef_Step3_Save(sender_psid, messageText, sendText);
                case 'awaiting_edit_admin': return adminHandler.processEditAdmin(sender_psid, messageText, sendText);
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
            case '9': return adminHandler.toggleAdminOnlineStatus(sender_psid, sendText);
            case '10': return adminHandler.promptForReply_Step1_GetPSID(sender_psid, sendText);
            default: return adminHandler.showAdminMenu(sender_psid, sendText);
        }

    } else {
        // --- USER LOGIC ---
        // If the user is not an admin, proceed with the language check and regular flow.
        const userStateObj = stateManager.getUserState(sender_psid);

        if (!userStateObj || !userStateObj.lang) {
            if (lowerCaseText === 'english' || lowerCaseText === '1') {
                stateManager.setUserState(sender_psid, 'language_set', { lang: 'en' });
                await userHandler.showUserMenu(sender_psid, sendText, 'en');
                return;
            } else if (lowerCaseText === 'tagalog' || lowerCaseText === '2') {
                stateManager.setUserState(sender_psid, 'language_set', { lang: 'tl' });
                await userHandler.showUserMenu(sender_psid, sendText, 'tl');
                return;
            } else {
                const langPrompt = "Please select your language type the number only:\n\n1. English\n2. Tagalog";
                await sendText(sender_psid, langPrompt);
                stateManager.setUserState(sender_psid, 'awaiting_language_choice', {});
                return;
            }
        }
        
        const userLang = userStateObj.lang;
        const expectingReceipt = userStateObj?.state === 'awaiting_receipt_for_purchase' || userStateObj?.state === 'awaiting_receipt_for_custom_mod';

        if (expectingReceipt && webhook_event.message?.attachments?.[0]?.type === 'image') {
            if (!webhook_event.message?.sticker_id) {
                const imageUrl = webhook_event.message.attachments[0].payload.url;
                await handleReceiptSubmission(sender_psid, imageUrl);
            }
            return;
        }
        
        if (expectingReceipt && messageText) {
            await sendText(sender_psid, "It looks like you sent a message instead of a receipt, so the purchase has been cancelled. Feel free to start again from the menu! 😊");
            stateManager.clearUserState(sender_psid);
            stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
            return;
        }

        if (!messageText || messageText === '' || webhook_event.message?.sticker_id) {
            return userHandler.showUserMenu(sender_psid, sendText, userLang);
        }

        if (lowerCaseText === 'menu') {
            stateManager.clearUserState(sender_psid);
            stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
            return userHandler.showUserMenu(sender_psid, sendText, userLang);
        }
        
        if (lowerCaseText === 'my id') {
             return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`);
        }

        const state = userStateObj?.state;
        if (state) {
            switch (state) {
                case 'awaiting_manual_ref': return userHandler.handleManualReference(sender_psid, messageText, sendText, userLang);
                case 'awaiting_manual_mod': return userHandler.handleManualModSelection(sender_psid, messageText, sendText, sendImage, ADMIN_ID, userLang);
                case 'awaiting_email_for_purchase': return userHandler.handleEmailForPurchase(sender_psid, messageText, sendText, userLang);
                case 'awaiting_mod_confirmation': return userHandler.handleModConfirmation(sender_psid, messageText, sendText, ADMIN_ID, userLang);
                case 'awaiting_mod_clarification': return userHandler.handleModClarification(sender_psid, messageText, sendText, ADMIN_ID, userLang);
                case 'awaiting_want_mod': return userHandler.handleWantMod(sender_psid, messageText, sendText, userLang);
                case 'awaiting_ref_for_check': return userHandler.processCheckClaims(sender_psid, messageText, sendText, userLang);
                case 'awaiting_ref_for_replacement': return userHandler.processReplacementRequest(sender_psid, messageText, sendText, userLang);
                case 'awaiting_admin_message': return userHandler.forwardMessageToAdmin(sender_psid, messageText, sendText, ADMIN_ID, userLang);
                case 'awaiting_custom_mod_order': return userHandler.handleCustomModOrder(sender_psid, messageText, sendText, userLang);
            }
        }
        switch (lowerCaseText) {
            case '1': return userHandler.handleViewMods(sender_psid, sendText, userLang);
            case '2': return userHandler.promptForCheckClaims(sender_psid, sendText, userLang);
            case '3': return userHandler.promptForReplacement(sender_psid, sendText, userLang);
            case '4': return userHandler.promptForCustomMod(sender_psid, sendText, userLang);
            case '5': return userHandler.promptForAdminMessage(sender_psid, sendText, userLang);
            default: return userHandler.showUserMenu(sender_psid, sendText, userLang);
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
