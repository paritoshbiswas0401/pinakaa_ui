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
        last_download DATETIME,
        product_name TEXT,
        team_name TEXT
    )`);

    const migrateUsersSource = (sourceTable, callback) => {
        db.all(`PRAGMA table_info(${sourceTable})`, (schemaErr, columns) => {
            if (schemaErr) {
                console.error(`Unable to inspect ${sourceTable} schema:`, schemaErr);
                return callback && callback(schemaErr);
            }

            const keepColumns = (columns || []).filter((col) => col.name !== 'prerequisites');
            const columnList = keepColumns.map((col) => `"${col.name}"`).join(', ');
            const columnDefinitions = keepColumns.map((col) => {
                let colDef = `"${col.name}" ${col.type || 'TEXT'}`;
                if (col.pk === 1) {
                    if (col.type && col.type.toUpperCase() === 'INTEGER') {
                        colDef = `"${col.name}" INTEGER PRIMARY KEY AUTOINCREMENT`;
                    } else {
                        colDef += ' PRIMARY KEY';
                    }
                }
                if (col.notnull === 1) {
                    colDef += ' NOT NULL';
                }
                if (col.dflt_value !== null) {
                    colDef += ` DEFAULT ${col.dflt_value}`;
                }
                return colDef;
            }).join(', ');

            db.run('DROP TABLE IF EXISTS users', (dropErr) => {
                if (dropErr) {
                    console.error('Unable to drop temporary users table:', dropErr);
                    return callback && callback(dropErr);
                }

                db.run(`CREATE TABLE users (${columnDefinitions})`, (createErr) => {
                    if (createErr) {
                        console.error('Unable to create restored users table:', createErr);
                        return callback && callback(createErr);
                    }

                    db.run(`INSERT INTO users (${columnList}) SELECT ${columnList} FROM ${sourceTable}`, (insertErr) => {
                        if (insertErr) {
                            console.error('Unable to migrate users data after prerequisites removal:', insertErr);
                            return callback && callback(insertErr);
                        }

                        db.run(`DROP TABLE IF EXISTS ${sourceTable}`, (dropOldErr) => {
                            if (dropOldErr) {
                                console.error(`Unable to drop old ${sourceTable} table after migration:`, dropOldErr);
                                return callback && callback(dropOldErr);
                            }
                            console.log(`Successfully restored users table from ${sourceTable}.`);
                            return callback && callback(null);
                        });
                    });
                });
            });
        });
    };

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users_old'", (oldErr, oldRow) => {
        if (oldErr) {
            console.error('Unable to check for users_old table:', oldErr);
            return;
        }

        if (oldRow) {
            db.get('SELECT count(*) AS cnt FROM users', (countErr, countRow) => {
                if (countErr) {
                    console.error('Unable to count users rows:', countErr);
                    return;
                }

                const shouldRestore = (countRow && countRow.cnt === 0);
                if (!shouldRestore && countRow && countRow.cnt === 1) {
                    db.get('SELECT username, email, password FROM users LIMIT 1', (userErr, userRow) => {
                        if (userErr) {
                            console.error('Unable to inspect users table row:', userErr);
                            return;
                        }
                        if (userRow && userRow.username === 'admin' && userRow.email === 'admin@hpc.system' && userRow.password === 'admin123') {
                            migrateUsersSource('users_old', () => {
                                // nothing additional required here
                            });
                        } else {
                            console.warn('users_old table exists and users table already contains data; skipping restore.');
                        }
                    });
                    return;
                }

                if (!shouldRestore) {
                    console.warn('users_old table exists and users table already contains data; skipping restore.');
                    return;
                }

                migrateUsersSource('users_old', () => {
                    // nothing additional required here
                });
            });
            return;
        }

        db.all(`PRAGMA table_info(users)`, (schemaErr, columns) => {
            if (schemaErr) {
                console.error('Unable to inspect users table schema:', schemaErr);
                return;
            }

            const hasPrerequisites = (columns || []).some((col) => col.name === 'prerequisites');
            if (!hasPrerequisites) return;

            db.run('ALTER TABLE users RENAME TO users_old', (renameErr) => {
                if (renameErr) {
                    console.error('Unable to rename users table for prerequisites removal:', renameErr);
                    return;
                }

                migrateUsersSource('users_old', () => {
                    // nothing additional required here
                });
            });
        });
    });

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
            db.run("INSERT INTO stats (id, total_downloads) VALUES (1, 0)");
        }
    });

    // Create Containers Table for Per-Container Download Tracking
    db.run(`CREATE TABLE IF NOT EXISTS containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        title TEXT,
        version TEXT,
        arch TEXT,
        access TEXT,
        description TEXT,
        purpose TEXT,
        size TEXT,
        estimate TEXT,
        download_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create Download History Table for Admin Analytics
    db.run(`CREATE TABLE IF NOT EXISTS download_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        container_filename TEXT NOT NULL,
        container_title TEXT,
        download_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Insert Default Admin (Password hashed in production, plain text here for demo)
    // db.run(`INSERT OR IGNORE INTO users (username, email, password, purpose, target_device, container_access, role, organization) 
    //         VALUES ('admin', 'admin@hpc.system', 'admin123', 'System Administration', 'All', 'All', 'admin', 'HPC Systems')`);

});

module.exports = db;