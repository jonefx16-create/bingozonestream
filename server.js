const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api'); 

const app = express();
const server = http.createServer(app);
// ጨምረን የ upload መጠን ከፍ አድርገናል (ለፎቶ አፕሎድ እንዲረዳ)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ==========================================
// 🔵 DATABASE CONNECTION
// ==========================================
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
mongoose.connect(mongoURI).then(() => console.log("✅ Database Connected")).catch(err => console.log(err));

// ==========================================
// 🔵 MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true }, 
    telegramId: { type: String, default: "" }, 
    name: String, 
    password: { type: String, required: true },
    referredBy: { type: String, default: "" }, 
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 }, 
    won: { type: Number, default: 0 }, 
    status: { type: String, default: 'active' },
    language: { type: String, default: 'am' } 
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }, smsText: {type: String, default: ""}
}));

const BankSMS = mongoose.model('BankSMS', new mongoose.Schema({
    rawText: String,
    txRef: String,
    amount: Number,
    isUsed: { type: Boolean, default: false },
    dateReceived: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: Number, ticketId: String, winnerName: String, winnerPhone: String, prize: Number,
    adminProfit: { type: Number, default: 0 }, ticketPrice: Number, winningGrid: Array, calledNumbers: Array, playersData: Array, date: { type: Date, default: Date.now }
}));

const ActiveBonus = mongoose.model('ActiveBonus', new mongoose.Schema({
    amount: Number, maxUsers: Number, currentClaims: { type: Number, default: 0 }, claimedBy: [String], expiresAt: Date, isActive: { type: Boolean, default: true }, date: { type: Date, default: Date.now }
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }, gameTimer: { type: Number, default: 40 }
}));

let GLOBAL_SETTINGS = { adminPass: "bingo1234", ticketPrice: 10, isGamePaused: false, gameTimer: 40 };
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused, gameTimer: s.gameTimer || 40 };
}
loadSettings();

const bankAccounts = {
    'TeleBirr': { num: '0933638022', name: 'Tsedey Abebe' },
    'CBEBirr': { num: '0988180301', name: 'Yohannes Aberham' }
};

async function autoApprovePendingDeposits() {
    try {
        const pendingTxs = await Transaction.find({ type: 'deposit', status: 'Pending' });
        const unusedSMS = await BankSMS.find({ isUsed: false });

        for (let tx of pendingTxs) {
            let userMsg = (tx.smsText || "").toUpperCase();
            for (let sms of unusedSMS) {
                let bankRef = sms.txRef.toUpperCase();
                if (userMsg.includes(bankRef)) {
                    let user = await User.findOne({ phone: tx.phone });
                    if (user) {
                        let actualAmount = sms.amount;
                        let bonus = (actualAmount >= 100) ? 30 : 0;
                        let totalCredit = actualAmount + bonus;

                        tx.amount = actualAmount; 
                        tx.status = 'Approved';
                        await tx.save();

                        sms.isUsed = true;
                        await sms.save();

                        user.playBalance += totalCredit;
                        await user.save();
                        
                        io.emit('balance_updated', tx.phone);
                    }
                    break;
                }
            }
        }
    } catch (err) { console.log("Auto-Approve Error:", err); }
}

