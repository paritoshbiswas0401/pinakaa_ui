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
        name TEXT,
        email TEXT,
        password TEXT,
        purpose TEXT,
        target_device TEXT,
        container_access TEXT, 
        role TEXT DEFAULT 'user',
        organization TEXT,
        status TEXT DEFAULT 'active',
        last_download DATETIME
    )`);

    // Add columns if they don't exist (for existing databases)
    db.run(`ALTER TABLE users ADD COLUMN name TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding name column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN organization TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding organization column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding status column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN last_download DATETIME`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding last_download column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN product_name TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding product_name column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN team_name TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding team_name column:', err);
        }
    });
    db.run(`ALTER TABLE users ADD COLUMN prerequisites TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding prerequisites column:', err);
        }
    });
    db.run(`UPDATE users SET status = 'active' WHERE status IS NULL`, (err) => {
        if (err) console.error('Error updating user status defaults:', err);
    });

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
    db.run(`INSERT OR IGNORE INTO users (username, email, password, purpose, target_device, container_access, role, organization) 
            VALUES ('admin', 'admin@hpc.system', 'admin123', 'System Administration', 'All', 'All', 'admin', 'HPC Systems')`);

    // Insert Default User with specific access
    db.run(`INSERT OR IGNORE INTO users (username, email, password, purpose, target_device, container_access, role, organization) 
            VALUES ('dr_smith_ai', 'smith@stanford.edu', 'user123', 'AI Research', 'x86_64', 'GPU-Optimized', 'user', 'Stanford University')`);
});

module.exports = db;