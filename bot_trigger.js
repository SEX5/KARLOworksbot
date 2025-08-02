// --- START OF FILE bot_trigger.js ---

const axios = require('axios');
const secrets = require('./secrets.js');

const TELEGRAM_BOT_TOKEN = secrets.TELEGRAM_CREATOR_BOT_TOKEN;
const ADMIN_CHAT_ID = secrets.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

/**
 * Triggers the Python/Telegram account creator bot by sending it a command.
 * @param {string} email - The email for the new account.
 * @param {string} password - The password for the new account.
 * @param {number} setId - The Set ID (which corresponds to modId).
 * @returns {Promise<boolean>} - True if the trigger message was sent successfully.
 */
async function triggerAccountCreator(email, password, setId) {
    if (!TELEGRAM_BOT_TOKEN || !ADMIN_CHAT_ID) {
        console.error("FATAL: Telegram creator bot token or admin chat ID is not set in secrets.js. Cannot trigger automation.");
        return false;
    }

    // This is the final, correct format. It sends the command as plain text with spaces.
    const commandText = '/create ${email} ${password} ${setId}';

    try {
        console.log(`Triggering creator bot with command: ${commandText}`);
        await axios.post(TELEGRAM_API_URL, {
            chat_id: ADMIN_CHAT_ID,
            text: commandText,
        });
        console.log("Successfully sent trigger command to Telegram bot.");
        return true;
    } catch (error)
    {
        console.error("Error sending trigger command to Telegram bot:", error.response ? error.response.data : error.message);
        return false;
    }
}

module.exports = {
    triggerAccountCreator
};
