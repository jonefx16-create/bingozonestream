const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api'); // አንዴ ብቻ ከላይ ተጠርቷል

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ==========================================
// 🔵 DATABASE CONNECTION
// ==========================================
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

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
    status: { type: String, default: 'active' }
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
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }
}));

let GLOBAL_SETTINGS = { adminPass: "bingo1234", ticketPrice: 10, isGamePaused: false };
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused };
}
loadSettings();

const bankAccounts = {
    'TeleBirr': { num: '0933638022', name: 'Tsedey Abebe' },
    'CBE': { num: '0988180301', name: 'Yohannes Aberham' },
    'MPesa': { num: '251707896800', name: 'Yohannes Aberham' }
};

// ==========================================
// 🟢 AUTOMATIC DEPOSIT VERIFICATION ENGINE
// ==========================================
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
                        console.log(`✅ አውቶማቲክ አፕሩቭ፡ ${tx.phone} | የገባው ብር፡ ${actualAmount} | ቦነስ፡ ${bonus}`);
                    }
                    break;
                }
            }
        }
    } catch (err) { console.log("Auto-Approve Error:", err); }
}

// ==========================================
// 🔵 IPHONE SMS WEBHOOK (Received)
// ==========================================
app.post('/api/webhook/iphone-sms', async (req, res) => {
    try {
        const { secret, message } = req.body;
        if(secret !== "Bingo1234Secure") return res.status(401).json({ error: "Unauthorized" });

        let isReceivingMsg = /received|ደረሰዎት|ገቢ|ተቀብለዋል|into your account/i.test(message);
        if(!isReceivingMsg) return res.json({ success: false, msg: "Not a receiving message" });

        let amountMatch = message.match(/(\d+(?:\.\d{1,2})?)\s*(?:ETB|ብር|birr|Birr)/i) || 
                          message.match(/(?:ETB|ብር|birr|Birr)\s*(\d+(?:\.\d{1,2})?)/i);
        let amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

        let txMatch = message.match(/(?:Ref|ID|Txn|Transaction|ቁጥር|ማረጋገጫ)[:\s#-]+([A-Z0-9]+)/i);
        let txRef = txMatch ? txMatch[1] : null;

        if(!txRef) {
            let fallbackMatch = message.match(/\b([A-Z0-9]{8,15})\b/);
            if(fallbackMatch) txRef = fallbackMatch[1];
        }

        if(amount > 0 && txRef) {
            const exists = await BankSMS.findOne({ txRef: txRef });
            if (!exists) {
                await BankSMS.create({ rawText: message, txRef: txRef, amount: amount });
                console.log(`📩 New Official Bank SMS: Ref=${txRef}, Amount=${amount}`);
                await autoApprovePendingDeposits(); 
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ==========================================
// 🔵 USER APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ተመዝግቧል!" });
        let actualRef = "";
        if (refCode) { 
            let ref = await User.findOne({ phone: refCode.trim() }); 
            if (ref) { ref.playBalance += 10; await ref.save(); io.emit('balance_updated', ref.phone); actualRef = ref.phone; } 
        }
        await new User({ phone, name, password, referredBy: actualRef, playBalance: 100 }).save();
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
    res.json({ success: true, message: "✅ የገቢ ጥያቄዎ ደርሶናል፤ ማመሳሰል እየተከናወነ ነው!" });
});

app.get('/api/user/transactions/:phone', async (req, res) => { 
    res.json({ success: true, txs: await Transaction.find({ phone: req.params.phone }).sort({ date: -1 }).limit(30) }); 
});

app.get('/api/leaderboard', async (req, res) => { 
    res.json({ success: true, leaderboard: await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10).select('name won') }); 
});

app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[req.params.phone];
    res.json({ success: true, ticketsData: p ? p.ticketsData : [], calledNumbers: [...calledNumbers], gameState, gameId, globalTakenTickets: [...globalTakenTickets] });
});

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
    res.json({ totalUsers, livePlayers: Object.keys(activePlayers).length, gameState, gameId, totalProfit, settings: GLOBAL_SETTINGS });
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
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    await s.save(); await loadSettings();
    res.json({ success: true });
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
    gameState = "WAITING"; gameClock = 40; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
}

setInterval(() => {
    if(GLOBAL_SETTINGS.isGamePaused) return;
    if (gameState === "WAITING") {
        gameClock--;
        io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 1) {
                gameState = "PLAYING"; gameClock = 3; currentDrawSequence = generateRiggedDrawSequence();
            } else { gameClock = 40; }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; 
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; }
            let num = currentDrawSequence.shift(); calledNumbers.push(num); io.emit('new_number', num);
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) {
                    if (serverCheckBingo(ticket.grid, calledNumbers)) { declareWinner(player, ticket); return; }
                }
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) resetToWaiting();
    }
}, 1000);

