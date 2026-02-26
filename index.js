// index.js (COMPLETE, CORRECTED FINAL VERSION)
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dbManager = require('./database.js');
const stateManager = require('./state_manager.js');
const userHandler = require('./user_handler');
const adminHandler = require('./admin_handler.js');
const secrets = require('./secrets.js');
const paymentVerifier = require('./payment_verifier.js');
const { sendText, sendImage, sendQuickReplies, getUserProfile } = require('./messenger_api.js');
const lang = require('./language_manager');

const app = express();
app.use(express.json());

const { VERIFY_TOKEN, ADMIN_ID, WORKER_SECRET_TOKEN } = secrets;

/**
 * Endpoint for the Python Worker to deliver credentials
 */
app.post('/webhook-delivery', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (token !== WORKER_SECRET_TOKEN) {
            console.warn("Unauthorized delivery attempt.");
            return res.status(403).send('Forbidden');
        }

        const { job_id, username, password } = req.body;
        if (!job_id || !username || !password) {
            return res.status(400).send('Missing fields');
        }

        const job = await dbManager.getJobById(job_id);
        if (!job) return res.status(404).send('Job Not Found');

        // Safe language fallback
        const deliveryLang = job.lang || 'en';
        const userMessage = lang.getText('delivery_success', deliveryLang) + 
            `\n\n📧 Username: \`${username}\`\n🔐 Password: \`${password}\`\n\nThank you! Enjoy! 💙`;
        
        try {
            await sendText(job.user_psid, userMessage);
            await dbManager.updateJobStatus(job_id, 'delivered', 'Successfully delivered.');
            console.log(`Delivered Job ID: ${job_id} to ${job.user_psid}`);
        } catch (deliveryError) {
            const resultMsg = `Delivery failed. Credentials: ${username}:${password}`;
            await dbManager.updateJobStatus(job_id, 'delivery_failed', resultMsg);
            await sendText(ADMIN_ID, `🚨 DELIVERY FAILED for Job ID ${job_id}. User may have blocked the page.\nAcc: ${username}:${password}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error("CRITICAL ERROR in /webhook-delivery:", error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * Centralized Error Notification
 */
async function handleError(error, sender_psid, context = 'Unknown') {
    console.error(`--- ERROR in ${context} ---`, error);
    try {
        const user = await dbManager.getUser(sender_psid);
        const userLang = user?.lang || 'en';
        const adminMessage = `🚨 ERROR 🚨\nContext: ${context}\nUser: ${sender_psid}\nError: ${error.message}`;
        await sendText(ADMIN_ID, adminMessage);
        await sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
    } catch (e) {
        console.error("Fatal error inside error handler:", e);
    }
}

/**
 * Logic for processing payment receipts
 */
async function handleReceiptSubmission(sender_psid, imageUrl) {
    const userState = stateManager.getUserState(sender_psid);
    const userLang = userState?.lang || 'en';
    
    await sendText(sender_psid, lang.getText('receipt_analyzing', userLang));

    try {
        const imageResponse = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const image_b64 = await paymentVerifier.encodeImage(imageBuffer);

        if (!image_b64) throw new Error("Encoding failed.");

        const analysis = await paymentVerifier.analyzeReceiptWithFallback(imageUrl, image_b64);
        if (!analysis) throw new Error("AI returned null.");

        // Save receipt image locally for record
        const receiptsDir = path.join(__dirname, 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
        fs.writeFileSync(path.join(receiptsDir, `${sender_psid}_${Date.now()}.png`), imageBuffer);

        const currentState = stateManager.getUserState(sender_psid);
        if (currentState && currentState.state === 'processing_receipt') {
            if (currentState.orderType) { // Custom Mod Flow
                await userHandler.handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang);
            } else { // Standard Purchase Flow
                await userHandler.handleReceiptAnalysis(sender_psid, analysis, ADMIN_ID, userLang);
            }
        }
    } catch (error) {
        const currentState = stateManager.getUserState(sender_psid);
        if (currentState && currentState.state === 'processing_receipt') {
            await userHandler.startManualEntryFlow(sender_psid, sendText, imageUrl, userLang);
        } else {
            await handleError(error, sender_psid, 'Receipt Submission');
        }
    }
}

/**
 * Master Webhook Handler
 */
async function handleMessage(sender_psid, webhook_event) {
    try {
        const message = webhook_event.message;
        let received_text = message?.quick_reply?.payload || message?.text;
        const lowerCaseText = received_text?.toLowerCase().trim();

        // 1. Permission & Maintenance Checks
        const isAdmin = (sender_psid === ADMIN_ID) || await dbManager.isAdmin(sender_psid);
        const user = await dbManager.getUser(sender_psid);
        const userLang = user?.lang || 'en';

        const isMaintenance = await dbManager.getMaintenanceStatus();
        if (isMaintenance && !isAdmin) {
            return await sendText(sender_psid, lang.getText('maintenance_mode_message', userLang));
        }

        // 2. Admin Logic
        if (isAdmin) {
            const userStateObj = stateManager.getUserState(sender_psid);
            if (lowerCaseText === 'menu') {
                stateManager.clearUserState(sender_psid);
                return adminHandler.showAdminMenu(sender_psid, sendText);
            }
            if (userStateObj?.state) {
                const state = userStateObj.state;
                switch (state) {
                    case 'awaiting_reply_psid': return adminHandler.promptForReply_Step2_GetUsername(sender_psid, received_text, sendText);
                    case 'awaiting_reply_username': return adminHandler.promptForReply_Step3_GetPassword(sender_psid, received_text, sendText);
                    case 'awaiting_reply_password': return adminHandler.processReply_Step4_Send(sender_psid, received_text, sendText);
                    case 'viewing_references': 
                        if (lowerCaseText === '1') return adminHandler.handleViewReferences(sender_psid, sendText, (userStateObj.page || 1) + 1);
                        if (lowerCaseText === '2') return adminHandler.handleViewReferences(sender_psid, sendText, (userStateObj.page || 1) - 1);
                        break;
                    case 'awaiting_bulk_accounts_mod_id': return adminHandler.processBulkAccounts_Step2_GetAccounts(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_accounts_list': return adminHandler.processBulkAccounts_Step3_SaveAccounts(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_id': return adminHandler.processEditMod_Step2_AskDetail(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_detail_choice': return adminHandler.processEditMod_Step3_AskValue(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_new_value': return adminHandler.processEditMod_Step4_SaveValue(sender_psid, received_text, sendText);
                    case 'awaiting_edit_mod_continue': return adminHandler.processEditMod_Step5_Continue(sender_psid, received_text, sendText);
                    case 'awaiting_add_ref_number': return adminHandler.processAddRef_Step2_GetMod(sender_psid, received_text, sendText);
                    case 'awaiting_add_ref_mod_id': return adminHandler.processAddRef_Step3_Save(sender_psid, received_text, sendText);
                    case 'awaiting_edit_admin': return adminHandler.processEditAdmin(sender_psid, received_text, sendText);
                    case 'awaiting_edit_ref': return adminHandler.processEditRef(sender_psid, received_text, sendText);
                    case 'awaiting_add_mod': return adminHandler.processAddMod(sender_psid, received_text, sendText);
                    case 'awaiting_delete_ref': return adminHandler.processDeleteRef(sender_psid, received_text, sendText);
                    case 'awaiting_admin_create_email': return adminHandler.promptForAdminCreate_Step2_GetMod(sender_psid, received_text, sendText);
                    case 'awaiting_admin_create_mod_id': return adminHandler.processAdminCreate_Step3_CreateJob(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_refs_mod_id': return adminHandler.processBulkRefs_Step2_GetRefs(sender_psid, received_text, sendText);
                    case 'awaiting_bulk_refs_list': return adminHandler.processBulkRefs_Step3_SaveRefs(sender_psid, received_text, sendText);
                    case 'awaiting_pause_toggle_psid': return adminHandler.processPauseToggle(sender_psid, received_text, sendText);
                    case 'awaiting_delete_accounts_mod_id': return adminHandler.processDeleteAccounts_Step2_ConfirmAndDelete(sender_psid, received_text, sendText);
                    case 'awaiting_broadcast_message': return adminHandler.processBroadcast_Step2_ConfirmAndSend(sender_psid, received_text, sendText);
                    case 'awaiting_broadcast_confirmation': return adminHandler.processBroadcast_Step3_Execute(sender_psid, received_text, sendText);
                    case 'awaiting_edit_claims_ref': return adminHandler.promptForEditClaims_Step2_GetNewClaims(sender_psid, received_text, sendText);
                    case 'awaiting_edit_claims_values': return adminHandler.processEditClaims_Step3_Update(sender_psid, received_text, sendText);
                    case 'awaiting_sales_stats_period': return adminHandler.processSalesStats(sender_psid, received_text, sendText);
                }
            } else {
                const map = { '1':1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, '11':11, '12':12, '13':13, '14':14, '15':15, '16':16, '17':17, '18':18, '19':19 };
                if (map[lowerCaseText]) {
                    const funcMap = {
                        '1': () => adminHandler.handleViewReferences(sender_psid, sendText, 1),
                        '2': () => adminHandler.promptForBulkAccounts_Step1_ModId(sender_psid, sendText),
                        '3': () => adminHandler.promptForEditMod_Step1_ModId(sender_psid, sendText),
                        '4': () => adminHandler.promptForAddRef_Step1_GetRef(sender_psid, sendText),
                        '5': () => adminHandler.promptForEditAdmin(sender_psid, sendText),
                        '6': () => adminHandler.promptForEditRef(sender_psid, sendText),
                        '7': () => adminHandler.promptForAddMod(sender_psid, sendText),
                        '8': () => adminHandler.promptForDeleteRef(sender_psid, sendText),
                        '9': () => adminHandler.toggleAdminOnlineStatus(sender_psid, sendText),
                        '10': () => adminHandler.promptForReply_Step1_GetPSID(sender_psid, sendText),
                        '11': () => adminHandler.handleViewJobs(sender_psid, sendText),
                        '12': () => adminHandler.promptForAdminCreate_Step1_GetEmail(sender_psid, sendText),
                        '13': () => adminHandler.promptForBulkRefs_Step1_GetModId(sender_psid, sendText),
                        '14': () => adminHandler.promptForPauseToggle_GetPSID(sender_psid, sendText),
                        '15': () => adminHandler.toggleMaintenanceMode(sender_psid, sendText),
                        '16': () => adminHandler.promptForDeleteAccounts_Step1_GetModId(sender_psid, sendText),
                        '17': () => adminHandler.promptForBroadcast_Step1_GetMessage(sender_psid, sendText),
                        '18': () => adminHandler.promptForEditClaims_Step1_GetRef(sender_psid, sendText),
                        '19': () => adminHandler.promptForSalesStats(sender_psid, sendText)
                    };
                    return funcMap[lowerCaseText]();
                }
                return adminHandler.showAdminMenu(sender_psid, sendText);
            }
        } 
        
        // 3. User Logic
        const isPaused = await dbManager.isUserPaused(sender_psid);
        if (isPaused) return;

        let userStateObj = stateManager.getUserState(sender_psid);

        // Language Selection
        if (!userStateObj || (!userStateObj.lang && !user?.lang)) {
            if (lowerCaseText === 'lang_en') {
                await dbManager.addUser(sender_psid, 'en');
                stateManager.setUserState(sender_psid, 'language_set', { lang: 'en' });
                return userHandler.showUserMenu(sender_psid, 'en');
            } else if (lowerCaseText === 'lang_tl') {
                await dbManager.addUser(sender_psid, 'tl');
                stateManager.setUserState(sender_psid, 'language_set', { lang: 'tl' });
                return userHandler.showUserMenu(sender_psid, 'tl');
            } else {
                const replies = [{ title: "English", payload: "lang_en" }, { title: "Tagalog", payload: "lang_tl" }];
                return await sendQuickReplies(sender_psid, "Please select your language / Paki-pili ang iyong wika:", replies);
            }
        }

        const activeLang = userStateObj?.lang || user?.lang || 'en';
        const state = userStateObj?.state;

        // Block input if AI is working
        if (state === 'processing_receipt') {
            return await sendText(sender_psid, lang.getText('processing_receipt_wait', activeLang));
        }

        // Handle Image Attachment
        if (message?.attachments?.[0]?.type === 'image' && !message?.sticker_id) {
            const expecting = ['awaiting_receipt_for_purchase', 'awaiting_receipt_for_custom_mod'].includes(state);
            if (expecting) {
                const url = message.attachments[0].payload.url;
                stateManager.setUserState(sender_psid, 'processing_receipt', { ...(userStateObj || {}), lang: activeLang });
                return await handleReceiptSubmission(sender_psid, url);
            }
        }

        // Global Command
        if (lowerCaseText === 'menu') {
            stateManager.clearUserState(sender_psid);
            stateManager.setUserState(sender_psid, 'language_set', { lang: activeLang });
            return userHandler.showUserMenu(sender_psid, activeLang);
        }

        // State Machine
        if (state) {
            switch (state) {
                case 'awaiting_want_mod': return userHandler.handleWantMod(sender_psid, received_text, activeLang);
                case 'awaiting_email_for_purchase': return userHandler.handleEmailForPurchase(sender_psid, received_text, activeLang);
                case 'awaiting_mod_confirmation': return userHandler.handleModConfirmation(sender_psid, received_text, ADMIN_ID, activeLang);
                case 'awaiting_mod_clarification': return userHandler.handleModClarification(sender_psid, received_text, ADMIN_ID, activeLang);
                case 'awaiting_manual_ref': return userHandler.handleManualReference(sender_psid, received_text, activeLang);
                case 'awaiting_manual_mod': return userHandler.handleManualModSelection(sender_psid, received_text, sendImage, ADMIN_ID, activeLang);
                case 'awaiting_ref_for_check': return userHandler.processCheckClaims(sender_psid, received_text, activeLang);
                case 'awaiting_ref_for_replacement': return userHandler.processReplacementRequest(sender_psid, received_text, activeLang);
                case 'awaiting_custom_mod_type': return userHandler.handleCustomModType(sender_psid, received_text, activeLang);
                case 'awaiting_custom_mod_amount': return userHandler.handleCustomModAmount(sender_psid, received_text, activeLang);
                case 'awaiting_admin_message': return userHandler.forwardMessageToAdmin(sender_psid, received_text, ADMIN_ID, activeLang);
                case 'awaiting_report_ref': return userHandler.processReportRef(sender_psid, received_text, activeLang);
                case 'awaiting_report_issue_desc': return userHandler.processReportDescription(sender_psid, received_text, ADMIN_ID, activeLang);
            }
        }

        // Default Menu Mapping
        const userMenuMap = {
            '1': () => userHandler.handleViewMods(sender_psid, activeLang),
            '2': () => userHandler.promptForCheckClaims(sender_psid, activeLang),
            '3': () => userHandler.promptForReplacement(sender_psid, activeLang),
            '4': () => userHandler.promptForCustomMod(sender_psid, activeLang),
            '5': () => userHandler.promptForAdminMessage(sender_psid, activeLang),
            '6': () => userHandler.handleViewProofs(sender_psid, activeLang),
            '7': () => userHandler.promptForReportRef(sender_psid, activeLang)
        };

        if (userMenuMap[lowerCaseText]) return userMenuMap[lowerCaseText]();
        return userHandler.showUserMenu(sender_psid, activeLang);

    } catch (error) {
        await handleError(error, sender_psid, 'Master Message Handler');
    }
}

/**
 * Server Configuration
 */
async function startServer() {
    try {
        await dbManager.setupDatabase();
        
        app.get('/', (req, res) => res.send('Bot Online'));
        app.get('/webhook', (req, res) => {
            if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
                res.status(200).send(req.query['hub.challenge']);
            } else res.sendStatus(403);
        });

        app.post('/webhook', (req, res) => {
            if (req.body.object === 'page') {
                req.body.entry.forEach(entry => {
                    const event = entry.messaging[0];
                    if (event?.sender?.id) handleMessage(event.sender.id, event);
                });
                res.status(200).send('EVENT_RECEIVED');
            } else res.sendStatus(404);
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
    } catch (error) {
        console.error("Start failure:", error);
        process.exit(1);
    }
}

startServer();        console.error("Server failed to start:", error);
        process.exit(1);
    }
}

startServer();
 
