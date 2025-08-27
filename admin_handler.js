// admin_handler.js (Final Version with all features)
const db = require('./database');
const stateManager = require('./state_manager');

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
    const menu = `
Admin Menu:

Type 1: 👁️ View reference numbers
Type 2: ➕ Add bulk accounts
Type 3: 🖱️ Edit mod details
Type 4: ➕ Add a reference number
Type 5: 🖱️ Edit admin info
Type 6: 🖱️ Edit reference numbers
Type 7: ➕ Add a new mod
Type 8: 🗑️ Delete a reference number
Type 9: Toggle Online/Offline Status (Currently: ${onlineStatus})
Type 10: 💬 Reply to a user with account details
Type 11: 🤖 View account creation jobs
Type 12: ⚡ Create account for user (Admin)
Type 13: ➕ Add bulk reference numbers
`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- NEW: Admin Account Creation Flow ---

// Step 1: Ask for the email address
async function promptForAdminCreate_Step1_GetEmail(sender_psid, sendText) {
    await sendText(sender_psid, "Please enter the email address for the new account you want to create.");
    stateManager.setUserState(sender_psid, 'awaiting_admin_create_email');
}

// Step 2: Get email, validate it, and ask for the Mod ID
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
    mods.forEach(mod => {
        response += `🔹 ID ${mod.id}: ${mod.name}\n`;
    });
    response += `\nPlease reply with just the Mod ID number.`;

    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_admin_create_mod_id', { email });
}

