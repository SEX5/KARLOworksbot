// --- START OF FILE bot_trigger.js ---

const axios = require('axios');
const secrets = require('./secrets.js');

const TELEGRAM_BOT_TOKEN = secrets.TELEGRAM_CREATOR_BOT_TOKEN;
const ADMIN_CHAT_ID = secrets.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

/**
 * Triggers the Python bot by sending a single, multi-line command.
 * @param {string} email - The email for the new account.
 * @param {string} password - The password for the new account.
 * @param {number} setId - The Set ID.
 * @returns {Promise<boolean>} - True if successful.
 */
async function triggerAccountCreator(email, password, setId) {
    if (!TELEGRAM_BOT_TOKEN || !ADMIN_CHAT_ID) {
        console.error("FATAL: Telegram creator bot credentials not set.");
        return false;
    }

    // This creates the multi-line format:
    // /create
    // email@example.com
    // password123
    // 1
    const commandText = `/create\n${email}\n${password}\n${setId}`;

    try {
        console.log(`Queueing multi-line command for Telegram bot for email: ${email}`);
        await axios.post(TELEGRAM_API_URL, {
            chat_id: ADMIN_CHAT_ID,
            text: commandText,
        });
        console.log("Successfully queued multi-line command.");
        return true;
    } catch (error) {
        console.error("Error queueing command to Telegram bot:", error.response?.data || error.message);
        return false;
    }
}

module.exports = {
    triggerAccountCreator
};
