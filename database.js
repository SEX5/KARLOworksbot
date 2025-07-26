// database.js (Final Version using better-sqlite3 for Render compatibility)
const Database = require('better-sqlite3');
const secrets = require('./secrets.js'); // Assumes you are using secrets.js for keys

let db;

function getDb() {
    if (!db) {
        // This driver connects to Turso via a sync mechanism.
        // It creates a local temporary file that stays in sync with your cloud DB.
        db = new Database('turso_sync.db', {
            syncUrl: secrets.TURSO_DATABASE_URL,
            authToken: secrets.TURSO_AUTH_TOKEN
        });
        db.sync(); // Perform the initial sync
        console.log('Connected to and synced with Turso database via better-sqlite3.');
    }
    return db;
}

async function setupDatabase() {
    try {
        const db = getDb();
        // better-sqlite3 runs commands synchronously, so the setup is simpler and more robust.
        db.exec(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT)`);
        db.exec(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT)`);
        db.exec(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        db.exec(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        console.log('Database tables are ready on Turso.');
    } catch (error) {
        console.error('FATAL: Could not set up Turso database:', error.message);
        throw error;
    }
}

// --- Helper Functions (rewritten for better-sqlite3 synchronous syntax) ---
function isAdmin(userId) { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT * FROM admins WHERE user_id = ?'); return stmt.get(userId) || null; }
function getAdminInfo() { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT * FROM admins LIMIT 1'); return stmt.get() || null; }
function updateAdminInfo(userId, gcashNumber) { const db = getDb(); const stmt = db.prepare('INSERT OR REPLACE INTO admins (user_id, gcash_number) VALUES (?, ?)'); stmt.run(userId, gcashNumber); db.sync(); }
function getAllReferences() { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT r.ref_number, r.user_id, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id ORDER BY r.timestamp DESC'); return stmt.all(); }
function addBulkAccounts(modId, accounts) { const db = getDb(); const stmt = db.prepare('INSERT INTO accounts (mod_id, username, password) VALUES (?, ?, ?)'); db.transaction((accs) => { for (const acc of accs) stmt.run(modId, acc.username, acc.password); })(accounts); db.sync(); }
function updateModDetails(modId, details) { const db = getDb(); const fields = Object.keys(details).map(k => `${k} = ?`).join(', '); const values = Object.values(details); const stmt = db.prepare(`UPDATE mods SET ${fields} WHERE id = ?`); stmt.run([...values, modId]); db.sync(); }
function updateReferenceMod(ref, newModId) { const db = getDb(); const stmt = db.prepare('UPDATE "references" SET mod_id = ? WHERE ref_number = ?'); stmt.run(newModId, ref); db.sync(); }
function addReference(ref, userId, modId) { const db = getDb(); const stmt = db.prepare('INSERT OR REPLACE INTO "references" (ref_number, user_id, mod_id) VALUES (?, ?, ?)'); stmt.run(ref, userId, modId); db.sync(); }
function getMods() { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT m.id, m.name, m.description, m.price, m.image_url, (SELECT COUNT(*) FROM accounts WHERE mod_id = m.id AND is_available = 1) as stock FROM mods m ORDER BY m.id'); return stmt.all(); }
function getModById(modId) { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT * FROM mods WHERE id = ?'); return stmt.get(modId) || null; }
function getReference(refNumber) { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT r.*, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id WHERE r.ref_number = ?'); return stmt.get(refNumber) || null; }
function getAvailableAccount(modId) { const db = getDb(); db.sync(); const stmt = db.prepare('SELECT * FROM accounts WHERE mod_id = ? AND is_available = 1 LIMIT 1'); return stmt.get(modId) || null; }
function claimAccount(accountId) { const db = getDb(); const stmt = db.prepare('UPDATE accounts SET is_available = 0 WHERE id = ?'); stmt.run(accountId); db.sync(); }
function useClaim(refNumber) { const db = getDb(); const stmt = db.prepare('UPDATE "references" SET claims_used = claims_used + 1 WHERE ref_number = ?'); stmt.run(refNumber); db.sync(); }
function addMod(id, name, description, price, imageUrl) { const db = getDb(); const stmt = db.prepare('INSERT INTO mods (id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)'); stmt.run(id, name, description, price, imageUrl); db.sync(); }

module.exports = { setupDatabase, isAdmin, getAdminInfo, updateAdminInfo, getAllReferences, addBulkAccounts, updateModDetails, updateReferenceMod, addReference, getMods, getModById, getReference, getAvailableAccount, claimAccount, useClaim, addMod };
