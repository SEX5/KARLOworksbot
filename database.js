// database.js
const { createClient } = require("@libsql/client");
const secrets = require('./secrets.js');
let db;

function getDb() {
    if (!db) {
        db = createClient({
            url: secrets.TURSO_DATABASE_URL,
            authToken: secrets.TURSO_AUTH_TOKEN,
        });
        console.log('Database client created for Turso.');
    }
    return db;
}

async function setupDatabase() {
    try {
        const db = getDb();
        console.log('Running schema setup...');
        const tx = await db.transaction("write");
        try {
            await tx.execute(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT)`);
            await tx.execute(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT)`);
            await tx.execute(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
            await tx.execute(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }
        console.log('Database tables are ready on Turso.');
    } catch (error) {
        console.error('FATAL: Could not set up Turso database:', error.message);
        throw error;
    }
}

async function isAdmin(userId) { const db = getDb(); const rs = await db.execute({ sql: "SELECT * FROM admins WHERE user_id = ?", args: [userId] }); return rs.rows[0] || null; }
async function getAdminInfo() { const db = getDb(); const rs = await db.execute("SELECT * FROM admins LIMIT 1"); return rs.rows[0] || null; }
async function updateAdminInfo(userId, gcashNumber) { const db = getDb(); return await db.execute({ sql: "INSERT OR REPLACE INTO admins (user_id, gcash_number) VALUES (?, ?)", args: [userId, gcashNumber] }); }
async function getAllReferences() { const db = getDb(); const rs = await db.execute(`SELECT r.ref_number, r.user_id, r.claims_used, r.claims_max, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id ORDER BY r.timestamp DESC`); return rs.rows; }
async function addBulkAccounts(modId, accounts) { const db = getDb(); const queries = accounts.map(acc => ({ sql: "INSERT INTO accounts (mod_id, username, password) VALUES (?, ?, ?)", args: [modId, acc.username, acc.password] })); await db.batch(queries); }
async function updateModDetails(modId, details) { const db = getDb(); const fields = Object.keys(details).map(k => `${k} = ?`).join(', '); const values = Object.values(details); return await db.execute({ sql: `UPDATE mods SET ${fields} WHERE id = ?`, args: [...values, modId] }); }
async function updateReferenceMod(ref, newModId) { const db = getDb(); return await db.execute({ sql: 'UPDATE "references" SET mod_id = ? WHERE ref_number = ?', args: [newModId, ref] }); }
async function addReference(ref, userId, modId) { const db = getDb(); return await db.execute({ sql: 'INSERT OR REPLACE INTO "references" (ref_number, user_id, mod_id) VALUES (?, ?, ?)', args: [ref, userId, modId] }); }
async function getMods() { const db = getDb(); const rs = await db.execute(`SELECT m.id, m.name, m.description, m.price, m.image_url, (SELECT COUNT(*) FROM accounts WHERE mod_id = m.id AND is_available = 1) as stock FROM mods m ORDER BY m.id`); return rs.rows; }
async function getModById(modId) { const db = getDb(); const rs = await db.execute({ sql: "SELECT * FROM mods WHERE id = ?", args: [modId] }); return rs.rows[0] || null; }
async function getReference(refNumber) { const db = getDb(); const rs = await db.execute({ sql: `SELECT r.*, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id WHERE r.ref_number = ?`, args: [refNumber] }); return rs.rows[0] || null; }
async function getAvailableAccount(modId) { const db = getDb(); const rs = await db.execute({ sql: "SELECT * FROM accounts WHERE mod_id = ? AND is_available = 1 LIMIT 1", args: [modId] }); return rs.rows[0] || null; }
async function claimAccount(accountId) { const db = getDb(); await db.execute({ sql: "UPDATE accounts SET is_available = 0 WHERE id = ?", args: [accountId] }); }
async function useClaim(refNumber) { const db = getDb(); await db.execute({ sql: 'UPDATE "references" SET claims_used = claims_used + 1 WHERE ref_number = ?', args: [refNumber] }); }
async function addMod(id, name, description, price, imageUrl) { const db = getDb(); return await db.execute({ sql: 'INSERT INTO mods (id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)', args: [id, name, description, price, imageUrl] }); }

module.exports = { setupDatabase, getDb, isAdmin, getAdminInfo, updateAdminInfo, getAllReferences, addBulkAccounts, updateModDetails, updateReferenceMod, addReference, getMods, getModById, getReference, getAvailableAccount, claimAccount, useClaim, addMod };
