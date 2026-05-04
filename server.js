const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Database Connection
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI).then(() => console.log("✅ Database Connected")).catch(err => console.log(err));

// MODELS
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true }, name: String, password: { type: String, required: true },
    referredBy: { type: String, default: "" }, mainBalance: { type: Number, default: 0 }, playBalance: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, status: { type: String, default: 'active' }
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: Number, ticketId: String, winnerName: String, winnerPhone: String, prize: Number,
    adminProfit: { type: Number, default: 0 }, ticketPrice: Number, winningGrid: Array, calledNumbers: Array, playersData: Array, date: { type: Date, default: Date.now }
}));

const ActiveBonus = mongoose.model('ActiveBonus', new mongoose.Schema({
    amount: Number, maxUsers: Number, currentClaims: { type: Number, default: 0 }, claimedBy: [String], expiresAt: Date, isActive: { type: Boolean, default: true }, date: { type: Date, default: Date.now }
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }
}));

let GLOBAL_SETTINGS = { adminPass: "bingo1234", ticketPrice: 10, isGamePaused: false };
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused };
}
loadSettings();

// ==========================================
// 🔵 USER APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር አስቀድሞ ተመዝግቧል!" });
        let actualRef = "";
        if (refCode) { let ref = await User.findOne({ phone: refCode.trim() }); if (ref) { ref.playBalance += 10; await ref.save(); io.emit('balance_updated', ref.phone); actualRef = ref.phone; } }
        await new User({ phone, name, password, referredBy: actualRef, playBalance: 100 }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.password });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ አካውንትዎ ታግዷል! አድሚን ያናግሩ።" });
    res.json(user ? { success: true, user } : { success: false, message: "ስልክ ቁጥር ወይም የይለፍ ቃል ተሳስቷል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone }); res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    const { phone, type, amount, method } = req.body; let user = await User.findOne({phone}); if(!user) return res.json({success: false, message: "ተጠቃሚው አልተገኘም!"});
    if(type === 'withdraw' && user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
    if(type === 'withdraw') { user.mainBalance -= amount; await user.save(); }
    await new Transaction({ phone, type, amount, method }).save(); res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!" });
});

app.get('/api/user/transactions/:phone', async (req, res) => { res.json({ success: true, txs: await Transaction.find({ phone: req.params.phone }).sort({ date: -1 }).limit(30) }); });

app.post('/api/user/change-password', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.oldPass });
    if(!user) return res.json({ success: false, message: "የድሮው የይለፍ ቃል ተሳስቷል!" });
    user.password = req.body.newPass; await user.save(); res.json({ success: true, message: "ተቀይሯል!" });
});

app.get('/api/leaderboard', async (req, res) => { res.json({ success: true, leaderboard: await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10).select('name won') }); });