// ==========================================
// 🔵 SOCKET.IO HANDLERS
// ==========================================
io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
    socket.on('get_initial_data', (phone) => {
        let myData = activePlayers[phone];
        socket.emit('sync_data', { gameState, globalTakenTickets, calledNumbers, myTickets: myData ? myData.ticketsData : [] });
    });
    socket.on('buy_tickets', async (data) => {
        if(gameState !== "WAITING" || GLOBAL_SETTINGS.isGamePaused) return;
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
            io.emit('update_taken_tickets', globalTakenTickets);
            socket.emit('balance_updated', data.phone);
        }
    });
});

// ======================================================
// ✈️ TELEGRAM INTERACTIVE BOT INTEGRATION
// ======================================================
const telegramToken = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://bingohabesha.onrender.com";

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });

const botState = {};

app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.json({ success: false });
        const CHAT_ID = "@bingohabeshazone"; 
        const telegramURL = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
        await fetch(telegramURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" }) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

const WELCOME_TEXT = `🎉 <b>እንኳን ወደ BINGO HABESHA በደህና መጡ!</b> 🎉\n\nየኢትዮጵያ #1 እና በጣም ታማኝ የሆነው የቢንጎ መጫወቻ ፕላትፎርም። አሁኑኑ ይጫወቱ፣ ያሸንፉ፣ እና ወዲያውኑ ወደ ሂሳብዎ ገቢ ያድርጉ!\n\n👇 <b>ከታች ካሉት አማራጮች የሚፈልጉትን ይምረጡ፡</b>`;

function getProfileText(user) {
    return `👤 <b>የእርስዎ ፕሮፋይል መረጃ</b>\n\n` +
           `🔹 <b>ስም:</b> ${user.name}\n` +
           `🔹 <b>ስልክ:</b> ${user.phone}\n` +
           `🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n` +
           `💰 <b>የሂሳብ መጠን:</b>\n` +
           `   ➖ መጫወቻ ሂሳብ (Play): <b>${user.playBalance.toFixed(2)} ETB</b>\n` +
           `   ➖ ዋና ሂሳብ (Main): <b>${user.mainBalance.toFixed(2)} ETB</b>\n\n` +
           `🎁 በእርስዎ ሊንክ ለሚመዘገብ ሰው ሁሉ 10 ብር ያገኛሉ!`;
}

function getMainMenu(phone, password) {
    let playUrl = (phone && password) ? `${WEB_URL}/?phone=${phone}&pass=${password}` : WEB_URL;
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🎮 ጌም ይጫወቱ (PLAY BINGO)" }], 
                [{ text: "👤 ፕሮፋይል" }, { text: "💰 ሂሳብ" }],
                [{ text: "📥 ገቢ ማድረግ (Deposit)" }, { text: "📤 ወጪ (Withdraw)" }],
                [{ text: "🔗 ጋብዝ & አግኝ (Invite)" }, { text: "🗣 አስተዋውቅ" }],
                [{ text: "📖 መመሪያ" }, { text: "🆘 እርዳታ" }, { text: "📜 ደንቦች" }]
            ],
            resize_keyboard: true
        }
    };
}

const cancelKeyboard = {
    reply_markup: { keyboard: [[{ text: "🔙 ወደ ኋላ ተመለስ" }]], resize_keyboard: true }
};

bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const refCode = match[1]; 
    let user = await User.findOne({ telegramId: msg.from.id.toString() });

    if(user) {
        bot.sendMessage(chatId, WELCOME_TEXT, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } else {
        botState[chatId] = { step: 'idle', refCode: refCode };
        bot.sendMessage(chatId, "👋 እንኳን ወደ <b>BINGO HABESHA</b> መጡ!\n\nጌሙን ለመጀመር ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> ይጫኑ።", { 
            parse_mode: "HTML",
            reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } 
        });
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString(); 
    let phone = msg.contact.phone_number;
    if (phone.startsWith('251')) phone = '0' + phone.substring(3);
    if (phone.startsWith('+251')) phone = '0' + phone.substring(4);

    let user = await User.findOne({ phone: phone });
    let state = botState[chatId] || {};

    try {
        if (!user) {
            const newPassword = Math.random().toString(36).slice(-6);
            let actualRef = "";

            if (state.refCode) {
                let refUser = await User.findOne({ phone: state.refCode });
                if (refUser) {
                    refUser.playBalance += 10;
                    await refUser.save();
                    io.emit('balance_updated', refUser.phone);
                    actualRef = refUser.phone;
                }
            }

            user = await User.create({ phone, name: msg.contact.first_name || "User", password: newPassword, telegramId: telegramId, referredBy: actualRef, playBalance: 100 });
            bot.sendMessage(chatId, `🎉 እንኳን ደስ አሎት <b>${user.name}</b>! ምዝገባው ተጠናቋል።\n\n${WELCOME_TEXT}`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
        } else {
            user.telegramId = telegramId; 
            await user.save();
            bot.sendMessage(chatId, `✅ አካውንትዎ ተገናኝቷል!\n\n${WELCOME_TEXT}`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
        }
        botState[chatId] = { step: 'idle' };
    } catch (error) { bot.sendMessage(chatId, "❌ ይቅርታ፣ ችግር አጋጥሟል።"); }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if(!text || text.startsWith('/start') || msg.contact) return;

    const telegramId = msg.from.id.toString();
    let user = await User.findOne({ telegramId: telegramId });
    let state = botState[chatId] || { step: 'idle' };

    if (text === "🔙 ወደ ኋላ ተመለስ") {
        botState[chatId] = { step: 'idle' };
        if(user) {
            bot.sendMessage(chatId, "❌ ትዕዛዙ ተቋርጧል።", { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
        } else {
            bot.sendMessage(chatId, "❌ ትዕዛዙ ተቋርጧል።", { reply_markup: { remove_keyboard: true } });
        }
        return;
    }

    if (text === "🎮 ጌም ይጫወቱ (PLAY BINGO)") {
        let playUrl = (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL;
        bot.sendMessage(chatId, "🎮 ወደ ጌም መጫወቻ ገጽ ለመግባት ከታች ይጫኑ👇", {
            reply_markup: { inline_keyboard: [[{ text: "🎮 ጌም ይጫወቱ (PLAY)", web_app: { url: playUrl } }]] }
        });
    }
    else if (text === "👤 ፕሮፋይል") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        bot.sendMessage(chatId, getProfileText(user), { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    }
    else if (text === "💰 ሂሳብ") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        bot.sendMessage(chatId, `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n🟢 መጫወቻ ሂሳብ: <b>${user.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና ሂሳብ: <b>${user.mainBalance.toFixed(2)} ETB</b>`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } 
    else if (text === "📥 ገቢ ማድረግ (Deposit)") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        bot.sendMessage(chatId, "🏦 <b>የትኛውን የባንክ አማራጭ መጠቀም ይፈልጋሉ?</b>", { 
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"dep_TeleBirr"}, {text:"🏦 CBE", callback_data:"dep_CBE"}], [{text:"🟢 MPesa", callback_data:"dep_MPesa"}]] } 
        });
        state.step = 'idle';
    } 
    else if (text === "📤 ወጪ (Withdraw)") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        bot.sendMessage(chatId, "🏦 <b>በየትኛው ባንክ ወጪ ማድረግ ይፈልጋሉ?</b>", { 
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"wit_TeleBirr"}, {text:"🏦 CBE", callback_data:"wit_CBE"}], [{text:"🟢 MPesa", callback_data:"wit_MPesa"}]] } 
        });
        state.step = 'idle';
    } 
    else if (text === "🔗 ጋብዝ & አግኝ (Invite)") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        let refLink = `https://t.me/bingo_habesha_bot?start=${user.phone}`;
        let msgText = `🔗 <b>ጋብዝ እና አግኝ (Invite & Earn)</b>\n\nበቢንጎ ሀበሻ ይጫወቱ ይዝናኑ፣ በተጨማሪ ሽልማቶች ይንበሸበሹ! 🎁\n\nይህንን የራስዎ የሆነ መጋበዣ ሊንክ ለጓደኞችዎ ይላኩ። ጓደኛዎ በእርስዎ ሊንክ ገብቶ ሲመዘገብ የ <b>10 ብር ቦነስ</b> ያገኛሉ!\n\n👇 የጋብዝ ሊንክዎ:\n${refLink}`;
        bot.sendMessage(chatId, msgText, { parse_mode: "HTML", disable_web_page_preview: false, ...getMainMenu(user.phone, user.password) });
    } 
    else if (text === "🗣 አስተዋውቅ") {
        if(!user) return bot.sendMessage(chatId, "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።");
        bot.sendMessage(chatId, "🗣 <b>አስተዋውቅ እና አግኝ:</b>\n\nልዩ አስተዋዋቂ በመሆን ተጨማሪ ገቢ ማግኘት ከፈለጉ፣ እባክዎ አድሚን ያናግሩ: @bingohabesha", { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } 
    else if (text === "📖 መመሪያ") {
        if(!user) return;
        let guideText = `📖 <b>የጨዋታው መመሪያ (How to Play):</b>\n\n` +
                        `🎯 <b>እንዴት ይጫወታሉ?</b>\n` +
                        `1️⃣ ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል። (መሀል ላይ ያለው FREE ነው)\n` +
                        `2️⃣ ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል።\n` +
                        `3️⃣ ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።\n\n` +
                        `🏆 <b>እንዴት ያሸንፋሉ? (BINGO መቼ ይዘጋል?)</b>\n` +
                        `የተጠሩት ቁጥሮች በካርቴላዎ ላይ:\n` +
                        `👉 <b>በአግድም</b> (5 ቁጥር)\n` +
                        `👉 <b>ወደ ታች</b> (5 ቁጥር)\n` +
                        `👉 <b>በማዕዘን / X ቅርፅ</b> (5 ቁጥር)\n` +
                        `ሙሉ መስመር ከሰሩ <b>BINGO!</b> ብለው ያሸንፋሉ። አሸናፊው ሲገኝ ጨዋታው በራሱ ተዘግቶ ሽልማቱ ሂሳብዎ ላይ ይገባል!`;
        bot.sendMessage(chatId, guideText, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    }
    else if (text === "🆘 እርዳታ") {
        if(!user) return;
        bot.sendMessage(chatId, "🆘 <b>እርዳታ (Support):</b>\n\nማንኛውም ጥያቄ ካጋጠመዎት አድሚኑን ያናግሩ:\n👉 @bingohabesha", { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } 
    else if (text === "📜 ደንቦች") {
        if(!user) return;
        let rulesText = `📜 <b>የጨዋታው ደንቦች:</b>\n\n` +
            `1️⃣ <b>የገቢ (Deposit) ደንብ:</b>\n` +
            `👉 ከ ቴሌብር ወደ ቴሌብር (Telebirr to Telebirr)\n` +
            `👉 ከ ንግድ ባንክ ወደ ንግድ ባንክ (CBE to CBE) ብቻ ያስገቡ።\n` +
            `⚠️ ይህንን ሳያደርጉ ቀርተው ክፍያዎ ቢዘገይ ድርጅቱ ሀላፊነት አይወስድም።\n\n` +
            `2️⃣ <b>የማረጋገጫ (SMS) ደንብ:</b> ገቢ ሲያደርጉ የደረሰዎትን ትክክለኛ የባንክ ማረጋገጫ ፅሁፍ (SMS/TxRef) በትክክል ያስገቡ። የተሳሳተ ወይም ሀሰተኛ መረጃ ማስገባት አካውንትዎን ያስግዳል!\n\n` +
            `3️⃣ <b>እድሜ:</b> ተጫዋቾች ከ 21 ዓመት በላይ መሆን አለባቸው።\n\n` +
            `4️⃣ <b>ቦነስ:</b> የቦነስ ብር ለመጫወቻ ብቻ የሚያገለግል ሲሆን ወጪ (Withdraw) አይደረግም።`;
        bot.sendMessage(chatId, rulesText, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } 
    
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text);
        if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, "❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ 50 ብር):", cancelKeyboard);
        bot.sendMessage(chatId, `✅ መጠን: <b>${state.amount} ETB</b>\n\nእባክዎ ክፍያ የፈጸሙበትን የ <b>ትክክለኛውን የባንክ SMS ማረጋገጫ (Tx Ref) ፅሁፍ</b> አሁን እዚህ ይላኩ፦`, { parse_mode: "HTML", ...cancelKeyboard });
        state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) {
            await new Transaction({ phone: user.phone, type: 'deposit', amount: state.amount, method: state.method, smsText: text }).save();
            bot.sendMessage(chatId, "✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።", { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
            await autoApprovePendingDeposits();
        }
        state.step = 'idle';
    } 
    else if (state.step === 'awaiting_wit_acc') {
        state.destinationPhone = text.trim();
        bot.sendMessage(chatId, `✅ አካውንት: <b>${state.destinationPhone}</b>\n\nማውጣት የሚፈልጉትን መጠን ያስገቡ (ቢያንስ 50 ብር):`, { parse_mode: "HTML", ...cancelKeyboard });
        state.step = 'awaiting_wit_amt';
    }
    else if (state.step === 'awaiting_wit_amt') {
        state.amount = parseFloat(text);
        if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, "❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ 50 ብር):", cancelKeyboard);
        
        if(user) {
            if(user.mainBalance < state.amount) return bot.sendMessage(chatId, `❌ በዋና ሂሳብዎ ላይ በቂ ብር የለም!`, { ...getMainMenu(user.phone, user.password) });
            user.mainBalance -= state.amount; 
            await user.save();
            await new Transaction({ phone: user.phone, type: 'withdraw', amount: state.amount, method: state.method, smsText: `Transfer to: ${state.destinationPhone}` }).save();
            bot.sendMessage(chatId, `✅ <b>የወጪ ጥያቄዎ ተልኳል!</b>\n\nመጠን: ${state.amount} ETB\nወደ: ${state.destinationPhone}\n\nበቅርቡ ይላካል!`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
        }
        state.step = 'idle';
    }

    botState[chatId] = state;
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if(!botState[chatId]) botState[chatId] = { step: 'idle' };
    let state = botState[chatId];
    
    if (data.startsWith('dep_')) {
        state.method = data.split('_')[1];
        state.step = 'awaiting_dep_amt';
        let accInfo = bankAccounts[state.method] || { num: '09...', name: 'Bingo Admin' };
        bot.sendMessage(chatId, `🏦 ባንክ: <b>${state.method}</b>\n\nእባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: <b>${accInfo.name}</b>\n👉 ቁጥር: <b>${accInfo.num}</b>\n\nከዚያም <b>ያስገቡትን የብር መጠን</b> ብቻ እዚህ ይፃፉልኝ (ምሳሌ: 100):`, { parse_mode: "HTML", ...cancelKeyboard });
    }
    else if (data.startsWith('wit_')) {
        state.method = data.split('_')[1];
        state.step = 'awaiting_wit_acc';
        bot.sendMessage(chatId, `🏦 ባንክ: <b>${state.method}</b>\n\nገንዘቡ እንዲላክልዎ የሚፈልጉትን <b>ስልክ ቁጥር ወይም አካውንት</b> ያስገቡ፦`, { parse_mode: "HTML", ...cancelKeyboard });
    }
    botState[chatId] = state;
    bot.answerCallbackQuery(query.id);
});

// ==========================================
// 🛣️ ROUTES
// ==========================================
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/finance', (req, res) => res.sendFile(path.join(__dirname, 'finance.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));





