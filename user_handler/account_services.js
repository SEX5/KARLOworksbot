// user_handler/account_services.js (CORRECTED FINAL VERSION)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');
const { ADMIN_ID } = require('../secrets');

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

// --- Check Claims ---

async function promptForCheckClaims(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, userLang = 'en') {
    let resultMsg = '';
    const trimmedRef = refNumber.trim();
    
    if (!/^\d{13}$/.test(trimmedRef)) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(trimmedRef);
        if (!ref) {
            resultMsg = lang.getText('claims_check_not_found', userLang);
        } else {
            const remaining = ref.claims_max - ref.claims_used;
            const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
            resultMsg = lang.getText('claims_check_result', userLang)
                .replace('{claimsText}', claimsText)
                .replace('{modId}', ref.mod_id)
                .replace('{modName}', ref.mod_name);
        }
    }
    
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}


// --- Replacement Request (FULLY AUTOMATED) ---

async function promptForReplacement(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, userLang = 'en') {
    const trimmedRef = refNumber.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    // 1. Validation Checks
    if (!/^\d{13}$/.test(trimmedRef)) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), replies);
    }

    const ref = await db.getReference(trimmedRef);
    if (!ref) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_not_found', userLang), replies);
    }

    // Check 24-hour cooldown
    if (ref.last_replacement_timestamp) {
        const lastReplacementTime = new Date(ref.last_replacement_timestamp).getTime();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (Date.now() - lastReplacementTime < twentyFourHours) {
            return await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_limit_reached', userLang), replies);
        }
    }

    // Check if user has claims left
    if (ref.claims_used >= ref.claims_max) {
        return await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_no_claims', userLang), replies);
    }

    // 2. Queue Automation Job
    try {
        // Mark the claim as used immediately to prevent double-requests
        await db.useClaim(ref.ref_number);

        const password = generatePassword();
        // Create a unique internal email for the account creator
        const placeholderEmail = `rpl-${sender_psid}-${Date.now()}@internal.bot`;

        // FIXED: Passing userLang correctly to the job
        const jobId = await db.createAccountCreationJob(sender_psid, placeholderEmail, password, ref.mod_id, userLang);
        
        // Notify the user
        await messengerApi.sendText(sender_psid, lang.getText('replace_success_automated', userLang));
        
        // Notify the admin
        let userName = 'User';
        try { userName = await messengerApi.getUserProfile(sender_psid); } catch(e){}
        await messengerApi.sendText(ADMIN_ID, `🤖 REPLACEMENT QUEUED (Job ID: ${jobId})\nUser: ${userName}\nMod: ${ref.mod_name}\nRef: ${ref.ref_number}`);

    } catch (e) {
        console.error("Replacement creation error:", e);
        await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
    }

    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    promptForCheckClaims,
    processCheckClaims,
    promptForReplacement,
    processReplacementRequest
};
