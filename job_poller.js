// job_poller.js (with enhanced logging)
const dbManager = require('./database.js');
const lang = require('./language_manager.js');
const { sendText } = require('./messenger_api.js');
const { ADMIN_ID } = require('./secrets.js');

const POLLING_INTERVAL = 15 * 1000; // 15 seconds
const OFFLINE_ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes
let lastOfflineAlertTimestamp = 0;

async function pollForJobUpdates() {
    try {
        const actionableJobs = await dbManager.getActionableJobs();
        for (const job of actionableJobs) {
            const userLang = 'en';

            if (job.status === 'completed') {
                try {
                    // LOG 1: Shows that the poller found the job
                    console.log(`[Poller] Job ${job.job_id}: Found completed job for user ${job.user_psid}.`); 

                    const deliveryMessage = lang.getText('delivery_success', userLang) + `\n\n${job.result_message}`;
                    
                    // LOG 2: Shows we are about to make the API call
                    console.log(`[Poller] Job ${job.job_id}: Attempting to send credentials...`); 
                    
                    // The actual API call to Facebook
                    await sendText(job.user_psid, deliveryMessage, "POST_PURCHASE_UPDATE");
                    
                    // LOG 3: This will ONLY run if the API call did NOT throw an error
                    console.log(`[Poller] Job ${job.job_id}: Facebook API call successful. Now updating database status to 'delivered'.`); 

                    // Update the database status
                    await dbManager.updateJobStatus(job.job_id, 'delivered');
                    
                    // LOG 4: Confirms the database update was successful
                    console.log(`[Poller] Job ${job.job_id}: Database status successfully updated to 'delivered'.`); 

                } catch (sendError) {
                    // LOG 5: This will ONLY run if the API call threw an error
                    console.error(`[Poller] Job ${job.job_id}: FAILED TO SEND delivery message. Error: ${sendError.message}. The job status will remain 'completed' for the next retry.`); 
                }
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Processing failed job ${job.job_id} for user ${job.user_psid}`);
                try {
                    await sendText(job.user_psid, lang.getText('delivery_failed_user', userLang));
                    const adminMessage = `❌ AUTOMATION FAILED for Job ID: ${job.job_id}\nUser: ${job.user_psid}\nError: ${job.result_message}`;
                    await sendText(ADMIN_ID, adminMessage);
                    await dbManager.updateJobStatus(job.job_id, 'failed_notified');
                } catch (sendError) {
                    console.error(`[Poller] FAILED TO SEND failure notification for job ${job.job_id}. Error: ${sendError.message}.`);
                }
            }
        }

        // ... (your existing worker check logic) ...
        const now = Date.now();
        if (now - lastOfflineAlertTimestamp > OFFLINE_ALERT_COOLDOWN) {
            const staleJobs = await dbManager.getStalePendingJobs(20);
            if (staleJobs.length > 0) {
                console.warn(`[Poller] Worker appears to be offline. ${staleJobs.length} jobs are stale.`);
                await sendText(ADMIN_ID, `⚠️ Worker Alert: The automation script may be offline. ${staleJobs.length} job(s) have been pending for over 20 minutes.`);
                lastOfflineAlertTimestamp = now;
            }
        }

    } catch (error) {
        console.error("[Poller] CRITICAL Error in job polling loop:", error.message);
    }
}

/**
 * Starts the background polling service.
 */
function start() {
    setInterval(pollForJobUpdates, POLLING_INTERVAL);
    console.log(`✅ Job poller started with ENHANCED LOGGING. Checking every ${POLLING_INTERVAL / 1000} seconds.`);
}

module.exports = {
    start
};
