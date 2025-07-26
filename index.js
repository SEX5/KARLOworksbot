// index.js (Truly Complete & Final)
const express = require('express');
const axios = require('axios');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const dbManager = require('./database');
const stateManager = require('./state_manager');
const userHandler = require('./user_handler');
const adminHandler = require('./admin_handler');
const secrets = require('./secrets.js');
const app = express();
app.use(express.json());
const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, ADMIN_ID, GEMINI_API_KEY } = secrets;

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData); }
    catch (error) { console.error("Error sending message:", error.response?.data || error.message); }
}

async function handleReceiptSubmission(sender_psid, imageUrl) {
    await sendText(sender_psid, "Thank you! Analyzing your receipt now, this may take up to a minute...");
    const receiptsDir = path.join(__dirname, 'receipts');
    if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
    const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
    try {
        const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(imagePath, response.data);
    } catch (error) {
        console.error("Failed to download image:", error);
        return sendText(sender_psid, "Sorry, I couldn't download that image. Please try sending it again.");
    }
    if (!GEMINI_API_KEY) {
        console.error("CRITICAL: GEMINI_API_KEY is not set in secrets.js!");
        return sendText(ADMIN_ID, "Admin Alert: GEMINI_API_KEY is not set. Cannot verify receipts.");
    }
    execFile('python3', ['payment_verifier.py', GEMINI_API_KEY, imagePath], (error, stdout, stderr) => {
        if (error) { console.error(`Python Script Error: ${error}`); return sendText(ADMIN_ID, `Admin Alert: The AI verifier script crashed for user ${sender_psid}.`); }
        if (stderr) { console.log(`Python Log: ${stderr}`); }
        try {
            const analysis = JSON.parse(stdout);
            const report = `🔔 New Payment Received\n---------------------------\nBuyer ID: ${sender_psid}\n\nAI Verdict: *${analysis.verification_status}*\nReason: _${analysis.reasoning}_\n\nRef No: ${analysis.extracted_info.reference_number}\nAmount: ${analysis.extracted_info.amount}\n\nReceipt saved permanently. Please review.`;
            sendText(ADMIN_ID, report);
            sendText(sender_psid, `Your receipt has been submitted for final review. We will process your order shortly. Thank you!`);
        } catch (e) {
            console.error("Failed to parse AI response:", e, `Raw output: ${stdout}`);
            sendText(ADMIN_ID, `Admin Alert: AI verifier returned invalid data for user ${sender_psid}. Check logs.`);
        }
    });
}

async function handleMessage(sender_psid, webhook_event) {
    const messageText = webhook_event.message?.text?.trim();
    const lowerCaseText = messageText?.toLowerCase();

    if (lowerCaseText === 'setup admin') {
        if (sender_psid === ADMIN_ID) {
            await dbManager.updateAdminInfo(sender_psid, "09xx-xxx-xxxx");
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
                case 'awaiting_bulk_accounts': return adminHandler.processBulkAccounts(sender_psid, messageText, sendText);
                case 'awaiting_edit_mod': return adminHandler.processEditMod(sender_psid, messageText, sendText);
                case 'awaiting_add_ref': return adminHandler.processAddRef(sender_psid, messageText, sendText);
                case 'awaiting_edit_admin': return adminHandler.processEditAdmin(sender_psid, messageText, sendText);
                case 'awaiting_edit_ref': return adminHandler.processEditRef(sender_psid, messageText, sendText);
                case 'awaiting_add_mod': return adminHandler.processAddMod(sender_psid, messageText, sendText);
            }
        }
        switch (lowerCaseText) {
            case '1': return adminHandler.handleViewReferences(sender_psid, sendText);
            case '2': return adminHandler.promptForBulkAccounts(sender_psid, sendText);
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
