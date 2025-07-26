// setup_database.js
const dbManager = require('./database');

async function initialize() {
    console.log("Attempting to set up database schema...");
    try {
        await dbManager.setupDatabase();
        console.log("Database setup successful!");
    } catch (e) {
        console.error("Database setup failed:", e);
        process.exit(1); // Exit with an error code if setup fails
    }
}

initialize();
