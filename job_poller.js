// job_poller.js (Simplified & Robust Version with 30-Second Delay)
console.log("✅✅✅ POLLER STARTUP v6 (With 30s Delay) ✅✅✅");
const dbManager = require('./database.js');
const { sendText } = require('./messenger_api.js');
const { ADMIN_ID } = require('./secrets.js');

const POLLING_INTERVAL = 15 * 1000; // 15 seconds
const DELIVERY_DELAY = 30 * 1000; // 30 seconds
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
                    // --- MODIFICATION: 30-SECOND DELAY LOGIC ---
                    const completedTimestamp = new Date(job.updated_at).getTime();
                    const currentTime = Date.now();

                    // Check if 30 seconds have passed since the job was marked 'completed'
                    if (currentTime - completedTimestamp < DELIVERY_DELAY) {
                        // If not enough time has passed, log it and skip this job for now.
                        console.log(`[Poller] Job ${job.job_id} is completed but waiting for ${DELIVERY_DELAY / 1000}-second delay. Skipping for now.`);
                        continue; // Move to the next job in the loop
                    }
                    // --- END OF MODIFICATION ---
                    
                    console.log(`[Poller] Processing completed job ${job.job_id} for user ${job.user_psid} after delay.`);

                    const deliveryMessage = "Hooray! Your account has been created successfully!\n\n" + job.result_message;
                    
                    await sendText(job.user_psid, deliveryMessage, "POST_PURCHASE_UPDATE");
                    
                    await dbManager.updateJobStatus(job.job_id, 'delivered');
                    console.log(`[Poller] Successfully delivered job ${job.job_id}.`);

                } catch (sendError) {
                    console.error(`[Poller] FAILED TO SEND delivery for job ${job.job_id}. Error: ${sendError.message || 'Unknown error'}. It will be retried.`);
                }
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Processing failed job ${job.job_id} for user ${job.user_psid}`);
                await sendText(job.user_psid, "Sorry, there was an error creating your account. The admin has been notified and will assist you shortly.");
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
            const staleJobs = await dbManager.getStalePendingJobs(20);
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
    console.log(`✅ Job poller started with ${DELIVERY_DELAY / 1000}s delivery delay. Checking every ${POLLING_INTERVAL / 1000} seconds.`);
}

module.exports = {
    start
};
