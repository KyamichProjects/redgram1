
import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Database Setup
const db = new sqlite3.Database(path.join(__dirname, 'redgram.db'), (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            name TEXT,
            bio TEXT,
            phone TEXT,
            avatarColor TEXT,
            isPremium INTEGER DEFAULT 0,
            isAdmin INTEGER DEFAULT 0
        )`);

        // Messages table
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chatId TEXT,
            text TEXT,
            sender TEXT,
            senderId TEXT,
            timestamp INTEGER,
            status TEXT,
            type TEXT,
            mediaUrl TEXT,
            fileName TEXT,
            fileSize TEXT,
            duration INTEGER
        )`);

        // Promo Codes table
        db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
            code TEXT PRIMARY KEY,
            max_uses INTEGER,
            current_uses INTEGER DEFAULT 0
        )`);

        // User Promo Usage table (to track which user used which code)
        db.run(`CREATE TABLE IF NOT EXISTS user_promo_usage (
            user_id TEXT,
            code TEXT,
            PRIMARY KEY (user_id, code)
        )`);

        // Seed initial promo code
        db.run(`INSERT OR IGNORE INTO promo_codes (code, max_uses) VALUES ('welcome10', 999999)`);
        
        // Seed admin user if not exists (will be updated on login if exists)
        // We handle admin logic dynamically based on username 'kyamich'
    });
}

console.log(`🔴 RedGram Server starting...`);

// Serve static files from the 'dist' directory (Vite build output)
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
    if (!req.accepts('html')) return res.sendStatus(404);
    try {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } catch (e) {
        res.send('Build the app first using "npm run build"');
    }
});

io.on('connection', (socket) => {
    console.log('New client connected');

    // 1. Send current state to the new client
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (!err) {
            // Convert isPremium/isAdmin to boolean for frontend
            const formattedUsers = rows.map(u => ({
                ...u,
                isPremium: !!u.isPremium,
                isAdmin: !!u.isAdmin
            }));
            socket.emit('INIT_STATE', { users: formattedUsers });
        }
    });

    socket.on('REGISTER', (data) => {
        const { id, username, name, bio, phone, avatarColor } = data.profile;
        
        // Check if username is taken by ANOTHER user
        db.get("SELECT * FROM users WHERE username = ? AND id != ?", [username, id], (err, row) => {
            if (row) {
                socket.emit('REGISTRATION_ERROR', { message: 'Username is already taken.' });
                return;
            }

            const isAdmin = username === 'kyamich' ? 1 : 0;
            const isPremium = 0; // Default

            // Insert or Update
            db.run(`INSERT INTO users (id, username, name, bio, phone, avatarColor, isPremium, isAdmin) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET 
                    username=excluded.username, 
                    name=excluded.name, 
                    bio=excluded.bio, 
                    phone=excluded.phone, 
                    avatarColor=excluded.avatarColor,
                    isAdmin=excluded.isAdmin`,
                [id, username, name, bio, phone, avatarColor, isPremium, isAdmin],
                (err) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    
                    const profile = { ...data.profile, isAdmin: !!isAdmin };
                    console.log(`User registered/updated: ${username}`);
                    socket.emit('REGISTRATION_SUCCESS', { profile });
                    socket.broadcast.emit('USER_JOINED', { profile });
                }
            );
        });
    });

    socket.on('REDEEM_PROMO', (data) => {
        const { userId, code } = data;
        
        db.get("SELECT * FROM promo_codes WHERE code = ?", [code], (err, promo) => {
            if (!promo) {
                socket.emit('PROMO_RESULT', { success: false, message: 'Invalid code' });
                return;
            }

            // Check if user already used this code
            db.get("SELECT * FROM user_promo_usage WHERE user_id = ? AND code = ?", [userId, code], (err, usage) => {
                if (usage) {
                    socket.emit('PROMO_RESULT', { success: false, message: 'Code already used by you' });
                    return;
                }

                // Check global limits (if any, though welcome10 is practically unlimited per user)
                // Assuming 'welcome10' is single use per user, but maybe we want to enforce global limit too?
                // The prompt said "each code had 1 activation", which usually means unique codes.
                // But "welcome10" implies a shared code. I'll stick to "1 use per user".
                
                // Apply Premium
                db.run("UPDATE users SET isPremium = 1 WHERE id = ?", [userId], (err) => {
                    if (err) {
                         socket.emit('PROMO_RESULT', { success: false, message: 'Database error' });
                         return;
                    }
                    
                    // Record usage
                    db.run("INSERT INTO user_promo_usage (user_id, code) VALUES (?, ?)", [userId, code]);
                    db.run("UPDATE promo_codes SET current_uses = current_uses + 1 WHERE code = ?", [code]);

                    socket.emit('PROMO_RESULT', { success: true, message: 'Premium Activated!' });
                    
                    // Notify everyone (or just user) to update UI
                    // We need to fetch the updated user to broadcast
                    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
                        if (row) {
                            const updatedProfile = { ...row, isPremium: !!row.isPremium, isAdmin: !!row.isAdmin };
                            socket.emit('USER_UPDATED', { profile: updatedProfile });
                            socket.broadcast.emit('USER_UPDATED', { profile: updatedProfile });
                        }
                    });
                });
            });
        });
    });

    socket.on('SEND_MESSAGE', (data) => {
        const msg = data.message;
        console.log(`Message from ${msg.senderId} to ${msg.chatId}`);
        
        // Save to DB
        db.run(`INSERT INTO messages (id, chatId, text, sender, senderId, timestamp, status, type, mediaUrl, fileName, fileSize, duration)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [msg.id, msg.chatId, msg.text, msg.sender, msg.senderId, msg.timestamp, msg.status, msg.type, msg.mediaUrl, msg.fileName, msg.fileSize, msg.duration],
            (err) => {
                if (err) console.error("Error saving message", err);
            }
        );

        // Broadcast to everyone (simplified for this demo, ideally only to target)
        socket.broadcast.emit('NEW_MESSAGE', {
            message: {
                ...msg,
                sender: 'them', 
                status: 'sent'
            }
        });
    });

    // Admin Feature: Get All Chats
    socket.on('ADMIN_GET_ALL_DATA', (data) => {
        const { userId } = data;
        // Verify admin status
        db.get("SELECT isAdmin FROM users WHERE id = ?", [userId], (err, row) => {
            if (row && row.isAdmin) {
                // Fetch all messages
                db.all("SELECT * FROM messages", [], (err, messages) => {
                    if (!err) {
                        socket.emit('ADMIN_DATA', { messages });
                    }
                });
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
