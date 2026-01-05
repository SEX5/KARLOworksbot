// error_handler.js
const { sendText, notifyAdmin } = require('./messenger_api.js');
const lang = require('./language_manager.js');
const stateManager = require('./state_manager.js');

/**
 * A centralized function to handle unexpected errors, log them for the admin,
 * and provide a user-friendly message.
 */
async function handleUserError(error, sender_psid, userLang = 'en', context = 'an unknown process') {
    console.error(`[ERROR] Context: ${context} | User: ${sender_psid} | Message: ${error.message}`);
    console.error(error.stack); 

    // Notify the admin with detailed information using Robust Notification
    const adminMessage = `
⚠️ UNEXPECTED ERROR
Context: ${context}
User PSID: ${sender_psid}
Error: ${error.message}
Please check the logs.
    `;
    
    // This will try 3 times to ensure you get the message
    await notifyAdmin(adminMessage);

    // Send a generic, user-friendly message to the user
    try {
        await sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
    } catch (userSendError) {
        console.error(`CRITICAL: Failed to send error message to user ${sender_psid}.`, userSendError);
    }

    // Clear the user's state to prevent them from being stuck
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = { handleUserError };
