// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const svgCaptcha = require('svg-captcha');
const db = require('./db');

const app = express();
const PORT = 3000;
const requestRecipient = process.env.REQUEST_EMAIL || 'pinakaa@cdac.in';
const emailFromAddress = process.env.EMAIL_FROM || 'PINAKAA Studio <pinakaa@cdac.in>';
const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD || 'Welcome123';

const transportOptions = process.env.EMAIL_HOST ? {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: process.env.EMAIL_USER ? {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    } : undefined,
    tls: {
        rejectUnauthorized: false
    }
} : process.platform !== 'win32' ? {
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
} : {
    jsonTransport: true
};
const mailer = nodemailer.createTransport(transportOptions);

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
// Serve images placed in views/assets (e.g., pinakaa_logo.jpg)
app.use('/assets', express.static(path.join(__dirname, 'views', 'assets')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'supercomputing-mission-secret',
    resave: false,
    saveUninitialized: true
}));

const baseViewModel = (req) => ({
    username: req.session.username,
    role: req.session.role || null
});

function createLoginCaptcha(req) {
    const captcha = svgCaptcha.create({
        size: 5,
        noise: 2,
        ignoreChars: '0o1il',
        color: true,
        background: '#f8fafc'
    });
    req.session.captcha = captcha.text;
    return captcha.data;
}

function sendMailInBackground(mailOptions, description) {
    try {
        mailer.sendMail(mailOptions, (mailErr, info) => {
            if (mailErr) {
                console.error('Background mail send error:', description, mailErr);
                return;
            }
            console.log('Background mail sent:', description, info && (info.response || info.messageId));
        });
    } catch (err) {
        console.error('Background mail send threw an error:', description, err);
    }
}

// --- ROUTES ---

// 1. Home Page
app.get('/', (req, res) => {
    db.get("SELECT total_downloads FROM stats WHERE id = 1", (err, row) => {
        res.render('home', { downloads: row ? row.total_downloads : 0, ...baseViewModel(req) });
    });
});

// 2. Login Page
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect(req.session.role === 'admin' ? '/admin' : '/download');
    }
    const captchaSvg = createLoginCaptcha(req);
    res.render('login', { error: null, captcha: captchaSvg, ...baseViewModel(req) });
});

app.post('/login', (req, res) => {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    const captcha = (req.body.captcha || '').trim();
    const storedCaptcha = (req.session.captcha || '').trim().toUpperCase();

    if (!username || !password || !captcha) {
        const captchaSvg = createLoginCaptcha(req);
        return res.render('login', { error: 'Username, password, and captcha are required.', captcha: captchaSvg, ...baseViewModel(req) });
    }

    if (captcha.toUpperCase() !== storedCaptcha || !storedCaptcha) {
        const captchaSvg = createLoginCaptcha(req);
        return res.render('login', { error: 'Invalid captcha code.', captcha: captchaSvg, ...baseViewModel(req) });
    }

    req.session.captcha = null;

    db.get("SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ? AND status = 'active'", [username, username, password], (err, user) => {
        if (err) {
            const captchaSvg = createLoginCaptcha(req);
            return res.render('login', { error: 'Internal error during login. Please try again.', captcha: captchaSvg, ...baseViewModel(req) });
        }
        if (user) {
            req.session.userId = user.id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.access = user.container_access;
            req.session.purpose = user.purpose;
            req.session.targetDevice = user.target_device;

            if (user.role === 'admin') {
                return res.redirect('/admin');
            }
            return res.redirect('/download');
        }

        const captchaSvg = createLoginCaptcha(req);
        return res.render('login', { error: 'Invalid credentials. Please check your username and password.', captcha: captchaSvg, ...baseViewModel(req) });
    });
});

// 3. Admin Dashboard (User Management)
app.get('/admin', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/login');

    db.all("SELECT * FROM users WHERE status = 'active' AND role != 'admin'", (err, users) => {
        if (err) return res.redirect('/login');

        db.all("SELECT * FROM users WHERE status = 'pending'", (err2, pendingRequests) => {
            if (err2) return res.redirect('/login');

            res.render('admin', {
                users: users,
                pendingRequests: pendingRequests,
                adminName: req.session.username,
                message: req.query.message || null,
                ...baseViewModel(req)
            });
        });
    });
});

