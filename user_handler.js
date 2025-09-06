// user_handler.js (Complete Final Version)
const db = require('./database');
const stateManager = require('./state_manager');
const messengerApi = require('./messenger_api.js');
const lang = require('./language_manager');
const { handleUserError } = require('./error_handler.js');

// Helper to create a "Menu" quick reply button
const menuReply = (userLang) => ({ title: "⬅️ Menu", payload: "menu" });

// Helper to strip prefixes from menu option text for cleaner button titles
const cleanButtonTitle = (text) => {
    return text.replace(/^[^\s]+\s*[\d️⃣]+\s*|^\s*📦\s*Type\s*|^\s*🔹\s*Mod\s*/, '').trim();
};

// Simple password generator
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// --- Main Menu ---
async function showUserMenu(sender_psid, sendText, userLang = 'en') {
    const adminInfo = await db.getAdminInfo();
    let initialMessage = adminInfo?.is_online 
        ? lang.getText('admin_online', userLang) 
        : lang.getText('admin_offline', userLang);

    initialMessage += `\n\n${lang.getText('welcome_message', userLang)}`;
    
    const replies = [
        { title: cleanButtonTitle(lang.getText('menu_option_1', userLang)), payload: '1' },
        { title: cleanButtonTitle(lang.getText('menu_option_2', userLang)), payload: '2' },
        { title: cleanButtonTitle(lang.getText('menu_option_3', userLang)), payload: '3' },
        { title: cleanButtonTitle(lang.getText('menu_option_4', userLang)), payload: '4' },
        { title: cleanButtonTitle(lang.getText('menu_option_5', userLang)), payload: '5' },
        { title: cleanButtonTitle(lang.getText('menu_option_6', userLang)), payload: '6' },
        { title: cleanButtonTitle(lang.getText('menu_option_7', userLang)), payload: '7' }
    ];
    
    // The full text is sent for backward compatibility, while buttons provide the primary UI
    const menuText = `
${lang.getText('menu_option_1', userLang)}
${lang.getText('menu_option_2', userLang)}
${lang.getText('menu_option_3', userLang)}
${lang.getText('menu_option_4', userLang)}
${lang.getText('menu_option_5', userLang)}
${lang.getText('menu_option_6', userLang)}
${lang.getText('menu_option_7', userLang)}
${lang.getText('menu_suffix', userLang)}`;

    await messengerApi.sendQuickReplies(sender_psid, `${initialMessage}\n\n${menuText}`, replies);
}

// --- Manual Entry Fallback ---
async function startManualEntryFlow(sender_psid, sendText, sendImage, imageUrl, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_start', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl: imageUrl, lang: userLang });
}

async function handleManualReference(sender_psid, text, sendText, userLang = 'en') {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_invalid_ref', userLang), [menuReply(userLang)]);
        return;
    }
    const { imageUrl } = stateManager.getUserState(sender_psid);
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_no_mods_found', userLang), [menuReply(userLang)]);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }
    
    let response = `${lang.getText('manual_entry_thanks', userLang)}\n`;
    const replies = [];
    mods.forEach(mod => {
        const modText = `🔹 Mod ${mod.id}: ${mod.name}\n   💰 Price: ${mod.price} PHP\n`;
        response += modText;
        replies.push({ title: cleanButtonTitle(modText.split('\n')[0]), payload: mod.id.toString() });
    });
    response += `\n${lang.getText('manual_entry_prompt_mod', userLang)}`;
    
    replies.push(menuReply(userLang));
    await messengerApi.sendQuickReplies(sender_psid, response, replies);
    stateManager.setUserState(sender_psid, 'awaiting_manual_mod', { imageUrl, refNumber, lang: userLang });
}

