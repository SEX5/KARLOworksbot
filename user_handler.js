// user_handler.js (Fully Corrected, Feature-Complete Version)
const db = require('./database');
const stateManager = require('./state_manager');
const messengerApi = require('./messenger_api.js');
const lang = require('./language_manager');

function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// --- Main Menu (Sends Text and Buttons) ---
async function showUserMenu(sender_psid, sendQuickReplies, userLang = 'en') {
    const adminInfo = await db.getAdminInfo();
    let initialMessage = adminInfo?.is_online ? lang.getText('admin_online', userLang) : lang.getText('admin_offline', userLang);
    await messengerApi.sendText(sender_psid, initialMessage);

    // FIX: Added Menu Option 7 to the menu text
    const menuText = `${lang.getText('welcome_message', userLang)}\n\n${lang.getText('menu_option_1', userLang)}\n${lang.getText('menu_option_2', userLang)}\n${lang.getText('menu_option_3', userLang)}\n${lang.getText('menu_option_4', userLang)}\n${lang.getText('menu_option_5', userLang)}\n${lang.getText('menu_option_6', userLang)}\n${lang.getText('menu_option_7', userLang)}\n\n${lang.getText('menu_suffix', userLang)}`;
    
    // FIX: Added Menu Option 7 to the quick replies
    const replies = [
        { title: lang.getText('menu_option_1_button', userLang), payload: "1" },
        { title: lang.getText('menu_option_2_button', userLang), payload: "2" },
        { title: lang.getText('menu_option_3_button', userLang), payload: "3" },
        { title: lang.getText('menu_option_4_button', userLang), payload: "4" },
        { title: lang.getText('menu_option_5_button', userLang), payload: "5" },
        { title: lang.getText('menu_option_6_button', userLang), payload: "6" },
        { title: lang.getText('menu_option_7_button', userLang), payload: "7" },
    ];
    await sendQuickReplies(sender_psid, menuText, replies);
}

// --- View Mods ---
async function handleViewMods(sender_psid, sendText, userLang = 'en') {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        return sendText(sender_psid, lang.getText('mods_none_available', userLang));
    }
    let response = `${lang.getText('mods_header', userLang)}\n`;
    mods.forEach(mod => {
        const claimsText = mod.default_claims_max === 1 ? '1 Replacement' : `${mod.default_claims_max} Replacements`;
        response += `\n📦 Type ${mod.id}:\n${mod.description || 'N/A'}\n💰 Price: ${mod.price} PHP\n🔁 FreeAcc: ${claimsText}\n🖼️ Image: ${mod.image_url || 'N/A'}\n`;
    });
    
    const finalMessage = response + `\n${lang.getText('mods_purchase_prompt', userLang)}`;
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    
    await messengerApi.sendQuickReplies(sender_psid, finalMessage, replies);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod', { lang: userLang });
}

// --- Purchase Flow ---
async function handleWantMod(sender_psid, text, sendText, userLang = 'en') {
    const modId = parseInt(text.trim());
    if (isNaN(modId)) {
        // FIX: Sends an error message for invalid text input instead of silently failing.
        await sendText(sender_psid, lang.getText('purchase_invalid_format', userLang));
        return;
    }
    const mod = await db.getModById(modId);
    if (!mod) {
        await sendText(sender_psid, lang.getText('purchase_invalid_mod', userLang));
        return;
    }
    const promptEmailMsg = lang.getText('purchase_prompt_email', userLang).replace('{modId}', mod.id).replace('{modName}', mod.name);
    await sendText(sender_psid, promptEmailMsg);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id, lang: userLang });
}

// --- View Proofs ---
async function handleViewProofs(sender_psid, sendText, userLang = 'en') {
    const proofMessage = lang.getText('proofs_message', userLang);
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, proofMessage, replies);
}

