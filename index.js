// index.js (Corrected Version)
const express = require('express');
const fs = require('fs');
const path = require('path');
const dbManager = require('./database.js');
const stateManager = require('./state_manager.js');
const userHandler = require('./user_handler.js');
const adminHandler = require('./admin_handler.js');
const secrets = require('./secrets.js');
const paymentVerifier = require('./payment_verifier.js');
const jobPoller = require('./job_poller.js');
const stockNotifier = require('./stock_notifier.js'); // --- ADD THIS LINE ---
const { sendText, sendImage, sendQuickReplies } = require('./messenger_api.js'); 
const lang = require('./language_manager.js');
const { handleUserError } = require('./error_handler.js');

const app = express();
app.use(express.json());
const { VERIFY_TOKEN, ADMIN_ID } = secrets;

async function handleReceiptSubmission(sender_psid, imageUrl) {
    const userState = stateManager.getUserState(sender_psid);
    const userLang = userState?.lang || 'en';
    
    // The "Analyzing" message is now sent from handleMessage, before this function is called.
    try {
        const imageResponse = await require('axios')({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);
        if (!image_b64) throw new Error("Failed to encode image.");
        
        const analysis = await paymentVerifier.analyzeReceiptWithFallback(imageUrl, image_b64);

        if (!analysis) throw new Error("AI analysis returned null.");
        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) { fs.mkdirSync(receiptsDir); }
        const imagePath = path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageBuffer);

        if (userState?.state === 'processing_receipt_custom') {
             await userHandler.handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang);
        } else {
             await userHandler.handleReceiptAnalysis(sender_psid, analysis, sendText, sendImage, ADMIN_ID, userLang);
        }

    } catch (error) {
        const userState = stateManager.getUserState(sender_psid);
        const userLang = userState?.lang || 'en';
    
        // If the error happens during a standard purchase, try the manual fallback
        if (userState?.state === 'processing_receipt') {
            console.warn(`Receipt analysis failed for user ${sender_psid}, initiating manual flow. Error: ${error.message}`);
            await userHandler.startManualEntryFlow(sender_psid, sendText, sendImage, imageUrl, userLang);
        } else {
            // For custom mods or other unexpected scenarios, use the generic error handler
            await handleUserError(error, sender_psid, userLang, 'Receipt Submission');
        }
    }
}