async function handleManualModSelection(sender_psid, text, sendText, sendImage, ADMIN_ID, userLang = 'en') {
    try {
        const { imageUrl, refNumber } = stateManager.getUserState(sender_psid);
        const modId = parseInt(text.trim());
        const mod = await db.getModById(modId);
        if (isNaN(modId) || !mod) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_invalid_mod', userLang), [menuReply(userLang)]);
            return;
        }
        const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
        const claimsText = claimsAdded === 1 ? '1 replacement claim' : `${claimsAdded} replacement claims`;
        const successMsg = lang.getText('manual_entry_success', userLang)
            .replace('{modId}', mod.id)
            .replace('{claimsText}', claimsText);
        await messengerApi.sendQuickReplies(sender_psid, successMsg, [menuReply(userLang)]);

        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️\nUser: ${userName}\nManually Entered Info:\n- Ref No: ${refNumber}\n- Mod: ${mod.name} (ID: ${modId})\nThe original receipt is attached below for verification.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_duplicate_ref', userLang), [menuReply(userLang)]);
            const userName = await messengerApi.getUserProfile(sender_psid);
            await sendText(ADMIN_ID, `⚠️ User ${userName} tried to manually submit a DUPLICATE reference number: ${refNumber}`);
            stateManager.clearUserState(sender_psid);
            stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        } else {
            await handleUserError(e, sender_psid, userLang, 'Manual Mod Selection');
        }
    }
}

// --- View Available Mods ---
async function handleViewMods(sender_psid, sendText, userLang = 'en') {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('mods_none_available', userLang), [menuReply(userLang)]);
        return;
    }

    let response = `${lang.getText('mods_header', userLang)}\n`;
    const replies = [];
    mods.forEach(mod => {
        const claimsText = mod.default_claims_max === 1 ? '1 Replacement' : `${mod.default_claims_max} Replacements`;
        response += `\n📦 Type ${mod.id}:\n${mod.description || 'N/A'}\n💰 Price: ${mod.price} PHP\n🔁 FreeAcc: ${claimsText}\n🖼️ Image: ${mod.image_url || 'N/A'}\n`;
        replies.push({ title: `Buy Mod ${mod.id}`, payload: mod.id.toString() });
    });
    response += `\n${lang.getText('mods_purchase_prompt', userLang)}`;

    replies.push(menuReply(userLang));
    await messengerApi.sendQuickReplies(sender_psid, response, replies);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod', { lang: userLang });
}

// --- View Proofs ---
async function handleViewProofs(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('proofs_message', userLang), [menuReply(userLang)]);
}

// --- Purchase Flow ---
async function handleWantMod(sender_psid, text, sendText, userLang = 'en') {
    const modId = parseInt(text.replace('want mod', '').trim());
    if (isNaN(modId)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_format', userLang), [menuReply(userLang)]);
        return;
    }
    const mod = await db.getModById(modId);
    if (!mod) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_mod', userLang), [menuReply(userLang)]);
        return;
    }
    const promptEmailMsg = lang.getText('purchase_prompt_email', userLang)
        .replace('{modId}', mod.id)
        .replace('{modName}', mod.name);
    await messengerApi.sendQuickReplies(sender_psid, promptEmailMsg, [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id, lang: userLang });
}

async function handleEmailForPurchase(sender_psid, text, sendText, userLang = 'en') {
    const { modId } = stateManager.getUserState(sender_psid);
    const email = text.trim();
    
    if (!/\S+@\S+\.\S+/.test(email)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_email', userLang), [menuReply(userLang)]);
        return;
    }

    const mod = await db.getModById(modId);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";

    const paymentMsg = lang.getText('purchase_prompt_payment', userLang)
        .replace('{price}', mod.price)
        .replace('{gcashNumber}', gcashNumber);
    await messengerApi.sendQuickReplies(sender_psid, paymentMsg, [menuReply(userLang)]);
    
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, lang: userLang });
}

