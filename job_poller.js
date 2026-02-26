// job_poller.js (FIXED & COMPLETED)
const dbManager = require('./database.js');
const lang = require('./language_manager.js');
const { sendText } = require('./messenger_api.js');
const { ADMIN_ID } = require('./secrets.js');

const POLLING_INTERVAL = 15 * 1000; // 15 seconds
const OFFLINE_ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes
let lastOfflineAlertTimestamp = 0;

/**
 * Checks the database for completed, failed, or stale jobs and acts on them.
 */
async function pollForJobUpdates() {
    try {
        // 1. Handle COMPLETED and FAILED jobs
        // getActionableJobs fetches jobs with status 'completed' or 'failed'
        const actionableJobs = await dbManager.getActionableJobs();
        
        for (const job of actionableJobs) {
            const userLang = job.lang || 'en'; 

            if (job.status === 'completed') {
                console.log(`[Poller] Delivering completed job ${job.job_id} to user ${job.user_psid}`);
                
                // Construct the delivery message
                const deliveryMessage = lang.getText('delivery_success', userLang) + 
                                       `\n\n${job.result_message}`;
                
                try {
                    await sendText(job.user_psid, deliveryMessage);
                    // Mark as delivered so it's not picked up again
                    await dbManager.updateJobStatus(job.job_id, 'delivered', 'Successfully delivered via Poller');
                } catch (err) {
                    console.error(`[Poller] Failed to deliver Job ${job.job_id}:`, err.message);
                }
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Notifying failed job ${job.job_id} to user ${job.user_psid}`);
                
                try {
                    // Inform the user
                    await sendText(job.user_psid, lang.getText('delivery_failed_user', userLang));
                    
                    // Inform the admin
                    const adminMessage = `❌ AUTOMATION FAILED\nJob ID: ${job.job_id}\nUser: ${job.user_psid}\nError: ${job.result_message}`;
                    await sendText(ADMIN_ID, adminMessage);
                    
                    // Mark as failed_notified so it's not picked up again
                    await dbManager.updateJobStatus(job.job_id, 'failed_notified', job.result_message);
                } catch (err) {
                    console.error(`[Poller] Failed to process failure notification for Job ${job.job_id}:`, err.message);
                }
            }
        }

        // 2. Check for OFFLINE WORKER (Stale jobs)
        const now = Date.now();
        if (now - lastOfflineAlertTimestamp > OFFLINE_ALERT_COOLDOWN) {
            // Check for jobs pending for more than 20 minutes
            const staleJobs = await dbManager.getStalePendingJobs(20);
            if (staleJobs.length > 0) {
                console.warn(`[Poller] Worker alert: ${staleJobs.length} stale jobs found.`);
                await sendText(ADMIN_ID, `⚠️ Worker Alert: The automation script may be offline. ${staleJobs.length} job(s) have been pending for over 20 minutes.`);
                lastOfflineAlertTimestamp = now;
            }
        }

    } catch (error) {
        console.error("[Poller] Error in job polling loop:", error.message);
    }
}

/**
 * Starts the background polling service.
 */
function start() {
    setInterval(pollForJobUpdates, POLLING_INTERVAL);
    console.log(`✅ Job poller started. Checking every ${POLLING_INTERVAL / 1000} seconds.`);
}

module.exports = {
    start
};
