// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'singularity.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Create Users Table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        password TEXT,
        purpose TEXT,
        target_device TEXT,
        container_access TEXT, 
        role TEXT DEFAULT 'user'
    )`);

    // Create System Stats Table for Download Counts
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY,
        total_downloads INTEGER
    )`);

    // Initialize default stats if empty
    db.get("SELECT COUNT(*) AS count FROM stats", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO stats (id, total_downloads) VALUES (1, 12402)");
        }
    });

    // Insert Default Admin (Password hashed in production, plain text here for demo)
    db.run(`INSERT OR IGNORE INTO users (username, email, password, purpose, target_device, container_access, role) 
            VALUES ('admin', 'admin@hpc.system', 'admin123', 'System Administration', 'All', 'All', 'admin')`);

    // Insert Default User with specific access
    db.run(`INSERT OR IGNORE INTO users (username, email, password, purpose, target_device, container_access, role) 
            VALUES ('dr_smith_ai', 'smith@stanford.edu', 'user123', 'AI Research', 'x86_64', 'GPU-Optimized', 'user')`);
});

module.exports = db;