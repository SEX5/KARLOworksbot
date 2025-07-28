// database.js (Complete with new function)
const { Pool } = require('pg');
const secrets = require('./secrets.js');

let pool;

function getDb() {
    if (!pool) {
        pool = new Pool({
            connectionString: secrets.NEON_DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
    }
    return pool;
}

async function setupDatabase() {
    const client = await getDb().connect();
    try {
        console.log('Connecting to Neon PostgreSQL database...');
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT)`);
        await client.query(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT)`);
        await client.query(`CREATE TABLE IF NOT EXISTS accounts (id SERIAL PRIMARY KEY, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT TRUE, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        await client.query(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        await client.query('COMMIT');
        console.log('Database tables are ready on Neon.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('FATAL: Could not set up Neon database:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function isAdmin(userId) { const res = await getDb().query('SELECT * FROM admins WHERE user_id = $1', [userId]); return res.rows[0] || null; }
async function getAdminInfo() { const res = await getDb().query('SELECT * FROM admins LIMIT 1'); return res.rows[0] || null; }
async function updateAdminInfo(userId, gcashNumber) { await getDb().query('INSERT INTO admins (user_id, gcash_number) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gcash_number = $2', [userId, gcashNumber]); }
async function getAllReferences() { const res = await getDb().query('SELECT r.ref_number, r.user_id, r.claims_used, r.claims_max, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id ORDER BY r.timestamp DESC'); return res.rows; }
async function addBulkAccounts(modId, accounts) { const client = await getDb().connect(); try { await client.query('BEGIN'); for (const acc of accounts) { await client.query('INSERT INTO accounts (mod_id, username, password) VALUES ($1, $2, $3)', [modId, acc.username, acc.password]); } await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
async function updateModDetails(modId, details) { const fields = Object.keys(details).map((k, i) => `${k} = $${i + 1}`).join(', '); const values = Object.values(details); await getDb().query(`UPDATE mods SET ${fields} WHERE id = $${values.length + 1}`, [...values, modId]); }
async function updateReferenceMod(ref, newModId) { await getDb().query('UPDATE "references" SET mod_id = $1 WHERE ref_number = $2', [newModId, ref]); }
async function addReference(ref, userId, modId) { await getDb().query('INSERT INTO "references" (ref_number, user_id, mod_id) VALUES ($1, $2, $3) ON CONFLICT (ref_number) DO NOTHING', [ref, userId, modId]); }
async function getMods() { const res = await getDb().query('SELECT m.id, m.name, m.description, m.price, m.image_url, (SELECT COUNT(*) FROM accounts WHERE mod_id = m.id AND is_available = TRUE) as stock FROM mods m ORDER BY m.id'); return res.rows; }
async function getModById(modId) { const res = await getDb().query('SELECT * FROM mods WHERE id = $1', [modId]); return res.rows[0] || null; }
async function getReference(refNumber) { const res = await getDb().query('SELECT r.*, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id WHERE r.ref_number = $1', [refNumber]); return res.rows[0] || null; }
async function getAvailableAccount(modId) { const res = await getDb().query('SELECT * FROM accounts WHERE mod_id = $1 AND is_available = TRUE LIMIT 1', [modId]); return res.rows[0] || null; }
async function claimAccount(accountId) { await getDb().query('UPDATE accounts SET is_available = FALSE WHERE id = $1', [accountId]); }
async function useClaim(refNumber) { await getDb().query('UPDATE "references" SET claims_used = claims_used + 1 WHERE ref_number = $1', [refNumber]); }
async function addMod(id, name, description, price, imageUrl) { await getDb().query('INSERT INTO mods (id, name, description, price, image_url) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO NOTHING', [id, name, description, price, imageUrl]); }
// --- NEW FUNCTION ---
async function getModsByPrice(price) { const res = await getDb().query('SELECT * FROM mods WHERE price BETWEEN $1 AND $2', [price - 0.01, price + 0.01]); return res.rows; }

module.exports = { setupDatabase, isAdmin, getAdminInfo, updateAdminInfo, getAllReferences, addBulkAccounts, updateModDetails, updateReferenceMod, addReference, getMods, getModById, getReference, getAvailableAccount, claimAccount, useClaim, addMod, getModsByPrice };