app.post('/api/webhook/iphone-sms', async (req, res) => {
    try {
        const { secret, message } = req.body;
        if(secret !== "Bingo1234Secure") return res.status(401).json({ error: "Unauthorized" });

        let isReceivingMsg = /received|ደረሰዎት|ገቢ|ተቀብለዋል|into your account/i.test(message);
        if(!isReceivingMsg) return res.json({ success: false, msg: "Not a receiving message" });

        let amountMatch = message.match(/(\d+(?:\.\d{1,2})?)\s*(?:ETB|ብር|birr|Birr)/i) || message.match(/(?:ETB|ብር|birr|Birr)\s*(\d+(?:\.\d{1,2})?)/i);
        let amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
        let txMatch = message.match(/(?:Ref|ID|Txn|Transaction|ቁጥር|ማረጋገጫ)[:\s#-]+([A-Z0-9]+)/i);
        let txRef = txMatch ? txMatch[1] : null;

        if(!txRef) { let fallbackMatch = message.match(/\b([A-Z0-9]{8,15})\b/); if(fallbackMatch) txRef = fallbackMatch[1]; }

        if(amount > 0 && txRef) {
            const exists = await BankSMS.findOne({ txRef: txRef });
            if (!exists) {
                await BankSMS.create({ rawText: message, txRef: txRef, amount: amount });
                await autoApprovePendingDeposits(); 
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ተመዝግቧል!" });
        let actualRef = "";
        if (refCode) { 
            let ref = await User.findOne({ phone: refCode.trim() }); 
            if (ref) { ref.playBalance += 10; await ref.save(); io.emit('balance_updated', ref.phone); actualRef = ref.phone; } 
        }
        await new User({ phone, name, password, referredBy: actualRef, playBalance: 10 }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.password });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ አካውንትዎ ታግዷል!" });
    res.json(user ? { success: true, user } : { success: false, message: "ስልክ ቁጥር ወይም ፓስወርድ ተሳስቷል!" });
});

app.post('/api/telegram-login', async (req, res) => {
    const { telegramId } = req.body;
    let user = await User.findOne({ telegramId: telegramId.toString() });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ የታገደ አካውንት!" });
    if(user) res.json({ success: true, user });
    else res.json({ success: false, message: "Share contact in bot first." });
});

app.post('/api/user/change-password', async (req, res) => {
    const { phone, oldPass, newPass } = req.body;
    let user = await User.findOne({ phone, password: oldPass });
    if (!user) return res.json({ success: false, message: "❌ የድሮው ፓስወርድ ትክክል አይደለም!" });
    user.password = newPass;
    await user.save();
    res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone }); res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    const { phone, type, amount, method, sms } = req.body; 
    let user = await User.findOne({phone}); if(!user) return res.json({success: false, message: "User not found!"});
    if(type === 'withdraw') {
        if(user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
        user.mainBalance -= amount; await user.save();
    }
    await new Transaction({ phone, type, amount, method, smsText: sms || "" }).save();
    if(type === 'deposit') { await autoApprovePendingDeposits(); }
    res.json({ success: true, message: "✅ ጥያቄዎ ደርሶናል፤ ማመሳሰል እየተከናወነ ነው!" });
});

app.get('/api/user/transactions/:phone', async (req, res) => { 
    res.json({ success: true, txs: await Transaction.find({ phone: req.params.phone }).sort({ date: -1 }).limit(30) }); 
});

app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[req.params.phone];
    res.json({ success: true, ticketsData: p ? p.ticketsData : [], calledNumbers: [...calledNumbers], gameState, gameId, globalTakenTickets: [...globalTakenTickets] });
});

// 🔥 SYSTEM AUTOMATIC RANKING LOGIC (የሲስተሙ አውቶማቲክ ራንክ አሰራር እዚህ ነው) 🔥
app.get('/api/leaderboard', async (req, res) => { 
    try {
        let leaderboard = await User.find().sort({ won: -1, playBalance: -1 }).limit(10).select('name won playBalance'); 
        res.json({ success: true, leaderboard }); 
    } catch(e) { res.json({ success: false }); }
});

const auth = (req, res, next) => { 
    const pass = req.body.password || req.body.adminPass;
    const isPassValid = pass === GLOBAL_SETTINGS.adminPass;
    if(!isPassValid) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

app.post('/api/admin/users', auth, async (req, res) => res.json(await User.find().sort({ _id: -1 })));
app.post('/api/admin/transactions', auth, async (req, res) => res.json(await Transaction.find().sort({ date: -1 })));
app.post('/api/admin/history', auth, async (req, res) => res.json(await GameHistory.find().sort({ date: -1 }).limit(200)));

app.post('/api/admin/finance-raw-data', auth, async (req, res) => {
    try {
        let txs = await Transaction.find({ status: { $in: ['Approved', 'Pending'] } });
        let games = await GameHistory.find();
        let bonuses = await ActiveBonus.find();
        res.json({ success: true, txs, games, bonuses });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/live-stats', auth, async (req, res) => {
    const totalUsers = await User.countDocuments();
    const history = await GameHistory.find();
    let totalProfit = history.reduce((sum, h) => sum + (h.adminProfit || 0), 0);
    res.json({ totalUsers, livePlayers: Object.keys(activePlayers).length, gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, gameId, totalProfit, settings: GLOBAL_SETTINGS });
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    if (req.body.action === 'Approve') { 
        tx.status = 'Approved'; 
        if(tx.type === 'deposit') user.playBalance += tx.amount; 
    } else { 
        tx.status = 'Rejected'; 
        if(tx.type === 'withdraw') user.mainBalance += tx.amount; 
    }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass;
    if(req.body.ticketPrice) s.ticketPrice = req.body.ticketPrice;
    if(req.body.gameTimer) s.gameTimer = req.body.gameTimer;
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    await s.save(); await loadSettings();
    res.json({ success: true });
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    const { oldPhone, newPhone, password, mainBalance, playBalance, won } = req.body;
    await User.findOneAndUpdate({ phone: oldPhone }, { phone: newPhone, password, mainBalance, playBalance, won });
    res.json({ success: true });
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/unban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'active' }); res.json({ success: true }); });

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone });
    if(user) { user.playBalance += Number(req.body.amount); await user.save(); io.emit('balance_updated', user.phone); }
    res.json({ success: true, message: `✅ Bonus of ${req.body.amount} ETB successfully sent to ${req.body.phone}!` });
});
app.post('/api/admin/send-bulk-bonus', auth, async (req, res) => {
    if (req.body.phones === "ALL") { await User.updateMany({}, { $inc: { playBalance: Number(req.body.amount) } }); } 
    else { await User.updateMany({ phone: { $in: req.body.phones } }, { $inc: { playBalance: Number(req.body.amount) } }); }
    res.json({ success: true, message: `✅ Bulk Bonus of ${req.body.amount} ETB successfully sent to ALL users!` });
});
app.post('/api/admin/create-claim-bonus', auth, async (req, res) => {
    const { maxUsers, amount, minutes } = req.body;
    let expires = new Date(Date.now() + (minutes * 60000));
    await ActiveBonus.updateMany({}, { isActive: false });
    await new ActiveBonus({ amount, maxUsers, expiresAt: expires, isActive: true }).save();
    res.json({ success: true, message: `✅ Promo Created! ${maxUsers} users can now claim ${amount} ETB in the Telegram Bot.` });
});

const telegramToken = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://bingohabesha.onrender.com";
let lastBroadcasts = []; 

app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    try {
        const { message, photoUrl } = req.body;
        if (!message) return res.json({ success: false, message: "No message entered." });
        const users = await User.find({ telegramId: { $ne: "" } });
        lastBroadcasts = []; let count = 0;
        for (let u of users) {
            try {
                let sentMsg;
                if (photoUrl && photoUrl.startsWith('data:image')) {
                    let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); let photoBuffer = Buffer.from(base64Data, 'base64');
                    sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, parse_mode: "HTML" });
                } else if (photoUrl && photoUrl.startsWith('http')) { sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, parse_mode: "HTML" });
                } else { sentMsg = await bot.sendMessage(u.telegramId, message, { parse_mode: "HTML" }); }
                lastBroadcasts.push({ chatId: u.telegramId, messageId: sentMsg.message_id }); count++;
            } catch(e) {} 
        }
        res.json({ success: true, message: `✅ Successfully sent to ${count} Bot Users.` });
    } catch (e) { res.status(500).json({ success: false, message: "Error sending broadcast." }); }
});

