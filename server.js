const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api'); 

const app = express();
const server = http.createServer(app);
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
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }, smsText: {type: String, default: ""},
    txRef: { type: String, default: "" } 
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
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }, gameTimer: { type: Number, default: 40 },
    depBonusPercent: { type: Number, default: 20 }, depBonusMinAmount: { type: Number, default: 200 }, depBonusTimeRestricted: { type: Boolean, default: false }, happyHourStart: { type: Number, default: 12 }, happyHourEnd: { type: Number, default: 16 }    
}));

let GLOBAL_SETTINGS = { adminPass: "bingo1234", ticketPrice: 10, isGamePaused: false, gameTimer: 40, depBonusPercent: 20, depBonusMinAmount: 200, depBonusTimeRestricted: false, happyHourStart: 12, happyHourEnd: 16 };
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused, gameTimer: s.gameTimer || 40, depBonusPercent: s.depBonusPercent || 20, depBonusMinAmount: s.depBonusMinAmount || 200, depBonusTimeRestricted: s.depBonusTimeRestricted || false, happyHourStart: s.happyHourStart || 12, happyHourEnd: s.happyHourEnd || 16 };
}
loadSettings();

const bankAccounts = { 'TeleBirr': { num: '0953839231', name: 'Yohannes aberham' }, 'CBEBirr': { num: '0953839231', name: 'Yohannes aberham' } };

function getTxRef(text) {
    if (!text || typeof text !== 'string') return null;
    let msg = text.toUpperCase().replace(/\n/g, ' ');
    let ftMatch = msg.match(/\b(FT[0-9A-Z]{5,15})\b/);
    if (ftMatch) return ftMatch[1];
    let matches = msg.match(/\b(?![A-Z]+\b)(?!\d+\b)[A-Z0-9]{6,15}\b/g);
    if (matches && matches.length > 0) return matches[0];
    let exact = msg.replace(/\s+/g, '');
    if (exact.length >= 6 && exact.length <= 15 && !/^\d+$/.test(exact)) return exact;
    return null;
}

function getBankAmount(text) {
    if (!text || typeof text !== 'string') return 0;
    let msg = text.toUpperCase().replace(/\n/g, ' ');
    let amtMatch = msg.match(/(?:ETB|BIRR|BR|ብር)\s*([\d,]+(?:\.\d+)?)/i) || msg.match(/([\d,]+(?:\.\d+)?)\s*(?:ETB|BIRR|BR|ብር)/i);
    if (amtMatch) return parseFloat(amtMatch[1].replace(/,/g, ''));
    return 0;
}

async function isSmsAlreadyUsed(userInputSms) {
    let txRef = getTxRef(userInputSms);
    if (!txRef) return false; 
    let inBankSms = await BankSMS.findOne({ txRef: txRef, isUsed: true });
    if (inBankSms) return true;
    let inTxRef = await Transaction.findOne({ txRef: txRef, status: { $in: ['Approved', 'Pending'] } });
    if (inTxRef) return true;
    return false;
}

function isHappyHour() {
    let currentHour = new Date().getHours();
    return currentHour >= GLOBAL_SETTINGS.happyHourStart && currentHour < GLOBAL_SETTINGS.happyHourEnd;
}

function calculateDepositBonus(amount) {
    if (amount >= GLOBAL_SETTINGS.depBonusMinAmount) {
        if (!GLOBAL_SETTINGS.depBonusTimeRestricted || isHappyHour()) { return amount * (GLOBAL_SETTINGS.depBonusPercent / 100); }
    }
    return 0;
}

async function autoApprovePendingDeposits() {
    try {
        const pendingTxs = await Transaction.find({ type: 'deposit', status: 'Pending' });
        const unusedSMS = await BankSMS.find({ isUsed: false });
        for (let tx of pendingTxs) {
            if (!tx.txRef) continue; 
            let matchedSMS = unusedSMS.find(sms => sms.txRef === tx.txRef);
            if (matchedSMS) {
                let user = await User.findOne({ phone: tx.phone });
                if (user) {
                    let actualReceivedAmount = matchedSMS.amount;
                    let bonus = calculateDepositBonus(actualReceivedAmount); 
                    let totalCredit = actualReceivedAmount + bonus;
                    tx.amount = actualReceivedAmount; tx.status = 'Approved'; await tx.save();
                    matchedSMS.isUsed = true; await matchedSMS.save();
                    user.playBalance += totalCredit; await user.save();
                    io.emit('balance_updated', tx.phone);
                }
            }
        }
    } catch (err) {}
}

app.post('/api/webhook/iphone-sms', async (req, res) => {
    try {
        const { secret, message } = req.body;
        if(secret !== "Bingo1234Secure") return res.status(401).json({ error: "Unauthorized" });
        if (!message) return res.json({ success: false, msg: "Empty message" });
        let isReceivingMsg = /received|credited|transfer|gebi|into your account/i.test(message);
        if(!isReceivingMsg) return res.json({ success: false, msg: "Not a receiving message" });
        let txRef = getTxRef(message); let amount = getBankAmount(message);
        if(amount > 0 && txRef) {
            const exists = await BankSMS.findOne({ txRef: txRef });
            if (!exists) { await BankSMS.create({ rawText: message, txRef: txRef, amount: amount }); await autoApprovePendingDeposits(); }
            res.json({ success: true, amount: amount, txRef: txRef });
        } else { res.json({ success: false, msg: "Could not extract valid data" }); }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ተመዝግቧል!" });
        let actualRef = "";
        if (refCode && refCode.trim() !== "") { 
            let cleanRef = refCode.toString().replace(/[^0-9]/g, '');
            if(cleanRef.startsWith('251')) cleanRef = '0' + cleanRef.substring(3);
            let ref = await User.findOne({ phone: cleanRef }); 
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
    if(user) res.json({ success: true, user }); else res.json({ success: false, message: "Share contact in bot first." });
});

app.post('/api/user/change-password', async (req, res) => {
    const { phone, oldPass, newPass } = req.body;
    let user = await User.findOne({ phone, password: oldPass });
    if (!user) return res.json({ success: false, message: "❌ የድሮው ፓስወርድ ትክክል አይደለም!" });
    user.password = newPass; await user.save(); res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone }); res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    try {
        const { phone, type, amount, method, sms } = req.body; 
        let user = await User.findOne({phone}); if(!user) return res.json({success: false, message: "User not found!"});
        if(type === 'withdraw') {
            if(user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
            user.mainBalance -= amount; await user.save();
            await new Transaction({ phone, type, amount, method, smsText: sms || "" }).save();
        }
        if(type === 'deposit') {
            let txRef = getTxRef(sms);
            if (!txRef) { return res.json({ success: false, message: "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) ከፅሁፉ ውስጥ አልተገኘም!" }); }
            let isUsed = await isSmsAlreadyUsed(sms);
            if (isUsed) { return res.json({ success: false, message: "❌ ይህ SMS (TxRef) ቀድሞ ጥቅም ላይ ውሏል!" }); }
            await new Transaction({ phone, type, amount: amount, method, smsText: sms, txRef: txRef }).save();
            await autoApprovePendingDeposits();
        }
        res.json({ success: true, message: "✅ ጥያቄዎ ደርሶናል፤ ማመሳሰል እየተከናወነ ነው!" });
    } catch(e) { res.json({ success: false, message: "❌ ሲስተም ላይ ስህተት አጋጥሟል! እባክዎ እንደገና ይሞክሩ።" }); }
});

app.get('/api/user/transactions/:phone', async (req, res) => { 
    const txs = await Transaction.find({ phone: req.params.phone, $or: [ { type: 'withdraw' }, { type: 'deposit', status: 'Approved' } ] }).sort({ date: -1 }).limit(30);
    res.json({ success: true, txs }); 
});

app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[req.params.phone];
    res.json({ success: true, ticketsData: p ? p.ticketsData : [], calledNumbers: [...calledNumbers], gameState, gameId, globalTakenTickets: [...globalTakenTickets] });
});

app.get('/api/leaderboard', async (req, res) => { 
    try {
        let leaderboard = await User.find({ won: { $gt: 0 } }).sort({ won: -1, playBalance: -1 }).limit(10).select('name won playBalance'); 
        res.json({ success: true, leaderboard }); 
    } catch(e) { res.json({ success: false }); }
});

const auth = (req, res, next) => { 
    const pass = req.body.adminPass || req.body.password;
    if(pass === GLOBAL_SETTINGS.adminPass) return next(); 
    return res.status(401).json({error:"Unauthorized"}); 
};

app.post('/api/admin/users', auth, async (req, res) => res.json(await User.find().sort({ _id: -1 })));
app.post('/api/admin/transactions', auth, async (req, res) => res.json(await Transaction.find().sort({ date: -1 })));
app.post('/api/admin/history', auth, async (req, res) => res.json(await GameHistory.find().sort({ date: -1 }).limit(200)));
app.post('/api/admin/finance-raw-data', auth, async (req, res) => {
    try {
        let txs = await Transaction.find({ status: { $in: ['Approved', 'Pending'] } });
        let games = await GameHistory.find(); let bonuses = await ActiveBonus.find(); let users = await User.find({}, 'mainBalance playBalance'); 
        res.json({ success: true, txs, games, bonuses, users });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/live-stats', auth, async (req, res) => {
    const totalUsers = await User.countDocuments();
    const history = await GameHistory.find();
    let totalProfit = history.reduce((sum, h) => sum + (h.adminProfit || 0), 0);
    
    let today = new Date(); today.setHours(0,0,0,0);
    let weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    let firstDayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let dGames = await GameHistory.find({ date: { $gte: today } }); let wGames = await GameHistory.find({ date: { $gte: weekAgo } }); let mGames = await GameHistory.find({ date: { $gte: firstDayMonth } });
    let dSet = new Set(), wSet = new Set(), mSet = new Set();
    dGames.forEach(g => g.playersData.forEach(p => dSet.add(p.phone))); wGames.forEach(g => g.playersData.forEach(p => wSet.add(p.phone))); mGames.forEach(g => g.playersData.forEach(p => mSet.add(p.phone)));

    res.json({ totalUsers, livePlayers: Object.keys(activePlayers).length, gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, gameId, totalProfit, settings: GLOBAL_SETTINGS, dailyActive: dSet.size, weeklyActive: wSet.size, monthlyActive: mSet.size, currentJackpot: totalPrizePool });
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    if (req.body.action === 'Approve') { 
        tx.status = 'Approved'; 
        if(tx.type === 'deposit') { let actualAmount = tx.amount; let bonus = calculateDepositBonus(actualAmount); let totalCredit = actualAmount + bonus; user.playBalance += totalCredit; }
    } else { tx.status = 'Rejected'; if(tx.type === 'withdraw') user.mainBalance += tx.amount; }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass; if(req.body.ticketPrice) s.ticketPrice = req.body.ticketPrice; if(req.body.gameTimer) s.gameTimer = req.body.gameTimer; if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    if(req.body.depBonusPercent !== undefined) s.depBonusPercent = req.body.depBonusPercent; if(req.body.depBonusMinAmount !== undefined) s.depBonusMinAmount = req.body.depBonusMinAmount; if(req.body.depBonusTimeRestricted !== undefined) s.depBonusTimeRestricted = req.body.depBonusTimeRestricted; if(req.body.happyHourStart !== undefined) s.happyHourStart = req.body.happyHourStart; if(req.body.happyHourEnd !== undefined) s.happyHourEnd = req.body.happyHourEnd;
    await s.save(); await loadSettings(); res.json({ success: true });
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const { oldPhone, newPhone, userPass, mainBalance, playBalance, won } = req.body;
        let updateData = { phone: newPhone, mainBalance: Number(mainBalance), playBalance: Number(playBalance), won: Number(won) };
        if (userPass) updateData.password = userPass;
        await User.findOneAndUpdate({ phone: oldPhone }, updateData);
        res.json({ success: true });
    } catch(e) { res.json({ success: false, message: "Error updating user." }); }
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/unban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'active' }); res.json({ success: true }); });
app.post('/api/admin/factory-reset', auth, async (req, res) => { await User.deleteMany({}); await Transaction.deleteMany({}); await GameHistory.deleteMany({}); await BankSMS.deleteMany({}); await ActiveBonus.deleteMany({}); res.json({ success: true, message: "✅ ሲስተሙ ሙሉ በሙሉ ፀድቷል! ሁሉም ዳታ ጠፍቷል እንደ አዲስ ይጀምራል።" }); });

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone });
    if(user) { user.playBalance += Number(req.body.amount); await user.save(); io.emit('balance_updated', user.phone); }
    res.json({ success: true, message: `✅ Bonus of ${req.body.amount} ETB successfully sent!` });
});

app.post('/api/admin/send-bulk-bonus', auth, async (req, res) => {
    if (req.body.phones === "ALL") { await User.updateMany({}, { $inc: { playBalance: Number(req.body.amount) } }); } 
    else { await User.updateMany({ phone: { $in: req.body.phones } }, { $inc: { playBalance: Number(req.body.amount) } }); }
    res.json({ success: true, message: `✅ Bulk Bonus sent!` });
});

const telegramToken = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://bingohabesha.onrender.com";
let lastBroadcasts = []; 

