// user_handler.js (Your provided base file)
const db = require('./database');
const stateManager = require('./state_manager');
const messengerApi = require('./messenger_api.js');

// --- Main Menu ---
async function showUserMenu(sender_psid, sendText) {
    const adminInfo = await db.getAdminInfo();
    if (adminInfo && adminInfo.is_online) {
        // The hardcoded link is in this message
        const onlineMessage = `The admin is currently online! 🟢\n\nYou can message them directly for assistance at:\nhttps://www.facebook.com/share/19Z1AuEuGN/\n\nAlternatively, you can use the options below:`;
        await sendText(sender_psid, onlineMessage);
    } else {
        const offlineMessage = `The admin is currently offline. 🔴\n\nYou can use the automated menu below for assistance.`;
        await sendText(sender_psid, offlineMessage);
    }

    const menu = `🌟 Welcome to KARLOWORKS ModShop! 🌟
We're thrilled to help you unlock your gaming experience!
Please choose an option:
🔢 1️⃣  View available mods
✅ 2️⃣  Check remaining replacement accounts
🔁 3️⃣  Request a replacement account
📩 4️⃣  Contact the admin
Just type the number of your choice! 😊`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- Manual Entry Fallback ---
async function startManualEntryFlow(sender_psid, sendText, imageUrl) {
    await sendText(sender_psid, `😔 Oops! I couldn't read your receipt automatically.
No worries — we can still register your purchase manually! 🙌
Please type your 13-digit GCash reference number! Remove any spaces before sending the reference number. Example 123456789123:
(Type 'Menu' to return to the main menu.)`);
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl: imageUrl });
}

async function handleManualReference(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, `❌ That doesn't look like a valid 13-digit reference number.
Please double-check and try again. Example: 1234567890123
(Type 'Menu' to return to the main menu.)`);
        return;
    }
    const { imageUrl } = stateManager.getUserState(sender_psid);
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, `⚠️ An issue occurred (no mods found). An admin has been notified.
(Type 'Menu' to return to the main menu.)`);
        stateManager.clearUserState(sender_psid);
        return;
    }
    let response = `🎉 Thank you! Your reference is confirmed.
Which Mod did you purchase? Here are the available options:
`;
    mods.forEach(mod => {
        response += `🔹 Mod ${mod.id}: ${mod.name}
   💰 Price: ${mod.price} PHP
`;
    });
    response += `
👉 Please reply with just the Mod number (example: 1 )
(Type 'Menu' to return to the main menu.)`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_manual_mod', { imageUrl, refNumber });
}

async function handleManualModSelection(sender_psid, text, sendText, sendImage, ADMIN_ID) {
    const { imageUrl, refNumber } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, `❌ That's not a valid Mod number.
Please reply with one of the numbers from the list.
(Type 'Menu' to return to the main menu.)`);
        return;
    }
    try {
        const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
        const claimsText = claimsAdded === 1 ? '1 replacement claim' : `${claimsAdded} replacement claims`;
        await sendText(sender_psid, `✅ Success! Your purchase of *Mod ${mod.id}* has been registered!
You now have *${claimsText}* available. 🎁
An admin will verify your receipt shortly — thank you for your trust! 💙
(Type 'Menu' to return to the main menu.)`);
        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️
User: ${userName}
Manually Entered Info:
- Ref No: ${refNumber}
- Mod: ${mod.name} (ID: ${modId})
The original receipt is attached below for verification.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, `⚠️ This reference number has already been used.
Please contact an admin if you believe this is a mistake.
(Type 'Menu' to return to the main menu.)`);
            const userName = await messengerApi.getUserProfile(sender_psid);
            await sendText(ADMIN_ID, `⚠️ User ${userName} tried to manually submit a DUPLICATE reference number: ${refNumber}`);
        } else {
            console.error(e);
            await sendText(sender_psid, `🔧 An unexpected error occurred. An admin has been notified. Please try again later.
(Type 'Menu' to return to the main menu.)`);
        }
    }
    stateManager.clearUserState(sender_psid);
}

