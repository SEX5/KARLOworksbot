// user_handler/account_services.js (Fully Automated Version)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');
const { ADMIN_ID } = require('../secrets');

// Password generator for the new automated jobs
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// --- Check Claims --- (This function remains the same)
async function promptForCheckClaims(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

async function processCheckClaims(sender_psid, refNumber, userLang = 'en') {
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


// --- Replacement Request (NEW FULLY AUTOMATED LOGIC) ---
async function promptForReplacement(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

async function processReplacementRequest(sender_psid, refNumber, userLang = 'en') {
    const trimmedRef = refNumber.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    // 1. Perform all validation checks first.
    if (!/^\d{13}$/.test(trimmedRef)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), replies);
        return;
    }

    const ref = await db.getReference(trimmedRef);

    if (!ref) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_not_found', userLang), replies);
        return;
    }

    if (ref.last_replacement_timestamp) {
        const lastReplacementTime = new Date(ref.last_replacement_timestamp).getTime();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (Date.now() - lastReplacementTime < twentyFourHours) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_limit_reached', userLang), replies);
            return;
        }
    }

    if (ref.claims_used >= ref.claims_max) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_no_claims', userLang), replies);
        return;
    }

    // 2. If all checks pass, ALWAYS create a new automation job.
    try {
        // IMPORTANT: Use the claim BEFORE creating the job to prevent spam.
        await db.useClaim(ref.ref_number);

        const password = generatePassword();
        // A unique placeholder email is needed for the worker. Using improved format.
        const placeholderEmail = `acct-${sender_psid}-${Date.now()}@replacement.bot`;

        const jobId = await db.createAccountCreationJob(sender_psid, placeholderEmail, password, ref.mod_id);
        
        // Notify the user that their account is being made.
        await messengerApi.sendText(sender_psid, lang.getText('replace_success_automated', userLang));
        
        // Notify the admin.
        const userName = await messengerApi.getUserProfile(sender_psid);
        await messengerApi.sendText(ADMIN_ID, `🤖 AUTOMATED REPLACEMENT job (ID: ${jobId}) has been queued for ${userName} (Mod: ${ref.mod_name}, Ref: ${ref.ref_number}).`);

    } catch (e) {
        console.error("Error during automated replacement job creation:", e);
        await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
    }

    // 3. Clear state and finish.
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}


module.exports = {
    promptForCheckClaims,
    processCheckClaims,
    promptForReplacement,
    processReplacementRequest
};
