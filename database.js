// database.js
const { Pool } = require('pg');
const secrets = require('./secrets.js'); // This line reads your secrets.js file

let pool;

function getDb() {
    if (!pool) {
        // This debug line will tell us if the secrets.js file is being read correctly.
        console.log("DEBUG: The URL my code is trying to use is:", secrets.DATABASE_URL);

        // This check will stop the app if the URL is missing from secrets.js
        if (!secrets.DATABASE_URL) {
            console.error("FATAL ERROR: DATABASE_URL is not found in secrets.js! The file might be missing or has a syntax error.");
            process.exit(1); // Stop the application
        }

        pool = new Pool({
            connectionString: secrets.DATABASE_URL,
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
        console.log('Connecting to Supabase PostgreSQL database...');
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT, is_online BOOLEAN DEFAULT FALSE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT, default_claims_max INTEGER DEFAULT 3, x_coordinate REAL, y_coordinate REAL)`);
        await client.query(`CREATE TABLE IF NOT EXISTS accounts (id SERIAL PRIMARY KEY, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT TRUE, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        // FIXED TYPO HERE: TIMESTPTZ -> TIMESTAMPTZ
        await client.query(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        // FIXED TYPO HERE: TIMESTPTZ -> TIMESTAMPTZ
        await client.query(`CREATE TABLE IF NOT EXISTS creation_jobs ( job_id SERIAL PRIMARY KEY, user_psid TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, mod_id INTEGER NOT NULL, status VARCHAR(20) DEFAULT 'pending', result_message TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP )`);
        await client.query('COMMIT');
        console.log('Database tables are ready on Supabase.');
        try { await client.query('ALTER TABLE admins ADD COLUMN is_online BOOLEAN DEFAULT FALSE'); console.log('Verified "is_online" column in admins table.'); } catch (e) { if (e.code !== '42701') { throw e; } }
        try { await client.query('ALTER TABLE mods ADD COLUMN x_coordinate REAL'); await client.query('ALTER TABLE mods ADD COLUMN y_coordinate REAL'); console.log('Verified coordinate columns in mods table.'); } catch (e) { if (e.code !== '42701') { throw e; } }
    } catch (error) { await client.query('ROLLBACK'); console.error('FATAL: Could not set up Supabase database:', error.message); throw error; } finally { client.release(); }
}
async function getActionableJobs() { const query = `SELECT * FROM creation_jobs WHERE status = 'completed' OR status = 'failed'`; const res = await getDb().query(query); return res.rows; }
async function updateJobStatus(jobId, newStatus) { const query = `UPDATE creation_jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE job_id = $2`; await getDb().query(query, [newStatus, jobId]); }
async function getStalePendingJobs(minutes = 20) { const query = ` SELECT job_id FROM creation_jobs WHERE status = 'pending' AND created_at < NOW() - INTERVAL '${minutes} minutes' `; const res = await getDb().query(query); return res.rows; }
async function deleteReference(refNumber) { const res = await getDb().query('DELETE FROM "references" WHERE ref_number = $1', [refNumber]); return res.rowCount; }
async function setAdminOnlineStatus(isOnline) { await getDb().query('UPDATE admins SET is_online = $1', [isOnline]); }
async function createAccountCreationJob(user_psid, email, password, modId) { const query = 'INSERT INTO creation_jobs (user_psid, email, password, mod_id) VALUES ($1, $2, $3, $4) RETURNING job_id'; const res = await getDb().query(query, [user_psid, email, password, modId]); return res.rows[0].job_id; }
async function getCreationJobs() { const query = 'SELECT job_id, user_psid, status, result_message FROM creation_jobs ORDER BY created_at DESC LIMIT 15'; const res = await getDb().query(query); return res.rows; }
async function isAdmin(userId) { const res = await getDb().query('SELECT * FROM admins WHERE user_id = $1', [userId]); return res.rows[0] || null; }
async function getAdminInfo() { const res = await getDb().query('SELECT * FROM admins LIMIT 1'); return res.rows[0] || null; }
async function updateAdminInfo(userId, gcashNumber) { await getDb().query('INSERT INTO admins (user_id, gcash_number) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gcash_number = $2', [userId, gcashNumber]); }
async function getAllReferences() { const res = await getDb().query('SELECT r.ref_number, r.user_id, r.claims_used, r.claims_max, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id ORDER BY r.timestamp DESC'); return res.rows; }
async function addBulkAccounts(modId, accounts) { const client = await getDb().connect(); try { await client.query('BEGIN'); for (const acc of accounts) { await client.query('INSERT INTO accounts (mod_id, username, password) VALUES ($1, $2, $3)', [modId, acc.username, acc.password]); } await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
async function updateModDetails(modId, details) { const fields = Object.keys(details).map((k, i) => `${k} = $${i + 1}`).join(', '); const values = Object.values(details); await getDb().query(`UPDATE mods SET ${fields} WHERE id = $${values.length + 1}`, [...values, modId]); }
async function updateReferenceMod(ref, newModId) { await getDb().query('UPDATE "references" SET mod_id = $1 WHERE ref_number = $2', [newModId, ref]); }
async function addReference(ref, userId = 'ADMIN_ADDED', modId) { const mod = await getModById(modId); if (!mod) { throw new Error(`Mod with ID ${modId} not found when trying to add reference.`); } const claimsMax = mod.default_claims_max || 1;  const res = await getDb().query('INSERT INTO "references" (ref_number, user_id, mod_id, claims_max) VALUES ($1, $2, $3, $4) ON CONFLICT (ref_number) DO NOTHING', [ref, userId, modId, claimsMax]); if (res.rowCount === 0) { throw new Error('Duplicate reference number'); } return claimsMax; }
async function getMods() { const res = await getDb().query('SELECT m.id, m.name, m.description, m.price, m.image_url, m.default_claims_max, (SELECT COUNT(*) FROM accounts WHERE mod_id = m.id AND is_available = TRUE) as stock FROM mods m ORDER BY m.id'); return res.rows; }
async function getModById(modId) { const res = await getDb().query('SELECT * FROM mods WHERE id = $1', [modId]); return res.rows[0] || null; }
async function getReference(refNumber) { const res = await getDb().query('SELECT r.*, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id WHERE r.ref_number = $1', [refNumber]); return res.rows[0] || null; }
async function getAvailableAccount(modId) { const res = await getDb().query('SELECT * FROM accounts WHERE mod_id = $1 AND is_available = TRUE LIMIT 1', [modId]); return res.rows[0] || null; }
async function claimAccount(accountId) { await getDb().query('UPDATE accounts SET is_available = FALSE WHERE id = $1', [accountId]); }
async function useClaim(refNumber) { await getDb().query('UPDATE "references" SET claims_used = claims_used + 1 WHERE ref_number = $1', [refNumber]); }
async function addMod(id, name, description, price, imageUrl, defaultClaimsMax) { await getDb().query('INSERT INTO mods (id, name, description, price, image_url, default_claims_max) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO NOTHING', [id, name, description, price, imageUrl, defaultClaimsMax]); }
async function getModsByPrice(price) { const res = await getDb().query('SELECT * FROM mods WHERE price BETWEEN $1 AND $2', [price - 0.01, price + 0.01]); return res.rows; }

async function addBulkReferences(modId, refNumbers) {
    const client = await getDb().connect();
    const mod = await getModById(modId); // Reuse existing function to get mod details
    if (!mod) {
        throw new Error(`Mod with ID ${modId} not found.`);
    }
    const claimsMax = mod.default_claims_max || 1;
    let successfulAdds = 0;
    const duplicates = [];
    const invalids = [];

    try {
        await client.query('BEGIN');
        for (const ref of refNumbers) {
            // Validate that the reference number is exactly 13 digits
            if (!/^\d{13}$/.test(ref)) {
                invalids.push(ref);
                continue; // Skip invalid format
            }
            const res = await client.query(
                'INSERT INTO "references" (ref_number, user_id, mod_id, claims_max) VALUES ($1, $2, $3, $4) ON CONFLICT (ref_number) DO NOTHING',
                [ref, 'ADMIN_ADDED', modId, claimsMax]
            );
            if (res.rowCount > 0) {
                successfulAdds++;
            } else {
                duplicates.push(ref);
            }
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    return { successfulAdds, duplicates, invalids };
}

module.exports = { setupDatabase, getActionableJobs, updateJobStatus, getStalePendingJobs, deleteReference, setAdminOnlineStatus, createAccountCreationJob, getCreationJobs, isAdmin, getAdminInfo, updateAdminInfo, getAllReferences, addBulkAccounts, updateModDetails, updateReferenceMod, addReference, getMods, getModById, getReference, getAvailableAccount, claimAccount, useClaim, addMod, getModsByPrice, addBulkReferences };