// Step 3: Get Mod ID, validate, and create the job
async function processAdminCreate_Step3_CreateJob(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const { email } = stateManager.getUserState(sender_psid);

    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "❌ Invalid Mod ID. Please reply with a valid number from the list or type 'Menu' to cancel.");
        return;
    }

    if (!mod.x_coordinate || !mod.y_coordinate) {
        await sendText(sender_psid, `❌ This mod (ID: ${modId}) cannot be automated because its coordinates are not set. Please edit the mod to add coordinates first.`);
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

// --- End of new functions ---

async function toggleAdminOnlineStatus(sender_psid, sendText) {
    try {
        const adminInfo = await db.getAdminInfo();
        const newStatus = !adminInfo.is_online;
        await db.setAdminOnlineStatus(newStatus);
        const statusText = newStatus ? '✅ Online' : '❌ Offline';
        await sendText(sender_psid, `Your status has been updated to: ${statusText}.\nTo return to the admin menu, type "Menu".`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred while updating your status: ${e.message}`);
    }
    stateManager.clearUserState(sender_psid);
}

async function handleViewReferences(sender_psid, sendText, page = 1) {
    const allRefs = await db.getAllReferences();
    if (!allRefs || allRefs.length === 0) {
        stateManager.clearUserState(sender_psid);
        return sendText(sender_psid, "No reference numbers have been submitted yet.\nTo return to the admin menu, type \"Menu\".");
    }
    const totalPages = Math.ceil(allRefs.length / REFERENCES_PER_PAGE);
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    const startIndex = (page - 1) * REFERENCES_PER_PAGE;
    const endIndex = startIndex + REFERENCES_PER_PAGE;
    const refsToShow = allRefs.slice(startIndex, endIndex);
    let response = `--- Reference Numbers (Page ${page}/${totalPages}) ---\n\n`;
    refsToShow.forEach(r => {
        response += `Ref: ${r.ref_number}\nMod: ${r.mod_name}\nUser: ${r.user_id}\nClaims: ${r.claims_used}/${r.claims_max}\n\n`;
    });
    response += `--- Options ---\n`;
    if (page < totalPages) response += `Type '1' for Next Page\n`;
    if (page > 1) response += `Type '2' for Previous Page\n`;
    response += `Type 'Menu' to return to the main menu.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'viewing_references', { page: page });
}

async function promptForBulkAccounts_Step1_ModId(sender_psid, sendText) { const mods = await db.getMods(); if (!mods || mods.length === 0) { await sendText(sender_psid, "❌ There are no mods in the system yet. You must add a mod before you can add accounts.\n\nPlease use 'Type 7: Add a new mod' from the menu first."); stateManager.clearUserState(sender_psid); return; } let availableMods = "Available Mod IDs:\n"; mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; }); await sendText(sender_psid, `${availableMods}\nWhich mod would you like to add accounts to? Please type the Mod ID (e.g., 1).`); stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_mod_id'); }
async function processBulkAccounts_Step2_GetAccounts(sender_psid, text, sendText) { const modId = parseInt(text.trim()); if (isNaN(modId) || !(await db.getModById(modId))) { await sendText(sender_psid, "Invalid Mod ID. Please type a valid number from the list.\nTo return to the menu, type \"Menu\"."); return; } await sendText(sender_psid, `Okay, adding accounts to Mod ${modId}. Please send the list of accounts now.\n\nFormat (one per line):\nusername:password\nusername2:password2`); stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_list', { modId: modId }); }
async function processBulkAccounts_Step3_SaveAccounts(sender_psid, text, sendText) { const { modId } = stateManager.getUserState(sender_psid); try { const lines = text.split('\n').map(line => line.trim()).filter(Boolean); const accounts = lines.map(line => { const parts = line.split(':'); if (parts.length < 2) return null; const username = parts.shift().trim(); const password = parts.join(':').trim(); if (!username || !password) return null; return { username, password }; }).filter(Boolean); if (accounts.length === 0) throw new Error("No valid accounts were found in your message. Please check the format (username:password)."); await db.addBulkAccounts(modId, accounts); await sendText(sender_psid, `✅ ${accounts.length} accounts were successfully added to Mod ${modId}.`); } catch (e) { await sendText(sender_psid, `❌ An error occurred: ${e.message}`); } finally { stateManager.clearUserState(sender_psid); } }

async function promptForEditMod_Step1_ModId(sender_psid, sendText) { const mods = await db.getMods(); if (!mods || mods.length === 0) { await sendText(sender_psid, "❌ There are no mods to edit. Please add a mod first using 'Type 7'."); return stateManager.clearUserState(sender_psid); } let availableMods = "Available Mod IDs:\n"; mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; }); await sendText(sender_psid, `${availableMods}\nWhich mod would you like to edit? Please type the Mod ID.`); stateManager.setUserState(sender_psid, 'awaiting_edit_mod_id'); }
async function processEditMod_Step2_AskDetail(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) { await sendText(sender_psid, "Invalid Mod ID. Please try again or type 'Menu' to cancel."); return; }
    const response = `Editing Mod ${mod.id} (${mod.name}).\n\nCurrent Details:\n- Name: ${mod.name}\n- Description: ${mod.description}\n- Price: ${mod.price}\n- Image: ${mod.image_url}\n- Max Claims: ${mod.default_claims_max}\n- X Coordinate: ${mod.x_coordinate || 'Not Set'}\n- Y Coordinate: ${mod.y_coordinate || 'Not Set'}\n\nWhat would you like to change? Reply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId });
}
async function processEditMod_Step3_AskValue(sender_psid, text, sendText) { const detailToChange = text.trim().toLowerCase(); const { modId } = stateManager.getUserState(sender_psid); if (!['name', 'description', 'price', 'image', 'claims', 'x', 'y'].includes(detailToChange)) { await sendText(sender_psid, "Invalid choice. Please reply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'."); return; } await sendText(sender_psid, `What is the new ${detailToChange} for Mod ${modId}?`); stateManager.setUserState(sender_psid, 'awaiting_edit_mod_new_value', { modId, detailToChange }); }
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
        if (numValue < 0 && (detailToChange === 'price' || detailToChange === 'claims')) {
            await sendText(sender_psid, `Invalid number for ${detailToChange}. Please enter a positive number.`);
            stateManager.setUserState(sender_psid, 'awaiting_edit_mod_new_value', { modId, detailToChange });
            return;
        }
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
async function processEditMod_Step5_Continue(sender_psid, text, sendText) { const choice = text.trim().toLowerCase(); const { modId } = stateManager.getUserState(sender_psid); if (choice === 'yes') { const mod = await db.getModById(modId); const response = `What else would you like to change for Mod ${mod.id}?\nReply with 'name', 'description', 'price', 'image', 'claims', 'x', or 'y'.`; await sendText(sender_psid, response); stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId }); } else { await sendText(sender_psid, "Finished editing Mod. Returning to the admin menu."); await showAdminMenu(sender_psid, sendText); } }

async function promptForAddRef_Step1_GetRef(sender_psid, sendText) { await sendText(sender_psid, "Please provide the 13-digit GCash reference number you want to add."); stateManager.setUserState(sender_psid, 'awaiting_add_ref_number'); }
async function processAddRef_Step2_GetMod(sender_psid, text, sendText) { const refNumber = text.trim(); if (!/^\d{13}$/.test(refNumber)) { await sendText(sender_psid, "Invalid reference number format. Please try again or type 'Menu' to cancel."); return; } const mods = await db.getMods(); if (!mods || mods.length === 0) { await sendText(sender_psid, "❌ There are no mods in the system. Please add a mod first using 'Type 7'."); stateManager.clearUserState(sender_psid); return; } let availableMods = "Reference number accepted. Now, choose the mod for this reference:\n\n"; mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; }); await sendText(sender_psid, availableMods); stateManager.setUserState(sender_psid, 'awaiting_add_ref_mod_id', { refNumber }); }
async function processAddRef_Step3_Save(sender_psid, text, sendText) { const modId = parseInt(text.trim()); const { refNumber } = stateManager.getUserState(sender_psid); if (isNaN(modId) || !(await db.getModById(modId))) { await sendText(sender_psid, "Invalid Mod ID. Please type a valid number from the list."); return; } try { const claimsAdded = await db.addReference(refNumber, 'ADMIN_ADDED', modId); await sendText(sender_psid, `✅ Reference ${refNumber} has been successfully added to Mod ${modId} with ${claimsAdded} replacement claims.`); } catch (e) { if (e.message === 'Duplicate reference number') { await sendText(sender_psid, "Could not add reference. It already exists."); } else { await sendText(sender_psid, `Could not add reference. Error: ${e.message}`); } } finally { stateManager.clearUserState(sender_psid); } }

async function promptForEditAdmin(sender_psid, sendText) { await sendText(sender_psid, `Provide new admin info.\nFormat: Facebook ID: [New ID], GCash Number: [New Number]`); stateManager.setUserState(sender_psid, 'awaiting_edit_admin'); }
async function processEditAdmin(sender_psid, text, sendText) { try { const parts = text.split(',').map(p => p.trim()); const newAdminId = parts.find(p => p.toLowerCase().startsWith('facebook id:')).split(':')[1].trim(); const newGcash = parts.find(p => p.toLowerCase().startsWith('gcash number:')).split(':')[1].trim(); if (!newAdminId || !newGcash) throw new Error("Missing details."); await db.updateAdminInfo(newAdminId, newGcash); await sendText(sender_psid, "Admin info updated successfully."); } catch (e) { await sendText(sender_psid, `Invalid format. Error: ${e.message}`); } finally { stateManager.clearUserState(sender_psid); } }

async function promptForEditRef(sender_psid, sendText) { await sendText(sender_psid, `Provide the ref number and the new mod ID.\nFormat: [ref_number], Mod [ID]`); stateManager.setUserState(sender_psid, 'awaiting_edit_ref'); }
async function processEditRef(sender_psid, text, sendText) { try { const [ref, modIdStr] = text.split(',').map(p => p.trim()); const newModId = parseInt(modIdStr.replace('mod', '').trim()); if (!/^\d{13}$/.test(ref) || !(await db.getReference(ref))) throw new Error("Invalid ref number."); if (isNaN(newModId) || !(await db.getModById(newModId))) throw new Error("Invalid Mod ID."); await db.updateReferenceMod(ref, newModId); await sendText(sender_psid, `Reference ${ref} updated to Mod ${newModId}.`); } catch (e) { await sendText(sender_psid, `Invalid format. Error: ${e.message}`); } finally { stateManager.clearUserState(sender_psid); } }

async function promptForAddMod(sender_psid, sendText) { await sendText(sender_psid, `Provide the new mod details.\nFormat: ID, Name, Description, Price, ImageURL, MaxClaims\n\nExample: 1, VIP Mod, Unlocks all features, 250, http://image.link/vip.png, 3`); stateManager.setUserState(sender_psid, 'awaiting_add_mod'); }
async function processAddMod(sender_psid, text, sendText) {
    try {
        const [id, name, description, price, imageUrl, maxClaims] = text.split(',').map(p => p.trim());
        const modId = parseInt(id); const modPrice = parseFloat(price); const defaultClaims = parseInt(maxClaims);
        if (isNaN(modId) || !name || isNaN(modPrice) || isNaN(defaultClaims)) throw new Error("ID, Name, Price, and MaxClaims are required and must be the correct format.");
        await db.addMod(modId, name, description, modPrice, imageUrl, defaultClaims);
        const claimsText = defaultClaims === 1 ? '1 default claim' : `${defaultClaims} default claims`;
        await sendText(sender_psid, `✅ Mod ${modId} (${name}) created successfully with ${claimsText}!`);
    } catch (e) {
        await sendText(sender_psid, `❌ Could not create mod. The Mod ID might already exist or the format was wrong.\nError: ${e.message}`);
    } finally { stateManager.clearUserState(sender_psid); }
}

