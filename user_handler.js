// user_handler.js (Complete & Final with Email/Password Collection)
const db = require('./database');
const stateManager = require('./state_manager');

async function showUserMenu(sender_psid, sendText) {
    const menu = `Welcome! Please select an option:\nType 1: View available mods\nType 2: Check remaining replacement accounts\nType 3: Request a replacement account\nType 4: Contact the admin`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- Type 1 & Purchase Flow ---
async function handleViewMods(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) return sendText(sender_psid, "There are currently no mods available.\nTo return to the menu, type \"Menu\".");
    let response = "Available Mods:\n\n";
    mods.forEach(mod => { response += `Mod ${mod.id}: ${mod.description || 'N/A'}\nPrice: ${mod.price} PHP | Stock: ${mod.stock}\nImage: ${mod.image_url || 'N/A'}\n\n`; });
    response += `To purchase, type "Want Mod [Number]" (e.g., Want Mod 1).\nTo return to the menu, type "Menu".`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod');
}

async function handleWantMod(sender_psid, text, sendText) {
    const modId = parseInt(text.replace('want mod', '').trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        return sendText(sender_psid, "Invalid mod number. Please select a valid mod from the list.");
    }
    await sendText(sender_psid, `Okay, you've chosen Mod ${mod.id}. To create your account, please tell me your desired email address.`);
    stateManager.setUserState(sender_psid, 'awaiting_desired_email', { modId: mod.id, modName: mod.name, price: mod.price });
}

async function processDesiredEmail(sender_psid, text, sendText) {
    const email = text.trim();
    if (!email.includes('@')) {
        await sendText(sender_psid, "That doesn't look like a valid email address. Please try again.");
        return;
    }
    const { modId, modName, price } = stateManager.getUserState(sender_psid);
    await sendText(sender_psid, "Great, I've got your email. Now, please enter a password for your account (must be at least 8 characters long).");
    stateManager.setUserState(sender_psid, 'awaiting_desired_password', { modId, modName, price, email });
}

async function processDesiredPassword(sender_psid, text, sendText) {
    const password = text.trim();
    if (password.length < 8) {
        await sendText(sender_psid, "That password is too short. It must be at least 8 characters long. Please try again.");
        return;
    }
    const { modId, modName, price, email } = stateManager.getUserState(sender_psid);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "not set by admin";
    
    const message = `Perfect! To complete your order for Mod ${modId} (${modName}) with the email \`${email}\`, please send a payment of ${price} PHP to GCash: ${gcashNumber}.\n\nAfter paying, send your receipt screenshot here to confirm.`;
    await sendText(sender_psid, message);
    stateManager.setUserState(sender_psid, 'awaiting_payment_receipt', { modId, modName, email, password });
}

async function handleReceiptAnalysis(sender_psid, analysis, sendText, ADMIN_ID) {
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    const userState = stateManager.getUserState(sender_psid);

    if (!userState || userState.state !== 'awaiting_payment_receipt') {
        await sendText(sender_psid, "Thanks for the receipt! However, I don't have a pending order for you. Please start by choosing a mod first by typing '1'.");
        return;
    }
    
    if (!refNumber || !/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, "I couldn't read a valid 13-digit reference number from that receipt. An admin has been notified to assist you.");
        return;
    }

    const { modId, modName, email, password } = userState;

    try {
        await db.addReference(refNumber, sender_psid, modId, 3);
        await sendText(sender_psid, `✅ Thank you! Your purchase of Mod ${modId} has been registered. The admin will create your account and send the details shortly.`);
        
        const adminNotification = `✅ New Order Ready for Creation!\n\nUser: ${sender_psid}\nMod: ${modName} (ID: ${modId})\nRef No: ${refNumber}\n\n--> Email: ${email}\n--> Password: ${password}`;
        await sendText(ADMIN_ID, adminNotification);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, "This reference number appears to have already been used. An admin has been notified.");
        } else {
            console.error(e);
            await sendText(sender_psid, "An unexpected error occurred. An admin has been notified.");
        }
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- Type 2 ---
async function promptForCheckClaims(sender_psid, sendText) { await sendText(sender_psid, "Please provide your 13-digit GCash reference number to check remaining replacement accounts."); stateManager.setUserState(sender_psid, 'awaiting_ref_for_check'); }
async function processCheckClaims(sender_psid, refNumber, sendText) { if (!/^\d{13}$/.test(refNumber)) return sendText(sender_psid, "Invalid reference number format."); const ref = await db.getReference(refNumber); if (!ref) { await sendText(sender_psid, "This reference number was not found."); } else { const remaining = ref.claims_max - ref.claims_used; await sendText(sender_psid, `You have ${remaining} replacement account(s) left for Mod ${ref.mod_id} (${ref.mod_name}).`); } stateManager.clearUserState(sender_psid); }

// --- Type 3 ---
async function promptForReplacement(sender_psid, sendText) { await sendText(sender_psid, "Please provide your 13-digit GCash reference number to request a replacement account."); stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement'); }
async function processReplacementRequest(sender_psid, refNumber, sendText) { if (!/^\d{13}$/.test(refNumber)) return sendText(sender_psid, "Invalid reference number format."); const ref = await db.getReference(refNumber); if (!ref || ref.claims_used >= ref.claims_max) { await sendText(sender_psid, "No replacement accounts available for this reference number."); stateManager.clearUserState(sender_psid); return; } const account = await db.getAvailableAccount(ref.mod_id); if (!account) { await sendText(sender_psid, "Sorry, no replacement accounts are in stock for your mod. Please contact an admin."); stateManager.clearUserState(sender_psid); return; } await db.claimAccount(account.id); await db.useClaim(ref.ref_number); await sendText(sender_psid, `Here is your replacement account for Mod ${ref.mod_id}:\nUsername: \`${account.username}\`\nPassword: \`${account.password}\``); stateManager.clearUserState(sender_psid); }

// --- Type 4 ---
async function promptForAdminMessage(sender_psid, sendText) { await sendText(sender_psid, "Please provide your message for the admin, and it will be forwarded."); stateManager.setUserState(sender_psid, 'awaiting_admin_message'); }
async function forwardMessageToAdmin(sender_psid, text, sendText, ADMIN_ID) { const forwardMessage = `Message from user ${sender_psid}:\n\n"${text}"`; await sendText(ADMIN_ID, forwardMessage); await sendText(sender_psid, "Your message has been sent to the admin. You will be contacted soon."); stateManager.clearUserState(sender_psid); }

module.exports = { showUserMenu, handleViewMods, handleWantMod, processDesiredEmail, processDesiredPassword, handleReceiptAnalysis, promptForCheckClaims, processCheckClaims, promptForReplacement, processReplacementRequest, promptForAdminMessage, forwardMessageToAdmin };