async function handleMessage(sender_psid, webhook_event) {
    try {
        // Prioritize quick reply payload over text input
        const messageText = webhook_event.message?.quick_reply?.payload || (typeof webhook_event.message?.text === 'string' ? webhook_event.message.text.trim() : null);
        const lowerCaseText = messageText?.toLowerCase();
        
        const isAdmin = await dbManager.isAdmin(sender_psid);
        const adminInfo = await dbManager.getAdminInfo();

        if (isAdmin) {
            // --- ADMIN LOGIC ---
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
                    case 'awaiting_admin_create_email': return adminHandler.promptForAdminCreate_Step2_GetMod(sender_psid, messageText, sendText);
                    case 'awaiting_admin_create_mod_id': return adminHandler.processAdminCreate_Step3_CreateJob(sender_psid, messageText, sendText);
                    case 'awaiting_bulk_refs_mod_id': return adminHandler.processBulkRefs_Step2_GetRefs(sender_psid, messageText, sendText);
                    case 'awaiting_bulk_refs_list': return adminHandler.processBulkRefs_Step3_SaveRefs(sender_psid, messageText, sendText);
                    case 'awaiting_pause_toggle_psid': return adminHandler.processPauseToggle(sender_psid, messageText, sendText);
                    case 'awaiting_delete_accounts_mod_id': return adminHandler.processDeleteAccounts_Step2_ConfirmAndDelete(sender_psid, messageText, sendText);
                    case 'awaiting_broadcast_message': return adminHandler.processBroadcast_Step2_ConfirmAndSend(sender_psid, messageText, sendText);
                    case 'awaiting_broadcast_confirmation': return adminHandler.processBroadcast_Step3_Execute(sender_psid, messageText, sendText);
                    case 'awaiting_edit_claims_ref': return adminHandler.promptForEditClaims_Step2_GetNewClaims(sender_psid, messageText, sendText);
                    case 'awaiting_edit_claims_values': return adminHandler.processEditClaims_Step3_Update(sender_psid, messageText, sendText);
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
                case '11': return adminHandler.handleViewJobs(sender_psid, sendText);
                case '12': return adminHandler.promptForAdminCreate_Step1_GetEmail(sender_psid, sendText);
                case '13': return adminHandler.promptForBulkRefs_Step1_GetModId(sender_psid, sendText);
                case '14': return adminHandler.promptForPauseToggle_GetPSID(sender_psid, sendText);
                case '15': return adminHandler.toggleMaintenanceMode(sender_psid, sendText);
                case '16': return adminHandler.promptForDeleteAccounts_Step1_GetModId(sender_psid, sendText);
                case '17': return adminHandler.promptForBroadcast_Step1_GetMessage(sender_psid, sendText);
                case '18': return adminHandler.promptForEditClaims_Step1_GetRef(sender_psid, sendText);
                default: return adminHandler.showAdminMenu(sender_psid, sendText);
            }

        } else {
            // --- USER LOGIC ---
            const userStateObj = stateManager.getUserState(sender_psid);
            const userLang = userStateObj?.lang || 'en';

            if (adminInfo && adminInfo.is_maintenance_mode) {
                await sendText(sender_psid, lang.getText('maintenance_mode_message', userLang));
                return;
            }
            
            const isPaused = await dbManager.isUserPaused(sender_psid);
            if (isPaused) { return; }

            // --- RACE CONDITION FIX STARTS HERE ---
            const isExpectingReceipt = userStateObj?.state === 'awaiting_receipt_for_purchase' || userStateObj?.state === 'awaiting_receipt_for_custom_mod';
            
            // IF an image is received while expecting one:
            if (isExpectingReceipt && webhook_event.message?.attachments?.[0]?.type === 'image' && !webhook_event.message?.sticker_id) {
                const imageUrl = webhook_event.message.attachments[0].payload.url;
                const nextState = userStateObj.state === 'awaiting_receipt_for_purchase' ? 'processing_receipt' : 'processing_receipt_custom';
                
                // Immediately set state to "processing" to lock out other messages
                stateManager.setUserState(sender_psid, nextState, { ...userStateObj, lang: userLang });
                
                // Send the "Analyzing" message immediately after locking the state and before the async handler
                await sendText(sender_psid, lang.getText('receipt_analyzing', userLang));
                
                await handleReceiptSubmission(sender_psid, imageUrl);
                return;
            }

            // IF a text message is received while an image is being processed:
            const isProcessingReceipt = userStateObj?.state === 'processing_receipt' || userStateObj?.state === 'processing_receipt_custom';
            if (isProcessingReceipt && messageText) {
                await sendText(sender_psid, lang.getText('processing_receipt_wait', userLang));
                return;
            }
            
            // IF a text message is received INSTEAD of an image:
            if (isExpectingReceipt && messageText) {
                await sendText(sender_psid, lang.getText('receipt_cancelled_text_instead', userLang));
                stateManager.clearUserState(sender_psid);
                stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
                return;
            }
            // --- RACE CONDITION FIX ENDS HERE ---

            if (!userStateObj || !userStateObj.lang) {
                if (lowerCaseText === 'english' || lowerCaseText === '1') {
                    stateManager.setUserState(sender_psid, 'language_set', { lang: 'en' });
                    await userHandler.showUserMenu(sender_psid, sendText, 'en');
                } else if (lowerCaseText === 'tagalog' || lowerCaseText === '2') {
                    stateManager.setUserState(sender_psid, 'language_set', { lang: 'tl' });
                    await userHandler.showUserMenu(sender_psid, sendText, 'tl');
                } else {
                    const langPrompt = "Please select your language:";
                    const replies = [{ title: "English", payload: "1" }, { title: "Tagalog", payload: "2" }];
                    await sendQuickReplies(sender_psid, langPrompt, replies);
                    stateManager.setUserState(sender_psid, 'awaiting_language_choice', {});
                }
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
                    case 'awaiting_custom_mod_choice': return userHandler.handleCustomModChoice(sender_psid, messageText, sendText, userLang);
                    case 'awaiting_custom_money_amount': return userHandler.processCustomMoneyOrder(sender_psid, messageText, sendText, userLang);
                    case 'awaiting_custom_gold_amount': return userHandler.processCustomGoldOrder(sender_psid, messageText, sendText, userLang);
                    case 'awaiting_report_ref': return userHandler.handleReportReference(sender_psid, messageText, sendText, userLang);
                    case 'awaiting_report_issue': return userHandler.forwardReportToAdmin(sender_psid, messageText, sendText, ADMIN_ID, userLang);
                }
            }
            switch (lowerCaseText) {
                case '1': return userHandler.handleViewMods(sender_psid, sendText, userLang);
                case '2': return userHandler.promptForCheckClaims(sender_psid, sendText, userLang);
                case '3': return userHandler.promptForReplacement(sender_psid, sendText, userLang);
                case '4': return userHandler.promptForCustomMod(sender_psid, sendText, userLang);
                case '5': return userHandler.promptForAdminMessage(sender_psid, sendText, userLang);
                case '6': return userHandler.handleViewProofs(sender_psid, sendText, userLang);
                case '7': return userHandler.promptForReport(sender_psid, sendText, userLang);
                default: return userHandler.showUserMenu(sender_psid, sendText, userLang);
            }
        }
    } catch (error) {
        const userState = stateManager.getUserState(sender_psid);
        const userLang = userState?.lang || 'en';
        await handleUserError(error, sender_psid, userLang, 'Main Message Handler');
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

        // Start the background job poller using the new module
        jobPoller.start();

        // Start the background stock notifier
        stockNotifier.start(); // --- ADD THIS LINE ---

    } catch (error) { console.error("Server failed to start:", error); }
}

startServer();