// --- Custom Mod Functions ---
async function promptForCustomMod(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('custom_mod_prompt', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_order', { lang: userLang });
}

async function handleCustomModOrder(sender_psid, text, sendText, userLang = 'en') {
    const orderText = text.toLowerCase().trim();
    let orderType = '';
    let orderAmount = '';
    let price = 0;

    if (orderText.startsWith('money')) {
        orderType = 'Money';
        orderAmount = text.substring(5).trim();
        const amountMil = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (amountMil >= 5 && amountMil <= 10) {
            price = 150;
        } else if (amountMil > 10 && amountMil <= 30) {
            price = 200;
        }
    } else if (orderText.startsWith('gold')) {
        orderType = 'Gold';
        orderAmount = text.substring(4).trim();
        const amountK = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (amountK >= 1 && amountK <= 6) {
            price = 150;
        }
    }

    if (price === 0) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('custom_mod_invalid_order', userLang), [menuReply(userLang)]);
        return;
    }

    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";

    const paymentMsg = lang.getText('custom_mod_prompt_payment', userLang)
        .replace('{orderAmount}', orderAmount)
        .replace('{orderType}', orderType)
        .replace('{price}', price)
        .replace('{gcashNumber}', gcashNumber);
    await messengerApi.sendQuickReplies(sender_psid, paymentMsg, [menuReply(userLang)]);
    
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_custom_mod', {
        orderType,
        orderAmount,
        price,
        lang: userLang
    });
}

async function handleCustomModReceipt(sender_psid, analysis, sendText, sendImage, ADMIN_ID, imageUrl, userLang = 'en') {
    const { orderType, orderAmount, price } = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userName = await messengerApi.getUserProfile(sender_psid);

    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('custom_mod_receipt_fail', userLang), [menuReply(userLang)]);
        const adminNotification = `⚠️ CUSTOM MOD - AI FAILURE ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nThe AI could not read the receipt. Please check manually. Receipt is attached below.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }

    if (amount !== price) {
        const mismatchMsg = lang.getText('custom_mod_mismatch', userLang)
            .replace('{amount}', amount)
            .replace('{price}', price);
        await messengerApi.sendQuickReplies(sender_psid, mismatchMsg, [menuReply(userLang)]);
        const adminNotification = `⚠️ CUSTOM MOD - PRICE MISMATCH ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nExpected Price: ${price} PHP\nPaid Price: ${amount} PHP\nRef No: ${refNumber}\nReceipt is attached below.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
        return;
    }

    await messengerApi.sendQuickReplies(sender_psid, lang.getText('custom_mod_success', userLang), [menuReply(userLang)]);
    const adminNotification = `✅ New Custom Mod Order!\nUser: ${userName} (${sender_psid})\nOrder: *${orderAmount} of ${orderType}*\nPrice: ${price} PHP\nRef No: ${refNumber}\nThe receipt is attached below for verification.`;
    await sendText(ADMIN_ID, adminNotification);
    await sendImage(ADMIN_ID, imageUrl);
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Receipt Analysis (AI-powered) ---
async function handleReceiptAnalysis(sender_psid, analysis, sendText, sendImage, ADMIN_ID, userLang = 'en') {
    const precollectedState = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        const userName = await messengerApi.getUserProfile(sender_psid);
        await sendText(ADMIN_ID, `User ${userName} sent a receipt, but AI failed to extract valid info. Amount found: ${amountStr}, Ref found: ${refNumber}. Please check manually.`);
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('receipt_fail_read', userLang), [menuReply(userLang)]);
        return;
    }

    const matchingMods = await db.getModsByPrice(amount);
    if (matchingMods.length === 1) {
        const mod = matchingMods[0];
        const confirmationMsg = lang.getText('receipt_confirm_purchase', userLang)
            .replace('{amount}', amount)
            .replace('{modId}', mod.id)
            .replace('{modName}', mod.name);
        
        const replies = [
            { title: lang.getText('confirm_yes', userLang), payload: 'yes' },
            { title: lang.getText('confirm_no', userLang), payload: 'no' },
            menuReply(userLang)
        ];
        await messengerApi.sendQuickReplies(sender_psid, confirmationMsg, replies);
        stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', { refNumber, modId: mod.id, modName: mod.name, email: precollectedState?.email, lang: userLang });
    } else if (matchingMods.length > 1) {
        let modList = '';
        const replies = [];
        matchingMods.forEach(m => { 
            modList += `- Mod ${m.id}: ${m.name}\n`;
            replies.push({ title: `Mod ${m.id}`, payload: m.id.toString() });
        });
        const clarificationMsg = lang.getText('receipt_clarify_purchase', userLang)
            .replace('{amount}', amount)
            .replace('{modList}', modList);
        
        replies.push(menuReply(userLang));
        await messengerApi.sendQuickReplies(sender_psid, clarificationMsg, replies);
        stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', { refNumber, email: precollectedState?.email, lang: userLang });
    } else {
        const userName = await messengerApi.getUserProfile(sender_psid);
        await sendText(ADMIN_ID, `User ${userName} sent a receipt for ${amount} PHP with ref ${refNumber}, but no mod matches this price.`);
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('receipt_no_match', userLang).replace('{amount}', amount), [menuReply(userLang)]);
    }
}

