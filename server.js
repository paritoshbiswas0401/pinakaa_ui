// server.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = 3000;
const requestRecipient = process.env.REQUEST_EMAIL || 'paritoshb@cdac.in';
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
    res.render('login', { error: null, ...baseViewModel(req) });
});

app.post('/login', (req, res) => {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    const captcha = (req.body.captcha || '').trim();

    if (!username || !password || !captcha) {
        return res.render('login', { error: 'Username, password, and captcha are required.' });
    }

    if (captcha.toUpperCase() !== '8F2A') {
        return res.render('login', { error: 'Invalid captcha code.' });
    }

    db.get("SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ? AND status = 'active'", [username, username, password], (err, user) => {
        if (user) {
            req.session.userId = user.id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.access = user.container_access;
            req.session.purpose = user.purpose;
            req.session.targetDevice = user.target_device;

            if (user.role === 'admin') {
                res.redirect('/admin');
            } else {
                res.redirect('/download');
            }
        } else {
            res.render('login', { error: 'Invalid credentials. Please check your username and password.', ...baseViewModel(req) });
        }
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
    const { id } = req.body;

    if (!validActions.includes(action) || !id) {
        return res.redirect('/admin?message=' + encodeURIComponent('Invalid request action or missing request id.'));
    }

    const newStatus = action === 'approve' ? 'active' : 'rejected';
    db.run("UPDATE users SET status = ? WHERE id = ? AND status = 'pending'", [newStatus, id], function(err) {
        if (err) {
            return res.redirect('/admin?message=' + encodeURIComponent('Unable to update request status.'));
        }

        if (this.changes === 0) {
            return res.redirect('/admin?message=' + encodeURIComponent('Request not found or already processed.'));
        }

        const message = action === 'approve' ? 'Request approved successfully.' : 'Request rejected successfully.';
        return res.redirect('/admin?message=' + encodeURIComponent(message));
    });
});

app.post('/admin/user/delete', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/login');

    const { id } = req.body;
    if (!id) {
        return res.redirect('/admin?message=' + encodeURIComponent('Missing user id.'));
    }

    db.run("DELETE FROM users WHERE id = ? AND role = 'user'", [id], function(err) {
        if (err) {
            return res.redirect('/admin?message=' + encodeURIComponent('Unable to delete the user.'));
        }

        if (this.changes === 0) {
            return res.redirect('/admin?message=' + encodeURIComponent('User not found or cannot be deleted.'));
        }

        return res.redirect('/admin?message=' + encodeURIComponent('User deleted successfully.'));
    });
});

const allContainers = [
    {
        title: 'TensorFlow HPC Optimization',
        description: 'Highly optimized TensorFlow container compiled specifically for NVIDIA A100 architectures. Includes cuDNN, NCCL, and MPI optimizations for distributed training across cluster nodes.',
        access: 'GPU-Optimized',
        arch: 'x86_64',
        purpose: 'AI Research',
        downloads: '14.2k',
        size: '4.8 GB',
        estimate: '~2 mins @ 1Gbps',
        filename: 'tensorflow-hpc.sif',
        stable: true
    },
    {
        title: 'AMD OpenCL Compute Runtime',
        description: 'Container image for AMD developers with OpenCL tooling, optimized for x86_64 platforms and targeted compute workloads.',
        access: 'AMD Based',
        arch: 'x86_64',
        purpose: 'AMD Developer',
        downloads: '9.1k',
        size: '3.2 GB',
        estimate: '~90 seconds @ 1Gbps',
        filename: 'amd-opencl.sif',
        stable: true
    },
    {
        title: 'Bioinformatics x86 Toolkit',
        description: 'Curated bioinformatics environment for x86_64 clusters with preloaded genomics tools, MPI, and large dataset support.',
        access: 'CPU-Only',
        arch: 'x86_64',
        purpose: 'Bioinformatics',
        downloads: '6.8k',
        size: '5.1 GB',
        estimate: '~2.5 mins @ 1Gbps',
        filename: 'bioinfokit.sif',
        stable: false
    },
    {
        title: 'Intel HPC Platform',
        description: 'Optimized Intel-based HPC runtime for x86_64 compute nodes with CPU-only performance tuning and MPI acceleration.',
        access: 'Intel Based',
        arch: 'x86_64',
        purpose: 'AI Research',
        downloads: '5.7k',
        size: '3.9 GB',
        estimate: '~2 mins @ 1Gbps',
        filename: 'intel-hpc.sif',
        stable: true
    },
    {
        title: 'Edge HPC Container',
        description: 'Lightweight runtime for edge and embedded HPC workloads on ARM-based hardware with accelerated inference and data streaming support.',
        access: 'For Single Server',
        arch: 'arm64',
        purpose: 'Edge Computing',
        downloads: '4.3k',
        size: '2.7 GB',
        estimate: '~70 seconds @ 1Gbps',
        filename: 'edge-hpc.sif',
        stable: true
    }
];

// 4. Download Centre
app.get('/download', (req, res) => {
    let containers = allContainers;
    let personalized = false;
    let warningMessage = null;

    if (req.session.role === 'Product Owner') {
        containers = [];
        warningMessage = 'Product Owner role cannot download containers. Deployment Team role is required to access container downloads.';
    } else if (req.session.userId && (req.session.role === 'user' || req.session.role === 'Deployment team')) {
        personalized = true;
        const purpose = (req.session.purpose || '').toLowerCase();
        const arch = (req.session.targetDevice || '').toLowerCase();
        const accessPref = (req.session.access || '').toLowerCase();

        containers = allContainers.filter((container) => {
            const purposeMatch = container.purpose.toLowerCase().includes(purpose) || purpose.includes(container.purpose.toLowerCase());
            const archMatch = container.arch.toLowerCase() === arch || arch.includes(container.arch.toLowerCase()) || (container.arch === 'x86_64' && arch.includes('x86'));
            const accessMatch = !accessPref || accessPref === 'all' || container.access.toLowerCase().includes(accessPref) || accessPref.includes(container.access.toLowerCase());
            return purposeMatch && archMatch && accessMatch;
        });
    }

    res.render('download', {
        access: req.session.access,
        containers,
        personalized,
        warningMessage,
        headerLabel: personalized ? `Containers tailored for ${req.session.username}` : 'All available containers',
        ...baseViewModel(req)
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
    const { name, email, purpose, 'target-device': targetDevice, organization, role, 'container-access': containerAccess, product_name: productName, team_name: teamName, prerequisites } = req.body;
    const formData = { name, email, purpose, targetDevice, organization, role, containerAccess, productName, teamName, prerequisites };

    if (!name || !email || !purpose || !targetDevice || !organization || !role) {
        return res.render('contact', {
            error: 'Please complete all fields before submitting the request.',
            formData,
            ...baseViewModel(req)
        });
    }

    if (role === 'Product Owner' && (!productName || !teamName || !prerequisites)) {
        return res.render('contact', {
            error: 'Product Owner requests require Product name, Team name, and Prerequisites.',
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
                db.run(`UPDATE users SET name = ?, password = ?, purpose = ?, target_device = ?, role = ?, organization = ?, container_access = ?, product_name = ?, team_name = ?, prerequisites = ?, status = 'pending' WHERE id = ?`,
                    [name, defaultUserPassword, purpose, targetDevice, role, organization, role === 'Deployment team' ? containerAccess : 'Login Request', productName || null, teamName || null, prerequisites || null, existingUser.id], function(updateErr) {
                        if (updateErr) {
                            return res.render('contact', {
                                error: 'Unable to update your request at this time. Please try again later.',
                                formData,
                                ...baseViewModel(req)
                            });
                        }

                        const mailOptions = {
                            from: 'Singularity Hub <no-reply@singularity-hub.local>',
                            to: requestRecipient,
                            subject: `Updated login request from ${name}`,
                            text: `Updated login request submitted:\n\nName: ${name}\nEmail: ${email}\nRole: ${role}\nPurpose: ${purpose}\nTarget Device/Architecture: ${targetDevice}\nOrganization: ${organization}\nProduct Name: ${productName || 'N/A'}\nTeam Name: ${teamName || 'N/A'}\nPrerequisites: ${prerequisites || 'N/A'}\nContainer Access: ${containerAccess || 'N/A'}\nSubmitted At: ${now}`,
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
                                     <li><strong>Prerequisites:</strong> ${prerequisites || 'N/A'}</li>
                                     <li><strong>Container Access:</strong> ${containerAccess || 'N/A'}</li>
                                     <li><strong>Submitted At:</strong> ${now}</li>
                                   </ul>`
                        };

                        mailer.sendMail(mailOptions, (mailErr, info) => {
                            if (mailErr) {
                                console.error('Mail send error:', mailErr);
                                return res.render('contact', {
                                    error: 'Your request was updated, but we could not send the notification email. Please contact support directly.',
                                    formData,
                                    ...baseViewModel(req)
                                });
                            }

                            return res.redirect('/success');
                        });
                    });
                return;
            }
        }

        db.run(`INSERT INTO users (username, name, email, password, purpose, target_device, container_access, role, organization, product_name, team_name, prerequisites, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [username, name, email, defaultUserPassword, purpose, targetDevice, role === 'Deployment team' ? containerAccess : 'Login Request', role, organization, productName || null, teamName || null, prerequisites || null], function(insertErr) {
                if (insertErr) {
                    return res.render('contact', {
                        error: 'Unable to save your request at this time. Please try again later.',
                        formData,
                        ...baseViewModel(req)
                    });
                }

                const mailOptions = {
                    from: 'Singularity Hub <no-reply@singularity-hub.local>',
                    to: requestRecipient,
                    subject: `New login request from ${name}`,
                    text: `New login request submitted:\n\nName: ${name}\nEmail: ${email}\nRole: ${role}\nPurpose: ${purpose}\nTarget Device/Architecture: ${targetDevice}\nOrganization: ${organization}\nProduct Name: ${productName || 'N/A'}\nTeam Name: ${teamName || 'N/A'}\nPrerequisites: ${prerequisites || 'N/A'}\nContainer Access: ${containerAccess || 'N/A'}\nSubmitted At: ${now}`,
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
                             <li><strong>Prerequisites:</strong> ${prerequisites || 'N/A'}</li>
                             <li><strong>Container Access:</strong> ${containerAccess || 'N/A'}</li>
                             <li><strong>Submitted At:</strong> ${now}</li>
                           </ul>`
                };

                mailer.sendMail(mailOptions, (mailErr, info) => {
                    if (mailErr) {
                        console.error('Mail send error:', mailErr);
                        return res.render('contact', {
                            error: 'Your request was recorded, but we could not send the notification email. Please contact support directly.',
                            formData,
                            ...baseViewModel(req)
                        });
                    }

                    return res.redirect('/success');
                });
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