app.post('/api/admin/delete-broadcast', auth, async (req, res) => {
    try {
        if(lastBroadcasts.length === 0) return res.json({ success: false, message: "No recent broadcast found." });
        let count = 0;
        for (let b of lastBroadcasts) { try { await bot.deleteMessage(b.chatId, b.messageId); count++; } catch(e) {} }
        lastBroadcasts = []; res.json({ success: true, message: `🗑️ Deleted ${count} messages.` });
    } catch(e) { res.status(500).json({ success: false, message: "Error deleting broadcast." }); }
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
    gameState = "FINISHED"; gameClock = 12; 
    const user = await User.findOne({phone: player.phone});
    if(user) { user.mainBalance += totalPrizePool; user.won += totalPrizePool; await user.save(); io.emit('balance_updated', player.phone); }
    let adminProfit = (totalTickets * GLOBAL_SETTINGS.ticketPrice) - totalPrizePool; 
    await GameHistory.create({ gameId, ticketId: ticket.id, winnerName: player.name, winnerPhone: player.phone, prize: totalPrizePool, adminProfit, ticketPrice: GLOBAL_SETTINGS.ticketPrice, winningGrid: ticket.grid, calledNumbers: [...calledNumbers], playersData: Object.values(activePlayers) });
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers: [...calledNumbers] });
}

function resetToWaiting() {
    gameState = "WAITING"; gameClock = GLOBAL_SETTINGS.gameTimer; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
}

setInterval(() => {
    if(GLOBAL_SETTINGS.isGamePaused) { io.emit('game_status', { state: "MAINTENANCE", timer: 0, totalPrizePool: 0, totalTickets: 0, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers: [], playersCount: 0, gameId }); return; }
    if (gameState === "WAITING") {
        gameClock--;
        io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        
        if (gameClock <= 0) { 
            // 🔥 ከ 1 ተጫዋች በላይ ካለ (ቢያንስ 2 ሰው) ብቻ ጌሙ ይጀምራል 🔥
            if(Object.keys(activePlayers).length > 1) { 
                gameState = "PLAYING"; gameClock = 3; currentDrawSequence = generateRiggedDrawSequence(); 
                io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
            } else { 
                // ሰው ከሌለ ወደ ተስተካከለው ሰከንድ (ለምሳሌ 40) ይመለሳል
                gameClock = GLOBAL_SETTINGS.gameTimer; 
            }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; 
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; }
            let num = currentDrawSequence.shift(); calledNumbers.push(num); io.emit('new_number', num);
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) { if (serverCheckBingo(ticket.grid, calledNumbers)) { declareWinner(player, ticket); return; } }
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) resetToWaiting();
    }
}, 1000);