// --- Confirmation after Receipt ---
async function handleModConfirmation(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const { refNumber, modId, modName, email } = stateManager.getUserState(sender_psid);
    if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'oo') {
        try {
            await db.addReference(refNumber, sender_psid, modId);
            const userName = await messengerApi.getUserProfile(sender_psid);
            
            const mod = await db.getModById(modId);
            if (mod && mod.x_coordinate && mod.y_coordinate) {
                const password = generatePassword();
                const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);
                await messengerApi.sendQuickReplies(sender_psid, lang.getText('automation_started_user', userLang).replace('{modName}', modName), [menuReply(userLang)]);
                let adminNotification = `🤖 New automated job (ID: ${jobId}) started!\nUser: ${userName}\nMod: ${modName} (ID: ${modId})\nRef No: ${refNumber}\nEmail: \`${email}\``;
                await sendText(ADMIN_ID, adminNotification);
            } else {
                await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_creation_user', userLang), [menuReply(userLang)]);
                let adminNotification = `⚠️ MANUAL CREATION REQUIRED ⚠️\nUser: ${userName} (${sender_psid})\nMod: ${modName} (ID: ${modId})\nRef No: ${refNumber}\nEmail: \`${email}\`\nReason: Automation coordinates are missing for this mod.`;
                await sendText(ADMIN_ID, adminNotification);
            }
        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_duplicate_ref', userLang), [menuReply(userLang)]);
                const userName = await messengerApi.getUserProfile(sender_psid);
                await sendText(ADMIN_ID, `⚠️ User ${userName} tried to submit a duplicate reference number: ${refNumber}`);
            } else {
                await handleUserError(e, sender_psid, userLang, 'Mod Confirmation');
            }
        }
    } else {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('receipt_transaction_cancelled', userLang), [menuReply(userLang)]);
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Clarify Mod if Multiple Match ---
async function handleModClarification(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    try {
        const { refNumber, email } = stateManager.getUserState(sender_psid);
        const modId = parseInt(text.trim());
        const mod = await db.getModById(modId);
        if (isNaN(modId) || !mod) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_entry_invalid_mod', userLang), [menuReply(userLang)]);
            return;
        }

        await db.addReference(refNumber, sender_psid, modId);
        const userName = await messengerApi.getUserProfile(sender_psid);

        if (mod && mod.x_coordinate && mod.y_coordinate) {
            const password = generatePassword();
            const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('automation_started_user', userLang).replace('{modName}', mod.name), [menuReply(userLang)]);
            let adminNotification = `🤖 New automated job (ID: ${jobId}) started!\nUser: ${userName}\nMod: ${mod.name} (ID: ${modId})\nRef No: ${refNumber}\nEmail: \`${email}\``;
            await sendText(ADMIN_ID, adminNotification);
        } else {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('manual_creation_user', userLang), [menuReply(userLang)]);
            let adminNotification = `⚠️ MANUAL CREATION REQUIRED ⚠️\nUser: ${userName} (${sender_psid})\nMod: ${mod.name} (ID: ${modId})\nRef No: ${refNumber}\nEmail: \`${email}\`\nReason: Automation coordinates are missing for this mod.`;
            await sendText(ADMIN_ID, adminNotification);
        }
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('error_duplicate_ref', userLang), [menuReply(userLang)]);
            const userName = await messengerApi.getUserProfile(sender_psid);
            await sendText(ADMIN_ID, `⚠️ User ${userName} tried to submit a duplicate reference number: ${refNumber}`);
        } else {
            await handleUserError(e, sender_psid, userLang, 'Mod Clarification');
        }
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Check Remaining Claims ---
async function promptForCheckClaims(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_prompt', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, sendText, userLang = 'en') {
    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), [menuReply(userLang)]);
        return;
    }
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_not_found', userLang), [menuReply(userLang)]);
    } else {
        const remaining = ref.claims_max - ref.claims_used;
        const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
        const resultMsg = lang.getText('claims_check_result', userLang)
            .replace('{claimsText}', claimsText)
            .replace('{modId}', ref.mod_id)
            .replace('{modName}', ref.mod_name);
        await messengerApi.sendQuickReplies(sender_psid, resultMsg, [menuReply(userLang)]);
    }
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Request Replacement Account ---
async function promptForReplacement(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_prompt', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, sendText, userLang = 'en') {
    try {
        if (!/^\d{13}$/.test(refNumber)) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), [menuReply(userLang)]);
            return;
        }
        const ref = await db.getReference(refNumber);
        if (!ref) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_not_found', userLang), [menuReply(userLang)]);
            return;
        }

        if (ref.last_replacement_timestamp) {
            const lastClaimTime = new Date(ref.last_replacement_timestamp).getTime();
            const currentTime = new Date().getTime();
            const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;
            if (currentTime - lastClaimTime < twentyFourHoursInMillis) {
                await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_limit_reached', userLang), [menuReply(userLang)]);
                return;
            }
        }

        if (ref.claims_used >= ref.claims_max) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_no_claims', userLang), [menuReply(userLang)]);
            return;
        }
        const account = await db.getAvailableAccount(ref.mod_id);
        if (!account) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_no_stock', userLang), [menuReply(userLang)]);
            return;
        }
        await db.claimAccount(account.id);
        await db.useClaim(ref.ref_number);
        const successMsg = lang.getText('replace_success', userLang)
            .replace('{modId}', ref.mod_id)
            .replace('{username}', account.username)
            .replace('{password}', account.password);
        await messengerApi.sendQuickReplies(sender_psid, successMsg, [menuReply(userLang)]);
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    } catch (e) {
        await handleUserError(e, sender_psid, userLang, 'Replacement Request');
    }
}

