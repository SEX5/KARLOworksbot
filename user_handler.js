// user_handler.js (Final Version with manual entry flow)
const db = require('./database');
const stateManager = require('./state_manager');
const messengerApi = require('./messenger_api.js');

async function showUserMenu(sender_psid, sendText) {
    const menu = `🌟 Welcome! Please select an option🌟:\nType 1: 👁️View available mods\nType 2: ✅Check remaining replacement accounts\nType 3: 🖱️Request a replacement account\nType 4: 📨Contact the admin`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- Functions for Manual Entry Fallback ---
async function startManualEntryFlow(sender_psid, sendText, imageUrl) {
    await sendText(sender_psid, "Sorry, I had trouble reading your receipt automatically. Let's register your purchase manually.\n\nPlease type your 13-digit GCash reference number.");
    stateManager.setUserState(sender_psid, 'awaiting_manual_ref', { imageUrl: imageUrl });
}

async function handleManualReference(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, "That doesn't look like a valid 13-digit reference number. Please try again.");
        return;
    }
    const { imageUrl } = stateManager.getUserState(sender_psid);
    
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "An issue occurred (no mods found). An admin has been notified.");
        stateManager.clearUserState(sender_psid);
        return;
    }
    let response = "Thank you! Now, which Mod did you purchase?\n\n";
    mods.forEach(mod => { response += `Mod ${mod.id}: ${mod.name}\n`; });
    response += "\nPlease reply with the Mod number (e.g., '1').";
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_manual_mod', { imageUrl, refNumber });
}

async function handleManualModSelection(sender_psid, text, sendText, sendImage, ADMIN_ID) {
    const { imageUrl, refNumber } = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);

    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "That's not a valid Mod number. Please reply with one of the numbers from the list.");
        return;
    }

    try {
        await db.addReference(refNumber, sender_psid, modId, 3);
        await sendText(sender_psid, `✅ Great! Your purchase of Mod ${mod.id} has been manually registered with 3 replacement claims. An admin will verify the details shortly.`);

        const userName = await messengerApi.getUserProfile(sender_psid);
        const adminNotification = `⚠️ MANUAL REGISTRATION (AI FAILED) ⚠️\n\nUser: ${userName} (${sender_psid})\nManually Entered Info:\n- Ref No: ${refNumber}\n- Mod: ${mod.name} (ID: ${modId})\n\nThe original receipt is attached below for verification.`;
        await sendText(ADMIN_ID, adminNotification);
        await sendImage(ADMIN_ID, imageUrl);

    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, "This reference number appears to have already been used. Please contact an admin if you believe this is a mistake.");
            await sendText(ADMIN_ID, `⚠️ User ${sender_psid} tried to manually submit a DUPLICATE reference number: ${refNumber}`);
        } else {
            console.error(e);
            await sendText(sender_psid, "An unexpected error occurred saving your details. An admin has been notified.");
        }
    }
    stateManager.clearUserState(sender_psid);
}


