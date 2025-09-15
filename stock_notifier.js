// stock_notifier.js
const db = require('./database.js');
const { sendText } = require('./messenger_api.js');
const { ADMIN_ID } = require('./secrets.js');

// How often to check the stock (e.g., every 1 hour).
// 60 minutes * 60 seconds * 1000 milliseconds = 3,600,000
const STOCK_CHECK_INTERVAL = 60 * 60 * 1000; 

// The stock level that triggers a low stock notification.
const LOW_STOCK_THRESHOLD = 5;

/**
 * Fetches all mods and their available replacement account stock from the database.
 * If any mod's stock is below the threshold, it sends a single notification to the admin.
 */
async function checkStockLevels() {
    console.log('[Stock Notifier] Running hourly check for low stock...');
    try {
        const mods = await db.getMods();
        if (!mods || mods.length === 0) {
            return; // No mods to check.
        }

        // Filter out the mods that are low on stock.
        const lowStockMods = mods.filter(mod => mod.stock < LOW_STOCK_THRESHOLD);

        // If no mods are low on stock, do nothing.
        if (lowStockMods.length === 0) {
            console.log('[Stock Notifier] All stock levels are sufficient.');
            return;
        }

        // If there are low-stock mods, format a single alert message.
        let notificationMessage = '⚠️ LOW STOCK ALERT ⚠️\n\nThe following mods are running low on replacement accounts:\n';
        
        lowStockMods.forEach(mod => {
            notificationMessage += `\n🔹 Mod ${mod.id} (${mod.name}): ${mod.stock} remaining`;
        });

        notificationMessage += '\n\nPlease add more accounts soon to avoid running out.';

        // Send the consolidated message to the admin.
        await sendText(ADMIN_ID, notificationMessage);
        console.warn(`[Stock Notifier] Low stock alert sent to admin for ${lowStockMods.length} mod(s).`);

    } catch (error) {
        console.error("[Stock Notifier] Error during stock check:", error.message);
        // Optionally, send an error alert to the admin so they know the check failed.
        // await sendText(ADMIN_ID, `An error occurred in the stock notifier: ${error.message}`);
    }
}

/**
 * Starts the background service to periodically check stock levels.
 */
function start() {
    // Run the check immediately on startup, then set the interval.
    checkStockLevels();
    setInterval(checkStockLevels, STOCK_CHECK_INTERVAL);
    console.log(`✅ Stock Notifier started. Checking every ${STOCK_CHECK_INTERVAL / (60 * 1000)} minutes.`);
}

module.exports = {
    start
};
