// job_poller.js (CORRECTED FINAL VERSION)
const dbManager = require('./database.js');
const lang = require('./language_manager.js');
const { sendText } = require('./messenger_api.js');
const secrets = require('./secrets.js');

const { ADMIN_ID } = secrets;

const POLLING_INTERVAL = 15 * 1000; // Check every 15 seconds
const OFFLINE_ALERT_COOLDOWN = 30 * 60 * 1000; // Notify admin every 30 mins if worker is dead
let lastOfflineAlertTimestamp = 0;

/**
 * Checks the database for completed or failed jobs and handles notifications.
 */
async function pollForJobUpdates() {
    try {
        // 1. Process jobs that have finished but haven't been delivered/notified yet.
        // This function was added to your database.js in the previous step.
        const actionableJobs = await dbManager.getActionableJobs();

        for (const job of actionableJobs) {
            const userLang = job.lang || 'en'; 

            if (job.status === 'completed') {
                console.log(`[Poller] Delivering completed Job ID: ${job.job_id}`);
                
                // If the worker updated the DB to 'completed' but didn't trigger delivery webhook
                const deliveryMessage = lang.getText('delivery_success', userLang) + 
                    `\n\n${job.result_message}\n\nThank you! Enjoy! 💙`;
                
                try {
                    await sendText(job.user_psid, deliveryMessage);
                    await dbManager.updateJobStatus(job.job_id, 'delivered', 'Delivered via Poller');
                } catch (e) {
                    console.error(`[Poller] Delivery failed for job ${job.job_id}:`, e.message);
                    await dbManager.updateJobStatus(job.job_id, 'delivery_failed', e.message);
                }
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Notifying failure for Job ID: ${job.job_id}`);
                
                // Inform the user
                await sendText(job.user_psid, lang.getText('delivery_failed_user', userLang));
                
                // Inform the admin
                const adminMessage = `❌ AUTOMATION FAILED\nJob ID: ${job.job_id}\nUser: ${job.user_psid}\nError: ${job.result_message}`;
                await sendText(ADMIN_ID, adminMessage);
                
                // Mark as notified so we don't spam
                await dbManager.updateJobStatus(job.job_id, 'failed_notified');
            }
        }

        // 2. Check for stale jobs (Safety check to see if worker is offline)
        const now = Date.now();
        if (now - lastOfflineAlertTimestamp > OFFLINE_ALERT_COOLDOWN) {
            const staleJobs = await dbManager.getStalePendingJobs(20); // 20 minutes old
            if (staleJobs.length > 0) {
                console.warn(`[Poller] Worker Alert: ${staleJobs.length} stale jobs.`);
                await sendText(ADMIN_ID, `⚠️ WORKER ALERT: The automation script seems to be OFFLINE. ${staleJobs.length} job(s) have been pending for >20 mins.`);
                lastOfflineAlertTimestamp = now;
            }
        }

    } catch (error) {
        console.error("[Poller] Error in loop:", error.message);
    }
}

/**
 * Start the background polling service
 */
function start() {
    // Initial delay to let DB setup finish
    setTimeout(() => {
        setInterval(pollForJobUpdates, POLLING_INTERVAL);
        console.log(`✅ Job Poller started (${POLLING_INTERVAL / 1000}s interval)`);
    }, 5000);
}

module.exports = { start };