// --- View Available Mods ---
async function handleViewMods(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        return sendText(sender_psid, `📭 There are currently no mods available.
Check back later or type Menu to return.`);
    }
    let response = `🎮 *Available Mods* 🎮
Here’s what you can get right now:
`;
    mods.forEach(mod => {
        const claimsText = mod.default_claims_max === 1 ? '1 Replacement' : `${mod.default_claims_max} Replacements`;
        response += `
📦 Type ${mod.id}: ${mod.description || 'N/A'}
💰 Price: ${mod.price} PHP
🔁 FreeClaims: ${claimsText}
🖼️ Image: ${mod.image_url || 'N/A'}
`;
    });
    response += `
💡 To purchase, Please reply with just the Mod number (example: 1)
🔙 To return to the menu, type: Menu`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod');
}

// --- Purchase Flow ---
async function handleWantMod(sender_psid, text, sendText) {
    const modId = parseInt(text.replace('want mod', '').trim());
    if (isNaN(modId)) {
        return sendText(sender_psid, `❌ Invalid format. Please type the Number. Example: (1).
(Type 'Menu' to return to the main menu.)`);
    }
    const mod = await db.getModById(modId);
    if (!mod) {
        return sendText(sender_psid, `❌ Invalid mod number. Please select a valid mod from the list.
(Type 'Menu' to return to the main menu.)`);
    }
    await sendText(sender_psid, `✅ You selected Mod ${mod.id}: ${mod.name}!\n\nTo proceed, please provide an email address that has **NOT** been used for a CarX Street account before.\n\n(Type 'Menu' to return to the main menu.)`);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id });
}

async function handleEmailForPurchase(sender_psid, text, sendText) {
    const { modId } = stateManager.getUserState(sender_psid);
    const email = text.trim();
    
    // Basic email format validation
    if (!/\S+@\S+\.\S+/.test(email)) {
        await sendText(sender_psid, `❌ That doesn't look like a valid email address. Please try again.\n(Type 'Menu' to return to the main menu.)`);
        return;
    }

    const mod = await db.getModById(modId);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204"; // Fallback Gcash number

    await sendText(sender_psid, `🎉 You're all set! Your email has been noted.\n\nPlease send ${mod.price} PHP via GCash to: Karl Abalunan\n📞 ${gcashNumber}\n\n📲 After paying, send a screenshot of your receipt to confirm your purchase.\nWe’ll verify and deliver your mod ASAP! ⏳💙\n(Type 'Menu' to return to the main menu after sending the receipt.)`);
    
    // Set state to await the receipt, now including the email but no password
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email });
}

// The handlePasswordForPurchase function has been removed as it is no longer needed.

// --- Receipt Analysis (AI-powered) ---
async function handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID) {
    const precollectedState = stateManager.getUserState(sender_psid);
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userName = await messengerApi.getUserProfile(sender_psid);
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, `🔍 I couldn't clearly read the amount or a valid 13-digit reference number from that receipt.
Don’t worry — an admin has been notified and will assist you shortly! 🙏
(Type 'Menu' to return to the main menu.)`);
        await sendText(ADMIN_ID, `User ${userName} sent a receipt, but AI failed to extract valid info. Amount found: ${amountStr}, Ref found: ${refNumber}. Please check manually.`);
        return;
    }
    const matchingMods = await db.getModsByPrice(amount);
    if (matchingMods.length === 1) {
        const mod = matchingMods[0];
        let confirmationStateData = { refNumber, modId: mod.id, modName: mod.name };
        if (precollectedState) {
            confirmationStateData.email = precollectedState.email;
            // password is no longer collected, so it won't be in the state
        }
        await sendText(sender_psid, `💳 I see a payment of ${amount} PHP.
Did you purchase Mod ${mod.id}: ${mod.name}? 
✅ Reply with Yes or No to confirm.
(Type 'Menu' to return to the main menu.)`);
        stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', confirmationStateData);
    } else if (matchingMods.length > 1) {
        let clarificationStateData = { refNumber };
        if (precollectedState) {
            clarificationStateData.email = precollectedState.email;
        }
        let response = `🔍 I see a payment of ${amount} PHP, which matches multiple mods:
`;
        matchingMods.forEach(m => {
            response += `- Mod ${m.id}: ${m.name}
`;
        });
        response += `
Please type the number of the mod you purchased (e.g., *1*).
(Type 'Menu' to return to the main menu.)`;
        await sendText(sender_psid, response);
        stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', clarificationStateData);
    } else {
        await sendText(sender_psid, `💳 I received your payment of ${amount} PHP, but no mod matches this price.
An admin has been notified and will assist you shortly. 🙌
(Type 'Menu' to return to the main menu.)`);
        await sendText(ADMIN_ID, `User ${userName} sent a receipt for ${amount} PHP with ref ${refNumber}, but no mod matches this price.`);
    }
}

