// job_poller.js (Simplified & Robust Version)
console.log("✅✅✅ POLLER STARTUP v5 (Simplified Version) ✅✅✅");
const dbManager = require('./database.js');
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
        const actionableJobs = await dbManager.getActionableJobs();
        for (const job of actionableJobs) {
            if (job.status === 'completed') {
                try {
                    console.log(`[Poller] Processing completed job ${job.job_id} for user ${job.user_psid}`);

                    // --- SIMPLIFIED MESSAGE ---
                    // We replaced the language manager with a simple, hardcoded string to prevent hidden crashes.
                    const deliveryMessage = "Hooray! Your account has been created successfully!\n\n" + job.result_message;
                    
                    // Call sendText WITH the required tag to work after 24 hours
                    await sendText(job.user_psid, deliveryMessage, "POST_PURCHASE_UPDATE");
                    
                    // This line will only run if the message was sent successfully
                    await dbManager.updateJobStatus(job.job_id, 'delivered');
                    console.log(`[Poller] Successfully delivered job ${job.job_id}.`);

                } catch (sendError) {
                    // If sending fails, the bot will log the error and try again on the next loop.
                    console.error(`[Poller] FAILED TO SEND delivery for job ${job.job_id}. Error: ${sendError.message || 'Unknown error'}. It will be retried.`);
                }
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Processing failed job ${job.job_id} for user ${job.user_psid}`);
                // Notify user with a simple, hardcoded message
                await sendText(job.user_psid, "Sorry, there was an error creating your account. The admin has been notified and will assist you shortly.");
                // Notify admin with details
                const adminMessage = `
                    ❌ AUTOMATION FAILED for Job ID: ${job.job_id}
                    User: ${job.user_psid}
                    Please check the worker logs and assist the user manually.

                    Error Details:
                    ${job.result_message}
                `;
                await sendText(ADMIN_ID, adminMessage);
                await dbManager.updateJobStatus(job.job_id, 'failed_notified');
            }
        }

        // Check for OFFLINE WORKER
        const now = Date.now();
        if (now - lastOfflineAlertTimestamp > OFFLINE_ALERT_COOLDOWN) {
            const staleJobs = await dbManager.getStalePendingJobs(20); // jobs pending > 20 mins
            if (staleJobs.length > 0) {
                console.warn(`[Poller] Worker appears to be offline. ${staleJobs.length} jobs are stale.`);
                await sendText(ADMIN_ID, `⚠️ Worker Alert: The automation script may be offline. ${staleJobs.length} job(s) have been pending for over 20 minutes.`);
                lastOfflineAlertTimestamp = now;
            }
        }

    } catch (error) {
        console.error("[Poller] A CRITICAL error occurred in the main polling loop:", error.message);
    }
}

/**
 * Starts the background polling service.
 */
function start() {
    setInterval(pollForJobUpdates, POLLING_INTERVAL);
    console.log(`✅ Job poller started with SIMPLIFIED CODE. Checking every ${POLLING_INTERVAL / 1000} seconds.`);
}

module.exports = {
    start
};
