// admin_handler.js (Complete & Final with "Edit Name" feature)
const db = require('./database');
const stateManager = require('./state_manager');

const REFERENCES_PER_PAGE = 10; // You can adjust this number

async function showAdminMenu(sender_psid, sendText) {
    const menu = `Admin Menu:\nType 1: View reference numbers\nType 2: Add bulk accounts\nType 3: Edit mod details\nType 4: Add a reference number\nType 5: Edit admin info\nType 6: Edit reference numbers\nType 7: Add a new mod`;
    await sendText(sender_psid, menu);
    stateManager.clearUserState(sender_psid);
}

// --- Type 1 ---
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
    refsToShow.forEach(r => { response += `Ref: ${r.ref_number}\nMod: ${r.mod_name}\nUser: ${r.user_id}\nClaims: ${r.claims_used}/${r.claims_max}\n\n`; });
    response += `--- Options ---\n`;
    if (page < totalPages) response += `Type '1' for Next Page\n`;
    if (page > 1) response += `Type '2' for Previous Page\n`;
    response += `Type 'Menu' to return to the main menu.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'viewing_references', { page: page });
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
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
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
        if (accounts.length === 0) throw new Error("No valid accounts were found in your message. Please check the format (username:password).");
        await db.addBulkAccounts(modId, accounts);
        await sendText(sender_psid, `✅ ${accounts.length} accounts were successfully added to Mod ${modId}.`);
    } catch (e) {
        await sendText(sender_psid, `❌ An error occurred: ${e.message}`);
    } finally {
        stateManager.clearUserState(sender_psid);
    }
}

// --- UPDATED "Type 3" ---
async function promptForEditMod_Step1_ModId(sender_psid, sendText) {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods to edit. Please add a mod first using 'Type 7'.");
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
    if (isNaN(modId) || !mod) {
        await sendText(sender_psid, "Invalid Mod ID. Please try again or type 'Menu' to cancel.");
        return;
    }
    const response = `Editing Mod ${mod.id} (${mod.name}).\n\nCurrent Details:\n- Name: ${mod.name}\n- Description: ${mod.description}\n- Price: ${mod.price}\n- Image: ${mod.image_url}\n\nWhat would you like to change? Reply with 'name', 'description', 'price', or 'image'.`;
    await sendText(sender_psid, response);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId });
}

async function processEditMod_Step3_AskValue(sender_psid, text, sendText) {
    const detailToChange = text.trim().toLowerCase();
    const { modId } = stateManager.getUserState(sender_psid);
    if (!['name', 'description', 'price', 'image'].includes(detailToChange)) {
        await sendText(sender_psid, "Invalid choice. Please reply with 'name', 'description', 'price', or 'image'.");
        return;
    }
    await sendText(sender_psid, `What is the new ${detailToChange} for Mod ${modId}?`);
    stateManager.setUserState(sender_psid, 'awaiting_edit_mod_new_value', { modId, detailToChange });
}

async function processEditMod_Step4_SaveValue(sender_psid, text, sendText) {
    const newValue = text.trim();
    const { modId, detailToChange } = stateManager.getUserState(sender_psid);
    const detailsToUpdate = {};
    const fieldName = detailToChange === 'image' ? 'image_url' : detailToChange;
    
    if (detailToChange === 'price' && isNaN(parseFloat(newValue))) {
        await sendText(sender_psid, "Invalid price. Please enter a number.");
        stateManager.setUserState(sender_psid, 'awaiting_edit_mod_new_value', { modId, detailToChange });
        return;
    }
    
    detailsToUpdate[fieldName] = detailToChange === 'price' ? parseFloat(newValue) : newValue;

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
        const response = `What else would you like to change for Mod ${mod.id}?\nReply with 'name', 'description', 'price', or 'image'.`;
        await sendText(sender_psid, response);
        stateManager.setUserState(sender_psid, 'awaiting_edit_mod_detail_choice', { modId });
    } else {
        await sendText(sender_psid, "Finished editing Mod. Returning to the admin menu.");
        await showAdminMenu(sender_psid, sendText);
    }
}

// --- Type 4 ---
async function promptForAddRef_Step1_GetRef(sender_psid, sendText) {
    await sendText(sender_psid, "Please provide the 13-digit GCash reference number you want to add.");
    stateManager.setUserState(sender_psid, 'awaiting_add_ref_number');
}

async function processAddRef_Step2_GetMod(sender_psid, text, sendText) {
    const refNumber = text.trim();
    if (!/^\d{13}$/.test(refNumber)) {
        await sendText(sender_psid, "Invalid reference number format. Please try again or type 'Menu' to cancel.");
        return;
    }
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        await sendText(sender_psid, "❌ There are no mods in the system. Please add a mod first using 'Type 7'.");
        stateManager.clearUserState(sender_psid);
        return;
    }
    let availableMods = "Reference number accepted. Now, choose the mod for this reference:\n\n";
    mods.forEach(mod => { availableMods += `- ID: ${mod.id}, Name: ${mod.name}\n`; });
    await sendText(sender_psid, availableMods);
    stateManager.setUserState(sender_psid, 'awaiting_add_ref_mod_id', { refNumber });
}

async function processAddRef_Step3_Save(sender_psid, text, sendText) {
    const modId = parseInt(text.trim());
    const { refNumber } = stateManager.getUserState(sender_psid);
    if (isNaN(modId) || !(await db.getModById(modId))) {
        await sendText(sender_psid, "Invalid Mod ID. Please type a valid number from the list.");
        return;
    }
    try {
        await db.addReference(refNumber, 'ADMIN_ADDED', modId, 3);
        await sendText(sender_psid, `✅ Reference ${refNumber} has been successfully added to Mod ${modId} with 3 replacement claims.`);
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

module.exports = {
    showAdminMenu,
    handleViewReferences,
    promptForBulkAccounts_Step1_ModId,
    processBulkAccounts_Step2_GetAccounts,
    processBulkAccounts_Step3_SaveAccounts,
    promptForEditMod_Step1_ModId,
    processEditMod_Step2_AskDetail,
    processEditMod_Step3_AskValue,
    processEditMod_Step4_SaveValue,
    processEditMod_Step5_Continue,
    promptForAddRef_Step1_GetRef,
    processAddRef_Step2_GetMod,
    processAddRef_Step3_Save,
    promptForEditAdmin,
    processEditAdmin,
    promptForEditRef,
    processEditRef,
    promptForAddMod,
    processAddMod
};