app.post('/api/admin/create-claim-bonus', auth, async (req, res) => {
    try {
        const { maxUsers, amount, minutes, message, photoUrl } = req.body;
        let expires = new Date(Date.now() + (minutes * 60000));
        await ActiveBonus.updateMany({}, { isActive: false });
        await new ActiveBonus({ amount, maxUsers, expiresAt: expires, isActive: true }).save();
        if (message) {
            const users = await User.find({ telegramId: { $ne: "" } });
            lastBroadcasts = []; 
            const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: `🎁 Claim ${amount} ETB Bonus`, callback_data: 'claim_promo' }]] } };
            for (let u of users) {
                try {
                    let sentMsg;
                    if (photoUrl && photoUrl.startsWith('data:image')) {
                        let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); let photoBuffer = Buffer.from(base64Data, 'base64');
                        sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, ...opts });
                    } else if (photoUrl && photoUrl.startsWith('http')) { sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, ...opts });
                    } else { sentMsg = await bot.sendMessage(u.telegramId, message, opts); }
                    lastBroadcasts.push({ chatId: u.telegramId, messageId: sentMsg.message_id }); 
                } catch(e) {} 
            }
        }
        res.json({ success: true, message: `✅ Promo Created & Broadcasted to Telegram Bot!` });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/claim-bonus-list', auth, async (req, res) => {
    try {
        let activeBonus = await ActiveBonus.findOne().sort({ date: -1 });
        if(!activeBonus) return res.json({ success: false, message: "No bonus history found." });
        res.json({ success: true, claimedBy: activeBonus.claimedBy, amount: activeBonus.amount, max: activeBonus.maxUsers });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    try {
        const { message, photoUrl } = req.body;
        if (!message) return res.json({ success: false });
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
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/delete-broadcast', auth, async (req, res) => {
    try {
        if(lastBroadcasts.length === 0) return res.json({ success: false, message: "No recent broadcast found." });
        let count = 0;
        for (let b of lastBroadcasts) { try { await bot.deleteMessage(b.chatId, b.messageId); count++; } catch(e) {} }
        lastBroadcasts = []; res.json({ success: true, message: `🗑️ Deleted ${count} messages.` });
    } catch(e) { res.status(500).json({ success: false }); }
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
    
    // 🔥 FIXED: 00 SECOND BUG (NOW PROPERLY TRANSITIONS TO PLAYING FOR EVERYONE) 🔥
    if (gameState === "WAITING") {
        gameClock--;
        
        io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 0) { // ቢያንስ 1 ሰው ካለ ይጀምራል
                gameState = "PLAYING"; 
                gameClock = 3; 
                currentDrawSequence = generateRiggedDrawSequence(); 
                io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
            } else { 
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
        // 🔥 FIXED: DEDUCT FROM PLAY BALANCE ONLY 🔥
        if(user && user.playBalance >= betAmount) {
            user.playBalance -= betAmount;
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

const WELCOME_PHOTO_URL = "https://i.postimg.cc/fyRC4Vsq/IMG-20260510-002811-640.jpg"

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
        welcome: "🎉 <b>Welcome to BINGO HABESHA!</b> 🎉\n\nEthiopia's #1 BINGO platform.",
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
    return { reply_markup: { keyboard: [ [{ text: ln.btn_play }], [{ text: ln.btn_profile }, { text: ln.btn_balance }], [{ text: ln.btn_deposit }, { text: ln.btn_withdraw }], [{ text: ln.btn_invite }, { text: ln.btn_promo }], [{ text: ln.btn_guide }, { text: ln.btn_help }, { text: ln.btn_rules }] ], resize_keyboard: true } };
}
const cancelKeyboard = (ln) => ({ reply_markup: { keyboard: [[{ text: ln.btn_back }]], resize_keyboard: true } });

bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id; let user = await User.findOne({ telegramId: msg.from.id.toString() }); let ln = getLang(user);
    if(user) { 
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: ln.welcome, parse_mode: "HTML", ...getMainMenu(user) }); }
        catch(e) { bot.sendMessage(chatId, ln.welcome, { parse_mode: "HTML", ...getMainMenu(user) }); }
    } else {
        botState[chatId] = { step: 'idle', refCode: match[1] };
        const cap = `👋 <b>እንኳን ወደ BINGO HABESHA መጡ!</b>\n\nጌሙን ለመጀመር ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> ይጫኑ።`;
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } }); }
        catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } }); }
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id; let phone = msg.contact.phone_number;
    if (phone.startsWith('251')) phone = '0' + phone.substring(3); if (phone.startsWith('+251')) phone = '0' + phone.substring(4);
    let user = await User.findOne({ phone: phone }); let state = botState[chatId] || {};
    try {
        if (!user) {
            let actualRef = "";
            
            // 🔥 FIXED: REFERRAL LOGIC FOR BOT REGISTRATION 🔥
            if (state.refCode) { 
                let cleanRef = state.refCode.toString().replace(/[^0-9]/g, '');
                if(cleanRef.startsWith('251')) cleanRef = '0' + cleanRef.substring(3);
                let refUser = await User.findOne({ phone: cleanRef }); 
                if (refUser) { 
                    refUser.playBalance += 10; 
                    await refUser.save(); 
                    io.emit('balance_updated', refUser.phone); 
                    actualRef = refUser.phone; 
                } 
            }

            user = await User.create({ phone, name: msg.contact.first_name || "User", password: Math.random().toString(36).slice(-6), telegramId: msg.from.id.toString(), referredBy: actualRef, playBalance: 10, language: 'am' });
            
            const cap = `🎉 እንኳን ደስ አሎት <b>${user.name}</b>! ምዝገባው ተጠናቋል።\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
            try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
            catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
        } else {
            user.telegramId = msg.from.id.toString(); await user.save();
            const cap = `✅ አካውንትዎ ተገናኝቷል!\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
            try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
            catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
        }
        botState[chatId] = { step: 'idle' };
    } catch (e) { bot.sendMessage(chatId, "❌ ይቅርታ፣ ችግር አጋጥሟል።"); }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if(!text || text.startsWith('/start') || msg.contact) return;
    
    let user = await User.findOne({ telegramId: msg.from.id.toString() }); 
    let ln = getLang(user); 
    let state = botState[chatId] || { step: 'idle' };

    if (text === t.am.btn_back || text === t.en.btn_back || text === t.or.btn_back || text === t.ti.btn_back || text.includes('ተመለስ') || text.includes('Back') || text.includes('Duubatti') || text.includes('ንድሕሪት') || text === '/back') { 
        botState[chatId] = { step: 'idle' }; 
        return bot.sendMessage(chatId, ln.err_cancel, user ? { parse_mode: "HTML", ...getMainMenu(user) } : { reply_markup: { remove_keyboard: true } }); 
    }

    if (text === t.am.btn_play || text === t.en.btn_play || text === t.or.btn_play || text === t.ti.btn_play || text.includes('PLAY') || text.includes('ጌም ይጫወቱ') || text.includes('Tapadhu') || text.includes('ጻወት') || text === '/play') {
        bot.sendMessage(chatId, "🎮 BINGO HABESHA", { reply_markup: { inline_keyboard: [[{ text: ln.btn_play, web_app: { url: (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL } }]] } });
    }
    else if (text === t.am.btn_profile || text === t.en.btn_profile || text === t.or.btn_profile || text === t.ti.btn_profile || text.includes('ፕሮፋይል') || text.includes('Profile') || text.includes('Pirofaayilii') || text === '/profile' || text === '/account') { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        const cap = `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
        catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
    }
    else if (text === t.am.btn_balance || text === t.en.btn_balance || text === t.or.btn_balance || text === t.ti.btn_balance || text.includes('ሂሳብ') || text.includes('Balance') || text.includes('Herrega') || text.includes('ሕሳብ')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, ln.balance_text(user), { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    else if (text === t.am.btn_deposit || text === t.en.btn_deposit || text === t.or.btn_deposit || text === t.ti.btn_deposit || text.includes('ገቢ') || text.includes('Deposit') || text.includes('Galchuu') || text.includes('ኣእቱ') || text === '/deposit') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        state.step = 'idle';
        bot.sendMessage(chatId, ln.dep_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"dep_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"dep_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_withdraw || text === t.en.btn_withdraw || text === t.or.btn_withdraw || text === t.ti.btn_withdraw || text.includes('ወጪ') || text.includes('Withdraw') || text.includes('Baasuu') || text.includes('ኣውጽእ') || text === '/withdraw') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        state.step = 'idle';
        bot.sendMessage(chatId, ln.wit_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"wit_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"wit_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_invite || text === t.en.btn_invite || text === t.or.btn_invite || text === t.ti.btn_invite || text.includes('ጋብዝ') || text.includes('Invite') || text.includes('Afeeri') || text.includes('ዕደም') || text === '/referral') { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, ln.invite_msg(`https://t.me/bingo_habesha_bot?start=${user.phone}`), { parse_mode: "HTML", disable_web_page_preview: false, ...getMainMenu(user) }); 
    } 
    else if (text === t.am.btn_promo || text === t.en.btn_promo || text === t.or.btn_promo || text === t.ti.btn_promo || text.includes('አስተዋውቅ') || text.includes('Promote') || text.includes('Beeksisi') || text.includes('ኣፋልጥ')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, ln.promo_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    else if (text === t.am.btn_guide || text === t.en.btn_guide || text === t.or.btn_guide || text === t.ti.btn_guide || text.includes('መመሪያ') || text.includes('Guide') || text.includes('Qajeelfama') || text.includes('መምርሒ')) { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.guide_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    }
    else if (text === t.am.btn_help || text === t.en.btn_help || text === t.or.btn_help || text === t.ti.btn_help || text.includes('እርዳታ') || text.includes('Help') || text.includes('Gargaarsa') || text.includes('ሓገዝ') || text === '/help') { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.help_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    else if (text === t.am.btn_rules || text === t.en.btn_rules || text === t.or.btn_rules || text === t.ti.btn_rules || text.includes('ደንቦች') || text.includes('Rules') || text.includes('Seera') || text.includes('ሕግታት')) { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.rules_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt, cancelKeyboard(ln));
        bot.sendMessage(chatId, ln.enter_sms(state.amount), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) { 
            let txRef = getTxRef(text);
            if (!txRef) { return bot.sendMessage(chatId, "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) ከፅሁፉ ውስጥ አልተገኘም።", { parse_mode: "HTML", ...getMainMenu(user) }); }
            let isUsed = await isSmsAlreadyUsed(text);
            if (isUsed) { return bot.sendMessage(chatId, "❌ ያስገቡት sms (TxRef) ቀድሞ ጥቅም ላይ ውሏል!", { parse_mode: "HTML", ...getMainMenu(user) }); }

            await new Transaction({ phone: user.phone, type: 'deposit', amount: state.amount, method: state.method, smsText: text, txRef: txRef }).save(); 
            bot.sendMessage(chatId, `✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\n📌 ማረጋገጫ ኮድ: <b>${txRef}</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።`, { parse_mode: "HTML", ...getMainMenu(user) }); 
            await autoApprovePendingDeposits(); 
        }
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
    
    if (data === 'claim_promo') {
        if(!user) return bot.answerCallbackQuery(query.id, { text: "❌ እባክዎ መጀመሪያ ይመዝገቡ!", show_alert: true });
        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) return bot.answerCallbackQuery(query.id, { text: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!", show_alert: true });
        if (activeBonus.currentClaims >= activeBonus.maxUsers) return bot.answerCallbackQuery(query.id, { text: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።", show_alert: true });
        if (activeBonus.claimedBy.includes(user.phone)) return bot.answerCallbackQuery(query.id, { text: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!", show_alert: true });
        activeBonus.claimedBy.push(user.phone); activeBonus.currentClaims += 1; await activeBonus.save(); user.playBalance += activeBonus.amount; await user.save();
        io.emit('balance_updated', user.phone); return bot.answerCallbackQuery(query.id, { text: `🎉 እንኳን ደስ አሎት! የ ${activeBonus.amount} ETB ቦነስ አግኝተዋል!`, show_alert: true });
    }

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
            let overlay = `<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(10,15,24,0.85);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-align:center;padding:20px;box-sizing:border-box;">
                <h1 style="color:#4ade80;font-size:50px;margin-bottom:10px;text-shadow:0 0 20px rgba(74,222,128,0.6);">⚠️ ጥገና ላይ ነን!</h1>
                <p style="font-size:20px;color:#cbd5e1;font-weight:bold;margin-top:0;">(MAINTENANCE BREAK)</p>
                <p style="font-size:15px;color:#94a3b8;max-width:400px;line-height:1.6;margin-top:15px;">በአሁኑ ሰዓት ሲስተሙን እያሻሻልን ስለሆነ ጌም መጫወት አይቻልም።<br><br>እባክዎ ከጥቂት ደቂቃዎች በኋላ ተመልሰው ይሞክሩ። እናመሰግናለን!</p>
            </div>`;
            html = html.replace('<body>', '<body>' + overlay);
        }
        res.send(html);
    } else {
        res.send("<h1>Bingo Habesha System is Running.</h1>");
    }
});

setInterval(async () => { try { await autoApprovePendingDeposits(); } catch (error) {} }, 30000); 
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));
```

---

### 2. `index.html` (የተጠቃሚው ገፅ - 100% ያልተቋረጠ ኮድ)
ይህን ኮፒ በማድረግ በ `index.html` ፋይልዎ ይተኩት፡

```html
<!DOCTYPE html>
<html lang="am">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>BINGO HABESHA - LIVE ULTIMATE</title>
    <!-- 🔥 የቴሌግራም አውቶ ሎጊን ስክሪፕት 🔥 -->
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --bg-dark: #0a0f18; --panel: #111827; --faded-green: #4ade80; --border-color: #1e293b; --orange: #ea580c; --text-gray: #94a3b8; --white: #ffffff; --blue: #3b82f6; --cyan: #38bdf8; --gold: #fbbf24; --purple: #a855f7; --red: #ef4444;}
        body { background-color: var(--bg-dark); color: var(--white); font-family: 'Segoe UI', Roboto, sans-serif; margin: 0; padding-bottom: 80px; overflow-x: hidden; }
        .page { display: none; padding: 10px; animation: fadeIn 0.3s; }
        .active-page { display: block; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* Auth Modernized */
        #auth-page.active-page { display: flex !important; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 0; margin: 0; box-sizing: border-box; }
        .auth-card { background: rgba(10, 15, 24, 0.85); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); padding: 35px 25px; border-radius: 25px; width: 90%; max-width: 360px; text-align: center; border: 1px solid rgba(74, 222, 128, 0.15); box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(74, 222, 128, 0.05); }
        .input-group { margin-bottom: 12px; position: relative; }
        .auth-input { width: 100%; padding: 14px 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.5); color: white; box-sizing: border-box; font-family: inherit; font-size: 14px; transition: 0.3s; }
        .auth-input:focus { border-color: var(--faded-green); outline: none; box-shadow: 0 0 8px rgba(74,222,128,0.3); background: rgba(0,0,0,0.8); }
        .ref-input { background: rgba(74, 222, 128, 0.05); border-color: rgba(74, 222, 128, 0.2); }
        .ref-input::placeholder { color: #6ee7b7; opacity: 0.7; }
        .auth-btn { width: 100%; padding: 15px; background: linear-gradient(135deg, var(--faded-green), #059669); color: #000; border: none; border-radius: 12px; font-weight: 900; font-size: 15px; cursor: pointer; text-transform: uppercase; transition: 0.2s; box-shadow: 0 4px 15px rgba(74,222,128,0.4);}
        .auth-btn:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; background: #334155; color: #94a3b8;}
        .eye-icon { position: absolute; right: 15px; top: 14px; cursor: pointer; font-size: 16px; opacity: 0.7; transition: 0.2s; }
        .eye-icon:hover { opacity: 1; }
        .auth-help-btn { width: 100%; padding: 12px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); color: var(--cyan); border-radius: 12px; font-weight: bold; margin-top: 15px; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px; transition: 0.2s; }
        .auth-help-btn:hover { background: rgba(56, 189, 248, 0.2); }
        
        body:has(#auth-page.active-page) #global-header, body:has(#auth-page.active-page) #navbar, body:has(#auth-page.active-page) #bet-slip-popup { display: none !important; }

        /* Header */
        .top-balance { position: relative; background: transparent; padding: 10px 10px 5px 10px; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; }
        .hdr-user-sec { display: flex; align-items: center; gap: 8px; }
        .hdr-user-sec .icon { width: 34px; height: 34px; background: linear-gradient(135deg, var(--blue), var(--purple)); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);}
        .hdr-user-sec .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
        .hdr-user-sec .phone { font-size: 9px; color: var(--text-gray); }
        .hdr-wallets-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
        .pill-wallet { background: #0b111a; border: 1px solid #1e293b; border-radius: 12px; padding: 3px 10px; display: flex; justify-content: space-between; align-items: center; min-width: 125px; box-shadow: 0 2px 5px rgba(0,0,0,0.5); box-sizing: border-box;}
        .pill-wallet span.title { font-size: 8px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;}
        .pill-wallet span.title.play { color: var(--faded-green); }
        .pill-wallet span.title.main { color: var(--gold); }
        .pill-wallet span.amt { color: white; font-size: 11px; font-weight: 900; font-family: monospace;}

        /* Timer Box */
        .new-timer-box { background: #111521; border: 1px solid rgba(74, 222, 128, 0.4); border-radius: 12px; padding: 12px 15px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(74, 222, 128, 0.05); }
        .nt-left { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
        .nt-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .nt-badge { background: rgba(74, 222, 128, 0.15); color: var(--faded-green); border: 1px solid rgba(74, 222, 128, 0.4); border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 900; letter-spacing: 0.5px; }
        .nt-status { color: #94a3b8; font-size: 10px; font-weight: bold; letter-spacing: 0.5px; }
        .nt-value { color: white; font-size: 20px; font-weight: 900; font-family: 'Arial Black', sans-serif; letter-spacing: 1px;}
        #timer { color: #ffffff; text-shadow: 0 0 15px rgba(255,255,255,0.8), 0 0 30px rgba(255,255,255,0.4); font-size: 26px; }

        .live-circle-badge { width: 75px; height: 75px; border-radius: 50%; background: linear-gradient(135deg, #0f172a, rgba(14, 165, 233, 0.2)); border: 2px solid rgba(56, 189, 248, 0.5); box-shadow: 0 4px 15px rgba(0,0,0,0.6), inset 0 0 15px rgba(56, 189, 248, 0.3); display: flex; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
        .live-indicator { color: #ef4444; font-size: 10px; font-weight: 900; display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
        .live-indicator .dot { width: 6px; height: 6px; background: #ef4444; border-radius: 50%; animation: pulseRed 1.2s infinite; }
        .jp-amount { color: #38bdf8; font-size: 13px; font-weight: 900; font-family: 'Arial Black', sans-serif; margin-top: 1px;}
        #game-page .live-circle-badge { width: 90px !important; height: 90px !important; margin: 0 auto; position: relative !important; border-width: 3px; box-shadow: 0 0 20px rgba(56, 189, 248, 0.5); }
        #game-page .jp-amount { font-size: 16px !important; }
        @keyframes pulseRed { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }

        .grid-subtitle-row { display: flex; justify-content: space-between; align-items: center; padding: 0 5px; margin-bottom: 10px; }
        .gs-left { color: white; font-size: 13px; font-weight: bold; letter-spacing: 0.5px; }
        .gs-right { font-size: 14px; font-weight: 900; color: var(--faded-green); } 
        .gs-right span.slash { color: #64748b; font-weight: bold; font-size: 13px; margin-left: 3px; }
        
        .num-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px; margin: 0 auto; width: fit-content; padding-bottom: 200px; } 
        .num-btn { width: 30px; height: 30px; background: #0d1117; border: 1px solid var(--border-color); color: var(--text-gray); display: flex; align-items: center; justify-content: center; font-size: 10px; border-radius: 6px; cursor: pointer; transition: 0.2s;}
        .num-btn.selected { background: var(--faded-green); color: black; font-weight: bold; border-color: var(--faded-green); transform: scale(1.1); z-index: 2;}
        .num-btn.bought-by-me { background: #059669; color: white; border-color: #047857; font-weight: bold; pointer-events: none !important; box-shadow: inset 0 0 8px rgba(0,0,0,0.5); }
        
        /* 🔥 FIXED: BLURRY TAKEN TICKETS 🔥 */
        .num-btn.taken { opacity: 0.4; filter: blur(2px); background: rgba(255,255,255,0.05); color: #475569; pointer-events: none !important; }

        .bet-slip-popup { position: fixed; bottom: 58px; left: 50%; transform: translate(-50%, 150%); width: 100%; max-width: 600px; background: rgba(11, 18, 31, 0.98); backdrop-filter: blur(10px); border-top: 2px solid var(--faded-green); border-radius: 12px 12px 0 0; padding: 8px 12px 10px 12px; box-shadow: 0 -10px 40px rgba(0,0,0,0.9); z-index: 2000; display: flex; flex-direction: column; align-items: center; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1); box-sizing: border-box; opacity: 0; visibility: hidden; pointer-events: none; }
        .bet-slip-popup.show { transform: translate(-50%, 0); opacity: 1; visibility: visible; pointer-events: auto; } 
        
        .preview-tickets-wrapper { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 6px; margin-bottom: 8px; width: 100%; scrollbar-width: none; min-height: 48px; padding-bottom: 4px; }
        .preview-tickets-wrapper::-webkit-scrollbar { display: none; }
        .preview-t-card { background: white; min-width: 85px; flex: 0 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; padding: 1px;}
        .preview-t-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #94a3b8; border: 1px solid #94a3b8;}
        .preview-t-head { color: white; height: 10px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 7px;}
        .preview-t-cell { background: #fff; height: 12px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 8px; color: #000;}

        .top-info-wrapper { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 5px; flex-shrink: 0; overflow-x: auto; scrollbar-width: none;}
        .top-info-wrapper::-webkit-scrollbar { display: none; }
        .top-info-box { flex: 1; min-width: 60px; background: var(--panel); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 4px; text-align: center; }
        .info-title { color: var(--text-gray); font-size: 10px; margin-bottom: 2px; font-weight: bold;}
        .info-val { color: white; font-weight: bold; font-size: 14px; }
        .top-info-box.prize-box { border-color: var(--cyan); box-shadow: inset 0 0 10px rgba(56, 189, 248, 0.2);}
        .info-title.prize-title { color: var(--cyan); text-shadow: 0 0 5px rgba(56, 189, 248, 0.4); }
        .info-val.highlight { color: var(--cyan); text-shadow: 0 0 8px rgba(56, 189, 248, 0.8); animation: shineCyan 1.5s infinite alternate; }
        @keyframes shineCyan { from { text-shadow: 0 0 5px rgba(56, 189, 248, 0.4); } to { text-shadow: 0 0 15px rgba(56, 189, 248, 1), 0 0 25px rgba(255, 255, 255, 0.5); transform: scale(1.02); } }

        #game-page.active-page { display: flex !important; flex-direction: column; height: calc(100svh - 65px); overflow: hidden; padding: 5px; box-sizing: border-box; margin: 0; max-width: 100%; }
        #game-page .game-layout-container { flex-grow: 1; display: flex; min-height: 0; align-items: stretch; gap: 2%; }
        
        .master-board-wrapper { width: 45%; flex: 0 0 45%; display: flex; flex-direction: column; justify-content: center; min-height: 0;}
        .mb-board { height: 100%; display: grid; grid-template-rows: auto repeat(15, minmax(0, 1fr)); grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1px; background: #1e293b; border: 1px solid #1e293b; border-radius: 4px; width: 100%; }
        .mb-head { background: var(--faded-green); color: black; display: flex; align-items: center; justify-content: center; font-size: 2vh; font-weight: 900;}
        .mb-cell { background: #111827; display: flex; align-items: center; justify-content: center; font-size: 2vh; font-weight: bold; transition: 0.2s; min-height: 0; overflow: hidden;}
        .mb-cell.called { background: #22c55e !important; color: #ffffff !important; font-weight: 900; border: 1px solid #16a34a; box-shadow: inset 0 0 5px rgba(0,0,0,0.3);}
        .mb-cell.current { background: #059669 !important; color: white !important; font-weight: 900; z-index: 2; transform: scale(1.05); box-shadow: 0 0 15px #10b981; border: 2px solid white;}
        
        #game-page .right-panel-stack { width: 53%; flex: 0 0 53%; display: flex; flex-direction: column; height: 100%; justify-content: space-between; gap: 5px; position: relative;}
        .caller-box { height: 15%; min-height: 65px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #111827, #0f172a); border-radius: 8px; border: 1px solid rgba(74, 222, 128, 0.4); flex-shrink: 0; position: relative;}
        .caller-ball { width: 8.5vh; height: 8.5vh; border-radius: 50%; background: #fff; color: #000; display: flex; align-items: center; justify-content: center; font-size: 3vh; font-weight: 900; border: 5px solid var(--faded-green); box-shadow: 0 0 25px rgba(74, 222, 128, 0.7), inset 0 0 10px rgba(74, 222, 128, 0.4);}
        
        #game-page .tickets-history-box { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; padding: 5px; background: var(--panel); border: 1px solid var(--border-color); border-radius: 8px; min-height: 0; }
        
        #game-page .game-mini-tickets { flex-grow: 1; display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 6px; overflow: hidden; align-content: stretch; min-height: 0; padding-bottom: 2px; }
        .mini-t-card { background: white; border-radius: 8px; border: 1px solid #ddd; padding: 2px; display: flex; flex-direction: column; box-sizing: border-box; height: 100%; min-height: 0; }
        
        .t-id-badge { text-align: center; font-size: 11px; font-weight: 900; color: #1e293b; margin-bottom: 2px; flex-shrink: 0; }
        .mini-t-id-badge { text-align: center; font-size: 10px; font-weight: 900; color: #1e293b; margin-bottom: 2px; flex-shrink: 0; }
        .t-grid-wrapper { display: flex; flex-grow: 1; min-height: 0; align-items: stretch; }
        .t-side-text { writing-mode: vertical-rl; transform: rotate(180deg); color: #94a3b8; opacity: 0.5; font-weight: normal; font-size: 4px !important; margin-right: 2px; letter-spacing: 0.5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }

        .mini-t-grid { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, minmax(0, 1fr)); gap: 1px; background: #e2e8f0; flex-grow: 1; min-height: 0;}
        .mini-t-head { color: white; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: clamp(7px, 1.5vh, 12px); padding: 2px 0; min-height: 0;}
        .mini-t-cell { background: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: clamp(7px, 1.5vh, 12px); color: #000; min-height: 0;}
        .mini-t-cell.marked { background: #000 !important; color: #fff !important; }

        .history-top-bar { display: flex; gap: 8px; overflow-x: auto; padding: 8px 10px; background: linear-gradient(135deg, #111827, #0f172a); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 12px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5); align-items: center; scrollbar-width: none; flex-shrink: 0; min-height: 45px;}
        .history-top-bar::-webkit-scrollbar { display: none; }
        .hist-top-ball { min-width: 35px; height: 35px; border-radius: 50%; border: 2px solid var(--faded-green); background: rgba(74, 222, 128, 0.1); color: var(--faded-green); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; box-shadow: 0 0 8px rgba(74, 222, 128, 0.4); flex-shrink: 0;}

        #ticket-page.active-page { display: flex !important; flex-direction: column; height: calc(100svh - 60px); overflow: hidden; padding: 8px; box-sizing: border-box; }
        .ticket-top-section { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; position: relative;}
        .t-page-badges-container { position: absolute; top: 0; right: 5px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; z-index: 10; }
        .t-badge-box { background: transparent; display: flex; align-items: center; gap: 5px; }
        .t-badge-box span { font-size: 9px; color: var(--text-gray); font-weight: bold; text-transform: uppercase; }
        .t-badge-box b { font-size: 12px; color: var(--white); font-family: monospace; }
        .t-badge-box.prize-b { background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 4px; padding: 2px 6px; box-shadow: inset 0 0 5px rgba(56, 189, 248, 0.2); }
        .t-badge-box.prize-b b { color: var(--cyan); }

        #ticket-mb-container { display: none; width: 85%; max-width: 320px; margin: 0 auto 6px auto; flex: 0 0 24vh; min-height: 0; }
        #ticket-page.show-mb #ticket-mb-container { display: flex; flex-direction: column; }
        #ticket-master-board { height: 100%; }
        #ticket-master-board .mb-head { font-size: 1.2vh; padding: 1px 0; min-height: 0;}
        #ticket-master-board .mb-cell { font-size: 1.4vh; line-height: 1; min-height: 0; padding: 0;}
        
        #ticket-list { flex-grow: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%; box-sizing: border-box; overflow: hidden; align-content: start; min-height: 0; padding-bottom: 4px; padding-top: 4px;}
        #ticket-page.show-mb #ticket-list { grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 6px; } 

        .t-card { background: #fff; color: #000; border-radius: 8px; padding: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); border: 2px solid #ddd; display: flex; flex-direction: column; box-sizing: border-box; min-height: 0; height: 100%;}
        #ticket-page.show-mb .t-card { padding: 3px; border-radius: 6px; border-width: 1px;}
        .t-grid { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, minmax(0, 1fr)); gap: 1px; background: #000; flex-grow: 1; min-height: 0;}
        .t-cell { background: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: clamp(8px, 1.8vh, 16px); min-height: 0;}
        #ticket-page.show-mb .t-cell { font-size: clamp(7px, 1.5vh, 12px); }
        .t-cell.marked { background: #000 !important; color: white !important;}

        .bingo-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10, 15, 24, 0.95); z-index: 9999; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; backdrop-filter: blur(8px);}
        .bling-text { font-size: 14px; font-weight: bold; color: white; margin-bottom: 15px; animation: blinker 1s linear infinite; text-shadow: 0 0 10px white; }
        @keyframes blinker { 50% { opacity: 0.3; } }
        .bingo-text { font-size: 50px; font-weight: 900; color: #ffffff; margin: 0; text-shadow: 0 0 15px #ffffff, 0 0 30px rgba(255,255,255,0.8); animation: pulseWin 0.8s infinite alternate; letter-spacing: 5px; font-family: 'Arial Black', sans-serif;}
        @keyframes pulseWin { from { transform: scale(1); text-shadow: 0 0 15px #ffffff; } to { transform: scale(1.05); text-shadow: 0 0 25px #ffffff, 0 0 40px rgba(255,255,255,0.9); } }
        .winner-card { background: transparent; padding: 10px; width: 90%; max-width: 400px;}
        #win-ticket-display { margin: 15px auto; width: 100%; display: flex; justify-content: center;}

        .podium-container { display: flex; justify-content: center; align-items: flex-end; gap: 6px; margin-bottom: 20px; padding-top: 30px; }
        .podium-box { display: flex; flex-direction: column; align-items: center; background: linear-gradient(180deg, #1e293b, #0f172a); border-radius: 8px; padding: 10px 4px; width: 28%; text-align: center; position: relative; border: 1px solid #334155; box-shadow: 0 4px 10px rgba(0,0,0,0.5);}
        .podium-1 { border-color: #FFD700; box-shadow: 0 0 15px rgba(255, 215, 0, 0.2); transform: scale(1.1); z-index: 2; height: 90px; justify-content: flex-end;}
        .podium-2 { border-color: #C0C0C0; height: 75px; justify-content: flex-end;}
        .podium-3 { border-color: #CD7F32; height: 65px; justify-content: flex-end;}
        .podium-avatar { width: 35px; height: 35px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 14px; font-weight: 900; margin-bottom: 5px; color: #000; box-shadow: inset 0 -2px 4px rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.5); position: absolute; top: -18px;}
        .p-1-ava { background: linear-gradient(135deg, #FFDF00, #DAA520); width: 45px; height: 45px; font-size: 18px; top: -25px;}
        .p-2-ava { background: linear-gradient(135deg, #E0E0E0, #9E9E9E); }
        .p-3-ava { background: linear-gradient(135deg, #E6A15C, #8B4513); }
        .podium-name { font-size: 9px; color: white; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; margin-bottom: 3px; }
        .podium-prize { font-size: 9px; color: var(--gold); font-weight: 900; background: rgba(0,0,0,0.6); padding: 2px 5px; border-radius: 4px;}
        .crown-icon { position: absolute; top: -45px; font-size: 22px; animation: floatCrown 2s infinite ease-in-out; text-shadow: 0 4px 8px rgba(255,215,0,0.5);}
        .rank-card { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(90deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9)); padding: 12px 15px; border-radius: 10px; border-left: 4px solid var(--faded-green); margin-bottom: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.4); transition: 0.3s; }
        .rank-badge { width: 26px; height: 26px; border-radius: 50%; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; margin-right: 12px; border: 1px solid var(--faded-green); box-shadow: inset 0 0 5px rgba(74,222,128,0.5);}
        
        .bottom-nav { position: fixed; bottom: 0; left: 0; width: 100%; height: 58px; background: #0d1117; display: flex; padding: 6px 0; border-top: 1px solid var(--border-color); z-index: 3000; justify-content: space-around; box-sizing: border-box; }
        .nav-item { text-align: center; color: var(--text-gray); font-size: 11px; cursor: pointer; flex: 1; transition: 0.2s; font-weight: bold;}
        .nav-item.active { color: var(--faded-green); text-shadow: 0 0 10px rgba(74,222,128,0.5);}
        .nav-icon { font-size: 20px; margin-bottom: 2px; display: block;}

        .profile-stat-box { background: var(--panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 15px; text-align: center; margin-bottom: 10px;}
        .prof-avatar-circle { width: 50px; height: 50px; background: linear-gradient(135deg, var(--faded-green), #059669); border-radius: 50%; margin: 0 auto 8px auto; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; color: #000; box-shadow: 0 4px 10px rgba(74, 222, 128, 0.4);}
        .prof-list-btn { background: var(--panel); border: 1px solid var(--border-color); color: white; padding: 12px 15px; border-radius: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 12px; font-weight: bold; width: 100%; box-sizing: border-box;}
        
        .trx-modal-overlay, .pw-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(5px); z-index: 9999; display: none; flex-direction: column; justify-content: flex-end; }
        .pw-modal-overlay { justify-content: center; align-items: center; }
        .trx-modal { background: #0f172a; width: 100%; border-radius: 25px 25px 0 0; padding: 20px 20px 30px 20px; box-sizing: border-box; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1); max-height: 90vh; overflow-y: auto;}
        .trx-modal.show { transform: translateY(0); }
        .trx-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .trx-title { color: white; font-size: 18px; font-weight: 900; margin: 0; }
        .trx-close { color: #64748b; font-size: 14px; cursor: pointer; font-weight: bold; background: none; border: none;}
        .dep-banner { background: linear-gradient(90deg, rgba(217, 119, 6, 0.15), rgba(180, 83, 9, 0.15)); border: 1px solid rgba(217, 119, 6, 0.4); border-radius: 12px; padding: 15px; margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
        .bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
        .bank-btn { display: flex; align-items: center; justify-content: center; gap: 8px; background: #1e293b; color: white; border: 1px solid #334155; padding: 12px; border-radius: 10px; font-size: 13px; font-weight: bold; cursor: pointer; transition: 0.3s;}
        .bank-btn.active { background: white; color: black; border-color: white; transform: scale(1.05); }
        .bank-logo { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; }
        .logo-tb { background: #00b0f0; color: white; } .logo-cbe { background: #502179; color: #fdb913; font-size: 9px;}
        .trx-copy-box { background: #020617; border: 1px solid #1e293b; padding: 15px; border-radius: 10px; margin-bottom: 20px; display: none; justify-content: space-between; align-items: center;}
        .trx-copy-box.show { display: flex; }
        @keyframes popIn { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .pop-anim { animation: popIn 0.3s ease-out; }
        
        .trx-input, .pw-input { width: 100%; background: #020617; border: 1px solid #1e293b; color: white; padding: 15px; border-radius: 10px; box-sizing: border-box; margin-bottom: 4px; font-size: 14px;}
        .trx-submit-btn { background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; font-weight: 900; width: 100%; padding: 16px; border-radius: 12px; border: none; font-size: 18px; cursor: pointer;}
        .trx-submit-btn.red-btn { background: linear-gradient(135deg, #ef4444, #b91c1c); }
        .pw-modal { background: #131b2f; border-radius: 20px; padding: 30px 25px; width: 85%; max-width: 350px; border: 1px solid #1e293b;}
        .pw-btn-row { display: flex; gap: 15px; margin-top: 10px; }
        .pw-btn { flex: 1; padding: 14px; border-radius: 10px; font-weight: bold; border: none; cursor: pointer; }
    </style>
</head>
<body>

<div id="bingo-overlay" class="bingo-overlay">
    <div class="bling-text">✨ ሽልማት ገቢ እየተደረገ ነው... ✨</div>
    <div class="winner-card">
        <h3 style="margin:0; color:white; font-size:12px; letter-spacing: 2px; text-transform: uppercase;">Winner</h3>
        <h1 class="bingo-text">B I N G O !</h1>
        <div id="win-ticket-display"></div>
        <h2 id="win-name" style="margin:10px 0 0 0; color:white; font-size:24px; font-weight:900;">---</h2>
        <p style="margin:2px 0 15px 0; font-size:12px; color:var(--text-gray);">አሸናፊ ካርቴላ: <b id="win-ticket">#---</b></p>
        <div style="background: rgba(0, 0, 0, 0.4); padding: 8px; border-radius: 8px; border: 1px solid #fbbf24; width: fit-content; margin: 0 auto;">
            <p style="margin:0; font-size:10px; color:#fff; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">የገንዘብ ሽልማት (Prize)</p>
            <h1 style="margin:2px 0 0 0; color:#fff; font-size: 22px; text-shadow: 0 0 10px rgba(255, 255, 255, 0.4);" id="win-prize">0 ETB</h1>
        </div>
    </div>
</div>

<div id="dep-modal-overlay" class="trx-modal-overlay" onclick="closeDepositModal(event)">
    <div id="dep-modal" class="trx-modal" onclick="event.stopPropagation()">
        <div class="trx-header"><button class="trx-close" onclick="closeDepositModal()">Close</button><h3 class="trx-title" id="dep-title">Deposit Funds</h3><span style="width:40px;"></span></div>
        <div class="dep-banner">
            <div class="dep-banner-icon">🔥</div>
            <div class="dep-banner-text">ልዩ ስጦታ<br>ከ 100 ብር ጀምሮ ገቢ ሲያደርጉ ተጨማሪ 20% ጉርሻ ያግኙ!</div>
        </div>
        
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 10px; margin-bottom: 15px; font-size: 11px; color: #fca5a5; text-align: center;" id="dep-strict-warn">
            ⚠️ <b>ማሳሰቢያ:</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር፣ እንዲሁም ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBE Birr) ብቻ ገቢ ያድርጉ።
        </div>

        <span class="trx-label">ባንክ ይምረጡ</span>
        <div class="bank-grid" id="dep-bank-grid">
            <div class="bank-btn active" data-bankname="telebirr" onclick="selectBank('telebirr', this, 'dep')"><div class="bank-logo logo-tb">t</div> TeleBirr</div>
            <div class="bank-btn" data-bankname="cbe" onclick="selectBank('cbe', this, 'dep')"><div class="bank-logo logo-cbe">CBE</div> CBE Birr</div>
        </div>
        <div id="dep-copy-box" class="trx-copy-box show">
            <div>
                <small style="color:#64748b; font-size:10px;">Account Name:</small><br><b id="m-dep-name" style="font-size:13px; color:white;">Yohannes aberham</b><br>
                <b id="m-dep-acc" style="font-size:18px; color:var(--cyan); font-family:monospace; margin-top:3px; display:block;">0953839231</b>
            </div>
            <button style="background: #1e293b; border: none; color: white; padding: 8px 15px; border-radius: 8px; font-weight: bold; cursor: pointer;" onclick="copyModalNumber('m-dep-acc')">Copy</button>
        </div>
        <span class="trx-label">መጠን (ብር)</span>
        <input type="number" id="m-dep-amt" class="trx-input" placeholder="">
        <span style="color: #475569; font-size: 10px; display: block; margin-bottom: 20px;">Min: 50 ETB | Max: 100,000 ETB</span>
        
        <span class="trx-label" id="lbl-dep-sms">የከፈሉበት ማረጋገጫ (SMS)</span>
        <textarea id="m-dep-sms" class="trx-input" style="height: 60px; resize: none; margin-bottom: 5px;" placeholder="ከባንክ የተላከሎትን SMS በሙሉ እዚህ Paste ያድርጉ (ትክክለኛ የከፈሉበትን ደረሰኝ)"></textarea>
        <div id="dep-sms-hint" style="font-size: 10px; color: var(--gold); margin-bottom: 20px; line-height: 1.4;">💡 <b>ማሳሰቢያ:</b> ከባንክ የተላከሎትን SMS <b>ሙሉውን</b> ኮፒ በማድረግ እዚህ ይለጥፉ። በተለይ በ <b>CBE Birr</b> ሲያስገቡ የባንኩን ሙሉ ደረሰኝ (SMS) ማካተትዎን አይርሱ።</div>
        
        <button class="trx-submit-btn" onclick="processNewDeposit()" id="m-dep-btn">ጨርስ</button>
        <button class="auth-help-btn" style="margin-top: 12px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); color: var(--cyan);" onclick="window.location.href='https://t.me/bingohabesha'">
            📞 <span>እርዳታ ያስፈልጎታል?</span>
        </button>
    </div>
</div>

<div id="wit-modal-overlay" class="trx-modal-overlay" onclick="closeWithdrawModal(event)">
    <div id="wit-modal" class="trx-modal" onclick="event.stopPropagation()">
        <div class="trx-header"><button class="trx-close" onclick="closeWithdrawModal()">Close</button><h3 class="trx-title" id="wit-title">Withdraw Funds</h3><span style="width:40px;"></span></div>
        <span class="trx-label">ወጪ ማድረጊያ ባንክ</span>
        <div class="bank-grid" id="wit-bank-grid">
            <div class="bank-btn active" data-bankname="telebirr" onclick="selectBank('telebirr', this, 'wit')"><div class="bank-logo logo-tb">t</div> TeleBirr</div>
            <div class="bank-btn" data-bankname="cbe" onclick="selectBank('cbe', this, 'wit')"><div class="bank-logo logo-cbe">CBE</div> CBE Birr</div>
        </div>
        <span class="trx-label">የእርስዎ ስልክ ቁጥር/አካውንት</span>
        <input type="tel" id="m-wit-phone" class="trx-input" placeholder="09********">
        <span style="display: block; margin-bottom: 10px;">&nbsp;</span>
        <span class="trx-label">መጠን (ብር)</span>
        <input type="number" id="m-wit-amt" class="trx-input" placeholder="">
        <span style="color: #475569; font-size: 10px; display: block; margin-bottom: 25px;">Min: 50 ETB | Max: 300,000 ETB</span>
        <button class="trx-submit-btn red-btn" onclick="processNewWithdraw()" id="m-wit-btn">ወጪ ጠይቅ</button>
        <button class="auth-help-btn" style="margin-top: 12px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); color: var(--cyan);" onclick="window.location.href='https://t.me/bingohabesha'">
            📞 <span>እርዳታ ያስፈልጎታል?</span>
        </button>
    </div>
</div>

<div id="pw-modal-overlay" class="pw-modal-overlay">
    <div class="pw-modal">
        <h3 style="color: white; font-size: 18px; font-weight: 900; margin: 0 0 25px 0;">CHANGE PASSWORD</h3>
        <input type="password" id="pw-old" class="pw-input" placeholder="Old Password">
        <input type="password" id="pw-new" class="pw-input" placeholder="New Password (min 4)">
        <input type="password" id="pw-conf" class="pw-input" placeholder="Confirm New Password">
        <div class="pw-btn-row">
            <button class="pw-btn cancel" style="background:#1e293b; color:#94a3b8;" onclick="document.getElementById('pw-modal-overlay').style.display='none'">CANCEL</button>
            <button class="pw-btn save" style="background:var(--faded-green); color:#000;" onclick="savePassword()">SAVE</button>
        </div>
    </div>
</div>

<!-- 1. AUTH PAGE -->
<div id="auth-page" class="page active-page">
    <div class="auth-card">
        <div style="text-align: center; margin-bottom: 10px;">
            <h1 style="margin: 0; font-size: 42px; font-weight: 900; letter-spacing: 2px;">
                <span style="color: #4ade80; text-shadow: 0px 0px 15px rgba(74, 222, 128, 0.6);">ቢንጎ</span> 
                <span style="color: #ffffff; text-shadow: 0px 0px 15px rgba(255, 255, 255, 0.6);">ሀበሻ</span>
            </h1>
            <div style="color: #94a3b8; font-size: 13px; font-weight: bold; letter-spacing: 6px; margin-top: 5px; text-transform: uppercase;">BINGO HABESHA</div>
        </div>
        
        <p id="auth-subtitle" style="font-size: 12px; color: #94a3b8; margin: 20px 0 25px 0;">ይመዝገቡ (10 ETB ቦነስ ያገኛሉ)</p>
        
        <div class="input-group" id="name-group">
            <input type="text" id="reg-name" class="auth-input" placeholder="ሙሉ ስም (Full Name)" onkeyup="v()">
        </div>
        
        <div class="input-group">
            <input type="tel" id="reg-phone" class="auth-input" placeholder="ስልክ ቁጥር (09... ወይም 07...)" onkeyup="v()">
        </div>
        
        <div class="input-group">
            <input type="password" id="reg-pass" class="auth-input" placeholder="የይለፍ ቃል (ቢያንስ 4 ፊደል/ቁጥር)" onkeyup="v()">
            <span class="eye-icon" id="eye-icon" onclick="togglePass()">👁️</span>
        </div>

        <div class="input-group" id="ref-group">
            <input type="text" id="reg-ref" class="auth-input ref-input" placeholder="የጋበዝዎት ሰው ኮድ (ካለዎት)" onkeyup="v()">
        </div>
        
        <div id="terms-box" style="text-align:left; font-size:12px; margin: 5px 0 20px 0; color: #cbd5e1; line-height: 2.2;">
            <label style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="c1" onchange="v()"> እድሜዬ 21+ መሆኑን አረጋግጣለሁ</label>
            <label style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="c2" onchange="v()"> በውልና ደንቦች እስማማለሁ</label>
        </div>
        
        <button id="start-btn" class="auth-btn" disabled onclick="authAction()">ወደ ጌም ግባ (REGISTER)</button>
        <p style="font-size: 13px; color: #4ade80; cursor: pointer; margin-top: 25px; font-weight: bold; text-decoration: underline;" onclick="toggleAuthMode()" id="toggle-auth-text">አካውንት አለዎት? ይግቡ (Login)</p>
        
        <button class="auth-help-btn" onclick="window.location.href='https://t.me/bingohabesha'">
            📞 <span>እርዳታ ያስፈልጎታል? (Need Help)</span>
        </button>
    </div>
</div>

<!-- TOP HEADER -->
<div id="global-header" class="top-balance" style="display:none;">
    <div class="hdr-user-sec">
        <div class="icon">👤</div>
        <div>
            <div id="hdr-name" class="name">User</div>
            <div id="hdr-phone" class="phone">09...</div>
        </div>
    </div>
    <div class="hdr-wallets-right">
        <div class="pill-wallet">
            <span class="title play">PLAY WALLET</span><span class="amt" id="hdr-play-balance">0.00</span>
        </div>
        <div class="pill-wallet">
            <span class="title main">MAIN WALLET</span><span class="amt" id="hdr-main-balance">0.00</span>
        </div>
    </div>
</div>

<!-- 2. HOME PAGE -->
<div id="home-page" class="page">
    
    <div style="display: flex; justify-content: flex-end; margin-bottom: 5px;">
        <div style="display: flex; border: 1px solid #4ade80; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.5);">
            <div id="btn-am" onclick="setLang('AM')" style="background: white; color: black; padding: 4px 12px; font-size: 11px; font-weight: 900; cursor: pointer;">AM</div>
            <div id="btn-en" onclick="setLang('EN')" style="background: black; color: white; padding: 4px 12px; font-size: 11px; font-weight: 900; cursor: pointer;">EN</div>
        </div>
    </div>

    <div style="text-align: center; margin-bottom: 15px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <h1 style="margin: 0; font-size: 32px; font-weight: 900; letter-spacing: 2px;">
            <span style="color: #4ade80; text-shadow: 0px 0px 15px rgba(74, 222, 128, 0.6);">ቢንጎ</span> 
            <span style="color: #ffffff; text-shadow: 0px 0px 15px rgba(255, 255, 255, 0.6);">ሀበሻ</span>
        </h1>
        <div style="color: rgba(255, 255, 255, 0.4); font-size: 14px; font-weight: bold; letter-spacing: 4px; margin-top: 2px;">BINGO HABESHA</div>
    </div>

    <div class="new-timer-box">
        <div class="nt-left">
            <div class="nt-status">ጨዋታው ሊጀምር ነው</div>
            <div class="nt-value" id="timer">00:40</div> 
        </div>
        <div class="nt-right">
            <div class="nt-badge" id="h-lbl-derash">ደራሽ</div>
            <div class="nt-value"><span id="jp">0</span> <span class="nt-currency">ETB</span></div>
        </div>
    </div>

    <div class="live-circle-badge" style="position: fixed; bottom: 75px; right: 15px; z-index: 1000;">
        <div class="live-indicator"><span class="dot"></span> LIVE</div>
        <div style="font-size:8px; color:#94a3b8; font-weight:bold;" id="h-lbl-derash-badge">ደራሽ</div>
        <div class="jp-amount"><span id="h-jp-amt-2">0</span></div>
        <div style="font-size:8px; font-weight:normal; color:#38bdf8;">ETB</div>
    </div>
    
    <div class="grid-subtitle-row" style="margin-top: 15px;">
        <div class="gs-left" id="h-lbl-select">ካርቴላ ይምረጡ (10 ብር)</div>
        <div class="gs-right"><span id="grid-sel-count">0</span><span class="slash">/ 4</span></div>
    </div>

    <div id="grid-box" class="num-grid"></div>
</div>

<div id="bet-slip-popup" class="bet-slip-popup">
    <div style="display:flex; justify-content:space-between; width:100%; margin-bottom:5px;">
        <span style="color:white; font-size:10px; font-weight:bold;"><span id="lbl-sel-tickets">የመረጧቸው ካርቴላዎች: </span> <span id="slip-count" style="color:var(--faded-green);">0</span></span>
        <span style="color:var(--faded-green); font-size:13px; font-weight:900;"><span id="slip-price">0</span> ETB</span>
    </div>
    <div id="ticket-preview-box" class="preview-tickets-wrapper"></div>
    <button onclick="placeBet()" id="bet-btn" class="auth-btn bet-btn-small" style="width: 100%;">BET NOW (ወራረድ)</button>
</div>

<!-- 3. GAME PAGE -->
<div id="game-page" class="page">
    <div class="top-info-wrapper">
        <div class="top-info-box"><div class="info-title" id="g-lbl-round">#ዙር (Round)</div><div class="info-val" id="g-id">#---</div></div>
        <div class="top-info-box"><div class="info-title" id="g-lbl-bet">መወራረጃ</div><div class="info-val">10.00</div></div>
        <div class="top-info-box prize-box"><div class="info-title prize-title" id="g-lbl-prize">ሽልማት (Prize)</div><div class="info-val highlight" id="g-prize">0.00</div></div>
        <div class="top-info-box"><div class="info-title" id="g-lbl-balls">እጣ (Balls)</div><div class="info-val" id="g-balls">0/20</div></div>
    </div>
    <div id="history-scroll-top" class="history-top-bar"></div>
    
    <div class="game-layout-container"> 
        <div class="master-board-wrapper"> 
            <div id="master-board" class="mb-board"></div>
        </div>
        <div class="right-panel-stack">
            <div class="caller-box" style="position: relative;">
                <div id="caller-ball" class="caller-ball">--</div>
                <div id="sound-toggle" onclick="toggleSound()" style="position: absolute; top: 8px; right: 8px; font-size: 16px; cursor: pointer; z-index: 10; background: #1e293b; border-radius: 50%; width: 34px; height: 34px; display: flex; justify-content: center; align-items: center; border: 2px solid #4ade80; box-shadow: 0 0 8px rgba(0,0,0,0.7);">🔊</div>
            </div>
            
            <div class="tickets-history-box">
                <div id="lbl-my-ticket" style="color: var(--faded-green); font-size: 11px; font-weight: bold; margin-bottom: 2px;">የእኔ ካርቴላ (My Ticket)</div>
                <div id="game-mini-tickets" class="game-mini-tickets"></div>
            </div>

            <div class="live-circle-badge">
                <div class="live-indicator" style="font-size: 8px;"><span class="dot" style="width:5px; height:5px;"></span> LIVE</div>
                <div id="lbl-derash-game" style="font-size:7px; color:#94a3b8; font-weight:bold;">ደራሽ</div>
                <div class="jp-amount"><span id="g-jp-amt">0</span></div>
                <div style="font-size:6px; font-weight:normal; color:#38bdf8;">ETB</div>
            </div>
        </div>
    </div>
</div>

<!-- 4. TICKETS PAGE -->
<div id="ticket-page" class="page">
    <div class="ticket-top-section">
        <div class="t-page-badges-container">
            <div class="t-badge-box"><span>Balls:</span><b id="t-page-balls">0/20</b></div>
            <div class="t-badge-box prize-b"><span>Prize:</span><b id="t-page-prize">0.00 ETB</b></div>
        </div>
        <h3 id="t-page-title" style="text-align:left; color:var(--faded-green); margin: 0 0 5px 0; font-size: 18px;">የእኔ ካርቴላዎች</h3>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div class="caller-box" style="width: 50px; min-height: 50px; padding: 0;">
                <div id="ticket-caller-ball" class="caller-ball" style="width: 35px; height: 35px; font-size: 12px; border-width: 3px;">--</div>
            </div>
            <div id="ticket-history-bar" class="history-top-bar" style="flex-grow: 1; margin: 0; min-height: 50px; padding-right: 90px;"><span style="color:var(--text-gray); font-size:11px;">ገና አልጀመረም...</span></div>
        </div>
        <div style="text-align: center; margin-top: 5px;">
            <button id="t-btn-mb" onclick="toggleTicketMasterBoard()" style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid var(--faded-green); color: white; border-radius: 8px; padding: 6px 20px; font-size: 14px; box-shadow: 0 2px 10px rgba(74, 222, 128, 0.2); cursor: pointer; display: flex; align-items: center; justify-content: center; margin: 0 auto; gap: 8px;">
                👁️ <span id="t-btn-mb-txt">ሙሉ ቦርድ እይ (Master Board)</span> <span id="mb-toggle-arrow" style="font-size: 12px; color: var(--faded-green);">▼</span>
            </button>
        </div>
        <p style="text-align: center; font-size: 12px; color: var(--text-gray); margin: 5px 0 0 0;" id="t-info">እስካሁን ካርቴላ አልገዙም</p>
    </div>
    <div id="ticket-mb-container">
        <div id="ticket-master-board" class="mb-board"></div>
    </div>
    <div id="ticket-list"></div>
</div>

<!-- 5. WALLET PAGE -->
<div id="wallet-page" class="page">
    <h3 id="wal-title" style="text-align:center; margin-top: 0; font-size: 20px;">የእኔ ሂሳብ (Wallet)</h3>
    <div style="background: linear-gradient(135deg, #0b111a, #131b2f); border-radius: 15px; padding: 25px 20px; margin-bottom: 10px; border: 1px solid var(--border-color); text-align: center;">
        <div id="wal-main-lbl" style="color: var(--text-gray); font-size: 13px; font-weight:bold;">ዋና ሂሳብ <span style="font-size:9px; color:#fbbf24;">(ያሸነፉት/ወጪ የሚደረግ)</span></div>
        <div style="font-size: 36px; font-weight: 900; color: white; margin: 5px 0; font-family: monospace;" id="main-bal">0.00</div>
        <div style="color: #dbeafe; font-size: 12px; margin-bottom: 10px; display: inline-block;">
            <span id="wal-play-lbl">መጫወቻ ሂሳብ:</span> <b style="color:#38bdf8;"><span id="play-bal">0.00</span> ETB</b>
        </div>
        <div style="display: flex; gap: 15px; justify-content: center; margin-top: 15px;">
            <button id="wal-btn-dep" style="background: linear-gradient(135deg, #0d9488, #0f766e); color: white; border: none; padding: 10px 20px; border-radius: 20px; font-size: 12px; font-weight:bold; cursor:pointer; box-shadow: 0 4px 10px rgba(13, 148, 136, 0.3);" onclick="openDepositModal()">➕ Deposit</button>
            <button id="wal-btn-wit" style="background: linear-gradient(135deg, #e11d48, #be123c); color: white; border: none; padding: 10px 20px; border-radius: 20px; font-size: 12px; font-weight:bold; cursor:pointer; box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);" onclick="openWithdrawModal()">💸 Withdraw</button>
        </div>
    </div>
    <div style="margin-top: 30px; padding: 0 10px;">
        <h4 id="wal-hist-lbl" style="color:var(--text-gray); font-size: 13px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 15px;">የሂሳብ ዝውውር ታሪክ (Approved)</h4>
        <div id="wallet-history-list"><p style="text-align:center; color:var(--text-gray); font-size:11px;">ታሪክ የለም / No History</p></div>
    </div>
</div>

<!-- 6. RANK PAGE -->
<div id="rank-page" class="page">
    <h3 id="rnk-title" style="text-align:center; color:var(--gold); margin-top: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px;">🏆 አሸናፊዎች (Top 10 Rank)</h3>
    <div id="rank-content"><p style="text-align:center; color:var(--text-gray); font-size:13px;">እየጫነ ነው...</p></div>
</div>

<!-- 7. PROFILE PAGE -->
<div id="profile-page" class="page">
    <h3 id="prof-title" style="text-align:center; margin-top: 0; font-size: 16px;">👤 የእኔ ፕሮፋይል</h3>
    
    <div class="profile-stat-box" style="padding: 15px; margin-bottom: 10px;">
        <div id="prof-avatar" class="prof-avatar-circle">U</div>
        <h2 id="prof-name" style="margin: 0; color: white; font-size: 16px;">User Name</h2>
        <p id="prof-phone" style="color: var(--text-gray); margin-top: 4px; font-size: 11px;">09...</p>
        <p id="prof-id-display" style="color: var(--cyan); margin-top: 2px; font-size: 10px; font-weight: bold;">ID: #---</p>
    </div>

    <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9)); border: 1px solid var(--faded-green); border-radius: 12px; padding: 12px 15px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
        <div style="overflow: hidden;">
            <div id="prof-bot-lbl" style="font-size: 11px; color: var(--faded-green); font-weight: bold; margin-bottom: 4px;">🤖 የራስዎ መጋበዣ ሊንክ (Share)</div>
            <div id="prof-ref-text" style="font-size: 11px; color: white; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">t.me/bingo_habesha_bot</div>
        </div>
        <div style="display: flex; gap: 8px;">
            <button id="prof-btn-open" style="background: var(--faded-green); color: black; border: none; padding: 6px 10px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; box-shadow: 0 2px 5px rgba(74,222,128,0.3);">ክፈት</button>
            <button id="prof-btn-copy" style="background: #334155; color: white; border: none; padding: 6px 10px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px;">Copy</button>
        </div>
    </div>

    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <div class="profile-stat-box" style="flex: 1; margin: 0; border-color: var(--blue); padding: 12px;">
            <div id="prof-played-lbl" style="font-size: 10px; color: var(--text-gray);">የተጫወቱት (Played)</div>
            <div style="font-size: 18px; font-weight: bold; color: var(--blue);" id="prof-played">0</div>
        </div>
        <div class="profile-stat-box" style="flex: 1; margin: 0; border-color: var(--faded-green); padding: 12px;">
            <div id="prof-won-lbl" style="font-size: 10px; color: var(--text-gray);">ያሸነፉት (Won)</div>
            <div style="font-size: 18px; font-weight: bold; color: var(--faded-green);" id="prof-won">0</div>
        </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:0px;">
        <button class="prof-list-btn" style="padding: 12px 15px; font-size: 12px; margin-bottom: 8px; border-color: var(--cyan);" onclick="window.location.href='https://t.me/bingohabesha'">
            <div style="display:flex; align-items:center;"><span class="icon-bg" style="padding: 6px; font-size: 14px; margin-right: 10px;">📞</span> <span id="prof-help-lbl" style="color:var(--cyan);">እርዳታ ያስፈልጎታል?</span></div><span style="color:var(--cyan)">></span>
        </button>
        <button class="prof-list-btn" style="padding: 12px 15px; font-size: 12px; margin-bottom: 8px;" onclick="document.getElementById('pw-modal-overlay').style.display='flex'">
            <div style="display:flex; align-items:center;"><span class="icon-bg" style="padding: 6px; font-size: 14px; margin-right: 10px;">🔐</span> <span id="prof-pw-lbl">የይለፍ ቃል ቀይር</span></div><span style="color:var(--text-gray)">></span>
        </button>
        <button class="prof-list-btn logout" style="padding: 12px 15px; font-size: 12px;" onclick="logout()">
            <div style="display:flex; align-items:center;"><span class="icon-bg" style="background:transparent; padding: 6px; font-size: 14px; margin-right: 10px;">🚪</span> <span id="prof-out-lbl">ከሲስተም ውጣ</span></div>
        </button>
    </div>
</div>

<nav id="navbar" class="bottom-nav" style="display: none;">
    <div class="nav-item active" id="nav-home" onclick="handleHomeNav()"><span class="nav-icon" id="nav-icon-home">🏠</span><span id="nav-txt-home">Home</span></div>
    <div class="nav-item" onclick="showPage('ticket')"><span class="nav-icon">🎟️</span><span id="nav-txt-ticket">Ticket</span></div>
    <div class="nav-item" onclick="showPage('wallet')"><span class="nav-icon">💰</span><span id="nav-txt-wallet">Wallet</span></div>
    <div class="nav-item" onclick="loadLeaderboard()"><span class="nav-icon">🏆</span><span id="nav-txt-rank">Rank</span></div>
    <div class="nav-item" onclick="showPage('profile')"><span class="nav-icon">👤</span><span id="nav-txt-profile">Profile</span></div>
</nav>

<script src="/socket.io/socket.io.js"></script>
<script>
    const socket = io();
    let selected = [], called = []; 
    let currentUser = null;
    let pendingTicketsData = []; 
    let userTicketsData = []; 
    let isLoginMode = false;
    let isGameRunningLocally = false;
    let currentGameState = null;
    let globalTakenTickets = []; 
    let isSoundOn = true;

    const depAccounts = { 'telebirr': {num: '0953839231', name: 'Yohannes aberham'}, 'cbe': {num: '0953839231', name: 'Yohannes aberham'} };
    const bHeads = ['B', 'I', 'N', 'G', 'O'];
    const bColors = ['#3b82f6', '#6366f1', '#a855f7', '#4ade80', '#f97316']; 

    function setLang(lang) {
        let btnAm = document.getElementById('btn-am');
        let btnEn = document.getElementById('btn-en');
        if(lang === 'AM') {
            btnAm.style.background = 'white'; btnAm.style.color = 'black'; btnEn.style.background = 'black'; btnEn.style.color = 'white';
            document.getElementById('g-lbl-round').innerText = "#ዙር (Round)"; document.getElementById('g-lbl-bet').innerText = "መወራረጃ"; document.getElementById('g-lbl-prize').innerText = "ሽልማት (Prize)"; document.getElementById('g-lbl-balls').innerText = "እጣ (Balls)"; document.getElementById('lbl-my-ticket').innerText = "የእኔ ካርቴላ (My Ticket)"; document.getElementById('lbl-derash-game').innerText = "ደራሽ";
            document.getElementById('h-lbl-derash').innerText = "ደራሽ"; document.getElementById('h-lbl-derash-badge').innerText = "ደራሽ"; document.getElementById('h-lbl-select').innerText = "ካርቴላ ይምረጡ (10 ብር)"; document.getElementById('lbl-sel-tickets').innerText = "የመረጧቸው ካርቴላዎች: ";
            let status = document.querySelector('.nt-status');
            if(status.innerText.includes("Starting") || status.innerText.includes("ሊጀምር")) { status.innerText = "ጨዋታው ሊጀምር ነው"; } else if(status.innerText.includes("LIVE") || status.innerText.includes("በመካሄድ")) { status.innerText = "ጨዋታው በመካሄድ ላይ ነው"; }
            document.getElementById('nav-txt-home').innerText = "Home"; document.getElementById('nav-txt-ticket').innerText = "Ticket"; document.getElementById('nav-txt-wallet').innerText = "Wallet"; document.getElementById('nav-txt-rank').innerText = "Rank"; document.getElementById('nav-txt-profile').innerText = "Profile";
            document.getElementById('wal-title').innerText = "የእኔ ሂሳብ (Wallet)"; document.getElementById('wal-main-lbl').innerHTML = "ዋና ሂሳብ <span style='font-size:9px; color:#fbbf24;'>(ያሸነፉት/ወጪ የሚደረግ)</span>"; document.getElementById('wal-play-lbl').innerText = "መጫወቻ ሂሳብ:"; document.getElementById('wal-hist-lbl').innerText = "የሂሳብ ዝውውር ታሪክ (Approved)"; document.getElementById('wal-btn-dep').innerText = "➕ Deposit"; document.getElementById('wal-btn-wit').innerText = "💸 Withdraw";
            document.getElementById('rnk-title').innerText = "🏆 አሸናፊዎች (Top 10 Rank)";
            document.getElementById('prof-title').innerText = "👤 የእኔ ፕሮፋይል"; document.getElementById('prof-bot-lbl').innerText = "🤖 የራስዎ መጋበዣ ሊንክ (Share)"; document.getElementById('prof-played-lbl').innerText = "የተጫወቱት (Played)"; document.getElementById('prof-won-lbl').innerText = "ያሸነፉት (Won)"; document.getElementById('prof-help-lbl').innerText = "እርዳታ ያስፈልጎታል?"; document.getElementById('prof-pw-lbl').innerText = "የይለፍ ቃል ቀይር"; document.getElementById('prof-out-lbl').innerText = "ከሲስተም ውጣ";
            document.getElementById('t-page-title').innerText = "የእኔ ካርቴላዎች"; document.getElementById('t-btn-mb-txt').innerText = "ሙሉ ቦርድ እይ (Master Board)";
            document.getElementById('dep-title').innerText = "Deposit Funds"; document.getElementById('wit-title').innerText = "Withdraw Funds";
            document.getElementById('dep-strict-warn').innerHTML = "⚠️ <b>ማሳሰቢያ:</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር፣ እንዲሁም ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBE Birr) ብቻ ገቢ ያድርጉ።";
            document.getElementById('lbl-dep-sms').innerText = "የከፈሉበት ማረጋገጫ (SMS)"; document.getElementById('m-dep-sms').placeholder = "ከባንክ የተላከሎትን SMS በሙሉ እዚህ Paste ያድርጉ";
            document.getElementById('dep-sms-hint').innerHTML = "💡 <b>ማሳሰቢያ:</b> ከባንክ የተላከሎትን SMS <b>ሙሉውን</b> ኮፒ በማድረግ እዚህ ይለጥፉ። በተለይ በ <b>CBE Birr</b> ሲያስገቡ የባንኩን ሙሉ ደረሰኝ ማካተትዎን አይርሱ።";
            document.getElementById('m-dep-btn').innerText = "ጨርስ";
        } else {
            btnEn.style.background = 'white'; btnEn.style.color = 'black'; btnAm.style.background = 'black'; btnAm.style.color = 'white';
            document.getElementById('g-lbl-round').innerText = "Game Round"; document.getElementById('g-lbl-bet').innerText = "Bet Amount"; document.getElementById('g-lbl-prize').innerText = "Prize Pool"; document.getElementById('g-lbl-balls').innerText = "Called Balls"; document.getElementById('lbl-my-ticket').innerText = "My Tickets"; document.getElementById('lbl-derash-game').innerText = "JACKPOT";
            document.getElementById('h-lbl-derash').innerText = "JACKPOT"; document.getElementById('h-lbl-derash-badge').innerText = "JACKPOT"; document.getElementById('h-lbl-select').innerText = "Select Tickets (10 ETB)"; document.getElementById('lbl-sel-tickets').innerText = "Selected Tickets: ";
            let status = document.querySelector('.nt-status');
            if(status.innerText.includes("ሊጀምር") || status.innerText.includes("Starting")) { status.innerText = "Game is Starting"; } else if(status.innerText.includes("በመካሄድ") || status.innerText.includes("LIVE")) { status.innerText = "Game is LIVE"; }
            document.getElementById('nav-txt-home').innerText = "Home"; document.getElementById('nav-txt-ticket').innerText = "Tickets"; document.getElementById('nav-txt-wallet').innerText = "Wallet"; document.getElementById('nav-txt-rank').innerText = "Rank"; document.getElementById('nav-txt-profile').innerText = "Profile";
            document.getElementById('wal-title').innerText = "My Wallet"; document.getElementById('wal-main-lbl').innerHTML = "Main Balance <span style='font-size:9px; color:#fbbf24;'>(Withdrawable)</span>"; document.getElementById('wal-play-lbl').innerText = "Play Balance:"; document.getElementById('wal-hist-lbl').innerText = "Transaction History (Approved)"; document.getElementById('wal-btn-dep').innerText = "➕ Deposit"; document.getElementById('wal-btn-wit').innerText = "💸 Withdraw";
            document.getElementById('rnk-title').innerText = "🏆 Leaderboard (Top 10)";
            document.getElementById('prof-title').innerText = "👤 My Profile"; document.getElementById('prof-bot-lbl').innerText = "🤖 Your Referral Link (Share)"; document.getElementById('prof-played-lbl').innerText = "Games Played"; document.getElementById('prof-won-lbl').innerText = "Total Won"; document.getElementById('prof-help-lbl').innerText = "Need Help?"; document.getElementById('prof-pw-lbl').innerText = "Change Password"; document.getElementById('prof-out-lbl').innerText = "Logout";
            document.getElementById('t-page-title').innerText = "My Tickets"; document.getElementById('t-btn-mb-txt').innerText = "View Master Board";
            document.getElementById('dep-title').innerText = "Deposit Funds"; document.getElementById('wit-title').innerText = "Withdraw Funds";
            document.getElementById('dep-strict-warn').innerHTML = "⚠️ <b>Notice:</b> Please transfer Telebirr to Telebirr ONLY, and CBE Birr to CBE Birr ONLY.";
            document.getElementById('lbl-dep-sms').innerText = "Payment Confirmation (SMS)"; document.getElementById('m-dep-sms').placeholder = "Paste the full SMS receipt from your bank here";
            document.getElementById('dep-sms-hint').innerHTML = "💡 <b>Hint:</b> Copy and paste the <b>full</b> SMS message you received from the bank. Especially for <b>CBE Birr</b>, make sure to include the entire receipt.";
            document.getElementById('m-dep-btn').innerText = "Submit";
        }
    }

    window.onload = async () => {
        buildMasterBoard(); buildTicketMasterBoard(); initGrid();
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
            const tgUser = window.Telegram.WebApp.initDataUnsafe.user; const tgId = tgUser.id.toString();
            document.getElementById('start-btn').innerText = "በቴሌግራም እየገባ ነው..."; document.getElementById('start-btn').disabled = true;
            try {
                let res = await fetch('/api/telegram-login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ telegramId: tgId }) });
                let data = await res.json();
                if (data.success) {
                    processLoginSuccess(data.user);
                    let tRes = await fetch(`/api/user/my-active-tickets/${data.user.phone}`); let tData = await tRes.json();
                    if(tData.success && tData.ticketsData && tData.ticketsData.length > 0) {
                        userTicketsData = tData.ticketsData; renderConfirmedTickets(); renderGridTakenStates(); 
                        if(tData.calledNumbers && tData.calledNumbers.length > 0) {
                            called = tData.calledNumbers;
                            called.forEach(num => {
                                let colIdx = num <= 15 ? 0 : num <= 30 ? 1 : num <= 45 ? 2 : num <= 60 ? 3 : 4; let ballText = bHeads[colIdx] + "-" + num;
                                let topH = document.getElementById('history-scroll-top'); let tickH = document.getElementById('ticket-history-bar');
                                if (topH.innerHTML === '' || tickH.innerText.includes("ገና")) { tickH.innerHTML = ''; }
                                let topDiv = document.createElement('div'); topDiv.className = 'hist-top-ball'; topDiv.innerText = ballText;
                                let tickDiv = document.createElement('div'); tickDiv.className = 'hist-top-ball'; tickDiv.innerText = ballText;
                                topH.insertBefore(topDiv, topH.firstChild); tickH.insertBefore(tickDiv, tickH.firstChild); 
                            });
                            called.forEach(num => { document.querySelectorAll('.t-v-' + num).forEach(c => c.classList.add('marked')); let mbCell = document.getElementById('mb-' + num); if(mbCell) mbCell.classList.add('called'); let tmbCell = document.getElementById('tmb-' + num); if(tmbCell) tmbCell.classList.add('called'); });
                        }
                    }
                    socket.emit('get_initial_data', data.user.phone); return; 
                } else { document.getElementById('start-btn').innerText = "ወደ ጌም ግባ (REGISTER)"; document.getElementById('start-btn').disabled = false; alert(data.message || "Please register via Telegram bot first!"); }
            } catch(e) { document.getElementById('start-btn').innerText = "ወደ ጌም ግባ (REGISTER)"; document.getElementById('start-btn').disabled = false; }
        }

        let savedPhone = localStorage.getItem('bingo_user_phone'); let savedPass = localStorage.getItem('bingo_user_pass');
        if(savedPhone && savedPass) {
            document.getElementById('start-btn').innerText = "እየገባ ነው... (Logging in...)"; document.getElementById('start-btn').disabled = true;
            try {
                let res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone: savedPhone, password: savedPass}) });
                let data = await res.json();
                if(data.success) { 
                    processLoginSuccess(data.user); 
                    let tRes = await fetch(`/api/user/my-active-tickets/${data.user.phone}`); let tData = await tRes.json();
                    if(tData.success && tData.ticketsData && tData.ticketsData.length > 0) {
                        userTicketsData = tData.ticketsData; renderConfirmedTickets(); renderGridTakenStates(); 
                        if(tData.calledNumbers && tData.calledNumbers.length > 0) {
                            called = tData.calledNumbers;
                            called.forEach(num => {
                                let colIdx = num <= 15 ? 0 : num <= 30 ? 1 : num <= 45 ? 2 : num <= 60 ? 3 : 4; let ballText = bHeads[colIdx] + "-" + num;
                                let topH = document.getElementById('history-scroll-top'); let tickH = document.getElementById('ticket-history-bar');
                                if (topH.innerHTML === '' || tickH.innerText.includes("ገና")) { tickH.innerHTML = ''; }
                                let topDiv = document.createElement('div'); topDiv.className = 'hist-top-ball'; topDiv.innerText = ballText;
                                let tickDiv = document.createElement('div'); tickDiv.className = 'hist-top-ball'; tickDiv.innerText = ballText;
                                topH.insertBefore(topDiv, topH.firstChild); tickH.insertBefore(tickDiv, tickH.firstChild); 
                            });
                            called.forEach(num => { document.querySelectorAll('.t-v-' + num).forEach(c => c.classList.add('marked')); let mbCell = document.getElementById('mb-' + num); if(mbCell) mbCell.classList.add('called'); let tmbCell = document.getElementById('tmb-' + num); if(tmbCell) tmbCell.classList.add('called'); });
                        }
                    }
                    socket.emit('get_initial_data', data.user.phone); 
                } else { logout(); }
            } catch(e) { document.getElementById('start-btn').innerText = "ወደ ጌም ግባ (REGISTER)"; document.getElementById('start-btn').disabled = false; }
        }
    };

    function toggleSound() { isSoundOn = !isSoundOn; let st = document.getElementById('sound-toggle'); if(st) st.innerText = isSoundOn ? '🔊' : '🔇'; }
    function toggleTicketMasterBoard() { const page = document.getElementById('ticket-page'); const arrow = document.getElementById('mb-toggle-arrow'); page.classList.toggle('show-mb'); if(page.classList.contains('show-mb')) { arrow.innerText = '▲'; } else { arrow.innerText = '▼'; } }
    function logout() { localStorage.removeItem('bingo_user_phone'); localStorage.removeItem('bingo_user_pass'); window.location.href = "/"; }
    function togglePass() { let x = document.getElementById("reg-pass"); let icon = document.getElementById("eye-icon"); if (x.type === "password") { x.type = "text"; icon.innerText = "🙈"; } else { x.type = "password"; icon.innerText = "👁️"; } }

    function openDepositModal() { document.getElementById('dep-modal-overlay').style.display = 'flex'; setTimeout(() => { document.getElementById('dep-modal').classList.add('show'); }, 10); }
    function closeDepositModal(e) { if(e && e.target.id !== 'dep-modal-overlay') return; document.getElementById('dep-modal').classList.remove('show'); setTimeout(() => { document.getElementById('dep-modal-overlay').style.display = 'none'; }, 300); }
    function openWithdrawModal() { document.getElementById('wit-modal-overlay').style.display = 'flex'; setTimeout(() => { document.getElementById('wit-modal').classList.add('show'); }, 10); }
    function closeWithdrawModal(e) { if(e && e.target.id !== 'wit-modal-overlay') return; document.getElementById('wit-modal').classList.remove('show'); setTimeout(() => { document.getElementById('wit-modal-overlay').style.display = 'none'; }, 300); }
    
    function selectBank(method, element, type) {
        let gridId = type === 'dep' ? 'dep-bank-grid' : 'wit-bank-grid';
        let buttons = document.querySelectorAll(`#${gridId} .bank-btn`); buttons.forEach(btn => btn.classList.remove('active')); element.classList.add('active');
        if(type === 'dep') { let copyBox = document.getElementById('dep-copy-box'); copyBox.classList.remove('pop-anim'); void copyBox.offsetWidth; copyBox.classList.add('show', 'pop-anim'); document.getElementById('m-dep-acc').innerText = depAccounts[method].num; document.getElementById('m-dep-name').innerText = depAccounts[method].name; }
    }
    function copyModalNumber(id) { navigator.clipboard.writeText(document.getElementById(id).innerText); alert("ቁጥሩ ኮፒ ተደርጓል!"); }

    async function processNewDeposit() {
        let amt = parseFloat(document.getElementById('m-dep-amt').value); let activeBtn = document.querySelector('#dep-bank-grid .bank-btn.active'); let method = activeBtn ? activeBtn.getAttribute('data-bankname') : ''; let smsText = document.getElementById('m-dep-sms').value.trim();
        if(!method) return alert("እባክዎ ባንክ ይምረጡ!"); if(!amt || amt < 50) return alert("ዝቅተኛው መጠን 50 ብር ነው!"); if(!smsText) return alert("እባክዎ የSMS ማረጋገጫ ያስገቡ!");
        let btn = document.getElementById('m-dep-btn'); btn.innerText = "እየላከ ነው...";
        try { let res = await fetch('/api/request-tx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: currentUser.phone, type: 'deposit', amount: amt, method: method, sms: smsText }) }); let data = await res.json(); alert(data.message); if(data.success) { document.getElementById('m-dep-amt').value = ''; document.getElementById('m-dep-sms').value = ''; closeDepositModal(); }
        } catch(e) {} btn.innerText = document.getElementById('btn-en').style.background === 'white' ? "Submit" : "ጨርስ";
    }

    async function processNewWithdraw() {
        let amt = parseFloat(document.getElementById('m-wit-amt').value); let activeBtn = document.querySelector('#wit-bank-grid .bank-btn.active'); let method = activeBtn ? activeBtn.getAttribute('data-bankname') : ''; let phone = document.getElementById('m-wit-phone').value.trim();
        if(!method) return alert("እባክዎ ባንክ ይምረጡ!"); if(!phone) return alert("እባክዎ ስልክ ቁጥር ያስገቡ!"); if(!amt || amt < 50 || amt > 300000) return alert("መጠን በ 50 እና 300,000 መሃል መሆን አለበት!");
        let currentMainBal = parseFloat(currentUser.mainBalance) || 0; if(amt > currentMainBal) return alert("በዋና (ያሸነፉት) ሂሳብዎ ላይ በቂ ገንዘብ የሎትም!"); 
        let btn = document.getElementById('m-wit-btn'); btn.innerText = "እየላከ ነው...";
        try { let res = await fetch('/api/request-tx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: currentUser.phone, type: 'withdraw', amount: amt, method: method, destinationPhone: phone }) }); let data = await res.json(); if(data.success) { await fetchUpdatedBalance(); alert(data.message); document.getElementById('m-wit-amt').value = ''; document.getElementById('m-wit-phone').value = ''; closeWithdrawModal(); } else { alert(data.message); } 
        } catch(e) {} btn.innerText = "ወጪ ጠይቅ";
    }

    async function savePassword() {
        let oldPass = document.getElementById('pw-old').value; let newPass = document.getElementById('pw-new').value; let confPass = document.getElementById('pw-conf').value;
        if(!oldPass || !newPass || !confPass) return alert("እባክዎ ሁሉንም ያስገቡ!"); if(newPass !== confPass) return alert("አዲሱ የይለፍ ቃል አይመሳሰልም!");
        try { let res = await fetch('/api/user/change-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone: currentUser.phone, oldPass, newPass}) }); let data = await res.json(); alert(data.message); if(data.success) { localStorage.setItem('bingo_user_pass', newPass); document.getElementById('pw-old').value = ''; document.getElementById('pw-new').value = ''; document.getElementById('pw-conf').value = ''; document.getElementById('pw-modal-overlay').style.display='none'; }
        } catch(e) {}
    }

    function toggleAuthMode() {
        isLoginMode = !isLoginMode; document.getElementById('name-group').style.display = isLoginMode ? 'none' : 'block'; document.getElementById('ref-group').style.display = isLoginMode ? 'none' : 'block'; document.getElementById('terms-box').style.display = isLoginMode ? 'none' : 'block';
        if(isLoginMode) { document.getElementById('start-btn').innerText = "ግባ (LOGIN)"; document.getElementById('auth-subtitle').innerText = "ወደ አካውንትዎ ይግቡ"; document.getElementById('toggle-auth-text').innerText = "አዲስ አካውንት ይክፈቱ (Register)";
        } else { document.getElementById('start-btn').innerText = "ወደ ጌም ግባ (REGISTER)"; document.getElementById('auth-subtitle').innerText = "ይመዝገቡ (10 ETB ቦነስ ያገኛሉ)"; document.getElementById('toggle-auth-text').innerText = "አካውንት አለዎት? ይግቡ (Login)"; } v();
    }

    function v() { 
        let phone = document.getElementById('reg-phone').value.trim(); let pass = document.getElementById('reg-pass').value.trim(); let name = document.getElementById('reg-name').value.trim(); let btn = document.getElementById('start-btn');
        let phoneValid = (phone.startsWith('09') || phone.startsWith('07')) && phone.length === 10 && /^\d+$/.test(phone); let passValid = pass.length >= 4;
        if(isLoginMode) { btn.disabled = !(phoneValid && passValid); } else { let nameValid = name.length > 0; let c1 = document.getElementById('c1').checked; let c2 = document.getElementById('c2').checked; btn.disabled = !(phoneValid && passValid && nameValid && c1 && c2); }
    }

    async function authAction() {
        let phone = document.getElementById('reg-phone').value.trim(); let pass = document.getElementById('reg-pass').value.trim(); let name = document.getElementById('reg-name').value.trim(); let refCode = document.getElementById('reg-ref').value.trim();
        document.getElementById('start-btn').innerText = "እባክዎ ይጠብቁ..."; document.getElementById('start-btn').disabled = true;
        let endpoint = isLoginMode ? '/api/login' : '/api/register';
        let res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone, password: pass, name, refCode}) }); let data = await res.json();
        if(data.success) { if(isLoginMode) { localStorage.setItem('bingo_user_phone', phone); localStorage.setItem('bingo_user_pass', pass); processLoginSuccess(data.user); } else { alert("✅ በተሳካ ሁኔታ ተመዝግበዋል! አሁን ይግቡ (Login)"); toggleAuthMode(); }
        } else { alert(data.message || "ስህተት አጋጥሟል!"); document.getElementById('start-btn').disabled = false; document.getElementById('start-btn').innerText = isLoginMode ? "ግባ (LOGIN)" : "ወደ ጌም ግባ (REGISTER)"; }
    }

    function processLoginSuccess(userObj) {
        currentUser = userObj;
        document.getElementById('hdr-name').innerText = currentUser.name; document.getElementById('hdr-phone').innerText = currentUser.phone; document.getElementById('prof-name').innerText = currentUser.name; document.getElementById('prof-phone').innerText = currentUser.phone; document.getElementById('prof-avatar').innerText = currentUser.name.charAt(0).toUpperCase();
        let displayId = currentUser.userId || currentUser.id || currentUser._id || currentUser.phone.slice(-5); document.getElementById('prof-id-display').innerText = "ID: #" + displayId; document.getElementById('prof-played').innerText = currentUser.played || 0; document.getElementById('prof-won').innerText = (currentUser.won || 0) + " ETB";
        let myRefLink = "https://t.me/bingo_habesha_bot?start=" + currentUser.phone; document.getElementById('prof-ref-text').innerText = "t.me/bingo_habesha_bot?start=" + currentUser.phone; document.getElementById('prof-btn-open').onclick = () => window.location.href = myRefLink; document.getElementById('prof-btn-copy').onclick = () => { navigator.clipboard.writeText(myRefLink); alert('ሊንኩ ኮፒ ተደርጓል!'); };
        updateUIBalance(); document.getElementById('auth-page').classList.remove('active-page'); document.getElementById('navbar').style.display = 'flex'; document.getElementById('global-header').style.display = 'flex'; handleHomeNav();
    }

    async function fetchUpdatedBalance() {
        if(!currentUser) return;
        let res = await fetch(`/api/getUser/${currentUser.phone}`); let data = await res.json();
        if(data.success) { currentUser = data.user; updateUIBalance(); document.getElementById('prof-played').innerText = currentUser.played || 0; document.getElementById('prof-won').innerText = (currentUser.won || 0) + " ETB"; }
    }

    async function loadLeaderboard() {
        showPage('rank'); const content = document.getElementById('rank-content'); content.innerHTML = `<p style="text-align:center; color:var(--text-gray); font-size:13px;">እየጫነ ነው...</p>`;
        try {
            let res = await fetch('/api/leaderboard'); let data = await res.json();
            if(data.success) {
                if(data.leaderboard.length === 0) { content.innerHTML = `<div style="background:rgba(15,23,42,0.5); border-radius:12px; padding:15px; text-align:center; color:var(--text-gray);">እስካሁን አሸናፊ የለም</div>`; } 
                else {
                    let top3 = data.leaderboard.slice(0, 3); let others = data.leaderboard.slice(3); let html = '<div class="podium-container">';
                    if(top3[1]) html += `<div class="podium-box podium-2"><div class="podium-avatar p-2-ava">2</div><div class="podium-name">${top3[1].name}</div><div class="podium-prize">${top3[1].won} ETB</div></div>`;
                    if(top3[0]) html += `<div class="podium-box podium-1"><div class="crown-icon">👑</div><div class="podium-avatar p-1-ava">1</div><div class="podium-name">${top3[0].name}</div><div class="podium-prize">${top3[0].won} ETB</div></div>`;
                    if(top3[2]) html += `<div class="podium-box podium-3"><div class="podium-avatar p-3-ava">3</div><div class="podium-name">${top3[2].name}</div><div class="podium-prize">${top3[2].won} ETB</div></div>`;
                    html += '</div>';
                    others.forEach((u, i) => { html += `<div class="rank-card"><div style="display:flex; align-items:center;"><div class="rank-badge">${i+4}</div><div style="font-weight:bold; color:white; font-size:12px;">${u.name}</div></div><div style="color:var(--faded-green); font-weight:bold; font-size:12px;">${u.won} ETB</div></div>`; });
                    content.innerHTML = html;
                }
            }
        } catch(e) { content.innerHTML = `<p style="text-align:center; color:var(--red);">ስህተት አጋጥሟል</p>`; }
    }

    async function loadTransactionHistory() {
        if(!currentUser) return;
        const hc = document.getElementById('wallet-history-list'); hc.innerHTML = `<p style="text-align:center; color:var(--text-gray); font-size:11px;">እየጫነ ነው...</p>`;
        try {
            let res = await fetch(`/api/user/transactions/${currentUser.phone}`); let data = await res.json();
            if(data.success && data.txs.length > 0) {
                hc.innerHTML = '';
                data.txs.forEach(tx => {
                    let color = tx.type === 'deposit' ? '#0d9488' : '#ef4444'; let sign = tx.type === 'deposit' ? '+' : '-'; let time = new Date(tx.date).toLocaleString();
                    hc.innerHTML += `<div class="list-card" style="border-left-color: ${color}; padding: 10px 15px; background: linear-gradient(90deg, #0b111a, #111827);"><div><span style="font-weight:bold; font-size: 11px; color:white; text-transform:uppercase;">${tx.type} (${tx.method})</span><br><small style="color:var(--text-gray); font-size: 9px;">${time}</small></div><b style="color:${color}; font-size:14px; text-shadow: 0 0 5px ${color};">${sign}${tx.amount} ETB</b></div>`;
                });
            } else { hc.innerHTML = `<p style="text-align:center; color:var(--text-gray); font-size:11px;">ታሪክ የለም</p>`; }
        } catch(e) { hc.innerHTML = `<p style="text-align:center; color:#ef4444; font-size:11px;">Error loading history.</p>`; }
    }

    function updateUIBalance() {
        document.getElementById('hdr-main-balance').innerText = (parseFloat(currentUser.mainBalance) || 0).toFixed(2);
        document.getElementById('hdr-play-balance').innerText = (parseFloat(currentUser.playBalance) || 0).toFixed(2);
        document.getElementById('main-bal').innerText = (parseFloat(currentUser.mainBalance) || 0).toFixed(2);
        let playEl = document.getElementById('play-bal'); if(playEl) playEl.innerText = (parseFloat(currentUser.playBalance) || 0).toFixed(2);
    }

    function formatTime(seconds) { if(isNaN(seconds)) return seconds; let m = Math.floor(seconds / 60); let s = seconds % 60; return `0${m}:${s < 10 ? '0' : ''}${s}`; }

    socket.on('balance_updated', async (phone) => { if(currentUser && phone === currentUser.phone) { await fetchUpdatedBalance(); if(document.getElementById('wallet-page').classList.contains('active-page')) loadTransactionHistory(); } });

    socket.on('sync_data', (data) => {
        globalTakenTickets = data.globalTakenTickets || []; called = data.calledNumbers || []; userTicketsData = data.myTickets || [];
        selected = userTicketsData.map(t => t.id); pendingTicketsData = []; 
        document.getElementById('g-balls').innerText = called.length + "/20"; document.getElementById('t-page-balls').innerText = called.length + "/20"; 
        renderGridTakenStates();
        if(userTicketsData.length > 0) { renderConfirmedTickets(); document.getElementById('t-info').innerText = "የገዙት ካርቴላ ብዛት: " + userTicketsData.length; } else { document.getElementById('t-info').innerText = "እስካሁን ካርቴላ አልገዙም"; }
        document.querySelectorAll('.mb-cell').forEach(c => c.classList.remove('called', 'current')); document.getElementById('history-scroll-top').innerHTML = ''; document.getElementById('ticket-history-bar').innerHTML = '';
        called.forEach((num, idx) => { updateLiveUI(num, idx === called.length - 1); });
    });

    socket.on('update_taken_tickets', (ticketsArr) => { globalTakenTickets = ticketsArr; renderGridTakenStates(); });

    // 🔥 FIXED: BLUR TAKEN TICKETS 🔥
    function renderGridTakenStates() {
        document.querySelectorAll('.num-btn').forEach(btn => {
            let num = parseInt(btn.innerText); let isMine = userTicketsData && userTicketsData.some(t => t.id === num); let isTakenGlobally = globalTakenTickets.includes(num);
            if (isMine) { btn.classList.add('bought-by-me'); btn.classList.remove('taken'); btn.classList.remove('selected'); } 
            else if (isTakenGlobally) {
                btn.classList.add('taken'); btn.classList.remove('selected'); btn.classList.remove('bought-by-me');
                if(selected.includes(num)) { selected = selected.filter(x => x !== num); pendingTicketsData = pendingTicketsData.filter(t => t.id !== num); updateBetPreview(); }
            } else { btn.classList.remove('taken'); btn.classList.remove('bought-by-me'); }
        });
    }

    socket.on('game_status', (data) => {
        document.getElementById('jp').innerText = data.totalPrizePool.toFixed(2); 
        let jpAmtBox2 = document.getElementById('h-jp-amt-2'); if(jpAmtBox2) jpAmtBox2.innerText = data.totalPrizePool.toFixed(2);
        let jpAmtBox = document.getElementById('g-jp-amt'); if(jpAmtBox) jpAmtBox.innerText = data.totalPrizePool.toFixed(2);
        let tPagePrize = document.getElementById('t-page-prize'); if(tPagePrize) tPagePrize.innerText = data.totalPrizePool.toFixed(2) + " ETB";
        if(data.gameId) document.getElementById('g-id').innerText = "#" + data.gameId; document.getElementById('g-prize').innerText = data.totalPrizePool.toFixed(2);

        if (data.state === "WAITING") {
            isGameRunningLocally = false;
            document.getElementById('bingo-overlay').style.display = 'none';
            document.getElementById('timer').innerText = formatTime(data.timer); 
            document.querySelector('.nt-status').innerText = document.getElementById('btn-en').style.background === 'white' ? "Game is Starting" : "ጨዋታው ሊጀምር ነው";
            
            if (currentGameState !== "WAITING") {
                currentGameState = "WAITING";
                document.querySelectorAll('.mb-cell').forEach(c => c.classList.remove('called', 'current'));
                document.getElementById('history-scroll-top').innerHTML = ''; 
                document.getElementById('ticket-history-bar').innerHTML = `<span style="color:var(--text-gray); font-size:11px;">ገና አልጀመረም...</span>`;
                
                document.getElementById('caller-ball').innerText = "--"; let ticketCb = document.getElementById('ticket-caller-ball'); if(ticketCb) ticketCb.innerText = "--";
                document.getElementById('g-balls').innerText = "0/20"; document.getElementById('t-page-balls').innerText = "0/20"; called = []; 
                
                if (currentUser) {
                    userTicketsData = []; pendingTicketsData = []; selected = []; globalTakenTickets = []; 
                    initGrid(); updateBetPreview(); 
                    document.getElementById('ticket-list').innerHTML = ''; document.getElementById('game-mini-tickets').innerHTML = '';
                    document.getElementById('t-info').innerText = "እስካሁን ካርቴላ አልገዙም";
                    if (document.getElementById('game-page').classList.contains('active-page')) { showPage('home'); }
                }
            }
            if (selected.length > 0) { document.getElementById('bet-btn').disabled = false; document.getElementById('bet-btn').innerText = "BET NOW (ወራረድ)"; document.getElementById('bet-slip-popup').classList.add('show');
            } else { document.getElementById('bet-slip-popup').classList.remove('show'); }
            
        } else if (data.state === "PLAYING") {
            isGameRunningLocally = true; document.getElementById('timer').innerText = "LIVE 🔴"; 
            document.querySelector('.nt-status').innerText = document.getElementById('btn-en').style.background === 'white' ? "Game is LIVE" : "ጨዋታው በመካሄድ ላይ ነው";

            if (currentGameState !== "PLAYING") {
                currentGameState = "PLAYING"; 
                document.getElementById('bet-slip-popup').classList.remove('show');
                // 🔥 FIXED: ALL LOGGED IN USERS ARE PUSHED TO PAGE 2 🔥
                if (currentUser && !document.getElementById('game-page').classList.contains('active-page')) { showPage('game'); }
            }
            called = data.calledNumbers || []; 
            document.getElementById('g-balls').innerText = called.length + "/20"; document.getElementById('t-page-balls').innerText = called.length + "/20"; 
            
            document.querySelectorAll('.mb-cell').forEach(c => c.classList.remove('called', 'current'));
            document.getElementById('history-scroll-top').innerHTML = ''; document.getElementById('ticket-history-bar').innerHTML = '';
            called.forEach((num, idx) => { updateLiveUI(num, idx === called.length - 1); });
        }
    });

    socket.on('new_number', (num) => {
        if (!isGameRunningLocally) return;
        called.push(num); 
        document.getElementById('g-balls').innerText = called.length + "/20"; document.getElementById('t-page-balls').innerText = called.length + "/20"; 
        updateLiveUI(num, true);
        userTicketsData.forEach(t => { for(let c=0; c<5; c++) { for(let r=0; r<5; r++) { if(t.grid[c][r] === num) t.marks[c][r] = 1; } } });
    });

    socket.on('game_winner', (data) => {
        document.getElementById('bingo-overlay').style.display = 'flex'; document.getElementById('win-name').innerText = data.winnerName; document.getElementById('win-ticket').innerText = "#" + data.ticketId; document.getElementById('win-prize').innerText = data.prize.toFixed(2) + " ETB";
        let g = data.ticketGrid; let cld = data.calledNumbers;
        let html = `<div style="width:200px; margin: 0 auto; border-radius: 30px; overflow: hidden; background: #ffffff; box-shadow: 0 0 25px rgba(255, 255, 255, 0.4); border: 3px solid #cbd5e1; padding: 6px;">`;
        html += `<div class="preview-t-grid" style="gap: 1px; background: #cbd5e1; border-radius: 24px; overflow: hidden;">`;
        for(let i=0; i<5; i++) { html += `<div class="preview-t-head" style="background:${bColors[i]}; color:#fff; height:25px; font-size:12px; display:flex; align-items:center; justify-content:center;">${bHeads[i]}</div>`; }
        for(let r=0; r<5; r++){
            for(let c=0; c<5; c++){
                let num = g[c][r];
                if(r===2 && c===2) { html += `<div class="preview-t-cell marked" style="background:#fff; height:30px; display:flex; align-items:center; justify-content:center; color:#38bdf8; font-size:18px; text-shadow:0 0 5px #38bdf8;">★</div>`; } 
                else if(cld.includes(num)) { html += `<div class="preview-t-cell" style="background:#fff; height:30px; display:flex; align-items:center; justify-content:center;"><div style="background: linear-gradient(135deg, #22c55e, #16a34a); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color:#fff; font-size: 12px; font-weight: 900; box-shadow: 0 0 8px rgba(34,197,94,0.6);">${num}</div></div>`; } 
                else { html += `<div class="preview-t-cell" style="background:#fff; color:#000; height:30px; font-size:12px; font-weight:bold; display:flex; align-items:center; justify-content:center;">${num}</div>`; }
            }
        }
        html += `</div></div>`; document.getElementById('win-ticket-display').innerHTML = html;
        if(currentUser && data.phone === currentUser.phone) fetchUpdatedBalance(); 
    });

    function initGrid() { 
        const box = document.getElementById('grid-box'); box.innerHTML = ''; 
        for(let i=1; i<=400; i++) { 
            let d = document.createElement('div'); d.className='num-btn'; d.innerText=i; 
            let isMine = userTicketsData && userTicketsData.some(t=>t.id===i);
            if(isMine) { d.classList.add('bought-by-me'); } else if(globalTakenTickets.includes(i)) { d.classList.add('taken'); }

            d.onclick = () => { 
                if(document.getElementById('timer').innerText.includes("LIVE")) return; 
                if(d.classList.contains('taken') || d.classList.contains('bought-by-me')) return; 

                if(d.classList.contains('selected')) { d.classList.remove('selected'); selected = selected.filter(x=>x!=i); pendingTicketsData = pendingTicketsData.filter(t=>t.id!=i); } 
                else if((selected.length + userTicketsData.length) < 4) { 
                    d.classList.add('selected'); selected.push(i); 
                    let cols = [rn(1,15), rn(16,30), rn(31,45), rn(46,60), rn(61,75)]; let marksObj = [[0,0,0,0,0], [0,0,0,0,0], [0,0,1,0,0], [0,0,0,0,0], [0,0,0,0,0]]; 
                    pendingTicketsData.push({ id: i, grid: cols, marks: marksObj });
                } else { alert("በአጠቃላይ ከ 4 ካርቴላ በላይ መግዛት አይቻልም!"); } 
                updateBetPreview(); 
            }; box.appendChild(d); 
        } 
    }

    function updateBetPreview() {
        document.getElementById('jp').innerText = (selected.length * 10); document.getElementById('grid-sel-count').innerText = selected.length;
        const popup = document.getElementById('bet-slip-popup'); const previewBox = document.getElementById('ticket-preview-box'); previewBox.innerHTML = '';
        if(selected.length > 0) {
            popup.classList.add('show'); document.getElementById('slip-count').innerText = selected.length; document.getElementById('slip-price').innerText = selected.length * 10;
            pendingTicketsData.forEach(t => {
                let card = document.createElement('div'); card.className = 'preview-t-card'; 
                let html = `<div style="text-align:center; font-size:10px; font-weight:bold; color:#1e293b; padding:1px;">#${t.id}</div><div class="preview-t-grid">`;
                for(let i=0; i<5; i++) { html += `<div class="preview-t-head" style="background:${bColors[i]}; color: #ffffff; text-shadow: 0 0 5px #ffffff;">${bHeads[i]}</div>`; }
                for(let r=0; r<5; r++) { for(let c=0; c<5; c++) { 
                    if(r==2 && c==2) html += `<div class="preview-t-cell marked" style="color:#38bdf8; font-size:12px; text-shadow:0 0 5px #38bdf8;">★</div>`; 
                    else html += `<div class="preview-t-cell">${t.grid[c][r]}</div>`; 
                } }
                card.innerHTML = html + "</div>"; previewBox.appendChild(card);
            });
        } else { popup.classList.remove('show'); }
    }

    // 🔥 FIXED: BUY TICKETS DEDUCTS FROM PLAY BALANCE ONLY 🔥
    function placeBet() { 
        if(selected.length === 0) return alert("ቢያንስ 1 ካርቴላ ይምረጡ!"); 
        let stolenTickets = selected.filter(x => globalTakenTickets.includes(x));
        if (stolenTickets.length > 0) { alert("የመረጧቸው አንዳንድ ካርቴላዎች በሌላ ሰው ተገዝተዋል!"); renderGridTakenStates(); return; }

        let betAmount = selected.length * 10; 
        let currentPlayBal = parseFloat(currentUser.playBalance) || 0; 
        
        if(currentPlayBal < betAmount) { alert("በመጫወቻ ሂሳብዎ (Play Balance) ላይ በቂ ገንዘብ የሎትም!"); return; }
        
        document.getElementById('bet-btn').innerText = "REGISTERED ✅"; document.getElementById('bet-btn').disabled = true; 
        pendingTicketsData.forEach(t => userTicketsData.push(t)); renderConfirmedTickets(); 
        
        socket.emit('buy_tickets', { name: currentUser.name, phone: currentUser.phone, ticketCount: selected.length, ticketIds: selected, ticketsData: pendingTicketsData });

        setTimeout(() => {
            selected = []; pendingTicketsData = []; document.querySelectorAll('.num-btn').forEach(btn => btn.classList.remove('selected'));
            document.getElementById('bet-slip-popup').classList.remove('show'); document.getElementById('grid-sel-count').innerText = "0"; 
            document.getElementById('bet-btn').innerText = "BET NOW (ወራረድ)"; document.getElementById('bet-btn').disabled = false;
            renderGridTakenStates();
        }, 800);
    }
    
    function renderConfirmedTickets() { 
        const list = document.getElementById('ticket-list'); const gameList = document.getElementById('game-mini-tickets');
        list.innerHTML = ''; gameList.innerHTML = ''; 
        userTicketsData.forEach(t => { 
            let id = t.id; let cols = t.grid;
            let card = document.createElement('div'); card.className = 't-card'; let miniCard = document.createElement('div'); miniCard.className = 'mini-t-card'; 
            let htmlMain = `<div class="t-id-badge">#${id}</div><div class="t-grid-wrapper"><div class="t-side-text">BINGO HABESHA</div><div class="t-grid">`;
            let htmlMini = `<div class="mini-t-id-badge">#${id}</div><div class="t-grid-wrapper"><div class="t-side-text" style="font-size:3px;">BINGO HABESHA</div><div class="mini-t-grid">`;

            for(let i=0; i<5; i++) { htmlMain += `<div class="t-cell" style="background:${bColors[i]}; color:white; border:none;">${bHeads[i]}</div>`; htmlMini += `<div class="mini-t-head" style="background:${bColors[i]}; border:none;">${bHeads[i]}</div>`; } 
            for(let r=0; r<5; r++) { 
                for(let c=0; c<5; c++) { 
                    if(r==2 && c==2) { htmlMain += `<div class="t-cell marked" style="color:#38bdf8; font-size:16px; text-shadow:0 0 5px #38bdf8;">★</div>`; htmlMini += `<div class="mini-t-cell marked" style="color:#38bdf8; font-size:14px; text-shadow:0 0 5px #38bdf8;">★</div>`; } 
                    else { htmlMain += `<div class="t-cell t-v-${cols[c][r]}">${cols[c][r]}</div>`; htmlMini += `<div class="mini-t-cell t-v-${cols[c][r]}">${cols[c][r]}</div>`; } 
                } 
            } 
            htmlMain += "</div></div>"; htmlMini += "</div></div>"; card.innerHTML = htmlMain; miniCard.innerHTML = htmlMini; list.appendChild(card); gameList.appendChild(miniCard);
        }); 
        document.getElementById('t-info').innerText = "የገዙት ካርቴላ ብዛት: " + userTicketsData.length;
    }

    function buildMasterBoard() { const board = document.getElementById('master-board'); board.innerHTML = ''; for(let c=0; c<5; c++) { let h = document.createElement('div'); h.className = 'mb-head'; h.style.background = bColors[c]; h.innerText = bHeads[c]; board.appendChild(h); } for(let r=1; r<=15; r++) { for(let c=0; c<5; c++) { let num = r + (c * 15); let d = document.createElement('div'); d.className = 'mb-cell'; d.id = 'mb-' + num; d.innerText = num; d.style.color = bColors[c]; board.appendChild(d); } } }
    function buildTicketMasterBoard() { const tBoard = document.getElementById('ticket-master-board'); if(!tBoard) return; tBoard.innerHTML = ''; for(let c=0; c<5; c++) { let h = document.createElement('div'); h.className = 'mb-head'; h.style.background = bColors[c]; h.innerText = bHeads[c]; tBoard.appendChild(h); } for(let r=1; r<=15; r++) { for(let c=0; c<5; c++) { let num = r + (c * 15); let d = document.createElement('div'); d.className = 'mb-cell'; d.id = 'tmb-' + num; d.innerText = num; d.style.color = bColors[c]; tBoard.appendChild(d); } } }

    function updateLiveUI(num, isLatest) {
        if(isLatest) document.querySelectorAll('.mb-cell').forEach(c => c.classList.remove('current'));
        let cell = document.getElementById('mb-' + num); if(cell) { cell.classList.add('called'); if(isLatest) cell.classList.add('current'); }
        let tCell = document.getElementById('tmb-' + num); if(tCell) { tCell.classList.add('called'); if(isLatest) tCell.classList.add('current'); }
        document.querySelectorAll('.t-v-' + num).forEach(c => c.classList.add('marked'));
        let colIdx = num <= 15 ? 0 : num <= 30 ? 1 : num <= 45 ? 2 : num <= 60 ? 3 : 4; let ballText = bHeads[colIdx] + "-" + num;
        if(isLatest) { document.getElementById('caller-ball').innerText = ballText; let ticketCb = document.getElementById('ticket-caller-ball'); if(ticketCb) ticketCb.innerText = ballText; }
        let topH = document.getElementById('history-scroll-top'); let tickH = document.getElementById('ticket-history-bar');
        let topDiv = document.createElement('div'); topDiv.className = 'hist-top-ball'; topDiv.innerText = ballText;
        let tickDiv = document.createElement('div'); tickDiv.className = 'hist-top-ball'; tickDiv.innerText = ballText;
        topH.insertBefore(topDiv, topH.firstChild); tickH.insertBefore(tickDiv, tickH.firstChild); 
    }

    function rn(min, max) { let a=[]; while(a.length<5){ let r=Math.floor(Math.random()*(max-min+1))+min; if(!a.includes(r)) a.push(r); } return a.sort((a,b)=>a-b); }
    function handleHomeNav() { if(isGameRunningLocally) showPage('game'); else showPage('home'); }
    function showPage(id) { 
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page')); document.getElementById(id + '-page').classList.add('active-page'); document.getElementById('global-header').style.display = (id === 'auth' || id === 'game') ? 'none' : 'flex'; 
        if(id !== 'home') document.getElementById('bet-slip-popup').classList.remove('show'); else if(selected.length > 0) document.getElementById('bet-slip-popup').classList.add('show');
        if(id === 'wallet') loadTransactionHistory();
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); 
        if(event && event.currentTarget.classList.contains('nav-item')) { event.currentTarget.classList.add('active'); } else { document.getElementById('nav-home').classList.add('active'); }
    }
</script>
</body>
</html>





