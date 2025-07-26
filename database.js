// database.js (Replit Version)
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'bot_data.sqlite');
let db;

async function setupDatabase() {
    try {
        db = await open({ filename: DB_PATH, driver: sqlite3.Database });
        console.log('Connected to the SQLite database.');
        await db.exec(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT)`);
        await db.exec(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT)`);
        await db.exec(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE)`);
        await db.exec(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE)`);
        console.log('Database tables are ready.');
    } catch (error) {
        console.error('FATAL: Could not set up database:', error.message);
        throw error;
    }
}

async function getDb() { if (!db) throw new Error("Database not initialized!"); return db; }

async function isAdmin(userId) { const db = await getDb(); return await db.get('SELECT * FROM admins WHERE user_id = ?', userId); }
async function getAdminInfo() { const db = await getDb(); return await db.get('SELECT * FROM admins LIMIT 1'); }
async function updateAdminInfo(userId, gcashNumber) { const db = await getDb(); return await db.run('INSERT OR REPLACE INTO admins (user_id, gcash_number) VALUES (?, ?)', userId, gcashNumber); }