// ==========================================
// 🔴 ADMIN & FINANCE APIs
// ==========================================
const auth = (req, res, next) => { 
    const pass = req.body.password || req.body.adminPass;
    const isPassValid = pass === GLOBAL_SETTINGS.adminPass || pass === ADMIN_PASS;
    if(!isPassValid) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

app.post('/api/admin/users', auth, async (req, res) => res.json(await User.find().sort({ _id: -1 })));
app.post('/api/admin/transactions', auth, async (req, res) => res.json(await Transaction.find().sort({ date: -1 })));
app.post('/api/admin/history', auth, async (req, res) => res.json(await GameHistory.find().sort({ date: -1 }).limit(200)));

app.post('/api/admin/live-stats', auth, async (req, res) => {
    const totalUsers = await User.countDocuments();
    const history = await GameHistory.find();
    let totalProfit = history.reduce((sum, h) => sum + (h.adminProfit || 0), 0);
    res.json({ totalUsers, livePlayers: Object.keys(activePlayers).length, currentPrize: totalPrizePool, gameState: gameState, gameId: gameId, totalProfit: totalProfit, settings: GLOBAL_SETTINGS });
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass;
    if(req.body.ticketPrice) s.ticketPrice = req.body.ticketPrice;
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    await s.save(); await loadSettings();
    io.emit('system_message', req.body.pauseGame ? "⚠️ ጌም ለጊዜው ቆሟል!" : "✅ ጌም ተከፍቷል!");
    res.json({ success: true });
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    const { oldPhone, newPhone, password, mainBalance, playBalance } = req.body;
    let user = await User.findOne({ phone: oldPhone }); if (!user) return res.json({ success: false });
    if (oldPhone !== newPhone && newPhone) { user.phone = newPhone; await Transaction.updateMany({ phone: oldPhone }, { $set: { phone: newPhone } }); }
    if(password) user.password = password; user.mainBalance = Number(mainBalance); user.playBalance = Number(playBalance); await user.save();
    res.json({ success: true, message: "User updated!" });
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    if (req.body.action === 'Approve') { tx.status = 'Approved'; if(tx.type === 'deposit') user.playBalance += tx.amount; } 
    else { tx.status = 'Rejected'; if(tx.type === 'withdraw') user.mainBalance += tx.amount; }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.updateOne({ phone: req.body.phone }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/unban-user', auth, async (req, res) => { await User.updateOne({ phone: req.body.phone }, { status: 'active' }); res.json({ success: true }); });

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.body.phone });
        if(!user) return res.json({ success: false, message: "ተጠቃሚ አልተገኘም!" });
        user.playBalance += Number(req.body.amount); await user.save();
        io.emit('balance_updated', user.phone); res.json({ success: true, message: "ቦነሱ ተልኳል!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/send-bulk-bonus', auth, async (req, res) => {
    let phones = req.body.phones; let amount = Number(req.body.amount); let count = 0;
    // Log expense to DB
    await ActiveBonus.create({ amount, maxUsers: phones.length, currentClaims: phones.length });
    for(let phone of phones) {
        let u = await User.findOne({phone: phone.trim()});
        if(u) { u.playBalance += amount; await u.save(); io.emit('balance_updated', u.phone); count++; }
    }
    res.json({ success: true, message: `Bonus sent to ${count} users!` });
});

// 🔥 የተስተካከለው የቴሌግራም መላኪያ ኮድ 🔥
app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.json({ success: false, message: "እባክዎ ሜሴጅ ያስገቡ!" });

        // የራስህ ቶከን 
        const BOT_TOKEN = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
        
        // ⚠️ ማሳሰቢያ፡ እዚህ ላይ የራስህን የቴሌግራም ቻናል ዩዘርኔም አስገባ (ለምሳሌ: "@bingohabesha")
        const CHAT_ID = "@bingohabeshazone"; 

        const telegramURL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(telegramURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" })
        });

        const data = await response.json();
        if (data.ok) {
            res.json({ success: true, message: "✅ ማስታወቂያው በተሳካ ሁኔታ ቴሌግራም ላይ ተለቋል!" });
        } else {
            res.json({ success: false, message: "❌ ቴሌግራም ላይ መላክ አልተቻለም: " + data.description });
        }
    } catch (e) {
        console.error("Telegram API Error:", e);
        res.status(500).json({ success: false, message: "የሰርቨር ስህተት አጋጥሟል!" });
    }
});