// --- Check Claims ---
async function promptForCheckClaims(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('claims_check_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, sendText, userLang = 'en') {
    let resultMsg = '';
    if (!/^\d{13}$/.test(refNumber.trim())) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(refNumber.trim());
        if (!ref) {
            resultMsg = lang.getText('claims_check_not_found', userLang);
        } else {
            const remaining = ref.claims_max - ref.claims_used;
            const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
            resultMsg = lang.getText('claims_check_result', userLang)
                .replace('{claimsText}', claimsText).replace('{modId}', ref.mod_id).replace('{modName}', ref.mod_name);
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}

// --- Replacement Request ---
async function promptForReplacement(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('replace_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, sendText, userLang = 'en') {
    const trimmedRef = refNumber.trim();
    let resultMsg = '';
    if (!/^\d{13}$/.test(trimmedRef)) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(trimmedRef);
        if (ref && ref.last_replacement_timestamp) {
            const lastReplacementTime = new Date(ref.last_replacement_timestamp).getTime();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            if (Date.now() - lastReplacementTime < twentyFourHours) {
                // FIX: Uses the correct language key.
                resultMsg = lang.getText('replace_limit_reached', userLang);
            }
        }
        if (!resultMsg) {
            if (!ref || ref.claims_used >= ref.claims_max) {
                resultMsg = lang.getText('replace_no_claims', userLang);
            } else {
                const account = await db.getAvailableAccount(ref.mod_id);
                if (!account) {
                    resultMsg = lang.getText('replace_no_stock', userLang);
                } else {
                    await db.claimAccount(account.id);
                    await db.useClaim(ref.ref_number);
                    resultMsg = lang.getText('replace_success', userLang)
                        .replace('{modId}', ref.mod_id).replace('{username}', account.username).replace('{password}', account.password);
                }
            }
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}

// --- Custom Mod Flow (Text-based) ---
async function promptForCustomMod(sender_psid, sendText, userLang = 'en') {
    // FIX: Uses the correct language key.
    await sendText(sender_psid, lang.getText('custom_mod_prompt_choice', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_order', { lang: userLang });
}

async function handleCustomModOrder(sender_psid, text, sendText, userLang = 'en') {
    const orderText = text.toLowerCase().trim();
    let orderType = ''; let orderAmount = ''; let price = 0;
    if (orderText.startsWith('money')) {
        orderType = 'Money'; orderAmount = text.substring(5).trim();
        const amountMil = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (amountMil >= 5 && amountMil <= 10) price = 150;
        else if (amountMil > 10 && amountMil <= 30) price = 200;
    } else if (orderText.startsWith('gold')) {
        orderType = 'Gold'; orderAmount = text.substring(4).trim();
        const amountK = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (amountK >= 1 && amountK <= 6) price = 150;
    }
    if (price === 0) {
        await sendText(sender_psid, lang.getText('custom_mod_invalid_order', userLang));
        return;
    }
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";
    const paymentMsg = lang.getText('custom_mod_prompt_payment', userLang).replace('{orderAmount}', orderAmount).replace('{orderType}', orderType).replace('{price}', price).replace('{gcashNumber}', gcashNumber);
    await sendText(sender_psid, paymentMsg);
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_custom_mod', { orderType, orderAmount, price, lang: userLang });
}


// --- Receipt and Confirmation Flows ---

async function handleEmailForPurchase(sender_psid, text, sendText, userLang = 'en') {
    const { modId } = stateManager.getUserState(sender_psid);
    const email = text.trim();
    if (!/\S+@\S+\.\S+/.test(email)) {
        await sendText(sender_psid, lang.getText('purchase_invalid_email', userLang));
        return;
    }
    const mod = await db.getModById(modId);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";
    await sendText(sender_psid, lang.getText('purchase_prompt_payment', userLang).replace('{price}', mod.price).replace('{gcashNumber}', gcashNumber));
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, lang: userLang });
}

async function handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang = 'en') {
    const { orderType, orderAmount, price } = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userName = await messengerApi.getUserProfile(sender_psid);
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, lang.getText('custom_mod_receipt_fail', userLang));
        const adminNotification = `⚠️ CUSTOM MOD - AI FAILURE ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nAI could not read the receipt. Please check manually.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } else if (Math.abs(amount - price) > 0.01) {
        const mismatchMsg = lang.getText('custom_mod_mismatch', userLang).replace('{amount}', amount).replace('{price}', price);
        await sendText(sender_psid, mismatchMsg);
        const adminNotification = `⚠️ CUSTOM MOD - PRICE MISMATCH ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nExpected: ${price} PHP\nPaid: ${amount} PHP\nRef: ${refNumber}`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } else {
        await sendText(sender_psid, lang.getText('custom_mod_success', userLang));
        const adminNotification = `✅ New Custom Mod Order!\nUser: ${userName} (${sender_psid})\nOrder: *${orderAmount} of ${orderType}*\nPrice: ${price} PHP\nRef No: ${refNumber}`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function handleReceiptAnalysis(sender_psid, analysis, sendText, sendQuickReplies, ADMIN_ID, userLang = 'en') {
    const precollectedState = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userName = await messengerApi.getUserProfile(sender_psid);
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, lang.getText('receipt_fail_read', userLang));
        await sendText(ADMIN_ID, `User ${userName} sent a receipt, but AI failed to extract valid info. Amount: ${amountStr}, Ref: ${refNumber}.`);
        return;
    }
    const matchingMods = await db.getModsByPrice(amount);
    if (matchingMods.length === 1) {
        const mod = matchingMods[0];
        const confirmationMsg = lang.getText('receipt_confirm_purchase', userLang)
            .replace('{amount}', amount).replace('{modId}', mod.id).replace('{modName}', mod.name);
        const replies = [{ title: "Yes", payload: "confirm_yes" }, { title: "No", payload: "confirm_no" }];
        await sendQuickReplies(sender_psid, confirmationMsg, replies);
        stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', { refNumber, modId: mod.id, modName: mod.name, email: precollectedState?.email, lang: userLang });
    } else if (matchingMods.length > 1) {
        let modList = '';
        matchingMods.forEach(m => { modList += `- Mod ${m.id}: ${m.name}\n`; });
        const clarificationMsg = lang.getText('receipt_clarify_purchase', userLang).replace('{amount}', amount).replace('{modList}', modList);
        await sendText(sender_psid, clarificationMsg);
        stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', { refNumber, email: precollectedState?.email, lang: userLang });
    } else {
        await sendText(sender_psid, lang.getText('receipt_no_match', userLang).replace('{amount}', amount));
        await sendText(ADMIN_ID, `User ${userName} sent a receipt for ${amount} PHP with ref ${refNumber}, but no mod matches this price.`);
    }
}

async function handleModConfirmation(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const { refNumber, modId, modName, email } = stateManager.getUserState(sender_psid);
    if (text.toLowerCase() === 'confirm_yes') {
        try {
            const userName = await messengerApi.getUserProfile(sender_psid);
            await db.addReference(refNumber, sender_psid, modId);

            const password = generatePassword();
            const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);
            
            // FIX: Uses the translatable language key instead of a hardcoded message.
            const confirmationMessage = lang.getText('automation_started_user', userLang)
                .replace('{modName}', modName);
            await sendText(sender_psid, confirmationMessage);
            
            await sendText(ADMIN_ID, `🤖 Automation job (ID: ${jobId}) has been queued for ${userName} (Mod: ${modName}, Ref: ${refNumber})`);

        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                const userName = await messengerApi.getUserProfile(sender_psid);
                await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
                await sendText(ADMIN_ID, `⚠️ User ${userName} tried to submit a DUPLICATE reference: ${refNumber}`);
            } else { throw e; }
        }
    } else {
        await sendText(sender_psid, lang.getText('receipt_transaction_cancelled', userLang));
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function handleModClarification(sender_psid, text, sendText, sendQuickReplies, ADMIN_ID, userLang = 'en') {
    const { refNumber, email } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    try {
        const mod = await db.getModById(modId);
        if (isNaN(modId) || !mod) {
            await sendText(sender_psid, lang.getText('manual_entry_invalid_mod', userLang));
            return;
        }
        const userName = await messengerApi.getUserProfile(sender_psid);
        await db.addReference(refNumber, sender_psid, modId);
        
        const password = generatePassword();
        const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);
        
        // FIX: Uses the translatable language key instead of a hardcoded message.
        const confirmationMessage = lang.getText('automation_started_user', userLang)
            .replace('{modName}', mod.name);
        await sendText(sender_psid, confirmationMessage);
        
        await sendText(ADMIN_ID, `🤖 Automation job (ID: ${jobId}) has been queued for ${userName} (Mod: ${mod.name}, Ref: ${refNumber})`);

    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else { throw e; }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


// --- Manual Entry and Admin Contact ---

async function startManualEntryFlow(sender_psid, sendText, imageUrl, userLang = 'en') {
    await sendText(sender_psid, lang.getText('manual_entry_start', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl, lang: userLang });
}

async function handleManualReference(sender_psid, text, sendText, userLang = 'en') {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, lang.getText('manual_entry_invalid_ref', userLang));
        return;
    }
    const { imageUrl } = stateManager.getUserState(sender_psid);
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, lang.getText('error_no_mods_found', userLang));
        stateManager.clearUserState(sender_psid);
        return stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    }
    let response = `${lang.getText('manual_entry_thanks', userLang)}\n`;
    mods.forEach(mod => { response += `🔹 Mod ${mod.id}: ${mod.name}\n   💰 Price: ${mod.price} PHP\n`; });
    response += `\n${lang.getText('manual_entry_prompt_mod', userLang)}`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_manual_mod', { imageUrl, refNumber, lang: userLang });
}

async function handleManualModSelection(sender_psid, text, sendText, sendImage, ADMIN_ID, userLang = 'en') {
    const { imageUrl, refNumber } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, lang.getText('manual_entry_invalid_mod', userLang));
        return;
    }
    try {
        const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
        const claimsText = claimsAdded === 1 ? '1 replacement claim' : `${claimsAdded} replacement claims`;
        await sendText(sender_psid, lang.getText('manual_entry_success', userLang).replace('{modId}', mod.id).replace('{claimsText}', claimsText));
        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️\nUser: ${userName}\nRef No: ${refNumber}\nMod: ${mod.name}\nReceipt attached.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else {
            throw e;
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function promptForAdminMessage(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('contact_admin_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_admin_message', { lang: userLang });
}

async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const userName = await messengerApi.getUserProfile(sender_psid);
    const forwardMessage = `📩 Message from ${userName} (${sender_psid}):\n\n"${text}"\n\nTo reply, use the admin menu.`;
    await sendText(ADMIN_ID, forwardMessage);
    await sendText(sender_psid, lang.getText('contact_admin_success', userLang));
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- NEW FUNCTIONS for Report Issue Feature ---

async function promptForReportRef(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('report_prompt_ref', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_report_ref', { lang: userLang });
}

async function processReportRef(sender_psid, text, sendText, userLang = 'en') {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, lang.getText('claims_check_invalid_format', userLang)); // Re-using this key is efficient
        return;
    }
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await sendText(sender_psid, lang.getText('report_not_found', userLang));
        return;
    }
    await sendText(sender_psid, lang.getText('report_prompt_issue', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_report_issue_desc', { refNumber, lang: userLang });
}

async function processReportDescription(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const { refNumber } = stateManager.getUserState(sender_psid);
    const issueDescription = text.trim();
    const userName = await messengerApi.getUserProfile(sender_psid);
    
    const adminNotification = `🚨 NEW ACCOUNT ISSUE REPORT 🚨\n\nUser: ${userName} (${sender_psid})\nReference: ${refNumber}\n\nIssue:\n"${issueDescription}"`;
    await sendText(ADMIN_ID, adminNotification);
    
    await sendText(sender_psid, lang.getText('report_success_user', userLang));
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    showUserMenu,
    handleViewMods,
    handleWantMod,
    handleEmailForPurchase,
    handleReceiptAnalysis,
    handleModConfirmation,
    handleModClarification,
    promptForCheckClaims,
    processCheckClaims,
    promptForReplacement,
    processReplacementRequest,
    promptForAdminMessage,
    forwardMessageToAdmin,
    startManualEntryFlow,
    handleManualReference,
    handleManualModSelection,
    promptForCustomMod,
    handleCustomModOrder,
    handleCustomModReceipt,
    handleViewProofs,
    // NEW EXPORTS for the report feature
    promptForReportRef,
    processReportRef,
    processReportDescription
};
