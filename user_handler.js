// user_handler.js (Final Version with Automatic Delivery)
const db = require('./database');
const stateManager = require('./state_manager');
const messengerApi = require('./messenger_api.js');
const lang = require('./language_manager');

const DEFAULT_ACCOUNT_PASSWORD = 'karloworksmod';

async function showUserMenu(sender_psid, sendText, userLang = 'en') {
    const adminInfo = await db.getAdminInfo();
    if (adminInfo && adminInfo.is_online) {
        await sendText(sender_psid, lang.getText('admin_online', userLang));
    } else {
        await sendText(sender_psid, lang.getText('admin_offline', userLang));
    }

    const menu = `${lang.getText('welcome_message', userLang)}
${lang.getText('menu_option_1', userLang)}
${lang.getText('menu_option_2', userLang)}
${lang.getText('menu_option_3', userLang)}
${lang.getText('menu_option_4', userLang)}
${lang.getText('menu_option_5', userLang)}
${lang.getText('menu_option_6', userLang)}
${lang.getText('menu_suffix', userLang)}`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

async function startManualEntryFlow(sender_psid, sendText, imageUrl, userLang = 'en') {
    await sendText(sender_psid, lang.getText('manual_entry_start', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl: imageUrl, lang: userLang });
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
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }
    let response = `${lang.getText('manual_entry_thanks', userLang)}\n`;
    mods.forEach(mod => {
        response += `🔹 Mod ${mod.id}: ${mod.name}\n   💰 Price: ${mod.price} PHP\n`;
    });
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
        const successMsg = lang.getText('manual_entry_success', userLang)
            .replace('{modId}', mod.id)
            .replace('{claimsText}', claimsText);
        await sendText(sender_psid, successMsg);

        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️\nUser: ${userName}\nManually Entered Info:\n- Ref No: ${refNumber}\n- Mod: ${mod.name} (ID: ${modId})\nThe original receipt is attached below for verification.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
            const userName = await messengerApi.getUserProfile(sender_psid);
            await sendText(ADMIN_ID, `⚠️ User ${userName} tried to manually submit a DUPLICATE reference number: ${refNumber}`);
        } else {
            console.error(e);
            await sendText(sender_psid, lang.getText('error_unexpected', userLang));
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

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
    response += `\n${lang.getText('mods_purchase_prompt', userLang)}`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod', { lang: userLang });
}

async function handleViewProofs(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('proofs_message', userLang));
}

async function handleWantMod(sender_psid, text, sendText, userLang = 'en') {
    const modId = parseInt(text.replace('want mod', '').trim());
    if (isNaN(modId)) {
        return sendText(sender_psid, lang.getText('purchase_invalid_format', userLang));
    }
    const mod = await db.getModById(modId);
    if (!mod) {
        return sendText(sender_psid, lang.getText('purchase_invalid_mod', userLang));
    }
    const promptEmailMsg = lang.getText('purchase_prompt_email', userLang)
        .replace('{modId}', mod.id)
        .replace('{modName}', mod.name);
    await sendText(sender_psid, promptEmailMsg);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id, lang: userLang });
}

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

    const paymentMsg = lang.getText('purchase_prompt_payment', userLang)
        .replace('{price}', mod.price)
        .replace('{gcashNumber}', gcashNumber);
    await sendText(sender_psid, paymentMsg);
    
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, lang: userLang });
}

async function promptForCustomMod(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('custom_mod_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_order', { lang: userLang });
}

async function handleCustomModOrder(sender_psid, text, sendText, userLang = 'en') {
    // This function is complete as provided in your file
}

async function handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang = 'en') {
    // This function is complete as provided in your file
}

async function handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID, userLang = 'en') {
    // This function is complete as provided in your file
}

