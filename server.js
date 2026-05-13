// server.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'supercomputing-mission-secret',
    resave: false,
    saveUninitialized: true
}));

// --- ROUTES ---

// 1. Home Page
app.get('/', (req, res) => {
    db.get("SELECT total_downloads FROM stats WHERE id = 1", (err, row) => {
        res.render('home', { downloads: row ? row.total_downloads : 0, username: req.session.username });
    });
});

// 2. Login Page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password, captcha } = req.body;

    // Simple captcha verification based on the visual in your HTML
    if (captcha.toUpperCase() !== '8F2A') {
        return res.render('login', { error: 'Invalid Captcha' });
    }

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
        if (user) {
            req.session.userId = user.id;
            req.session.role = user.role;
            req.session.username = user.username;
            req.session.access = user.container_access;
            req.session.purpose = user.purpose;
            req.session.targetDevice = user.target_device;
            
            // Route based on role
            if (user.role === 'admin') {
                res.redirect('/admin');
            } else {
                res.redirect('/download');
            }
        } else {
            res.render('login', { error: 'Invalid credentials' });
        }
    });
});

// 3. Admin Dashboard (User Management)
app.get('/admin', (req, res) => {
    if (req.session.role !== 'admin') return res.redirect('/login');

    db.all("SELECT * FROM users WHERE role = 'user'", (err, users) => {
        res.render('admin', { users: users, adminName: req.session.username, username: req.session.username });
    });
});

// 3.1 Add User
app.post('/admin/add-user', (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: "Unauthorized" });

    const { username, email, password, purpose, 'container-access': containerAccess, arch, organization } = req.body;

    db.run(`INSERT INTO users (username, email, password, purpose, target_device, container_access, role, organization) 
            VALUES (?, ?, ?, ?, ?, ?, 'user', ?)`, [username, email, password, purpose, arch, containerAccess, organization], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
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
        access: 'All',
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
        access: 'All',
        arch: 'x86_64',
        purpose: 'Bioinformatics',
        downloads: '6.8k',
        size: '5.1 GB',
        estimate: '~2.5 mins @ 1Gbps',
        filename: 'bioinfokit.sif',
        stable: false
    },
    {
        title: 'Edge HPC Container',
        description: 'Lightweight runtime for edge and embedded HPC workloads on ARM-based hardware with accelerated inference and data streaming support.',
        access: 'All',
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
    if (req.session.role === 'admin') return res.redirect('/admin');

    let containers = allContainers;
    let personalized = false;

    if (req.session.userId && req.session.role === 'user') {
        personalized = true;
        const purpose = (req.session.purpose || '').toLowerCase();
        const arch = (req.session.targetDevice || '').toLowerCase();

        containers = allContainers.filter((container) => {
            const purposeMatch = container.purpose.toLowerCase().includes(purpose) || purpose.includes(container.purpose.toLowerCase());
            const archMatch = container.arch.toLowerCase() === arch || arch.includes(container.arch.toLowerCase()) || (container.arch === 'x86_64' && arch.includes('x86'));
            return purposeMatch && archMatch;
        });
    }

    res.render('download', {
        username: req.session.username,
        access: req.session.access,
        containers,
        personalized,
        headerLabel: personalized ? `Containers tailored for ${req.session.username}` : 'All available containers'
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
        if (err) return res.redirect('/login');
        res.redirect('/');
    });
});

// 7. Contact Page
app.get('/contact', (req, res) => {
    res.render('contact', { username: req.session.username });
});

app.listen(PORT, () => {
    console.log(`PINAKAA UI running securely on http://localhost:${PORT}`);
});