// 3.1 Add User
app.post('/admin/add-user', (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: "Unauthorized" });

    const { username, email, password, purpose, 'container-access': containerAccess, arch, organization } = req.body;
    if (!username || !email || !password || !purpose || !containerAccess || !arch || !organization) {
        return res.status(400).json({ error: 'Please fill in all required fields.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    db.run(`INSERT INTO users (username, email, password, purpose, target_device, container_access, role, organization) 
            VALUES (?, ?, ?, ?, ?, ?, 'user', ?)`, [username, email, password, purpose, arch, containerAccess, organization], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/admin/request/:action', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/login');

    const action = req.params.action;
    const validActions = ['approve', 'reject'];
    const { id, rejection_reason: rejectionReasonRaw } = req.body;
    const rejectionReason = (rejectionReasonRaw || '').trim();

    if (!validActions.includes(action) || !id) {
        return res.redirect('/admin?message=' + encodeURIComponent('Invalid request action or missing request id.'));
    }

    // Fetch user details to get email and other info
    db.get("SELECT * FROM users WHERE id = ? AND status = 'pending'", [id], (err, user) => {
        if (err || !user) {
            return res.redirect('/admin?message=' + encodeURIComponent('Request not found or already processed.'));
        }

        const newStatus = action === 'approve' ? 'active' : 'rejected';
        const updateQuery = action === 'reject'
            ? "UPDATE users SET status = ?, rejection_reason = ? WHERE id = ? AND status = 'pending'"
            : "UPDATE users SET status = ? WHERE id = ? AND status = 'pending'";
        const updateParams = action === 'reject'
            ? [newStatus, rejectionReason || null, id]
            : [newStatus, id];

        db.run(updateQuery, updateParams, function(updateErr) {
            if (updateErr) {
                return res.redirect('/admin?message=' + encodeURIComponent('Unable to update request status.'));
            }

            if (this.changes === 0) {
                return res.redirect('/admin?message=' + encodeURIComponent('Request not found or already processed.'));
            }

            // Send email to user about approval/rejection
            let subject, textContent, htmlContent;
            
            if (action === 'approve') {
                subject = 'Your PINAKAA Studio Login Request - Approved';
                textContent = `Dear ${user.name},\n\nGood news! Your login request to PINAKAA Studio has been approved.\n\nYour login credentials are:\nUsername: ${user.username}\nPassword: ${defaultUserPassword}\n\nPlease change your password after your first login for security purposes.\n\nBest regards,\nPINAKAA Admin Team`;
                htmlContent = `<p>Dear ${user.name},</p>
                              <p>Good news! Your login request to PINAKAA Studio has been <strong>approved</strong>.</p>
                              <p><strong>Your login credentials are:</strong></p>
                              <ul>
                                <li><strong>Username:</strong> ${user.username}</li>
                                <li><strong>Password:</strong> ${defaultUserPassword}</li>
                              </ul>
                              <p style="color: #E84E1B; font-weight: bold;">Please change your password after your first login for security purposes.</p>
                              <p>Best regards,<br/>PINAKAA Admin Team</p>`;
            } else {
                const reasonText = rejectionReason ? `Reason: ${rejectionReason}\n\n` : '';
                const reasonHtml = rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : '';

                subject = 'Your PINAKAA Studio Login Request - Rejected';
                textContent = `Dear ${user.name},\n\nWe regret to inform you that your login request to PINAKAA Studio has been rejected.\n\n${reasonText}If you believe this is an error or have questions, please contact support at ${requestRecipient}.\n\nBest regards,\nPINAKAA Admin Team`;
                htmlContent = `<p>Dear ${user.name},</p>
                              <p>We regret to inform you that your login request to PINAKAA Studio has been <strong>rejected</strong>.</p>
                              ${reasonHtml}
                              <p>If you believe this is an error or have questions, please contact support at <a href="mailto:${requestRecipient}">${requestRecipient}</a>.</p>
                              <p>Best regards,<br/>PINAKAA Admin Team</p>`;
            }

            const mailOptions = {
                from: emailFromAddress,
                to: user.email,
                subject: subject,
                text: textContent,
                html: htmlContent
            };

            const successMessage = action === 'approve' ? 'Request approved and email sent to user.' : 'Request rejected and email sent to user.';
            res.redirect('/admin?message=' + encodeURIComponent(successMessage));
            sendMailInBackground(mailOptions, `admin request ${action} for user ${user.email}`);
        });
    });
});

app.post('/admin/user/delete', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/login');

    const { id } = req.body;
    if (!id) {
        return res.redirect('/admin?message=' + encodeURIComponent('Missing user id.'));
    }

    db.run("DELETE FROM users WHERE id = ? AND role != 'admin'", [id], function(err) {
        if (err) {
            return res.redirect('/admin?message=' + encodeURIComponent('Unable to delete the user.'));
        }

        if (this.changes === 0) {
            return res.redirect('/admin?message=' + encodeURIComponent('User not found or cannot be deleted.'));
        }

        return res.redirect('/admin?message=' + encodeURIComponent('User deleted successfully.'));
    });
});

// --- Remote container fetch via SSH ---
const { Client } = require('ssh2');

const sshConfig = {
    host: '10.180.192.122',
    port: parseInt(process.env.REMOTE_PORT, 10) || 22,
    username: 'development',
    password: 'deveop@@123',
    remotePath: '/home/development/pinakaa_cpu_containers'
};

function humanSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    let n = Number(bytes);
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 2 : 1)} ${units[i]}`;
}

function fetchRemoteContainers() {
    const conn = new Client();
    const host = sshConfig.host;
    const port = sshConfig.port;
    const username = sshConfig.username;
    const password = sshConfig.password;
    const remotePath = sshConfig.remotePath;

    return new Promise((resolve, reject) => {
        const results = [];
        let stdout = '';
        conn.on('ready', () => {
            // Use a robust shell command to output filename|size
            const cmd = `for f in ${remotePath}/*.sif; do if [ -f \"$f\" ]; then echo "$(basename \"$f\")|$(stat -c %s \"$f\")"; fi; done`;
            conn.exec(cmd, (err, stream) => {
                if (err) { conn.end(); return reject(err); }
                stream.on('data', (data) => { stdout += data.toString(); });
                stream.stderr.on('data', (data) => { /* ignore stderr */ });
                stream.on('close', () => {
                    conn.end();
                    const lines = stdout.split(/\r?\n/).filter(Boolean);
                    for (const line of lines) {
                        const parts = line.split('|');
                        if (parts.length >= 2) {
                            const filename = parts[0].trim();
                            const size = parseInt(parts[1], 10) || 0;
                            const baseName = filename.replace(/\.sif$/i, '');
                            const chunks = baseName.split('-');
                            const version = chunks.length > 1 ? chunks[chunks.length - 1] : '';
                            const type = chunks.length > 1 ? chunks[1] : '';
                            const vendorArch = chunks.length > 2 ? chunks[2] : '';
                            results.push({
                                filename,
                                title: baseName,
                                description: `Remote container ${filename}`,
                                access: type || 'CPU/GPU',
                                arch: vendorArch || 'unknown',
                                purpose: 'Remote',
                                downloads: '-',
                                estimate: '-',
                                size: humanSize(size),
                                version,
                                remote: true
                            });
                        }
                    }
                    resolve(results);
                });
            });
        }).on('error', (e) => reject(e)).connect({ host, port, username, password, readyTimeout: 10000 });
    });
}

// 4. Download Centre
app.get('/download', async (req, res) => {
    let containers = [];
    let personalized = false;
    let warningMessage = null;

    if (req.session.role === 'Product Owner') {
        warningMessage = 'Product Owner role cannot download containers. Deployment Team role is required to access container downloads.';
        return res.render('download', {
            access: req.session.access,
            containers: [],
            personalized: false,
            warningMessage,
            headerLabel: 'All Available Containers:',
            ...baseViewModel(req)
        });
    }

    try {
        const remote = await fetchRemoteContainers();
        containers = (remote || []).map((container) => ({
            ...container,
            access: container.access || 'CPU/GPU',
            purpose: container.purpose || 'Remote',
            downloads: container.downloads || '-',
            estimate: container.estimate || '-',
            size: container.size || '-',
        }));
    } catch (err) {
        console.error('Remote container fetch failed:', err && err.message ? err.message : err);
    }

    res.render('download', {
        access: req.session.access,
        containers,
        personalized: false,
        warningMessage,
        headerLabel: 'All Available Containers:',
        ...baseViewModel(req)
    });
});

app.get('/download/file/:filename', (req, res) => {
    if (!req.session.userId) return res.status(403).send('Unauthorized');

    const filename = req.params.filename;
    if (!filename || !/^[a-zA-Z0-9._-]+\.sif$/i.test(filename)) {
        return res.status(400).send('Invalid file requested.');
    }

    const remoteFile = path.posix.join(sshConfig.remotePath, filename);
    const conn = new Client();

    conn.on('ready', () => {
        conn.sftp((err, sftp) => {
            if (err) {
                conn.end();
                return res.status(500).send('Unable to open SFTP connection.');
            }

            sftp.stat(remoteFile, (statErr, stats) => {
                if (statErr) {
                    conn.end();
                    return res.status(404).send('File not found.');
                }

                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.setHeader('Content-Length', stats.size);

                const readStream = sftp.createReadStream(remoteFile);
                readStream.on('error', (streamErr) => {
                    conn.end();
                    if (!res.headersSent) {
                        res.status(500).send('Error streaming the file.');
                    }
                });
                readStream.on('end', () => {
                    conn.end();
                });
                readStream.pipe(res);
            });
        });
    }).on('error', (e) => {
        console.error('Download stream error:', e);
        res.status(500).send('SSH connection error.');
    }).connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
        readyTimeout: 10000
    });
});