// --- Contact Admin ---
async function promptForAdminMessage(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('contact_admin_prompt', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_admin_message', { lang: userLang });
}

async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    const userName = await messengerApi.getUserProfile(sender_psid);
    const forwardMessage = `📩 Message from user ${userName} (${sender_psid}):\n\n"${text}"`;
    await sendText(ADMIN_ID, forwardMessage);
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('contact_admin_success', userLang), [menuReply(userLang)]);
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

// --- Report Account Issue ---
async function promptForReport(sender_psid, sendText, userLang = 'en') {
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_prompt_ref', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_report_ref', { lang: userLang });
}

async function handleReportReference(sender_psid, text, sendText, userLang = 'en') {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), [menuReply(userLang)]);
        return;
    }

    const ref = await db.getReference(refNumber);
    if (!ref) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_not_found', userLang), [menuReply(userLang)]);
        return;
    }

    await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_prompt_issue', userLang), [menuReply(userLang)]);
    stateManager.setUserState(sender_psid, 'awaiting_report_issue', { refNumber, lang: userLang });
}

async function forwardReportToAdmin(sender_psid, text, sendText, ADMIN_ID, userLang = 'en') {
    try {
        const { refNumber } = stateManager.getUserState(sender_psid);
        const userName = await messengerApi.getUserProfile(sender_psid);
        const issueDescription = text.trim();

        const adminNotification = `
        🚨 ACCOUNT ISSUE REPORT 🚨
        ---
        User: ${userName}
        PSID: ${sender_psid}
        Ref No: ${refNumber}
        ---
        Issue Reported:
        "${issueDescription}"
        ---
        Please contact the user to resolve this issue and provide a manual replacement if necessary.
        `;

        await sendText(ADMIN_ID, adminNotification);
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('report_success_user', userLang), [menuReply(userLang)]);

    } catch (e) {
        await handleUserError(e, sender_psid, userLang, 'Forwarding Account Report');
    } finally {
        stateManager.clearUserState(sender_psid);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    }
}

module.exports = {
    showUserMenu,
    handleViewMods,
    handleViewProofs,
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
    promptForReport,
    handleReportReference,
    forwardReportToAdmin
};
