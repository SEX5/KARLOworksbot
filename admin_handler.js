// admin_handler.js (Fully Complete Version)
const db = require('./database');
const stateManager = require('./state_manager');
const { sendText } = require('./messenger_api');

// Simple password generator for the admin create feature
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

const REFERENCES_PER_PAGE = 10;

async function showAdminMenu(sender_psid, sendText) {
    const adminInfo = await db.getAdminInfo();
    const onlineStatus = adminInfo && adminInfo.is_online ? '✅ Online' : '❌ Offline';
    const maintenanceStatus = await db.getMaintenanceStatus() ? '🔴 ON' : '🟢 OFF';
    const menu = `
Admin Menu:

1: 👁️ View references
2: ➕ Add bulk accounts
3: 🖱️ Edit mod details
4: ➕ Add a reference
5: 🖱️ Edit admin info
6: 🖱️ Edit reference mod
7: ➕ Add a new mod
8: 🗑️ Delete a reference
9: Toggle Online Status (Now: ${onlineStatus})
10: 💬 Reply to a user
11: 🤖 View creation jobs
12: ⚡ Admin-create account
13: ➕ Add bulk references
14: ⏸️ Pause/Resume user
15: 🛠️ Toggle Maintenance (Now: ${maintenanceStatus})
16: 🗑️ Delete mod accounts
17: 📢 Broadcast to users
18: 🖱️ Edit reference claims
19: 📊 View sales stats
`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- NEW: Maintenance Mode ---
async function toggleMaintenanceMode(sender_psid, sendText) {
    try {
        const currentStatus = await db.getMaintenanceStatus();
        const newStatus = !currentStatus;
        await db.setMaintenanceStatus(newStatus);
        const statusText = newStatus ? '🔴 ON' : '🟢 OFF';
        await sendText(sender_psid, `✅ Maintenance mode is now ${statusText}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- NEW: Delete Mod Accounts ---
async function promptForDeleteModAccounts_Step1_GetModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods in the system.");
        return stateManager.clearUserState(sender_psid);
    }
    let availableMods = "Which mod's available accounts do you want to DELETE?\n\n";
    mods.forEach(mod => {
        availableMods += `- ID: ${mod.id}, Name: ${mod.name}, Stock: ${mod.stock}\n`;
    });
    await sendText(sender_psid, availableMods);
    stateManager.setUserState(sender_psid, 'awaiting_delete_mod_accounts_id');
}

async function processDeleteModAccounts_Step2_Confirm(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "Invalid Mod ID. Please try again or type 'Menu' to cancel.");
        return;
    }
    const confirmationText = `⚠️ ARE YOU SURE? ⚠️\nThis will permanently delete all *available* replacement accounts for Mod ${mod.id} (${mod.name}). This action cannot be undone.\n\nType 'delete' to confirm.`;
    await sendText(sender_psid, confirmationText);
    stateManager.setUserState(sender_psid, 'awaiting_delete_mod_accounts_confirm', { modId: mod.id });
}

async function processDeleteModAccounts_Step3_Execute(sender_psid, text, sendText) {
    if (text.trim().toLowerCase() !== 'delete') {
        await sendText(sender_psid, "❌ Deletion cancelled. Confirmation not received.");
        return stateManager.clearUserState(sender_psid);
    }
    const { modId } = stateManager.getUserState(sender_psid);
    try {
        const deletedCount = await db.deleteAccountsByModId(modId);
        await sendText(sender_psid, `✅ Success! Deleted ${deletedCount} available accounts for Mod ${modId}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- NEW: Broadcast ---
async function promptForBroadcast_Step1_GetMessage(sender_psid, sendText) {
    await sendText(sender_psid, "📢 Please type the message you want to broadcast to all users.");
    stateManager.setUserState(sender_psid, 'awaiting_broadcast_message');
}

async function processBroadcast_Step2_Confirm(sender_psid, text, sendText) {
    const message = text.trim();
    const userCount = (await db.getAllUserPsids()).length;
    const confirmationText = `Your message:\n\n"${message}"\n\nThis will be sent to ${userCount} users. Are you sure?\n\nType 'send' to confirm.`;
    await sendText(sender_psid, confirmationText);
    stateManager.setUserState(sender_psid, 'awaiting_broadcast_confirm', { message });
}

async function processBroadcast_Step3_Send(sender_psid, text, sendText) {
    if (text.trim().toLowerCase() !== 'send') {
        await sendText(sender_psid, "❌ Broadcast cancelled.");
        return stateManager.clearUserState(sender_psid);
    }
    const { message } = stateManager.getUserState(sender_psid);
    stateManager.clearUserState(sender_psid);

    await sendText(sender_psid, `🚀 Starting broadcast... This may take a moment.`);
    
    try {
        const userPsids = await db.getAllUserPsids();
        let successCount = 0;
        let failCount = 0;

        for (const psid of userPsids) {
            try {
                await sendText(psid, message);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 100)); // Delay to avoid rate limiting
            } catch (e) {
                failCount++;
                console.error(`Failed to send broadcast to ${psid}: ${e.message}`);
            }
        }
        await sendText(sender_psid, `✅ Broadcast complete.\n- Sent successfully: ${successCount}\n- Failed: ${failCount}`);

    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred during broadcast: ${e.message}`);
    }
}

// --- NEW: Edit Claims ---
async function promptForEditClaims_Step1_GetRef(sender_psid, sendText) {
    await sendText(sender_psid, "Enter the reference number whose claims you want to edit.");
    stateManager.setUserState(sender_psid, 'awaiting_edit_claim_ref');
}

async function processEditClaims_Step2_GetNewValues(sender_psid, text, sendText) {
    const refNumber = text.trim();
    const ref = await db.getReference(refNumber);
    if (!ref) {
        await sendText(sender_psid, "❌ Reference number not found. Please try again or type 'Menu' to cancel.");
        return;
    }
    const message = `Editing ${refNumber}.\nCurrent values:\n- Claims Used: ${ref.claims_used}\n- Claims Max: ${ref.claims_max}\n\nPlease provide the new values in the format:\nused: [number], max: [number]`;
    await sendText(sender_psid, message);
    stateManager.setUserState(sender_psid, 'awaiting_edit_claim_values', { refNumber });
}

async function processEditClaims_Step3_Update(sender_psid, text, sendText) {
    const { refNumber } = stateManager.getUserState(sender_psid);
    try {
        const usedMatch = text.match(/used:\s*(\d+)/i);
        const maxMatch = text.match(/max:\s*(\d+)/i);
        if (!usedMatch || !maxMatch) throw new Error("Invalid format.");
        const claimsUsed = parseInt(usedMatch[1]);
        const claimsMax = parseInt(maxMatch[1]);
        if (isNaN(claimsUsed) || isNaN(claimsMax)) throw new Error("Values must be numbers.");
        await db.updateReferenceClaims(refNumber, claimsUsed, claimsMax);
        await sendText(sender_psid, `✅ Success! Claims for ${refNumber} updated to ${claimsUsed}/${claimsMax}.`);
    } catch(e) {
        await sendText(sender_psid, `❌ Error: ${e.message}. Please use the format 'used: 1, max: 3'.`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- NEW: Statistics ---
async function promptForViewStatistics(sender_psid, sendText) {
    const message = `📊 Which sales period would you like to view?\n\n1. Daily\n2. Weekly\n3. Monthly`;
    await sendText(sender_psid, message);
    stateManager.setUserState(sender_psid, 'viewing_statistics');
}

async function handleViewStatistics(sender_psid, sendText, choice) {
    const periodMap = { '1': 'daily', 'daily': 'daily', '2': 'weekly', 'weekly': 'weekly', '3': 'monthly', 'monthly': 'monthly' };
    const period = periodMap[choice];
    if (!period) {
        await sendText(sender_psid, "Invalid choice. Please type 1, 2, or 3.");
        return;
    }
    try {
        const stats = await db.getSalesStatistics(period);
        let totalRevenue = 0;
        let totalSales = 0;
        let response = `--- Sales Statistics (${period.charAt(0).toUpperCase() + period.slice(1)}) ---\n\n`;

        if (stats.length === 0) {
            response += "No sales found for this period.";
        } else {
            stats.forEach(stat => {
                response += `Mod: ${stat.name}\n- Sales: ${stat.sales_count}\n- Revenue: ${stat.total_revenue} PHP\n\n`;
                totalRevenue += parseFloat(stat.total_revenue);
                totalSales += parseInt(stat.sales_count);
            });
            response += `--- TOTALS ---\nTotal Sales: ${totalSales}\nTotal Revenue: ${totalRevenue.toFixed(2)} PHP`;
        }
        await sendText(sender_psid, response);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred while fetching stats: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}


// --- ORIGINAL FUNCTIONS (FULLY INCLUDED) ---

async function promptForPauseToggle_GetPSID(sender_psid, sendText) {
    await sendText(sender_psid, "Please enter the Page-Scoped ID (PSID) of the user you want to pause or resume.");
    stateManager.setUserState(sender_psid, 'awaiting_pause_toggle_psid');
}

async function processPauseToggle(sender_psid, text, sendText) {
    const targetPsid = text.trim();
    if (!/^\d{15,17}$/.test(targetPsid)) {
        await sendText(sender_psid, "❌ That doesn't look like a valid PSID. Please try again or type 'Menu' to cancel.");
        return;
    }
    try {
        const isCurrentlyPaused = await db.isUserPaused(targetPsid);
        if (isCurrentlyPaused) {
            await db.resumeUser(targetPsid);
            await sendText(sender_psid, `✅ User ${targetPsid} has been RESUMED. The bot will now respond to them.`);
        } else {
            await db.pauseUser(targetPsid);
            await sendText(sender_psid, `✅ User ${targetPsid} has been PAUSED. The bot will now ignore their messages, allowing you to talk freely.`);
        }
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForAdminCreate_Step1_GetEmail(sender_psid, sendText) {
    await sendText(sender_psid, "Please enter the email address for the new account you want to create.");
    stateManager.setUserState(sender_psid, 'awaiting_admin_create_email');
}

async function promptForAdminCreate_Step2_GetMod(sender_psid, text, sendText) {
    const email = text.trim();
    if (!/\S+@\S+\.\S+/.test(email)) {
        await sendText(sender_psid, "❌ That doesn't look like a valid email address. Please try again or type 'Menu' to cancel.");
        return;
    }
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods in the system. Cannot proceed.");
        stateManager.clearUserState(sender_psid);
        return;
    }
    let response = `✅ Email accepted: ${email}\n\nNow, which mod should be created for this account?\n`;
    mods.forEach(mod => { response += `🔹 ID ${mod.id}: ${mod.name}\n`; });
    response += `\nPlease reply with just the Mod ID number.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_admin_create_mod_id', { email });
}

async function processAdminCreate_Step3_CreateJob(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const { email } = stateManager.getUserState(sender_psid);
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "❌ Invalid Mod ID. Please reply with a valid number from the list or type 'Menu' to cancel.");
        return;
    }
    if (!mod.x_coordinate || !mod.y_coordinate) {
        await sendText(sender_psid, `❌ This mod (ID: ${modId}) cannot be automated because its coordinates are not set.`);
        stateManager.clearUserState(sender_psid);
        return;
    }
    try {
        const password = generatePassword();
        const jobId = await db.createAccountCreationJob(sender_psid, email, password, modId);
        await sendText(sender_psid, `✅ Success! Automation job (ID: ${jobId}) has been started for ${email}.\n\nThe account details will be sent to you here once the worker has finished.`);
    } catch (e) {
        console.error("Error creating admin job:", e);
        await sendText(sender_psid, `An unexpected error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function toggleAdminOnlineStatus(sender_psid, sendText) {
    try {
        const adminInfo = await db.getAdminInfo();
        const newStatus = !adminInfo.is_online;
        await db.setAdminOnlineStatus(newStatus);
        const statusText = newStatus ? '✅ Online' : '❌ Offline';
        await sendText(sender_psid, `Your status has been updated to: ${statusText}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred while updating your status: ${e.message}`);
    }
    stateManager.clearUserState(sender_psid);
}

async function handleViewReferences(sender_psid, sendText, page = 1) {
    const allRefs = await db.getAllReferences();
    if (!allRefs || allRefs.length === 0) {
        stateManager.clearUserState(sender_psid);
        return sendText(sender_psid, "No reference numbers have been submitted yet.");
    }
    const totalPages = Math.ceil(allRefs.length / REFERENCES_PER_PAGE);
    if (page < 1) page = 1; if (page > totalPages) page = totalPages;
    const startIndex = (page - 1) * REFERENCES_PER_PAGE;
    const refsToShow = allRefs.slice(startIndex, startIndex + REFERENCES_PER_PAGE);
    let response = `--- Reference Numbers (Page ${page}/${totalPages}) ---\n\n`;
    refsToShow.forEach(r => { response += `Ref: ${r.ref_number}\nMod: ${r.mod_name}\nUser: ${r.user_id}\nClaims: ${r.claims_used}/${r.claims_max}\n\n`; });
    if (page < totalPages) response += `Type '1' for Next Page\n`;
    if (page > 1) response += `Type '2' for Previous Page\n`;
    response += `Type 'Menu' to return to the main menu.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'viewing_references', { page: page });
}

async function promptForBulkAccounts_Step1_ModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods. Add a mod first.");
        return stateManager.clearUserState(sender_psid);
    }
    let availableMods = "Available Mod IDs:\n";
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
    await sendText(sender_psid, `${availableMods}\nWhich mod do you want to add accounts to? Please type the Mod ID.`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_mod_id');
}

async function processBulkAccounts_Step2_GetAccounts(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    if (isNaN(modId) || !(await db.getModById(modId))) {
        await sendText(sender_psid, "Invalid Mod ID. Please type a valid number or 'Menu' to cancel.");
        return;
    }
    await sendText(sender_psid, `Okay, adding accounts to Mod ${modId}. Send the list of accounts now.\n\nFormat (one per line):\nusername:password`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_list', { modId });
}

async function processBulkAccounts_Step3_SaveAccounts(sender_psid, text, sendText) {
    const { modId } = stateManager.getUserState(sender_psid);
    try {
        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        const accounts = lines.map(line => {
            const parts = line.split(':');
            if (parts.length < 2) return null;
            const username = parts.shift().trim();
            const password = parts.join(':').trim();
            if (!username || !password) return null;
            return { username, password };
        }).filter(Boolean);
        if (accounts.length === 0) throw new Error("No valid accounts found in the format username:password.");
        await db.addBulkAccounts(modId, accounts);
        await sendText(sender_psid, `✅ ${accounts.length} accounts were successfully added to Mod ${modId}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForEditMod_Step1_ModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods to edit.");
        return stateManager.clearUserState(sender_psid);
    }
    let availableMods = "Available Mod IDs:\n";
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
    await sendText(sender_psid, `${availableMods}\nWhich mod would you like to edit? Please type the Mod ID.`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_id');
}

async function processEditMod_Step2_AskDetail(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) { await sendText(sender_psid, "Invalid Mod ID. Please try again or type 'Menu' to cancel."); return; }
    const response = `Editing Mod ${mod.id} (${mod.name}).\nCurrent Details:\n- Name: ${mod.name}\n- Desc: ${mod.description}\n- Price: ${mod.price}\n- Image: ${mod.image_url}\n- Claims: ${mod.default_claims_max}\n- X: ${mod.x_coordinate || 'Not Set'}\n- Y: ${mod.y_coordinate || 'Not Set'}\n\nWhat would you like to change? Reply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId });
}

async function processEditMod_Step3_AskValue(sender_psid, text, sendText) {
    const detailToChange = text.trim().toLowerCase();
    const { modId } = stateManager.getUserState(sender_psid);
    if (!['name', 'description', 'price', 'image', 'claims', 'x', 'y'].includes(detailToChange)) {
        await sendText(sender_psid, "Invalid choice. Please reply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'.");
        return;
    }
    await sendText(sender_psid, `What is the new ${detailToChange} for Mod ${modId}?`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_new_value', { modId, detailToChange });
}

async function processEditMod_Step4_SaveValue(sender_psid, text, sendText) {
    const newValue = text.trim();
    const { modId, detailToChange } = stateManager.getUserState(sender_psid);
    const detailsToUpdate = {};
    let fieldName = detailToChange, valueToSave = newValue;

    if (detailToChange === 'image') fieldName = 'image_url';
    if (detailToChange === 'claims') fieldName = 'default_claims_max';
    if (detailToChange === 'x') fieldName = 'x_coordinate';
    if (detailToChange === 'y') fieldName = 'y_coordinate';

    if (['price', 'claims', 'x', 'y'].includes(detailToChange)) {
        const numValue = (detailToChange === 'price' || detailToChange === 'x' || detailToChange === 'y') ? parseFloat(valueToSave) : parseInt(valueToSave);
        if (isNaN(numValue)) { await sendText(sender_psid, `Invalid number format for ${detailToChange}.`); return; }
        valueToSave = numValue;
    }
    detailsToUpdate[fieldName] = valueToSave;
    try {
        await db.updateModDetails(modId, detailsToUpdate);
        await sendText(sender_psid, `✅ The ${detailToChange} for Mod ${modId} has been updated.\n\nWould you like to edit another detail for this mod? (Yes / No)`);
        stateManager.setUserState(sender_psid, 'awaiting_edit_mod_continue', { modId });
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
        stateManager.clearUserState(sender_psid);
    }
}

async function processEditMod_Step5_Continue(sender_psid, text, sendText) {
    const choice = text.trim().toLowerCase();
    const { modId } = stateManager.getUserState(sender_psid);
    if (choice === 'yes') {
        const mod = await db.getModById(modId);
        const response = `What else would you like to change for Mod ${mod.id}?\nReply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'.`;
        await sendText(sender_psid, response);
        stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId });
    } else {
        await sendText(sender_psid, "Finished editing Mod. Returning to menu.");
        await showAdminMenu(sender_psid, sendText);
    }
}

async function promptForAddRef_Step1_GetRef(sender_psid, sendText) {
    await sendText(sender_psid, "Please provide the 13-digit GCash reference number.");
    stateManager.setUserState(sender_psid, 'awaiting_add_ref_number');
}

async function processAddRef_Step2_GetMod(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, "Invalid format. Please try again or type 'Menu' to cancel.");
        return;
    }
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ No mods exist. Add one first.");
        return stateManager.clearUserState(sender_psid);
    }
    let availableMods = "Reference accepted. Choose the mod for this reference:\n\n";
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
    await sendText(sender_psid, availableMods);
    stateManager.setUserState(sender_psid, 'awaiting_add_ref_mod_id', { refNumber });
}

