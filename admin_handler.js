// admin_handler.js (Corrected with claims_max = 3)
const db = require('./database');
const stateManager = require('./state_manager');

async function showAdminMenu(sender_psid, sendText) {
    const menu = `Admin Menu:\nType 1: View reference numbers\nType 2: Add bulk accounts\nType 3: Edit mod details\nType 4: Add a reference number\nType 5: Edit admin info\nType 6: Edit reference numbers\nType 7: Add a new mod`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- Type 1 ---
async function handleViewReferences(sender_psid, sendText) {
    const refs = await db.getAllReferences();
    if (!refs || refs.length === 0) {
        return sendText(sender_psid, "No reference numbers have been submitted yet.\nTo return to the admin menu, type \"Menu\".");
    }
    let response = "Reference Numbers Log:\n\n";
    refs.forEach(r => {
        response += `Ref: ${r.ref_number}\nMod: ${r.mod_name}\nUser: ${r.user_id}\nClaims: ${r.claims_used}/${r.claims_max}\n\n`;
    });
    await sendText(sender_psid, response);
}

// --- Type 2 ---
async function promptForBulkAccounts_Step1_ModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods in the system yet. You must add a mod before you can add accounts.\n\nPlease use 'Type 7: Add a new mod' from the menu first.");
        stateManager.clearUserState(sender_psid);
        return;
    }
    let availableMods = "Available Mod IDs:\n";
    mods.forEach(mod => {
        availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`;
    });
    await sendText(sender_psid, `${availableMods}\nWhich mod would you like to add accounts to? Please type the Mod ID (e.g., 1).`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_mod_id');
}

async function processBulkAccounts_Step2_GetAccounts(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    if (isNaN(modId) || !(await db.getModById(modId))) {
        await sendText(sender_psid, "Invalid Mod ID. Please type a valid number from the list.\nTo return to the menu, type \"Menu\".");
        return;
    }
    await sendText(sender_psid, `Okay, adding accounts to Mod ${modId}. Please send the list of accounts now.\n\nFormat (one per line):\nusername:password\nusername2:password2`);
    stateManager.setUserState(sender_psid, 'awaiting_bulk_accounts_list', { modId: modId });
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

        if (accounts.length === 0) {
            throw new Error("No valid accounts were found in your message. Please check the format (username:password).");
        }
        await db.addBulkAccounts(modId, accounts);
        await sendText(sender_psid, `✅ ${accounts.length} accounts were successfully added to Mod ${modId}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- Type 3 ---
async function promptForEditMod(sender_psid, sendText) {
    await sendText(sender_psid, `Specify the mod to edit and the new details.\nFormat: Mod [ID], Description: New desc, Price: 150, Image: http://link`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod');
}

async function processEditMod(sender_psid, text, sendText) {
    try {
        const parts = text.split(',').map(p => p.trim());
        const modIdPart = parts.shift();
        const modId = parseInt(modIdPart.replace('mod', '').trim());

        if (isNaN(modId) || !(await db.getModById(modId))) {
            throw new Error("Invalid Mod ID.");
        }
        const detailsToUpdate = {};
        parts.forEach(part => {
            const [key, ...valueParts] = part.split(':');
            const value = valueParts.join(':').trim();
            const keyLower = key.trim().toLowerCase();
            if (['description', 'price', 'image_url'].includes(keyLower)) { detailsToUpdate[keyLower] = keyLower === 'price' ? parseFloat(value) : value; }
        });
        if (Object.keys(detailsToUpdate).length === 0) {
            throw new Error("No valid details to update were provided.");
        }
        await db.updateModDetails(modId, detailsToUpdate);
        await sendText(sender_psid, `Mod ${modId} updated successfully.`);
    } catch (e) {
        await sendText(sender_psid, `Invalid format or Mod ID. Please try again.\nError: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- Type 4 ---
async function promptForAddRef(sender_psid, sendText) {
    await sendText(sender_psid, `Provide the 13-digit GCash ref, user ID, and mod ID.\nFormat: [ref_number], [user_id], Mod [ID]`);
    stateManager.setUserState(sender_psid, 'awaiting_add_ref');
}

async function processAddRef(sender_psid, text, sendText) {
    try {
        const [ref, userId, modIdStr] = text.split(',').map(p => p.trim());
        const modId = parseInt(modIdStr.replace('mod', '').trim());
        if (!/^\d{13}$/.test(ref) || !userId || isNaN(modId) || !(await db.getModById(modId))) {
            throw new Error("Invalid format, User ID, or Mod ID.");
        }
        await db.addReference(ref, userId, modId, 3); // <-- Pass 3 as claims_max
        await sendText(sender_psid, "Reference number added successfully with 3 replacement claims.");
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

// --- Type 5 ---
async function promptForEditAdmin(sender_psid, sendText) {
    await sendText(sender_psid, `Provide new admin info.\nFormat: Facebook ID: [New ID], GCash Number: [New Number]`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_admin');
}

async function processEditAdmin(sender_psid, text, sendText) {
    try {
        const parts = text.split(',').map(p => p.trim());
        const newAdminId = parts.find(p => p.toLowerCase().startsWith('facebook id:')).split(':')[1].trim();
        const newGcash = parts.find(p => p.toLowerCase().startsWith('gcash number:')).split(':')[1].trim();
        if (!newAdminId || !newGcash) throw new Error("Missing details.");
        await db.updateAdminInfo(newAdminId, newGcash);
        await sendText(sender_psid, "Admin info updated successfully.");
    } catch (e) {
        await sendText(sender_psid, `Invalid format. Error: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- Type 6 ---
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

// --- Type 7 ---
async function promptForAddMod(sender_psid, sendText) {
    await sendText(sender_psid, `Provide the new mod details.\nFormat: ID, Name, Description, Price, ImageURL\n\nExample: 1, VIP Mod, Unlocks all features, 250, http://image.link/vip.png`);
    stateManager.setUserState(sender_psid, 'awaiting_add_mod');
}

async function processAddMod(sender_psid, text, sendText) {
    try {
        const [id, name, description, price, imageUrl] = text.split(',').map(p => p.trim());
        const modId = parseInt(id);
        const modPrice = parseFloat(price);
        if (isNaN(modId) || !name || isNaN(modPrice)) throw new Error("ID, Name, and Price are required and must be the correct format.");
        await db.addMod(modId, name, description, modPrice, imageUrl);
        await sendText(sender_psid, `✅ Mod ${modId} (${name}) created successfully!`);
    } catch (e) {
        await sendText(sender_psid, `❌ Could not create mod. The Mod ID might already exist or the format was wrong.\nError: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

module.exports = { showAdminMenu, handleViewReferences, promptForBulkAccounts_Step1_ModId, processBulkAccounts_Step2_GetAccounts, processBulkAccounts_Step3_SaveAccounts, promptForEditMod, processEditMod, promptForAddRef, processAddRef, promptForEditAdmin, processEditAdmin, promptForEditRef, processEditRef, promptForAddMod, processAddMod };