// 🔥 Finance Raw Data for Filtering 🔥
app.post('/api/admin/finance-raw-data', auth, async (req, res) => {
    try {
        const txs = await Transaction.find({ status: 'Approved' });
        const games = await GameHistory.find();
        const bonuses = await ActiveBonus.find();
        const users = await User.find();
        res.json({ success: true, txs, games, bonuses, users });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE
// ==========================================
let gameState = "WAITING";
let gameClock = 40; 
let activePlayers = {}; 
let totalPrizePool = 0; 
let totalTickets = 0;
let calledNumbers = []; 
let currentDrawSequence = []; 
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

function serverCheckBingo(grid, called) {
    let m = Array(5).fill().map(() => Array(5).fill(false));
    for(let c=0; c<5; c++) for(let r=0; r<5; r++) if((c===2 && r===2) || called.includes(grid[c][r])) m[c][r] = true;
    for(let c=0; c<5; c++) if(m[c][0]&&m[c][1]&&m[c][2]&&m[c][3]&&m[c][4]) return true; 
    for(let r=0; r<5; r++) if(m[0][r]&&m[1][r]&&m[2][r]&&m[3][r]&&m[4][r]) return true; 
    if(m[0][0]&&m[1][1]&&m[2][2]&&m[3][3]&&m[4][4]) return true; 
    if(m[0][4]&&m[1][3]&&m[2][2]&&m[3][1]&&m[4][0]) return true; 
    return false;
}

function generateRiggedDrawSequence() {
    let pool = Array.from({length: 75}, (_, i) => i + 1);
    let allTickets = [];
    Object.values(activePlayers).forEach(p => p.ticketsData.forEach(t => allTickets.push({ phone: p.phone, name: p.name, ticket: t })));
    if (allTickets.length === 0) return pool.sort(() => Math.random() - 0.5).slice(0, 20);
    let target = allTickets[Math.floor(Math.random() * allTickets.length)];
    let req = [target.ticket.grid[0][2], target.ticket.grid[1][2], target.ticket.grid[3][2], target.ticket.grid[4][2]];
    req.forEach(n => { let i = pool.indexOf(n); if(i > -1) pool.splice(i, 1); });
    let fillers = []; for(let i=0; i<16; i++) fillers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    let winBall = req.pop(); let mixed = [...req, ...fillers].sort(() => Math.random() - 0.5); 
    mixed.splice(Math.floor(Math.random() * 5) + 15, 0, winBall); return mixed;
}

async function declareWinner(player, ticket) {
    gameState = "FINISHED"; 
    gameClock = 12; 
    const user = await User.findOne({phone: player.phone});
    if(user) { user.mainBalance += totalPrizePool; user.won += totalPrizePool; await user.save(); io.emit('balance_updated', player.phone); }
    let adminProfit = (totalTickets * GLOBAL_SETTINGS.ticketPrice) - totalPrizePool; 
    await GameHistory.create({ gameId, ticketId: ticket.id, winnerName: player.name, winnerPhone: player.phone, prize: totalPrizePool, adminProfit, ticketPrice: GLOBAL_SETTINGS.ticketPrice, winningGrid: ticket.grid, calledNumbers: [...calledNumbers], playersData: Object.values(activePlayers) });
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers: [...calledNumbers] });
    io.emit('admin_game_update', { playersCount: 0, totalTickets: 0, totalPrizePool: 0, playersData: [] });
}

function resetToWaiting() {
    gameState = "WAITING"; gameClock = 40; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
}

setInterval(() => {
    if(GLOBAL_SETTINGS.isGamePaused) { io.emit('game_status', { state: "PAUSED", timer: "PAUSED", totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId }); return; }

    if (gameState === "WAITING") {
        gameClock--;
        io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 1) {
                gameState = "PLAYING"; gameClock = 3; currentDrawSequence = generateRiggedDrawSequence();
                io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
            } else { gameClock = 40; }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; 
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; }
            let num = currentDrawSequence.shift(); calledNumbers.push(num); io.emit('new_number', num);
            let winnerFound = false;
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) {
                    if (serverCheckBingo(ticket.grid, calledNumbers)) { winnerFound = true; declareWinner(player, ticket); break; }
                }
                if(winnerFound) break;
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) { resetToWaiting(); }
    }
}, 1000);

io.on('connection', (socket) => {
    socket.emit('game_status', { state: GLOBAL_SETTINGS.isGamePaused ? "PAUSED" : gameState, timer: gameState === "PLAYING" ? "LIVE" : gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers: [...calledNumbers], playersCount: Object.keys(activePlayers).length, gameId });
    socket.emit('update_taken_tickets', globalTakenTickets); 

    socket.on('get_initial_data', (phone) => {
        let myData = activePlayers[phone];
        socket.emit('sync_data', { gameState: gameState, globalTakenTickets: globalTakenTickets, calledNumbers: calledNumbers, myTickets: myData ? myData.ticketsData : [] });
    });
    
    socket.on('buy_tickets', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused) return;
        if (gameState === "WAITING") {
            let currentTickets = activePlayers[data.phone] ? activePlayers[data.phone].tickets : 0;
            if (currentTickets + data.ticketCount > 4) return;

            const betAmount = data.ticketCount * GLOBAL_SETTINGS.ticketPrice; 
            const user = await User.findOne({phone: data.phone});
            
            if(user && user.status === 'banned') return;
            if(user && (user.playBalance + user.mainBalance) >= betAmount) {
                if (user.playBalance >= betAmount) user.playBalance -= betAmount; 
                else { user.mainBalance -= (betAmount - user.playBalance); user.playBalance = 0; }
                user.played += 1; await user.save();
                
                if (!activePlayers[data.phone]) { activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData }; } 
                else { activePlayers[data.phone].tickets += data.ticketCount; activePlayers[data.phone].ticketsData = [...activePlayers[data.phone].ticketsData, ...data.ticketsData]; }

                totalTickets += data.ticketCount; totalPrizePool = (totalTickets * GLOBAL_SETTINGS.ticketPrice) * 0.85; 
                if(data.ticketIds) { data.ticketIds.forEach(id => { if(!globalTakenTickets.includes(id)) globalTakenTickets.push(id); }); io.emit('update_taken_tickets', globalTakenTickets); }
                
                socket.emit('balance_updated', data.phone); 
                io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
                
                let playersDataList = Object.values(activePlayers).map(p => ({ phone: p.phone, name: p.name, tickets: p.tickets, ticketIds: p.ticketsData.map(t => t.id) }));
                io.emit('admin_game_update', { playersCount: Object.keys(activePlayers).length, totalTickets: totalTickets, totalPrizePool: totalPrizePool, playersData: playersDataList });
            }
        }
    });

    socket.on('admin_request_game_data', () => {
        let playersDataList = Object.values(activePlayers).map(p => ({ phone: p.phone, name: p.name, tickets: p.tickets, ticketIds: p.ticketsData.map(t => t.id) }));
        socket.emit('admin_game_update', { playersCount: Object.keys(activePlayers).length, totalTickets: totalTickets, totalPrizePool: totalPrizePool, playersData: playersDataList });
    });
});