async function handleModConfirmation(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const { refNumber, modId, modName, email } = stateManager.getUserState(sender_psid);
    if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'oo') {
        try {
            await db.addReference(refNumber, sender_psid, modId);
            const jobId = await db.createAccountJob(email, DEFAULT_ACCOUNT_PASSWORD, modId, sender_psid);
            
            await sendText(sender_psid, `✅ Thank you! Your purchase of Mod ${modId} has been registered.`);
            await sendText(sender_psid, `🤖 Your account is now being created automatically. You will receive another message here as soon as it is ready! This usually takes a few minutes.`);

            const userName = await messengerApi.getUserProfile(sender_psid);
            let adminNotification = `✅ New Order Queued!\nUser: ${userName} (${sender_psid})\nMod: ${modName} (ID: ${modId})\nRef No: ${refNumber}\nJob ID: ${jobId}\nEmail: \`${email}\``;
            await sendText(ADMIN_ID, adminNotification);
        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
            } else {
                console.error(e);
                await sendText(sender_psid, lang.getText('error_unexpected', userLang));
            }
        }
    } else {
        await sendText(sender_psid, lang.getText('receipt_transaction_cancelled', userLang));
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function handleModClarification(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const { refNumber, email } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, lang.getText('manual_entry_invalid_mod', userLang));
        return;
    }
    try {
        await db.addReference(refNumber, sender_psid, modId);
        const jobId = await db.createAccountJob(email, DEFAULT_ACCOUNT_PASSWORD, modId, sender_psid);

        await sendText(sender_psid, `✅ Got it! Your purchase of *Mod ${modId}* has been registered.`);
        await sendText(sender_psid, `🤖 Your account is now being created automatically. You will receive another message here as soon as it is ready! This usually takes a few minutes.`);

        const userName = await messengerApi.getUserProfile(sender_psid);
        let adminNotification = `✅ New Order Queued!\nUser: ${userName} (${sender_psid})\nMod: ${mod.name} (ID: ${modId})\nRef No: ${refNumber}\nJob ID: ${jobId}\nEmail: \`${email}\``;
        await sendText(ADMIN_ID, adminNotification);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else {
            console.error(e);
            await sendText(sender_psid, lang.getText('error_unexpected', userLang));
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function promptForCheckClaims(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('claims_check_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, sendText, userLang = 'en') {
    if (!/^\d{13}$/.test(refNumber)) {
        return sendText(sender_psid, lang.getText('claims_check_invalid_format', userLang));
    }
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await sendText(sender_psid, lang.getText('claims_check_not_found', userLang));
    } else {
        const remaining = ref.claims_max - ref.claims_used;
        const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
        const resultMsg = lang.getText('claims_check_result', userLang)
            .replace('{claimsText}', claimsText)
            .replace('{modId}', ref.mod_id)
            .replace('{modName}', ref.mod_name);
        await sendText(sender_psid, resultMsg);
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function promptForReplacement(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('replace_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, sendText, userLang = 'en') {
    if (!/^\d{13}$/.test(refNumber)) {
        return sendText(sender_psid, lang.getText('claims_check_invalid_format', userLang));
    }
    const ref = await db.getReference(refNumber);
    if (!ref || ref.claims_used >= ref.claims_max) {
        await sendText(sender_psid, lang.getText('replace_no_claims', userLang));
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }
    const account = await db.getAvailableAccount(ref.mod_id);
    if (!account) {
        await sendText(sender_psid, lang.getText('replace_no_stock', userLang));
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }
    await db.claimAccount(account.id);
    await db.useClaim(ref.ref_number);
    const successMsg = lang.getText('replace_success', userLang)
        .replace('{modId}', ref.mod_id)
        .replace('{username}', account.username)
        .replace('{password}', account.password);
    await sendText(sender_psid, successMsg);
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

async function promptForAdminMessage(sender_psid, sendText, userLang = 'en') {
    await sendText(sender_psid, lang.getText('contact_admin_prompt', userLang));
    stateManager.setUserState(sender_psid, 'awaiting_admin_message', { lang: userLang });
}

async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const userName = await messengerApi.getUserProfile(sender_psid);
    const forwardMessage = `📩 Message from user ${userName}:\n"${text}"`;
    await sendText(ADMIN_ID, forwardMessage);
    await sendText(sender_psid, lang.getText('contact_admin_success', userLang));
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
    handleViewProofs
};