// 5. API Route to increment downloads
app.post('/api/increment-download', (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Unauthorized" });

    const userId = req.session.userId;
    const now = new Date().toISOString();

    // Update total downloads
    db.run("UPDATE stats SET total_downloads = total_downloads + 1 WHERE id = 1", function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Update user's last download time
        db.run("UPDATE users SET last_download = ? WHERE id = ?", [now, userId], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true });
        });
    });
});

// 6. Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('connect.sid');
        if (err) return res.redirect('/login');
        res.redirect('/');
    });
});

// 7. Contact Page
app.get('/contact', (req, res) => {
    res.render('contact', { error: null, formData: {}, ...baseViewModel(req) });
});

app.get('/documentation', (req, res) => {
    res.render('documentation', { ...baseViewModel(req) });
});

app.post('/contact', (req, res) => {
    const { name, email, purpose, 'target-device': targetDevice, organization, role, 'container-access': containerAccess, product_name: productName, team_name: teamName } = req.body;
    const formData = { name, email, purpose, targetDevice, organization, role, containerAccess, productName, teamName };

    if (!name || !email || !purpose || !targetDevice || !organization || !role) {
        return res.render('contact', {
            error: 'Please complete all fields before submitting the request.',
            formData,
            ...baseViewModel(req)
        });
    }

    if (role === 'Product Owner' && (!productName || !teamName)) {
        return res.render('contact', {
            error: 'Product Owner requests require Product name and Team name.',
            formData,
            ...baseViewModel(req)
        });
    }

    if (role === 'Deployment team' && !containerAccess) {
        return res.render('contact', {
            error: 'Deployment team requests require a container access type selection.',
            formData,
            ...baseViewModel(req)
        });
    }

    const username = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const now = new Date().toISOString();

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, existingUser) => {
        if (err) {
            return res.render('contact', {
                error: 'Unable to submit your request at this time. Please try again later.',
                formData,
                ...baseViewModel(req)
            });
        }

        if (existingUser) {
            if (existingUser.status === 'active') {
                return res.render('contact', {
                    error: 'An account already exists for this email address.',
                    formData,
                    ...baseViewModel(req)
                });
            } else if (existingUser.status === 'pending') {
                return res.render('contact', {
                    error: 'A login request using this email is already pending review.',
                    formData,
                    ...baseViewModel(req)
                });
            } else if (existingUser.status === 'rejected') {
                // Allow resubmission by updating the existing rejected request to pending
                db.run(`UPDATE users SET name = ?, password = ?, purpose = ?, target_device = ?, role = ?, organization = ?, container_access = ?, product_name = ?, team_name = ?, status = 'pending' WHERE id = ?`,
                    [name, defaultUserPassword, purpose, targetDevice, role, organization, role === 'Deployment team' ? containerAccess : 'Login Request', productName || null, teamName || null, existingUser.id], function(updateErr) {
                        if (updateErr) {
                            return res.render('contact', {
                                error: 'Unable to update your request at this time. Please try again later.',
                                formData,
                                ...baseViewModel(req)
                            });
                        }

                        const mailOptions = {
                            from: emailFromAddress,
                            to: requestRecipient,
                            subject: `Updated login request from ${name}`,
                            text: `Updated login request submitted:\n\nName: ${name}\nEmail: ${email}\nRole: ${role}\nPurpose: ${purpose}\nTarget Device/Architecture: ${targetDevice}\nOrganization: ${organization}\nProduct Name: ${productName || 'N/A'}\nTeam Name: ${teamName || 'N/A'}\nContainer Access: ${containerAccess || 'N/A'}\nSubmitted At: ${now}`,
                            html: `<p>An updated login request has been submitted with the following details:</p>
                                   <ul>
                                     <li><strong>Name:</strong> ${name}</li>
                                     <li><strong>Email:</strong> ${email}</li>
                                     <li><strong>Role:</strong> ${role}</li>
                                     <li><strong>Purpose:</strong> ${purpose}</li>
                                     <li><strong>Target Device/Architecture:</strong> ${targetDevice}</li>
                                     <li><strong>Organization:</strong> ${organization}</li>
                                     <li><strong>Product Name:</strong> ${productName || 'N/A'}</li>
                                     <li><strong>Team Name:</strong> ${teamName || 'N/A'}</li>
                                     <li><strong>Container Access:</strong> ${containerAccess || 'N/A'}</li>
                                     <li><strong>Submitted At:</strong> ${now}</li>
                                   </ul>`
                        };

                        res.redirect('/success');
                        sendMailInBackground(mailOptions, `updated login request from ${email}`);
                    });
                return;
            }
        }

        db.run(`INSERT INTO users (username, name, email, password, purpose, target_device, container_access, role, organization, product_name, team_name, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [username, name, email, defaultUserPassword, purpose, targetDevice, role === 'Deployment team' ? containerAccess : 'Login Request', role, organization, productName || null, teamName || null], function(insertErr) {
                if (insertErr) {
                    return res.render('contact', {
                        error: 'Unable to save your request at this time. Please try again later.',
                        formData,
                        ...baseViewModel(req)
                    });
                }

                const mailOptions = {
                    from: emailFromAddress,
                    to: requestRecipient,
                    subject: `New login request from ${name}`,
                    text: `New login request submitted:\n\nName: ${name}\nEmail: ${email}\nRole: ${role}\nPurpose: ${purpose}\nTarget Device/Architecture: ${targetDevice}\nOrganization: ${organization}\nProduct Name: ${productName || 'N/A'}\nTeam Name: ${teamName || 'N/A'}\nContainer Access: ${containerAccess || 'N/A'}\nSubmitted At: ${now}`,
                    html: `<p>A new login request has been submitted with the following details:</p>
                           <ul>
                             <li><strong>Name:</strong> ${name}</li>
                             <li><strong>Email:</strong> ${email}</li>
                             <li><strong>Role:</strong> ${role}</li>
                             <li><strong>Purpose:</strong> ${purpose}</li>
                             <li><strong>Target Device/Architecture:</strong> ${targetDevice}</li>
                             <li><strong>Organization:</strong> ${organization}</li>
                             <li><strong>Product Name:</strong> ${productName || 'N/A'}</li>
                             <li><strong>Team Name:</strong> ${teamName || 'N/A'}</li>
                             <li><strong>Container Access:</strong> ${containerAccess || 'N/A'}</li>
                             <li><strong>Submitted At:</strong> ${now}</li>
                           </ul>`
                };

                res.redirect('/success');
                sendMailInBackground(mailOptions, `new login request from ${email}`);
            });
    });
});

app.get('/change-password', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('change-password', { error: null, success: null, ...baseViewModel(req) });
});

app.post('/change-password', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.render('change-password', { username: req.session.username, error: 'Please fill all password fields.', success: null });
    }
    if (newPassword !== confirmPassword) {
        return res.render('change-password', { username: req.session.username, error: 'New password and confirmation must match.', success: null });
    }
    if (newPassword.length < 6) {
        return res.render('change-password', { username: req.session.username, error: 'New password must be at least 6 characters.', success: null });
    }

    db.get("SELECT * FROM users WHERE id = ? AND status = 'active'", [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.render('change-password', { username: req.session.username, error: 'Unable to verify your account.', success: null });
        }
        if (user.password !== currentPassword) {
            return res.render('change-password', { username: req.session.username, error: 'Current password is incorrect.', success: null });
        }

        db.run("UPDATE users SET password = ? WHERE id = ?", [newPassword, req.session.userId], function(updateErr) {
            if (updateErr) {
                return res.render('change-password', { username: req.session.username, error: 'Unable to update your password. Please try again.', success: null });
            }
            req.session.destroy(() => {
                res.redirect('/login');
            });
        });
    });
});

app.get('/success', (req, res) => {
    res.render('success', { ...baseViewModel(req) });
});

app.listen(PORT, () => {
    console.log(`PINAKAA UI running securely on http://localhost:${PORT}`);
});