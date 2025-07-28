// index.js (Truly Complete & Final - with messenger_api.js integration)
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const dbManager = require('./database.js');
const stateManager = require('./state_manager.js');
const userHandler = require('./user_handler.js');
const adminHandler = require('./admin_handler.js');
const secrets = require('./secrets.js');
const paymentVerifier = require('./payment_verifier.js');
const messengerApi = require('./messenger_api.js'); // The new, centralized API handler

const app = express();
app.use(express.json());

const { VERIFY_TOKEN, ADMIN_ID } = secrets;

async function handleReceiptSubmission(sender_psid, imageUrl) {
    const sendText = messengerApi.sendText; // Use the centralized function
    await sendText(sender_psid, "Thank you! Analyzing your receipt, this may take a moment...");
    try {
        const imageResponse = await require('axios')({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');

        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);
        if (!image_b64) throw new Error("Failed to encode image.");

        const analysis = await paymentVerifier.sendGeminiRequest(image_b64);
        if (!analysis) throw new Error("AI analysis failed.");
        
        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
        const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageBuffer);
        
        await userHandler.handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID);

    } catch (error) {
        console.error("Error in handleReceiptSubmission:", error.message);
        await sendText(ADMIN_ID, `Admin Alert: Receipt analysis failed for user ${sender_psid}.`);
        await sendText(sender_psid, "Sorry, there was an issue analyzing your receipt. An admin has been notified.");
    }
}

async function handleMessage(sender_psid, webhook_event) {
    const sendText = messengerApi.sendText; // Use the centralized function for all messaging
    const messageText = webhook_event.message?.text?.trim();
    const lowerCaseText = messageText?.toLowerCase();

    if (lowerCaseText === 'setup admin') {
        if (sender_psid === secrets.ADMIN_ID) {
            await dbManager.updateAdminInfo(sender_psid, "09123963204, Karl Abalunan");
            await sendText(sender_psid, "✅ You have been successfully registered as the admin!");
            return adminHandler.showAdminMenu(sender_psid, sendText);
        } else {
            return sendText(sender_psid, "You are not authorized to perform this setup.");
        }
    }
    if (lowerCaseText === 'my id') {
        return sendText(sender_psid, `Your Facebook Page-Scoped ID is: ${sender_psid}`);
    }

    const isAdmin = await dbManager.isAdmin(sender_psid);
    const userStateObj = stateManager.getUserState(sender_psid);

    if (webhook_event.message?.attachments?.[0].type === 'image') {
        const imageUrl = webhook_event.message.attachments[0].payload.url;
        await handleReceiptSubmission(sender_psid, imageUrl);
        return;
    }

    if (!messageText) return;

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