// ==========================================
// ======================================================
// ✈️ TELEGRAM BOT INTEGRATION
// ======================================================
// ======================================================
// ✈️ TELEGRAM BOT INTEGRATION (Webhook mode)
// ======================================================
const TelegramBot = require('node-telegram-bot-api');
const telegramToken = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
const bot = new TelegramBot(telegramToken, { polling: false }); // polling: false እንዲሆን አድርግ
const WEB_URL = "https://bingohabesha.onrender.com";

// ሰርቨሩ ሲነሳ ዌብሁክ እንዲመዘገብ ማድረግ
bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);

app.post(`/bot${telegramToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ቦቱ ሲጀመር ቋሚ በተኖችን እንዲያሳይ
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "እንኳን ወደ Bingo Habesha በደህና መጡ! ከታች ካሉት በተኖች አንዱን ይምረጡ።", {
        reply_markup: {
            keyboard: [
                [{ text: "🎮 ጌም ይጫወቱ" }, { text: "💰 ሂሳብ ማረጋገጫ" }],
                [{ text: "📥 ገቢ ማድረግ" }, { text: "📤 ወጪ ማድረግ" }],
                [{ text: "🤝 ጓደኛ ይጋብዙ" }, { text: "🆘 እርዳታ" }]
            ],
            resize_keyboard: true
        }
    });
});

// በተኖቹ ሲጫኑ የሚሰሩ ተግባራት
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === "🎮 ጌም ይጫወቱ") {
        bot.sendMessage(chatId, "ጌሙን ለመጫወት ይህንን ይጫኑ፦", {
            reply_markup: { inline_keyboard: [[{ text: "🎮 Play Bingo", web_app: { url: WEB_URL } }]] }
        });
    } else if (text === "💰 ሂሳብ ማረጋገጫ") {
        bot.sendMessage(chatId, "ሂሳብዎን ለማየት ይህንን ይጫኑ፦", {
            reply_markup: { inline_keyboard: [[{ text: "💰 ሂሳብ ይመልከቱ", web_app: { url: WEB_URL } }]] }
        });
    } else if (text === "📥 ገቢ ማድረግ") {
        bot.sendMessage(chatId, "ገቢ ለማድረግ ይህንን ይጫኑ፦", {
            reply_markup: { inline_keyboard: [[{ text: "📥 ገቢ ያድርጉ", web_app: { url: WEB_URL } }]] }
        });
    } else if (text === "📤 ወጪ ማድረግ") {
        bot.sendMessage(chatId, "ወጪ ለማድረግ ይህንን ይጫኑ፦", {
            reply_markup: { inline_keyboard: [[{ text: "📤 ወጪ ያድርጉ", web_app: { url: WEB_URL } }]] }
        });
    } else if (text === "🤝 ጓደኛ ይጋብዙ") {
        bot.sendMessage(chatId, "ጓደኛ በመጋበዝ ይሸለሙ፦", {
            reply_markup: { inline_keyboard: [[{ text: "🤝 ጋብዝ", web_app: { url: WEB_URL } }]] }
        });
    } else if (text === "🆘 እርዳታ") {
        bot.sendMessage(chatId, "እርዳታ ከፈለጉ አድሚን ያናግሩ፦ @bingohabesh_support");
    }
});
});
// 🛣️ EXPLICIT ROUTING (Mobile Fix)
// ==========================================
app.get('/admin', (req, res) => {
    let p = path.join(__dirname, 'public', 'admin.html');
    if(fs.existsSync(p)) res.sendFile(p); else res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/finance', (req, res) => {
    let p = path.join(__dirname, 'public', 'finance.html');
    if(fs.existsSync(p)) res.sendFile(p); else res.sendFile(path.join(__dirname, 'finance.html'));
});
app.get('*', (req, res) => {
    let p = path.join(__dirname, 'public', 'index.html');
    if(fs.existsSync(p)) res.sendFile(p); else res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));