async function promptForDeleteRef(sender_psid, sendText) { await sendText(sender_psid, "Please provide the 13-digit reference number you wish to delete."); stateManager.setUserState(sender_psid, 'awaiting_delete_ref'); }
async function processDeleteRef(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) { await sendText(sender_psid, "Invalid format. A reference number must be exactly 13 digits. Please try again or type 'Menu' to cancel."); return; }
    try {
        const deleteCount = await db.deleteReference(refNumber);
        if (deleteCount > 0) { await sendText(sender_psid, `✅ Reference ${refNumber} has been successfully deleted.`); }
        else { await sendText(sender_psid, `❌ Reference ${refNumber} was not found in the database.`); }
    } catch (e) {
        await sendText(sender_psid, `An unexpected error occurred: ${e.message}`);
    } finally { stateManager.clearUserState(sender_psid); }
}

async function promptForReply_Step1_GetPSID(sender_psid, sendText) { await sendText(sender_psid, "Please enter the Page-Scoped ID (PSID) of the user you want to reply to."); stateManager.setUserState(sender_psid, 'awaiting_reply_psid'); }
async function promptForReply_Step2_GetUsername(sender_psid, text, sendText) {
    const targetPsid = text.trim();
    if (!/^\d{15,17}$/.test(targetPsid)) { await sendText(sender_psid, "❌ That doesn't look like a valid PSID. Please try again or type 'Menu' to cancel."); return; }
    await sendText(sender_psid, `✅ PSID received. Now, please enter the USERNAME (e.g., email@example.com) for the account.`);
    stateManager.setUserState(sender_psid, 'awaiting_reply_username', { targetPsid });
}
async function promptForReply_Step3_GetPassword(sender_psid, text, sendText) {
    const username = text.trim();
    const { targetPsid } = stateManager.getUserState(sender_psid);
    await sendText(sender_psid, `✅ Username noted. Now, please enter the PASSWORD for the account.`);
    stateManager.setUserState(sender_psid, 'awaiting_reply_password', { targetPsid, username });
}
async function processReply_Step4_Send(sender_psid, text, sendText) {
    const password = text.trim();
    const { targetPsid, username } = stateManager.getUserState(sender_psid);
    const customerMessage = `
🎉 Here are your account details!

Here is the account you requested:
📧 Username: \`${username}\`
🔐 Password: \`${password}\`

Thank you for your trust! Enjoy the game! 💙
(Type 'Menu' to see other options)
`;
    try {
        await sendText(targetPsid, customerMessage);
        await sendText(sender_psid, `✅ Account details have been successfully sent to user ${targetPsid}.`);
    } catch (error) {
        console.error("Failed to send reply to user:", error);
        await sendText(sender_psid, `❌ Failed to send the message to user ${targetPsid}. They may have blocked the page or the PSID is incorrect.`);
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
            response += `${statusEmoji} Job ID: ${job.job_id}\n`;
            response += `   User: ${job.user_psid}\n`;
            response += `   Status: ${job.status}\n`;
            if (job.status !== 'pending' && job.status !== 'processing') {
                const result = (job.result_message || 'No result message.').substring(0, 200);
                response += `   Result: ${result}...\n`;
            }
            response += '\n';
        });
        await sendText(sender_psid, response);
    } catch (e) {
        await sendText(sender_psid, `Error fetching jobs: ${e.message}`);
    }
    stateManager.clearUserState(sender_psid);
}