io.on('connection', (socket) => {
    let stateToSend = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
    socket.emit('game_status', { state: stateToSend, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
    socket.on('get_initial_data', (phone) => { let myData = activePlayers[phone]; socket.emit('sync_data', { gameState: stateToSend, globalTakenTickets, calledNumbers, myTickets: myData ? myData.ticketsData : [] }); });
    socket.on('buy_tickets', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return; 
        const betAmount = data.ticketCount * GLOBAL_SETTINGS.ticketPrice;
        const user = await User.findOne({phone: data.phone});
        if(user && (user.playBalance + user.mainBalance) >= betAmount) {
            if (user.playBalance >= betAmount) user.playBalance -= betAmount;
            else { user.mainBalance -= (betAmount - user.playBalance); user.playBalance = 0; }
            user.played += 1; await user.save();
            if (!activePlayers[data.phone]) activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
            else { activePlayers[data.phone].tickets += data.ticketCount; activePlayers[data.phone].ticketsData.push(...data.ticketsData); }
            totalTickets += data.ticketCount; totalPrizePool = (totalTickets * GLOBAL_SETTINGS.ticketPrice) * 0.85;
            data.ticketIds.forEach(id => globalTakenTickets.push(id));
            io.emit('update_taken_tickets', globalTakenTickets); socket.emit('balance_updated', data.phone);
        }
    });
});

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
const botState = {};

const t = {
    am: {
        welcome: "🎉 <b>እንኳን ወደ BINGO HABESHA በደህና መጡ!</b> 🎉\n\nየኢትዮጵያ #1 እና በጣም ታማኝ የሆነው የቢንጎ መጫወቻ ፕላትፎርም። አሁኑኑ ይጫወቱ፣ ያሸንፉ፣ እና ወዲያውኑ ወደ ሂሳብዎ ገቢ ያድርጉ!\n\n👇 <b>ከታች ካሉት አማራጮች የሚፈልጉትን ይምረጡ፡</b>",
        btn_play: "🎮 ጌም ይጫወቱ (PLAY)", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሂሳብ", btn_deposit: "📥 ገቢ (Deposit)", btn_withdraw: "📤 ወጪ (Withdraw)", btn_invite: "🔗 ጋብዝ & አግኝ", btn_promo: "🗣 አስተዋውቅ", btn_guide: "📖 መመሪያ", btn_help: "🆘 እርዳታ", btn_rules: "📜 ደንቦች", btn_lang: "🌐 ቋንቋ (Language)", btn_bonus: "🎁 ቦነስ (Claim Promo)", btn_back: "🔙 ወደ ኋላ ተመለስ",
        share_contact: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", err_reg_first: "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።", err_cancel: "❌ ትዕዛዙ ተቋርጧል።",
        profile_text: (u) => `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልክ:</b> ${u.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${u.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n🟢 መጫወቻ ሂሳብ (Play): <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና ሂሳብ (Main): <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>የትኛውን የባንክ አማራጭ መጠቀም ይፈልጋሉ?</b>", wit_msg: "🏦 <b>በየትኛው ባንክ ወጪ ማድረግ ይፈልጋሉ?</b>",
        invite_msg: (l) => `🔗 <b>ጋብዝ እና አግኝ</b>\n\nይህንን የራስዎ የሆነ መጋበዣ ሊንክ ለጓደኞችዎ ይላኩ። ጓደኛዎ በእርስዎ ሊንክ ገብቶ ሲመዘገብ <b>እርስዎም 10 ብር፣ ጓደኛዎም 10 ብር</b> የመጫወቻ ቦነስ ያገኛላችሁ!\n\n👇 የጋብዝ ሊንክዎ:\n${l}`,
        promo_msg: "🗣 <b>አስተዋውቅ እና አግኝ:</b>\n\nልዩ አስተዋዋቂ በመሆን ተጨማሪ ገቢ ማግኘት ከፈለጉ፣ እባክዎ አድሚን ያናግሩ: @bingohabesha",
        guide_msg: `📖 <b>የጨዋታው መመሪያ:</b>\n\n1️⃣ ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል።\n2️⃣ ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል።\n3️⃣ ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።\n\n🏆 <b>እንዴት ያሸንፋሉ?</b>\nየተጠሩት ቁጥሮች በአግድም፣ ወደ ታች ወይም በማዕዘን (X ቅርፅ) ሙሉ መስመር ከሰሩ <b>BINGO!</b> ብለው ያሸንፋሉ።`,
        help_msg: "🆘 <b>እርዳታ:</b>\n\nማንኛውም ጥያቄ ካጋጠመዎት አድሚኑን ያናግሩ:\n👉 @bingohabesha",
        rules_msg: `📜 <b>የጨዋታው ደንቦች:</b>\n\n1️⃣ <b>የሂሳብ ደንቦች:</b>\n🟢 <b>መጫወቻ ሂሳብ:</b> ካርድ ገዝቶ ለመጫወት ብቻ የሚያገለግል ሲሆን በፍፁም ወጪ (Withdraw) ማድረግ አይቻልም።\n🟡 <b>ዋና ሂሳብ:</b> ተጫውተው ሲያሸንፉ የሚገባበት ሲሆን፣ በማንኛውም ሰዓት ወጪ ማድረግ ይችላሉ።\n\n2️⃣ <b>የገቢ ደንብ:</b>\n👉 ከ ቴሌብር ወደ ቴሌብር\n👉 ከ ሲቢኢ ብር ወደ ሲቢኢ ብር ብቻ ያስገቡ።\n\n3️⃣ <b>ማረጋገጫ:</b> ገቢ ሲያደርጉ የደረሰዎትን ትክክለኛ የባንክ (SMS/TxRef) በትክክል ያስገቡ።\n4️⃣ <b>እድሜ:</b> ተጫዋቾች ከ 21 ዓመት በላይ መሆን አለባቸው።`,
        choose_lang: "እባክዎ ቋንቋ ይምረጡ:", lang_set: "✅ ቋንቋ በተሳካ ሁኔታ ተቀይሯል!",
        warn_telebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር (Telebirr to Telebirr) ብቻ ያስገቡ!\n\n", warn_cbebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBEBirr to CBEBirr) ብቻ ያስገቡ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንክ: <b>${method}</b>\n\n${warning}እባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: <b>${name}</b>\n👉 ቁጥር: <b>${num}</b>\n\nከዚያም <b>ያስገቡትን የብር መጠን</b> ብቻ እዚህ ይፃፉልኝ (ምሳሌ: 100):`,
        wit_info: (method) => `🏦 ባንክ: <b>${method}</b>\n\nገንዘቡ እንዲላክልዎ የሚፈልጉትን <b>ስልክ ቁጥር ወይም አካውንት</b> ያስገቡ፦`,
        invalid_amt: "❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ 50 ብር):", enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nእባክዎ ክፍያ የፈጸሙበትን የ <b>ትክክለኛውን የባንክ SMS ማረጋገጫ (Tx Ref) ፅሁፍ</b> አሁን እዚህ ይላኩ፦`,
        dep_success: "✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።",
        enter_wit_amt: (acc) => `✅ አካውንት: <b>${acc}</b>\n\nማውጣት የሚፈልጉትን መጠን ያስገቡ (ቢያንስ 50 ብር):`, insufficient: "❌ በዋና ሂሳብዎ ላይ በቂ ብር የለም!", wit_success: (amt, acc) => `✅ <b>የወጪ ጥያቄዎ ተልኳል!</b>\n\nመጠን: ${amt} ETB\nወደ: ${acc}\n\nበቅርቡ ይላካል!`
    },
    en: {
        welcome: "🎉 <b>Welcome to BINGO HABESHA!</b> 🎉\n\nEthiopia's #1 BINGO platform.\n\n👇 <b>Choose an option:</b>",
        btn_play: "🎮 PLAY BINGO", btn_profile: "👤 Profile", btn_balance: "💰 Balance", btn_deposit: "📥 Deposit", btn_withdraw: "📤 Withdraw", btn_invite: "🔗 Invite & Earn", btn_promo: "🗣 Promote", btn_guide: "📖 Guide", btn_help: "🆘 Help", btn_rules: "📜 Rules", btn_lang: "🌐 Language", btn_bonus: "🎁 Claim Promo Bonus", btn_back: "🔙 Go Back",
        share_contact: "📱 Share Contact", err_reg_first: "Register first by sending /start.", err_cancel: "❌ Action cancelled.",
        profile_text: (u) => `👤 <b>Your Profile</b>\n\n🔹 <b>Name:</b> ${u.name}\n🔹 <b>Phone:</b> ${u.phone}\n🔑 <b>Password:</b> <code>${u.password}</code>\n\n💰 <b>Play Balance:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Main Balance:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Wallet Balance:</b>\n\n🟢 Play Balance: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Main Balance: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Choose a bank to Deposit:</b>", wit_msg: "🏦 <b>Choose a bank to Withdraw:</b>",
        invite_msg: (l) => `🔗 <b>Invite & Earn</b>\n\nWhen a friend joins, <b>both YOU and YOUR FRIEND get 10 ETB</b> Play Bonus!\n\n👇 Your Link:\n${l}`,
        promo_msg: "🗣 <b>Promote:</b> Contact: @bingohabesha",
        guide_msg: `📖 <b>How to Play:</b>\n\n1️⃣ Get a 5x5 card.\n2️⃣ System calls a number every 3 sec.\n3️⃣ System auto-daubs.\n\n🏆 Match 5 in a row to win <b>BINGO!</b>`,
        help_msg: "🆘 <b>Support:</b> @bingohabesha",
        rules_msg: `📜 <b>Rules:</b>\n\n👉 Telebirr to Telebirr ONLY.\n👉 CBEBirr to CBEBirr ONLY.\n👉 Paste exact SMS.\n👉 Must be 21+.`,
        choose_lang: "Please choose your language:", lang_set: "✅ Language changed successfully!",
        warn_telebirr: "⚠️ <b>WARNING:</b> Send Telebirr to Telebirr ONLY!\n\n", warn_cbebirr: "⚠️ <b>WARNING:</b> Send CBEBirr to CBEBirr ONLY!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Bank: <b>${method}</b>\n\n${warning}Send money to:\n👤 Name: <b>${name}</b>\n👉 Account: <b>${num}</b>\n\nType the <b>amount you sent</b> here (e.g., 100):`,
        wit_info: (method) => `🏦 Bank: <b>${method}</b>\n\nEnter the <b>Account or Phone number</b>:`,
        invalid_amt: "❌ Invalid Amount. Min 50 ETB:", enter_sms: (amt) => `✅ Amount: <b>${amt} ETB</b>\n\nPaste exact <b>Bank SMS</b>:`,
        dep_success: "✅ <b>Deposit Request Sent!</b>", enter_wit_amt: (acc) => `✅ Account: <b>${acc}</b>\n\nEnter withdrawal amount (Min 50 ETB):`, insufficient: "❌ Insufficient Main Balance!", wit_success: (amt, acc) => `✅ <b>Withdrawal Request Sent!</b>\nAmount: ${amt} ETB\nTo: ${acc}`
    },
    or: {
        welcome: "🎉 <b>Baga nagaan dhuftan!</b> 🎉", btn_play: "🎮 Tapadhu", btn_profile: "👤 Pirofaayilii", btn_balance: "💰 Herrega", btn_deposit: "📥 Galchuu", btn_withdraw: "📤 Baasuu", btn_invite: "🔗 Afeeri", btn_promo: "🗣 Beeksisi", btn_guide: "📖 Qajeelfama", btn_help: "🆘 Gargaarsa", btn_rules: "📜 Seera", btn_lang: "🌐 Afaan", btn_bonus: "🎁 Boonasii", btn_back: "🔙 Duubatti", share_contact: "📱 Lakkoofsa ergi", err_reg_first: "Dura /start tuqi.", err_cancel: "❌ Haqameera.",
        profile_text: (u) => `👤 <b>Pirofaayilii</b>\n\n🔹 <b>Maqaa:</b> ${u.name}\n🔹 <b>Lakkoofsa:</b> ${u.phone}\n🔑 <b>Iccitii:</b> <code>${u.password}</code>\n\n💰 <b>Herrega Taphaa:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Muummee:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Herrega Kee:</b>\n\n🟢 Tapha: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Muummee: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Baankii filadhu:</b>", wit_msg: "🏦 <b>Baankii baasuuf filadhu:</b>", invite_msg: (l) => `🔗 <b>Afeeri</b>\n\nLachuun keessan 10 ETB argattu!\n\n👇 Liinkii Kee:\n${l}`, promo_msg: "🗣 admin dubbisi: @bingohabesha", guide_msg: `📖 <b>Akkaataa Tapha:</b> Sarara guutu BINGO!`, help_msg: "🆘 @bingohabesha", rules_msg: `📜 <b>Seera:</b> Telebirr gara Telebirr QOFA. CBEBirr gara CBEBirr QOFA.`, choose_lang: "Afaan filadhu:", lang_set: "✅ Jijjiirameera!", warn_telebirr: "⚠️ Telebirr gara Telebirr QOFA!\n\n", warn_cbebirr: "⚠️ CBEBirr gara CBEBirr QOFA!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Baankii: <b>${method}</b>\n\n${warning}Qarshii ergaa:\n👤 Maqaa: <b>${name}</b>\n👉 Lakkoofsa: <b>${num}</b>\n\n<b>Hamma qarshii</b> asitti barreessaa (Fkn: 100):`,
        wit_info: (method) => `🏦 Baankii: <b>${method}</b>\n\nLakkoofsa barreessaa:`, invalid_amt: "❌ Yoo xiqqaate 50 ETB:", enter_sms: (amt) => `✅ Hamma: <b>${amt} ETB</b>\n\nAmma <b>SMS Baankii</b> asitti ergaa:`, dep_success: "✅ <b>Ergameera!</b>", enter_wit_amt: (acc) => `✅ Herrega: <b>${acc}</b>\n\nHamma galchaa (Min 50):`, insufficient: "❌ Qarshiin ga'aan hin jiru!", wit_success: (amt, acc) => `✅ <b>Ergameera!</b>`
    },
    ti: {
        welcome: "🎉 <b>እንቋዕ ብደሓን መጻእኩም!</b> 🎉", btn_play: "🎮 ጻወት", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሕሳብ", btn_deposit: "📥 ኣእቱ", btn_withdraw: "📤 ኣውጽእ", btn_invite: "🔗 ዕደም", btn_promo: "🗣 ኣፋልጥ", btn_guide: "📖 መምርሒ", btn_help: "🆘 ሓገዝ", btn_rules: "📜 ሕግታት", btn_lang: "🌐 ቋንቋ", btn_bonus: "🎁 ቦነስ", btn_back: "🔙 ንድሕሪት", share_contact: "📱 ቁጽሪ ኣካፍል", err_reg_first: "ቅድም /start በሉ።", err_cancel: "❌ ተቋሪጹ።",
        profile_text: (u) => `👤 <b>ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልኪ:</b> ${u.phone}\n🔑 <b>መሕለፊ ቃል:</b> <code>${u.password}</code>\n\n💰 <b>መጻወቲ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ቀንዲ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>ናይ ሕሳብ ሓበሬታ:</b>\n\n🟢 መጻወቲ: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ቀንዲ: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>ባንኪ ምረጽ?</b>", wit_msg: "🏦 <b>ባንኪ ምረጽ?</b>", invite_msg: (l) => `🔗 <b>ዕደምን ረኸብን</b>\n\nንስኹም 10 ብር፡ ንሱ ድማ 10 ብር ክትረኽቡ ኢኹም!\n\n👇 ሊንክ:\n${l}`, promo_msg: "🗣 ንኣድሚን ኣዘራርቡ: @bingohabesha", guide_msg: `📖 <b>መምርሒ:</b> ምሉእ መስመር እንተሰሪሖም BINGO!`, help_msg: "🆘 @bingohabesha", rules_msg: `📜 <b>ሕግታት:</b> ካብ ቴሌብር ናብ ቴሌብር ጥራይ። ካብ CBEBirr ናብ CBEBirr ጥራይ።`, choose_lang: "ቋንቋ ምረጹ:", lang_set: "✅ ተቐይሩ ኣሎ!", warn_telebirr: "⚠️ ካብ ቴሌብር ናብ ቴሌብር ጥራይ!\n\n", warn_cbebirr: "⚠️ ካብ CBEBirr ናብ CBEBirr ጥራይ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንኪ: <b>${method}</b>\n\n${warning}ገንዘብ ናብዚ ኣእትዉ:\n👤 ስም: <b>${name}</b>\n👉 ቁጽሪ: <b>${num}</b>\n\n<b>መጠን ገንዘብ</b> ኣብዚ ጽሓፉ (ንኣብነት: 100):`,
        wit_info: (method) => `🏦 ባንኪ: <b>${method}</b>\n\n<b>ቁጽሪ ስልኪ ወይ ኣካውንት</b> ኣእትዉ፦`, invalid_amt: "❌ እንተወሓደ 50 ብር:", enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nሕጂ <b>ትኽክለኛ SMS</b> ስደዱ፦`, dep_success: "✅ <b>ተላኢኹ!</b>", enter_wit_amt: (acc) => `✅ ኣካውንት: <b>${acc}</b>\n\nመጠን ኣእትዉ (Min 50):`, insufficient: "❌ እኹል ገንዘብ የለን!", wit_success: (amt, acc) => `✅ <b>ተላኢኹ!</b>`
    }
};

function getLang(user) { return user && user.language && t[user.language] ? t[user.language] : t['am']; }
function getMainMenu(user) {
    let ln = getLang(user);
    return { reply_markup: { keyboard: [ [{ text: ln.btn_play }], [{ text: ln.btn_bonus }], [{ text: ln.btn_profile }, { text: ln.btn_balance }], [{ text: ln.btn_deposit }, { text: ln.btn_withdraw }], [{ text: ln.btn_invite }, { text: ln.btn_promo }], [{ text: ln.btn_guide }, { text: ln.btn_help }, { text: ln.btn_rules }], [{ text: ln.btn_lang }] ], resize_keyboard: true } };
}
const cancelKeyboard = (ln) => ({ reply_markup: { keyboard: [[{ text: ln.btn_back }]], resize_keyboard: true } });

bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id; let user = await User.findOne({ telegramId: msg.from.id.toString() }); let ln = getLang(user);
    if(user) { bot.sendMessage(chatId, ln.welcome, { parse_mode: "HTML", ...getMainMenu(user) }); } 
    else {
        botState[chatId] = { step: 'idle', refCode: match[1] };
        bot.sendMessage(chatId, `👋 እንኳን ወደ <b>BINGO HABESHA</b> መጡ!\n\nጌሙን ለመጀመር ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> ይጫኑ።`, { parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } });
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id; let phone = msg.contact.phone_number;
    if (phone.startsWith('251')) phone = '0' + phone.substring(3); if (phone.startsWith('+251')) phone = '0' + phone.substring(4);
    let user = await User.findOne({ phone: phone }); let state = botState[chatId] || {};
    try {
        if (!user) {
            let actualRef = "";
            if (state.refCode) { let refUser = await User.findOne({ phone: state.refCode }); if (refUser) { refUser.playBalance += 10; await refUser.save(); io.emit('balance_updated', refUser.phone); actualRef = refUser.phone; } }
            user = await User.create({ phone, name: msg.contact.first_name || "User", password: Math.random().toString(36).slice(-6), telegramId: msg.from.id.toString(), referredBy: actualRef, playBalance: 10, language: 'am' });
            bot.sendMessage(chatId, `🎉 እንኳን ደስ አሎት <b>${user.name}</b>! ምዝገባው ተጠናቋል።\n\n${getLang(user).welcome}`, { parse_mode: "HTML", ...getMainMenu(user) });
        } else {
            user.telegramId = msg.from.id.toString(); await user.save();
            bot.sendMessage(chatId, `✅ አካውንትዎ ተገናኝቷል!\n\n${getLang(user).welcome}`, { parse_mode: "HTML", ...getMainMenu(user) });
        }
        botState[chatId] = { step: 'idle' };
    } catch (e) { bot.sendMessage(chatId, "❌ ይቅርታ፣ ችግር አጋጥሟል።"); }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if(!text || text.startsWith('/start') || msg.contact) return;
    let user = await User.findOne({ telegramId: msg.from.id.toString() }); let ln = getLang(user); let state = botState[chatId] || { step: 'idle' };

    if (text === t.am.btn_back || text === t.en.btn_back || text === t.or.btn_back || text === t.ti.btn_back) { botState[chatId] = { step: 'idle' }; return bot.sendMessage(chatId, ln.err_cancel, user ? { parse_mode: "HTML", ...getMainMenu(user) } : { reply_markup: { remove_keyboard: true } }); }
    if (text === t.am.btn_lang || text === t.en.btn_lang || text === t.or.btn_lang || text === t.ti.btn_lang) {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first);
        return bot.sendMessage(chatId, ln.choose_lang, { reply_markup: { inline_keyboard: [ [{text: "🇪🇹 አማርኛ", callback_data: "lang_am"}, {text: "🇬🇧 English", callback_data: "lang_en"}], [{text: "🌳 Afaan Oromoo", callback_data: "lang_or"}, {text: "🇪🇷 ትግርኛ", callback_data: "lang_ti"}] ] } });
    }

    if (text === t.am.btn_bonus || text === t.en.btn_bonus || text === t.or.btn_bonus || text === t.ti.btn_bonus) {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first);
        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) return bot.sendMessage(chatId, "❌ በአሁኑ ሰዓት የተለቀቀ ቦነስ የለም። (No active promo)", { parse_mode: "HTML", ...getMainMenu(user) });
        if (activeBonus.currentClaims >= activeBonus.maxUsers) return bot.sendMessage(chatId, "❌ ይቅርታ! ቦነሱ ቀድሞ ባለቀበት ተወስዷል። (Limit reached)", { parse_mode: "HTML", ...getMainMenu(user) });
        if (activeBonus.claimedBy.includes(user.phone)) return bot.sendMessage(chatId, "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል! (Already claimed)", { parse_mode: "HTML", ...getMainMenu(user) });
        activeBonus.claimedBy.push(user.phone); activeBonus.currentClaims += 1; await activeBonus.save(); user.playBalance += activeBonus.amount; await user.save();
        bot.sendMessage(chatId, `🎉 <b>እንኳን ደስ አሎት!</b>\n\nየ <b>${activeBonus.amount} ETB</b> የመጫወቻ ቦነስ አግኝተዋል።`, { parse_mode: "HTML", ...getMainMenu(user) });
        io.emit('balance_updated', user.phone); return;
    }

    if (text === t.am.btn_play || text === t.en.btn_play || text === t.or.btn_play || text === t.ti.btn_play) {
        bot.sendMessage(chatId, "🎮 BINGO HABESHA", { reply_markup: { inline_keyboard: [[{ text: ln.btn_play, web_app: { url: (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL } }]] } });
    }
    else if (text === t.am.btn_profile || text === t.en.btn_profile || text === t.or.btn_profile || text === t.ti.btn_profile) { if(!user) return bot.sendMessage(chatId, ln.err_reg_first); bot.sendMessage(chatId, ln.profile_text(user), { parse_mode: "HTML", ...getMainMenu(user) }); }
    else if (text === t.am.btn_balance || text === t.en.btn_balance || text === t.or.btn_balance || text === t.ti.btn_balance) { if(!user) return bot.sendMessage(chatId, ln.err_reg_first); bot.sendMessage(chatId, ln.balance_text(user), { parse_mode: "HTML", ...getMainMenu(user) }); } 
    else if (text === t.am.btn_deposit || text === t.en.btn_deposit || text === t.or.btn_deposit || text === t.ti.btn_deposit) {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); state.step = 'idle';
        bot.sendMessage(chatId, ln.dep_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"dep_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"dep_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_withdraw || text === t.en.btn_withdraw || text === t.or.btn_withdraw || text === t.ti.btn_withdraw) {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); state.step = 'idle';
        bot.sendMessage(chatId, ln.wit_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"wit_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"wit_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_invite || text === t.en.btn_invite || text === t.or.btn_invite || text === t.ti.btn_invite) { if(!user) return bot.sendMessage(chatId, ln.err_reg_first); bot.sendMessage(chatId, ln.invite_msg(`https://t.me/bingo_habesha_bot?start=${user.phone}`), { parse_mode: "HTML", ...getMainMenu(user) }); } 
    else if (text === t.am.btn_promo || text === t.en.btn_promo || text === t.or.btn_promo || text === t.ti.btn_promo) { if(!user) return bot.sendMessage(chatId, ln.err_reg_first); bot.sendMessage(chatId, ln.promo_msg, { parse_mode: "HTML", ...getMainMenu(user) }); } 
    else if (text === t.am.btn_guide || text === t.en.btn_guide || text === t.or.btn_guide || text === t.ti.btn_guide) { if(!user) return; bot.sendMessage(chatId, ln.guide_msg, { parse_mode: "HTML", ...getMainMenu(user) }); }
    else if (text === t.am.btn_help || text === t.en.btn_help || text === t.or.btn_help || text === t.ti.btn_help) { if(!user) return; bot.sendMessage(chatId, ln.help_msg, { parse_mode: "HTML", ...getMainMenu(user) }); } 
    else if (text === t.am.btn_rules || text === t.en.btn_rules || text === t.or.btn_rules || text === t.ti.btn_rules) { if(!user) return; bot.sendMessage(chatId, ln.rules_msg, { parse_mode: "HTML", ...getMainMenu(user) }); } 
    
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt, cancelKeyboard(ln));
        bot.sendMessage(chatId, ln.enter_sms(state.amount), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) { await new Transaction({ phone: user.phone, type: 'deposit', amount: state.amount, method: state.method, smsText: text }).save(); bot.sendMessage(chatId, ln.dep_success, { parse_mode: "HTML", ...getMainMenu(user) }); await autoApprovePendingDeposits(); }
        state.step = 'idle';
    } 
    else if (state.step === 'awaiting_wit_acc') {
        state.destinationPhone = text.trim(); bot.sendMessage(chatId, ln.enter_wit_amt(state.destinationPhone), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_wit_amt';
    }
    else if (state.step === 'awaiting_wit_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt, cancelKeyboard(ln));
        if(user) {
            if(user.mainBalance < state.amount) return bot.sendMessage(chatId, ln.insufficient, { ...getMainMenu(user) });
            user.mainBalance -= state.amount; await user.save(); await new Transaction({ phone: user.phone, type: 'withdraw', amount: state.amount, method: state.method, smsText: `Transfer to: ${state.destinationPhone}` }).save();
            bot.sendMessage(chatId, ln.wit_success(state.amount, state.destinationPhone), { parse_mode: "HTML", ...getMainMenu(user) });
        }
        state.step = 'idle';
    }
    botState[chatId] = state;
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; const data = query.data;
    let user = await User.findOne({ telegramId: query.from.id.toString() }); let ln = getLang(user);
    if(data.startsWith('lang_')) { if(user) { user.language = data.split('_')[1]; await user.save(); ln = getLang(user); bot.sendMessage(chatId, ln.lang_set, { parse_mode: "HTML", ...getMainMenu(user) }); } bot.answerCallbackQuery(query.id); return; }
    if(!botState[chatId]) botState[chatId] = { step: 'idle' }; let state = botState[chatId];
    if (data.startsWith('dep_')) {
        state.method = data.split('_')[1]; state.step = 'awaiting_dep_amt';
        let accInfo = bankAccounts[state.method] || { num: '09...', name: 'Bingo Admin' };
        let warn = state.method === 'TeleBirr' ? ln.warn_telebirr : (state.method === 'CBEBirr' ? ln.warn_cbebirr : "");
        bot.sendMessage(chatId, ln.bank_info(state.method, warn, accInfo.name, accInfo.num), { parse_mode: "HTML", ...cancelKeyboard(ln) });
    }
    else if (data.startsWith('wit_')) { state.method = data.split('_')[1]; state.step = 'awaiting_wit_acc'; bot.sendMessage(chatId, ln.wit_info(state.method), { parse_mode: "HTML", ...cancelKeyboard(ln) }); }
    botState[chatId] = state; bot.answerCallbackQuery(query.id);
});

const basicAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    
    if (login === 'admin' && password === GLOBAL_SETTINGS.adminPass) { return next(); }
    res.set('WWW-Authenticate', 'Basic realm="Secure Bingo Area"');
    res.status(401).send('<h1>🔒 Private Page. Access Denied.</h1><p>እባክዎ ትክክለኛውን Username ("admin") እና Password ያስገቡ።</p>');
};

app.get('/admin', basicAuth, (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'admin.html')) ? path.join(__dirname, 'admin.html') : path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h2 style='color:red;'>❌ Error: admin.html አልተገኘም!</h2>");
});

app.get('/finance', basicAuth, (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'finance.html')) ? path.join(__dirname, 'finance.html') : path.join(__dirname, 'public', 'finance.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h2 style='color:red;'>❌ Error: finance.html አልተገኘም!</h2>");
});

app.get('*', (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(target)) {
        let html = fs.readFileSync(target, 'utf8');
        if (GLOBAL_SETTINGS.isGamePaused) {
            let overlay = `<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-align:center;padding:20px;box-sizing:border-box;">
                <h1 style="color:#ea580c;font-size:45px;margin-bottom:10px;font-family:sans-serif;">⚠️ ጥገና ላይ ነን!</h1>
                <p style="font-size:20px;color:#cbd5e1;font-family:sans-serif;margin-top:0;">(MAINTENANCE)</p>
                <p style="font-size:16px;color:#94a3b8;max-width:500px;line-height:1.6;font-family:sans-serif;">በአሁኑ ሰዓት ሲስተሙን እያሻሻልን ስለሆነ ጌም መጫወት አይቻልም።<br><br>እባክዎ ከጥቂት ደቂቃዎች በኋላ ተመልሰው ይሞክሩ። እናመሰግናለን!</p>
            </div>`;
            html = html.replace('<body>', '<body>' + overlay);
        }
        res.send(html);
    } else {
        res.send("<h1>Bingo Habesha System is Running.</h1>");
    }
});

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));