// --- Original Functions ---
async function handleViewMods(sender_psid, sendText) { const mods = await db.getMods(); if (!mods || mods.length === 0) return sendText(sender_psid, "There are currently no mods available.\nTo return to the menu, type \"Menu\"."); let response = "Available Mods:\n\n"; mods.forEach(mod => { response += `Mod ${mod.id}: ${mod.description || 'N/A'}\nPrice: ${mod.price} PHP | Stock: ${mod.stock}\nImage: ${mod.image_url || 'N/A'}\n\n`; }); response += `To purchase, type "Want Mod [Number]" (e.g., Want Mod 1).\nTo return to the menu, type "Menu".`; await sendText(sender_psid, response); stateManager.setUserState(sender_psid, 'awaiting_want_mod'); }
async function handleWantMod(sender_psid, text, sendText) { const modId = parseInt(text.replace('want mod', '').trim()); if (isNaN(modId)) return sendText(sender_psid, "Invalid format. Please type 'Want Mod [Number]'."); const mod = await db.getModById(modId); if (!mod) return sendText(sender_psid, "Invalid mod number. Please select a valid mod from the list."); await sendText(sender_psid, `You selected Mod ${mod.id}. Before we proceed with payment, please provide the email for the account.`); stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id }); }
async function handleEmailForPurchase(sender_psid, text, sendText) { const { modId } = stateManager.getUserState(sender_psid); const email = text.trim(); await sendText(sender_psid, "Thank you. Now, please enter the password for the account."); stateManager.setUserState(sender_psid, 'awaiting_password_for_purchase', { modId, email }); }
async function handlePasswordForPurchase(sender_psid, text, sendText) { const { modId, email } = stateManager.getUserState(sender_psid); const password = text.trim(); const mod = await db.getModById(modId); const adminInfo = await db.getAdminInfo(); const gcashNumber = adminInfo?.gcash_number || "not set by admin"; await sendText(sender_psid, `Great! You're purchasing Mod ${mod.id}.\nPlease send payment of ${mod.price} PHP to this GCash number: ${gcashNumber}.\n\nAfter payment, please send a screenshot of your receipt to confirm the purchase.`); stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, password }); }
async function handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID) { const precollectedState = stateManager.getUserState(sender_psid); const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, ''); const amount = parseFloat(amountStr); const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, ''); if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) { await sendText(sender_psid, "I couldn't clearly read the amount or a valid 13-digit reference number from that receipt. An admin has been notified to assist you."); await sendText(ADMIN_ID, `User ${sender_psid} sent a receipt, but AI failed to extract valid info. Amount found: ${amountStr}, Ref found: ${refNumber}. Please check manually.`); return; } const matchingMods = await db.getModsByPrice(amount); if (matchingMods.length === 1) { const mod = matchingMods[0]; let confirmationStateData = { refNumber, modId: mod.id, modName: mod.name }; if (precollectedState) { confirmationStateData.email = precollectedState.email; confirmationStateData.password = precollectedState.password; } await sendText(sender_psid, `I see a payment of ${amount} PHP. Did you purchase Mod ${mod.id} (${mod.name})?\n\nPlease reply with "Yes" or "No".`); stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', confirmationStateData); } else if (matchingMods.length > 1) { let clarificationStateData = { refNumber }; if (precollectedState) { clarificationStateData.email = precollectedState.email; clarificationStateData.password = precollectedState.password; } let response = `I see a payment of ${amount} PHP, which matches multiple mods:\n\n`; matchingMods.forEach(m => { response += `- Mod ${m.id}: ${m.name}\n`; }); response += "\nPlease type the number of the mod you purchased (e.g., '1')."; await sendText(sender_psid, response); stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', clarificationStateData); } else { await sendText(sender_psid, `I received your payment of ${amount} PHP, but I could not find a mod with that exact price. An admin has been notified and will assist you shortly.`); await sendText(ADMIN_ID, `User ${sender_psid} sent a receipt for ${amount} PHP with ref ${refNumber}, but no mod matches this price.`); } }
async function handleModConfirmation(sender_psid, text, sendText, ADMIN_ID) { const { refNumber, modId, modName, email, password } = stateManager.getUserState(sender_psid); if (text.toLowerCase() === 'yes') { try { await db.addReference(refNumber, sender_psid, modId, 3); await sendText(sender_psid, `✅ Thank you for confirming! Your purchase of Mod ${modId} has been registered with 3 replacement claims.`); const userName = await messengerApi.getUserProfile(sender_psid); let adminNotification = `✅ New Order Registered!\n\nUser: ${userName} (${sender_psid})\nMod: ${modName} (ID: ${modId})\nRef No: ${refNumber}`; if (email && password) { adminNotification += `\n\nUser Provided Details:\nEmail: \`${email}\`\nPassword: \`${password}\``; } await sendText(ADMIN_ID, adminNotification); } catch (e) { if (e.message === 'Duplicate reference number') { await sendText(sender_psid, "This reference number appears to have already been used. An admin has been notified."); await sendText(ADMIN_ID, `⚠️ User ${sender_psid} tried to submit a duplicate reference number: ${refNumber}`); } else { console.error(e); await sendText(sender_psid, "An unexpected error occurred. An admin has been notified."); } } } else { await sendText(sender_psid, "Okay, the transaction has been cancelled. If you made a mistake, please contact an admin."); } stateManager.clearUserState(sender_psid); }
async function handleModClarification(sender_psid, text, sendText, ADMIN_ID) { const { refNumber, email, password } = stateManager.getUserState(sender_psid); const modId = parseInt(text.trim()); const mod = await db.getModById(modId); if (isNaN(modId) || !mod) { await sendText(sender_psid, "That's not a valid Mod ID. Please type just the number of the mod you purchased."); return; } try { await db.addReference(refNumber, sender_psid, modId, 3); await sendText(sender_psid, `✅ Got it! Your purchase of Mod ${modId} has been registered with 3 replacement claims.`); const userName = await messengerApi.getUserProfile(sender_psid); let adminNotification = `✅ New Order Registered!\n\nUser: ${userName} (${sender_psid})\nMod: ${mod.name} (ID: ${modId})\nRef No: ${refNumber}`; if(email && password){ adminNotification += `\n\nUser Provided Details:\nEmail: \`${email}\`\nPassword: \`${password}\``; } await sendText(ADMIN_ID, adminNotification); } catch (e) { if (e.message === 'Duplicate reference number') { await sendText(sender_psid, "This reference number appears to have already been used. An admin has been notified."); await sendText(ADMIN_ID, `⚠️ User ${sender_psid} tried to submit a duplicate reference number: ${refNumber}`); } else { console.error(e); await sendText(sender_psid, "An unexpected error occurred. An admin has been notified."); } } stateManager.clearUserState(sender_psid); }
async function promptForCheckClaims(sender_psid, sendText) { await sendText(sender_psid, "Please provide your 13-digit GCash reference number to check remaining replacement accounts."); stateManager.setUserState(sender_psid, 'awaiting_ref_for_check'); }
async function processCheckClaims(sender_psid, refNumber, sendText) { if (!/^\d{13}$/.test(refNumber)) return sendText(sender_psid, "Invalid reference number format."); const ref = await db.getReference(refNumber); if (!ref) { await sendText(sender_psid, "This reference number was not found."); } else { const remaining = ref.claims_max - ref.claims_used; await sendText(sender_psid, `You have ${remaining} replacement account(s) left for Mod ${ref.mod_id} (${ref.mod_name}).`); } stateManager.clearUserState(sender_psid); }
async function promptForReplacement(sender_psid, sendText) { await sendText(sender_psid, "Please provide your 13-digit GCash reference number to request a replacement account."); stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement'); }
async function processReplacementRequest(sender_psid, refNumber, sendText) { if (!/^\d{13}$/.test(refNumber)) return sendText(sender_psid, "Invalid reference number format."); const ref = await db.getReference(refNumber); if (!ref || ref.claims_used >= ref.claims_max) { await sendText(sender_psid, "No replacement accounts available for this reference number."); stateManager.clearUserState(sender_psid); return; } const account = await db.getAvailableAccount(ref.mod_id); if (!account) { await sendText(sender_psid, "Sorry, no replacement accounts are in stock for your mod. Please contact an admin."); stateManager.clearUserState(sender_psid); return; } await db.claimAccount(account.id); await db.useClaim(ref.ref_number); await sendText(sender_psid, `Here is your replacement account for Mod ${ref.mod_id}:\nUsername: \`${account.username}\`\nPassword: \`${account.password}\``); stateManager.clearUserState(sender_psid); }
async function promptForAdminMessage(sender_psid, sendText) { await sendText(sender_psid, "Please provide your message for the admin, and it will be forwarded."); stateManager.setUserState(sender_psid, 'awaiting_admin_message'); }
async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID) { const userName = await messengerApi.getUserProfile(sender_psid); const forwardMessage = `Message from user ${userName} (${sender_psid}):\n\n"${text}"`; await sendText(ADMIN_ID, forwardMessage); await sendText(sender_psid, "Your message has been sent to the admin. You will be contacted soon."); stateManager.clearUserState(sender_psid); }

module.exports = { showUserMenu, handleViewMods, handleWantMod, handleEmailForPurchase, handlePasswordForPurchase, handleReceiptAnalysis, handleModConfirmation, handleModClarification, promptForCheckClaims, processCheckClaims, promptForReplacement, processReplacementRequest, promptForAdminMessage, forwardMessageToAdmin, startManualEntryFlow, handleManualReference, handleManualModSelection };