// --- Confirmation after Receipt ---
async function handleModConfirmation(sender_psid, text, sendText, ADMIN_ID) {
    // Note: password will be undefined here, which is handled correctly below
    const { refNumber, modId, modName, email, password } = stateManager.getUserState(sender_psid);
    if (text.toLowerCase() === 'yes') {
        try {
            const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
            const claimsText = claimsAdded === 1 ? '1 replacement claim' : `${claimsAdded} replacement claims`;
            await sendText(sender_psid, `✅ Thank you! Your purchase of Mod ${modId} has been registered with ${claimsText}.
(Type 'Menu' to return to the main menu.)`);
            const userName = await messengerApi.getUserProfile(sender_psid);
            let adminNotification = `✅ New Order Registered!
User: ${userName}
Mod: ${modName} (ID: ${modId})
Ref No: ${refNumber}`;
            if (email) { // Only check for email now
                adminNotification += `\n👤 User Provided Details:\n📧 Email: \`${email}\``;
            }
            await sendText(ADMIN_ID, adminNotification);
        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                await sendText(sender_psid, `⚠️ This reference number has already been used.
Please contact an admin if you believe this is a mistake.
(Type 'Menu' to return to the main menu.)`);
                const userName = await messengerApi.getUserProfile(sender_psid);
                await sendText(ADMIN_ID, `⚠️ User ${userName} tried to submit a duplicate reference number: ${refNumber}`);
            } else {
                console.error(e);
                await sendText(sender_psid, `🔧 An unexpected error occurred. An admin has been notified.
(Type 'Menu' to return to the main menu.)`);
            }
        }
    } else {
        await sendText(sender_psid, `❌ Okay, the transaction has been cancelled.
If you made a mistake, feel free to contact an admin. 😊
(Type 'Menu' to return to the main menu.)`);
    }
    stateManager.clearUserState(sender_psid);
}

// --- Clarify Mod if Multiple Match ---
async function handleModClarification(sender_psid, text, sendText, ADMIN_ID) {
    // Note: password will be undefined here
    const { refNumber, email, password } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, `❌ That's not a valid Mod number. Please reply with just the number (e.g., 1).
(Type 'Menu' to return to the main menu.)`);
        return;
    }
    try {
        const claimsAdded = await db.addReference(refNumber, sender_psid, modId);
        const claimsText = claimsAdded === 1 ? `*1 replacement claim*` : `*${claimsAdded} replacement claims*`;
        await sendText(sender_psid, `✅ Got it! Your purchase of *Mod ${modId}* has been registered with ${claimsText}. 🎉
(Type 'Menu' to return to the main menu.)`);
        const userName = await messengerApi.getUserProfile(sender_psid);
        let adminNotification = `✅ New Order Registered!
User: ${userName}
Mod: ${mod.name} (ID: ${modId})
Ref No: ${refNumber}`;
        if (email) { // Only check for email
            adminNotification += `\n👤 User Provided Details:\n📧 Email: \`${email}\``;
        }
        await sendText(ADMIN_ID, adminNotification);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, `⚠️ This reference number has already been used.
(Type 'Menu' to return to the main menu.)`);
            const userName = await messengerApi.getUserProfile(sender_psid);
            await sendText(ADMIN_ID, `⚠️ User ${userName} tried to submit a duplicate reference number: ${refNumber}`);
        } else {
            console.error(e);
            await sendText(sender_psid, `🔧 An unexpected error occurred. An admin has been notified.
(Type 'Menu' to return to the main menu.)`);
        }
    }
    stateManager.clearUserState(sender_psid);
}