async function processAddRef_Step3_Save(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const { refNumber } = stateManager.getUserState(sender_psid);
    if (isNaN(modId) || !(await db.getModById(modId))) {
        await sendText(sender_psid, "Invalid Mod ID. Please type a valid number.");
        return;
    }
    try {
        const claimsAdded = await db.addReference(refNumber, 'ADMIN_ADDED', modId);
        await sendText(sender_psid, `✅ Reference ${refNumber} added to Mod ${modId} with ${claimsAdded} claims.`);
    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await sendText(sender_psid, "Could not add reference. It already exists.");
        } else {
            await sendText(sender_psid, `Could not add reference. Error: ${e.message}`);
        }
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForEditAdmin(sender_psid, sendText) {
    await sendText(sender_psid, `Provide new admin info.\nFormat: Facebook ID: [ID], GCash Number: [Number]`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_admin');
}

async function processEditAdmin(sender_psid, text, sendText) {
    try {
        const newAdminId = text.match(/facebook id:\s*(\d+)/i)[1];
        const newGcash = text.match(/gcash number:\s*([\d\s]+)/i)[1].replace(/\s/g, '');
        if (!newAdminId || !newGcash) throw new Error("Missing details.");
        await db.updateAdminInfo(newAdminId, newGcash);
        await sendText(sender_psid, "Admin info updated successfully.");
    } catch (e) {
        await sendText(sender_psid, `Invalid format. Error: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForEditRef(sender_psid, sendText) {
    await sendText(sender_psid, `Provide the ref number and the new mod ID.\nFormat: [ref_number], Mod [ID]`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_ref');
}

async function processEditRef(sender_psid, text, sendText) {
    try {
        const [ref, modIdStr] = text.split(',').map(p => p.trim());
        const newModId = parseInt(modIdStr.replace('mod', '').trim());
        if (!/^\d{13}$/.test(ref) || !(await db.getReference(ref))) throw new Error("Invalid ref number.");
        if (isNaN(newModId) || !(await db.getModById(newModId))) throw new Error("Invalid Mod ID.");
        await db.updateReferenceMod(ref, newModId);
        await sendText(sender_psid, `Reference ${ref} updated to Mod ${newModId}.`);
    } catch (e) {
        await sendText(sender_psid, `Invalid format. Error: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForAddMod(sender_psid, sendText) {
    await sendText(sender_psid, `Provide new mod details.\nFormat: ID, Name, Description, Price, ImageURL, MaxClaims`);
    stateManager.setUserState(sender_psid, 'awaiting_add_mod');
}

async function processAddMod(sender_psid, text, sendText) {
    try {
        const [id, name, description, price, imageUrl, maxClaims] = text.split(',').map(p => p.trim());
        const modId = parseInt(id); const modPrice = parseFloat(price); const defaultClaims = parseInt(maxClaims);
        if (isNaN(modId) || !name || isNaN(modPrice) || isNaN(defaultClaims)) throw new Error("ID, Name, Price, and MaxClaims are required and must be correct format.");
        await db.addMod(modId, name, description, modPrice, imageUrl, defaultClaims);
        await sendText(sender_psid, `✅ Mod ${modId} (${name}) created successfully with ${defaultClaims} default claims.`);
    } catch (e) {
        await sendText(sender_psid, `❌ Could not create mod. The Mod ID might already exist or format was wrong.\nError: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForDeleteRef(sender_psid, sendText) {
    await sendText(sender_psid, "Please provide the 13-digit reference number you wish to delete.");
    stateManager.setUserState(sender_psid, 'awaiting_delete_ref');
}

async function processDeleteRef(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, "Invalid format. A reference number must be exactly 13 digits.");
        return;
    }
    try {
        const deleteCount = await db.deleteReference(refNumber);
        if (deleteCount > 0) { await sendText(sender_psid, `✅ Reference ${refNumber} has been deleted.`); }
        else { await sendText(sender_psid, `❌ Reference ${refNumber} was not found.`); }
    } catch (e) {
        await sendText(sender_psid, `An unexpected error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

async function promptForReply_Step1_GetPSID(sender_psid, sendText) {
    await sendText(sender_psid, "Enter the PSID of the user you want to reply to.");
    stateManager.setUserState(sender_psid, 'awaiting_reply_psid');
}

async function promptForReply_Step2_GetUsername(sender_psid, text, sendText) {
    const targetPsid = text.trim();
    if (!/^\d{15,17}$/.test(targetPsid)) {
        await sendText(sender_psid, "❌ Invalid PSID. Please try again or type 'Menu' to cancel.");
        return;
    }
    await sendText(sender_psid, `✅ PSID received. Now, enter the USERNAME for the account.`);
    stateManager.setUserState(sender_psid, 'awaiting_reply_username', { targetPsid });
}

async function promptForReply_Step3_GetPassword(sender_psid, text, sendText) {
    const username = text.trim();
    const { targetPsid } = stateManager.getUserState(sender_psid);
    await sendText(sender_psid, `✅ Username noted. Now, enter the PASSWORD.`);
    stateManager.setUserState(sender_psid, 'awaiting_reply_password', { targetPsid, username });
}

async function processReply_Step4_Send(sender_psid, text, sendText) {
    const password = text.trim();
    const { targetPsid, username } = stateManager.getUserState(sender_psid);
    const customerMessage = `🎉 Here are your account details!\n\n📧 Username: \`${username}\`\n🔐 Password: \`${password}\`\n\nThank you for your trust! Enjoy! 💙`;
    try {
        await sendText(targetPsid, customerMessage);
        await sendText(sender_psid, `✅ Account details sent to user ${targetPsid}.`);
    } catch (error) {
        await sendText(sender_psid, `❌ Failed to send message to user ${targetPsid}.`);
    }
    stateManager.clearUserState(sender_psid);
}

async function handleViewJobs(sender_psid, sendText) {
    try {
        const jobs = await db.getCreationJobs();
        if (!jobs || jobs.length === 0) { return sendText(sender_psid, "No account creation jobs found."); }
        let response = "--- Recent Account Creation Jobs ---\n\n";
        jobs.forEach(job => {
            const statusEmoji = { pending: '⏳', processing: '⚙️', completed: '✅', failed: '❌', delivered: '🎉', failed_notified: '📮'}[job.status] || '❓';
            response += `${statusEmoji} Job ID: ${job.job_id}\n   User: ${job.user_psid}\n   Status: ${job.status}\n\n`;
        });
        await sendText(sender_psid, response);
    } catch (e) {
        await sendText(sender_psid, `Error fetching jobs: ${e.message}`);
    }
    stateManager.clearUserState(sender_psid);
}

async function promptForBulkRefs_Step1_GetModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ No mods exist. Add one first.");
        return stateManager.clearUserState(sender_psid);
    }
    let availableMods = "Available Mod IDs:\n";
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
    await sendText(sender_psid, `${availableMods}\nWhich mod to add bulk references to? Type the Mod ID.`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_refs_mod_id');
}

async function processBulkRefs_Step2_GetRefs(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "Invalid Mod ID. Try again or type 'Menu' to cancel.");
        return;
    }
    await sendText(sender_psid, `Okay, adding references to Mod ${mod.id}. Send the list of 13-digit reference numbers now.`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_refs_list', { modId: mod.id });
}

async function processBulkRefs_Step3_SaveRefs(sender_psid, text, sendText) {
    const { modId } = stateManager.getUserState(sender_psid);
    try {
        const refNumbers = text.split(/[\s,\n]+/).map(ref => ref.trim()).filter(Boolean);
        if (refNumbers.length === 0) throw new Error("No valid reference numbers found.");
        const { successfulAdds, duplicates, invalids } = await db.addBulkReferences(modId, refNumbers);
        let summary = `✅ Bulk import complete for Mod ${modId}.\n- Added: ${successfulAdds}\n- Duplicates skipped: ${duplicates.length}\n- Invalid format skipped: ${invalids.length}`;
        await sendText(sender_psid, summary);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

module.exports = {
    showAdminMenu, toggleMaintenanceMode, promptForDeleteModAccounts_Step1_GetModId, processDeleteModAccounts_Step2_Confirm,
    processDeleteModAccounts_Step3_Execute, promptForBroadcast_Step1_GetMessage, processBroadcast_Step2_Confirm,
    processBroadcast_Step3_Send, promptForEditClaims_Step1_GetRef, processEditClaims_Step2_GetNewValues, processEditClaims_Step3_Update,
    promptForViewStatistics, handleViewStatistics, promptForPauseToggle_GetPSID, processPauseToggle, promptForAdminCreate_Step1_GetEmail,
    promptForAdminCreate_Step2_GetMod, processAdminCreate_Step3_CreateJob, toggleAdminOnlineStatus, handleViewReferences,
    promptForBulkAccounts_Step1_ModId, processBulkAccounts_Step2_GetAccounts, processBulkAccounts_Step3_SaveAccounts,
    promptForEditMod_Step1_ModId, processEditMod_Step2_AskDetail, processEditMod_Step3_AskValue, processEditMod_Step4_SaveValue,
    processEditMod_Step5_Continue, promptForAddRef_Step1_GetRef, processAddRef_Step2_GetMod, processAddRef_Step3_Save,
    promptForEditAdmin, processEditAdmin, promptForEditRef, processEditRef, promptForAddMod, processAddMod,
    promptForDeleteRef, processDeleteRef, promptForReply_Step1_GetPSID, promptForReply_Step2_GetUsername,
    promptForReply_Step3_GetPassword, processReply_Step4_Send, handleViewJobs, promptForBulkRefs_Step1_GetModId,
    processBulkRefs_Step2_GetRefs, processBulkRefs_Step3_SaveRefs
};