// --- Bulk Reference Number Flow ---

async function promptForBulkRefs_Step1_GetModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods in the system yet. You must add a mod before you can add references.\n\nPlease use 'Type 7: Add a new mod' from the menu first.");
        stateManager.clearUserState(sender_psid);
        return;
    }
    let availableMods = "Available Mod IDs:\n";
    mods.forEach(mod => {
        availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`;
    });
    await sendText(sender_psid, `${availableMods}\nWhich mod would you like to add bulk references to? Please type the Mod ID (e.g., 1).`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_refs_mod_id');
}

async function processBulkRefs_Step2_GetRefs(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const mod = await db.getModById(modId);
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "Invalid Mod ID. Please type a valid number from the list.\nTo return to the menu, type \"Menu\".");
        return;
    }
    await sendText(sender_psid, `Okay, adding references to Mod ${mod.id} (${mod.name}). Please send the list of 13-digit reference numbers now.\n\nYou can send them one per line or separated by spaces/commas.`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_refs_list', { modId: mod.id });
}

async function processBulkRefs_Step3_SaveRefs(sender_psid, text, sendText) {
    const { modId } = stateManager.getUserState(sender_psid);
    try {
        // Split by any combination of newlines, spaces, or commas, then filter out empty strings.
        const refNumbers = text.split(/[\s,\n]+/).map(ref => ref.trim()).filter(Boolean);

        if (refNumbers.length === 0) {
            throw new Error("No valid reference numbers were found in your message.");
        }

        const { successfulAdds, duplicates, invalids } = await db.addBulkReferences(modId, refNumbers);

        let summary = `✅ Bulk import complete for Mod ${modId}.\n\n`;
        summary += `- Successfully added: ${successfulAdds}\n`;
        if (duplicates.length > 0) {
            summary += `- Duplicates skipped: ${duplicates.length}\n`;
        }
        if (invalids.length > 0) {
            summary += `- Invalid format skipped: ${invalids.length}\n`;
        }
        await sendText(sender_psid, summary);

    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

module.exports = {
    showAdminMenu, handleViewReferences, promptForBulkAccounts_Step1_ModId, 
    processBulkAccounts_Step2_GetAccounts, processBulkAccounts_Step3_SaveAccounts,
    promptForEditMod_Step1_ModId, processEditMod_Step2_AskDetail, 
    processEditMod_Step3_AskValue, processEditMod_Step4_SaveValue, 
    processEditMod_Step5_Continue, promptForAddRef_Step1_GetRef, 
    processAddRef_Step2_GetMod, processAddRef_Step3_Save, promptForEditAdmin, 
    processEditAdmin, promptForEditRef, processEditRef, promptForAddMod, 
    processAddMod, promptForDeleteRef, processDeleteRef, toggleAdminOnlineStatus,
    promptForReply_Step1_GetPSID, promptForReply_Step2_GetUsername,
    promptForReply_Step3_GetPassword, processReply_Step4_Send,
    handleViewJobs,
    promptForAdminCreate_Step1_GetEmail,
    promptForAdminCreate_Step2_GetMod,
    processAdminCreate_Step3_CreateJob,
    promptForBulkRefs_Step1_GetModId,
    processBulkRefs_Step2_GetRefs,
    processBulkRefs_Step3_SaveRefs
};