// --- Check Remaining Claims ---
async function promptForCheckClaims(sender_psid, sendText) {
    await sendText(sender_psid, `🔍 Want to check how many replacements you have left?
Please enter your 13-digit GCash reference number! Remove any spaces before sending the reference number. Example 123456789123:
(Type 'Menu' to return to the main menu.)`);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check');
}

async function processCheckClaims(sender_psid, refNumber, sendText) {
    if (!/^\d{13}$/.test(refNumber)) {
        return sendText(sender_psid, `❌ Invalid reference number format. Please enter 13 digits.
(Type 'Menu' to return to the main menu.)`);
    }
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await sendText(sender_psid, `🔍 No purchase found with that reference number. Please double-check.
(Type 'Menu' to return to the main menu.)`);
    } else {
        const remaining = ref.claims_max - ref.claims_used;
        const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
        await sendText(sender_psid, `🎉 You have ${claimsText} left for Mod ${ref.mod_id} (${ref.mod_name}).
(Type 'Menu' to return to the main menu.)`);
    }
    stateManager.clearUserState(sender_psid);
}

// --- Request Replacement Account ---
async function promptForReplacement(sender_psid, sendText) {
    await sendText(sender_psid, `🔁 Ready for a replacement?
Please provide your 13-digit GCash reference number!! Remove any spaces before sending the reference number. Example 123456789123:
(Type 'Menu' to return to the main menu.)`);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement');
}

async function processReplacementRequest(sender_psid, refNumber, sendText) {
    if (!/^\d{13}$/.test(refNumber)) {
        return sendText(sender_psid, `❌ Invalid reference number format.
(Type 'Menu' to return to the main menu.)`);
    }
    const ref = await db.getReference(refNumber);
    if (!ref || ref.claims_used >= ref.claims_max) {
        await sendText(sender_psid, `❌ No replacement accounts available for this reference number.
(Type 'Menu' to return to the main menu.)`);
        stateManager.clearUserState(sender_psid);
        return;
    }
    const account = await db.getAvailableAccount(ref.mod_id);
    if (!account) {
        await sendText(sender_psid, `🛒 Sorry, no replacement accounts are in stock for your mod.
An admin will restock soon — please contact them for updates.
(Type 'Menu' to return to the main menu.)`);
        stateManager.clearUserState(sender_psid);
        return;
    }
    await db.claimAccount(account.id);
    await db.useClaim(ref.ref_number);
    await sendText(sender_psid, `🎉 Here’s your replacement account! 
🎮 Mod: ${ref.mod_id}
📧 Username: \`${account.username}\`
🔐 Password: \`${account.password}\`
Enjoy! And thank you for trusting us! 💙
(Type 'Menu' to return to the main menu.)`);
    stateManager.clearUserState(sender_psid);
}

// --- Contact Admin ---
async function promptForAdminMessage(sender_psid, sendText) {
    await sendText(sender_psid, `📩 Got a question or need help?
Please type your message, and I’ll forward it to the admin right away!
(Type 'Menu' to return to the main menu.)`);
    stateManager.setUserState(sender_psid, 'awaiting_admin_message');
}

async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID) {
    const userName = await messengerApi.getUserProfile(sender_psid);
    const forwardMessage = `📩 Message from user ${userName}:
"${text}"`;
    await sendText(ADMIN_ID, forwardMessage);
    await sendText(sender_psid, `✅ Your message has been sent to the admin!
We’ll get back to you as soon as possible. Thank you for reaching out! 🙌
(Type 'Menu' to return to the main menu.)`);
    stateManager.clearUserState(sender_psid);
}

// --- Export All Functions ---
module.exports = {
    showUserMenu,
    handleViewMods,
    handleWantMod,
    handleEmailForPurchase,
    // handlePasswordForPurchase is removed
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
    handleManualModSelection
};
