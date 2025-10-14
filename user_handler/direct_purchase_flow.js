// user_handler/direct_purchase_flow.js
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

// This function can be copied from purchase_flow.js or defined here
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// Flow Step 1: Ask the user for their reference number
async function promptForDirectPurchaseRef(sender_psid, userLang = 'en') {
    const message = lang.getText('direct_purchase_prompt_ref', userLang);
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, message, replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_direct_purchase', { lang: userLang });
}

// Flow Step 2: Validate ref number, check for duplicates, then ask for email
async function handleDirectPurchaseRef(sender_psid, text, userLang = 'en') {
    const refNumber = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), replies);
        return;
    }

    // CRITICAL: Check if the reference number has already been used
    const existingRef = await db.getReference(refNumber);
    if (existingRef) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_duplicate_ref', userLang), replies);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }

    const message = lang.getText('direct_purchase_prompt_email', userLang);
    await messengerApi.sendQuickReplies(sender_psid, message, replies);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_direct_purchase', { refNumber, lang: userLang });
}

// Flow Step 3: Validate email, then ask for the Mod they purchased
async function handleDirectPurchaseEmail(sender_psid, text, userLang = 'en') {
    const { refNumber } = stateManager.getUserState(sender_psid);
    const email = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    if (!/\S+@\S+\.\S+/.test(email)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_email', userLang), replies);
        return;
    }

    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('mods_none_available', userLang), replies);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }

    let response = `${lang.getText('direct_purchase_prompt_mod', userLang)}\n`;
    mods.forEach(mod => {
        response += `\n📦 Type ${mod.id}: ${mod.name} (${mod.price} PHP)`;
    });

    await messengerApi.sendQuickReplies(sender_psid, response, replies);
    stateManager.setUserState(sender_psid, 'awaiting_mod_for_direct_purchase', { refNumber, email, lang: userLang });
}

// Flow Step 4: Validate Mod ID and create the automation job
async function processDirectPurchase(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const { refNumber, email } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_mod', userLang), replies);
        return;
    }

    try {
        let userName = 'A User';
        try { userName = await messengerApi.getUserProfile(sender_psid); } catch (e) { console.error("Failed to fetch user profile", e); }

        await db.addReference(refNumber, sender_psid, modId);
        const password = generatePassword();
        const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);

        const confirmationMessage = lang.getText('automation_started_user', userLang).replace('{modName}', mod.name);
        await messengerApi.sendText(sender_psid, confirmationMessage);

        await messengerApi.sendText(ADMIN_ID, `🤖 Automation job (ID: ${jobId}) has been queued via DIRECT REF entry for ${userName} (Mod: ${mod.name}, Ref: ${refNumber})`);

    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else {
            console.error("Error in direct purchase processing:", e);
            await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
        }
    }

    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    promptForDirectPurchaseRef,
    handleDirectPurchaseRef,
    handleDirectPurchaseEmail,
    processDirectPurchase,
};
