// user_handler/purchase_flow.js (CORRECTED FINAL VERSION)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

/**
 * Generates a random secure password for the automated creation jobs.
 */
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// --- Step 1: View Mods ---
async function handleViewMods(sender_psid, userLang = 'en') {
    const mods = await db.getMods();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    if (!mods || mods.length === 0) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('mods_none_available', userLang), replies);
    }

    let response = `${lang.getText('mods_header', userLang)}\n`;
    mods.forEach(mod => {
        const claimsText = mod.default_claims_max === 1 ? '1 Replacement' : `${mod.default_claims_max} Replacements`;
        response += `\n📦 Type ${mod.id}:\n${mod.description || 'N/A'}\n💰 Price: ${mod.price} PHP\n🔁 FreeAcc: ${claimsText}\n🖼️ Image: ${mod.image_url || 'N/A'}\n`;
    });
    
    const finalMessage = response + `\n${lang.getText('mods_purchase_prompt', userLang)}`;
    await messengerApi.sendQuickReplies(sender_psid, finalMessage, replies);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod', { lang: userLang });
}

// --- Step 2: Choose Mod ---
async function handleWantMod(sender_psid, text, userLang = 'en') {
    const modId = parseInt(text.trim());
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    if (isNaN(modId)) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_format', userLang), replies);
    }

    const mod = await db.getModById(modId);
    if (!mod) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_mod', userLang), replies);
    }

    const promptEmailMsg = lang.getText('purchase_prompt_email', userLang).replace('{modId}', mod.id).replace('{modName}', mod.name);
    await messengerApi.sendQuickReplies(sender_psid, promptEmailMsg, replies);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id, lang: userLang });
}

// --- Step 3: Provide Email ---
async function handleEmailForPurchase(sender_psid, text, userLang = 'en') {
    const currentState = stateManager.getUserState(sender_psid);
    const modId = currentState?.modId;
    const email = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    if (!/\S+@\S+\.\S+/.test(email)) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_email', userLang), replies);
    }

    const mod = await db.getModById(modId);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";

    const paymentMessage = lang.getText('purchase_prompt_payment', userLang)
        .replace('{price}', mod.price)
        .replace('{gcashNumber}', gcashNumber);

    await messengerApi.sendQuickReplies(sender_psid, paymentMessage, replies);
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, lang: userLang });
}

// --- Step 4: Analyze Receipt ---
async function handleReceiptAnalysis(sender_psid, analysis, ADMIN_ID, userLang = 'en') {
    const precollectedState = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    
    let userName = 'User';
    try { userName = await messengerApi.getUserProfile(sender_psid); } catch (e) {}

    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendText(sender_psid, lang.getText('receipt_fail_read', userLang));
        await messengerApi.sendText(ADMIN_ID, `⚠️ AI Failure: User ${userName} sent a receipt but info could not be extracted. Amount: ${amountStr}, Ref: ${refNumber}.`);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang }); 
        return;
    }

    const matchingMods = await db.getModsByPrice(amount);
    if (matchingMods.length === 1) {
        const mod = matchingMods[0];
        const confirmationMsg = lang.getText('receipt_confirm_purchase', userLang)
            .replace('{amount}', amount).replace('{modId}', mod.id).replace('{modName}', mod.name);
        
        const replies = [
            { title: lang.getText('confirm_yes', userLang), payload: "confirm_yes" },
            { title: lang.getText('confirm_no', userLang), payload: "confirm_no" }
        ];
        await messengerApi.sendQuickReplies(sender_psid, confirmationMsg, replies);
        
        stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', { 
            refNumber, 
            modId: mod.id, 
            modName: mod.name, 
            email: precollectedState?.email, 
            lang: userLang 
        });

    } else if (matchingMods.length > 1) {
        let modList = '';
        matchingMods.forEach(m => { modList += `- Mod ${m.id}: ${m.name}\n`; });
        const clarificationMsg = lang.getText('receipt_clarify_purchase', userLang).replace('{amount}', amount).replace('{modList}', modList);
        await messengerApi.sendText(sender_psid, clarificationMsg);
        
        stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', { 
            refNumber, 
            email: precollectedState?.email, 
            lang: userLang 
        });

    } else {
        await messengerApi.sendText(sender_psid, lang.getText('receipt_no_match', userLang).replace('{amount}', amount));
        await messengerApi.sendText(ADMIN_ID, `⚠️ No mod matches price: User ${userName} paid ${amount} PHP (Ref: ${refNumber}).`);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    }
}

// --- Step 5: Final Confirmation ---
async function handleModConfirmation(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const currentState = stateManager.getUserState(sender_psid);
    const { refNumber, modId, modName, email } = currentState;
    const positiveReply = lang.getText('confirm_yes', userLang).toLowerCase();
    
    if (text.toLowerCase() === 'confirm_yes' || text.toLowerCase() === 'yes' || text.toLowerCase() === positiveReply) {
        try {
            let userName = 'User';
            try { userName = await messengerApi.getUserProfile(sender_psid); } catch (e) {}

            await db.addReference(refNumber, sender_psid, modId);
            
            const password = generatePassword();
            const safeEmail = email || `acct-${sender_psid}@fallback.bot`;

            // FIXED: Passing userLang to the creation job
            const jobId = await db.createAccountCreationJob(sender_psid, safeEmail, password, modId, userLang);
            
            const confirmationMessage = lang.getText('automation_started_user', userLang).replace('{modName}', modName);
            await messengerApi.sendText(sender_psid, confirmationMessage);
            
            await messengerApi.sendText(ADMIN_ID, `🤖 NEW PURCHASE (Job ID: ${jobId})\nUser: ${userName}\nMod: ${modName}\nRef: ${refNumber}`);
            
        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
            } else { 
                console.error("Confirmation error:", e);
                await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
            }
        }
    } else {
        await messengerApi.sendText(sender_psid, lang.getText('receipt_transaction_cancelled', userLang));
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Optional: Clarification Flow ---
async function handleModClarification(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const currentState = stateManager.getUserState(sender_psid);
    const { refNumber, email } = currentState;
    const modId = parseInt(text.trim());

    try {
        const mod = await db.getModById(modId);
        if (isNaN(modId) || !mod) {
            return await messengerApi.sendText(sender_psid, lang.getText('manual_entry_invalid_mod', userLang));
        }

        let userName = 'User';
        try { userName = await messengerApi.getUserProfile(sender_psid); } catch (e) {}

        await db.addReference(refNumber, sender_psid, modId);
        
        const password = generatePassword();
        const safeEmail = email || `acct-${sender_psid}@fallback.bot`;

        // FIXED: Passing userLang to the creation job
        const jobId = await db.createAccountCreationJob(sender_psid, safeEmail, password, modId, userLang);
        
        const confirmationMessage = lang.getText('automation_started_user', userLang).replace('{modName}', mod.name);
        await messengerApi.sendText(sender_psid, confirmationMessage);
        
        await messengerApi.sendText(ADMIN_ID, `🤖 NEW PURCHASE (Job ID: ${jobId})\nUser: ${userName}\nMod: ${mod.name}\nRef: ${refNumber}`);

    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else { 
            console.error("Clarification error:", e);
            await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = {
    handleViewMods,
    handleWantMod,
    handleEmailForPurchase,
    handleReceiptAnalysis,
    handleModConfirmation,
    handleModClarification,
};
