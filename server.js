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
    played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, status: { type: String, default: 'active' },
    telegramChatId: { type: String, default: "" } 
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }, smsText: {type: String, default: ""}
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
    const { phone, type, amount, method, sms } = req.body; let user = await User.findOne({phone}); if(!user) return res.json({success: false, message: "ተጠቃሚው አልተገኘም!"});
    if(type === 'withdraw' && user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
    if(type === 'withdraw') { user.mainBalance -= amount; await user.save(); }
    await new Transaction({ phone, type, amount, method, smsText: sms || "" }).save(); res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!" });
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
    if(pass !== GLOBAL_SETTINGS.adminPass && pass !== ADMIN_PASS) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

app.post('/api/admin/users', auth, async (req, res) => res.json(await User.find().sort({ _id: -1 })));
app.post('/api/admin/transactions', auth, async (req, res) => res.json(await Transaction.find().sort({ date: -1 })));
app.post('/api/admin/history', auth, async (req, res) => res.json(await GameHistory.find().sort({ date: -1 }).limit(200)));

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
    await ActiveBonus.create({ amount, maxUsers: phones.length, currentClaims: phones.length });
    for(let phone of phones) {
        let u = await User.findOne({phone: phone.trim()});
        if(u) { u.playBalance += amount; await u.save(); io.emit('balance_updated', u.phone); count++; }
    }
    res.json({ success: true, message: `Bonus sent to ${count} users!` });
});

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE
// ==========================================
let gameState = "WAITING"; let gameClock = 40; let activePlayers = {}; let totalPrizePool = 0; let totalTickets = 0;
let calledNumbers = []; let currentDrawSequence = []; let gameId = Math.floor(Math.random() * 9000) + 1000; let globalTakenTickets = []; 

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
    let pool = Array.from({length: 75}, (_, i) => i + 1); let allTickets = [];
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
    await GameHistory.create({ gameId, ticketId: ticket.id, winnerName: player.name, winnerPhone: player.phone, prize: totalPrizePool, adminProfit: (totalTickets*10)-totalPrizePool, ticketPrice: 10, winningGrid: ticket.grid, calledNumbers: [...calledNumbers]});
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers: [...calledNumbers] });
}

function resetToWaiting() {
    gameState = "WAITING"; gameClock = 40; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
}

setInterval(() => {
    if (gameState === "WAITING") {
        gameClock--; io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 1) { gameState = "PLAYING"; gameClock = 3; currentDrawSequence = generateRiggedDrawSequence(); io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId }); } 
            else { gameClock = 40; }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; if (currentDrawSequence.length === 0) { resetToWaiting(); return; }
            let num = currentDrawSequence.shift(); calledNumbers.push(num); io.emit('new_number', num);
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) { if (serverCheckBingo(ticket.grid, calledNumbers)) { declareWinner(player, ticket); return; } }
            }
        }
    } else if (gameState === "FINISHED") { gameClock--; if (gameClock <= 0) { resetToWaiting(); } }
}, 1000);

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer: gameState === "PLAYING" ? "LIVE" : gameClock, totalPrizePool, totalTickets, calledNumbers: [...calledNumbers], playersCount: Object.keys(activePlayers).length, gameId });
    socket.emit('update_taken_tickets', globalTakenTickets); 

    socket.on('get_initial_data', (phone) => {
        let myData = activePlayers[phone];
        socket.emit('sync_data', { gameState: gameState, globalTakenTickets: globalTakenTickets, calledNumbers: calledNumbers, myTickets: myData ? myData.ticketsData : [] });
    });
    
    socket.on('buy_tickets', async (data) => {
        if (gameState === "WAITING") {
            const betAmount = data.ticketCount * 10; const user = await User.findOne({phone: data.phone});
            if(user && user.status === 'banned') return;
            if(user && (user.playBalance + user.mainBalance) >= betAmount) {
                if (user.playBalance >= betAmount) user.playBalance -= betAmount; else { user.mainBalance -= (betAmount - user.playBalance); user.playBalance = 0; }
                user.played += 1; await user.save();
                
                if (!activePlayers[data.phone]) { activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData }; } 
                else { activePlayers[data.phone].tickets += data.ticketCount; activePlayers[data.phone].ticketsData = [...activePlayers[data.phone].ticketsData, ...data.ticketsData]; }

                totalTickets += data.ticketCount; totalPrizePool = (totalTickets * 10) * 0.85; 
                if(data.ticketIds) { data.ticketIds.forEach(id => { if(!globalTakenTickets.includes(id)) globalTakenTickets.push(id); }); io.emit('update_taken_tickets', globalTakenTickets); }
                socket.emit('balance_updated', data.phone); 
                io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
            }
        }
    });
});

// ======================================================
// ✈️ TELEGRAM INTERACTIVE BOT INTEGRATION
// ======================================================
const TelegramBot = require('node-telegram-bot-api');
const telegramToken = "8369500524:AAGVFwKXWj1I3STNBtfdGKroji4bN4gP5N0"; 
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://bingohabesha.onrender.com";

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });

// 🔥 Broadcast to Channel & Bot Users 🔥
app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.json({ success: false, message: "እባክዎ ሜሴጅ ያስገቡ!" });
        const CHAT_ID = "@bingohabeshazone"; 
        const telegramURL = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
        
        // 1. To Channel
        fetch(telegramURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" }) }).catch(e=>{});
        
        // 2. To All Registered Bot Users
        const users = await User.find({ telegramChatId: { $ne: "" } });
        let count = 0;
        for(let u of users) {
            try { await fetch(telegramURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: u.telegramChatId, text: message, parse_mode: "HTML" }) }); count++; } catch(e){}
        }
        res.json({ success: true, message: `✅ ማስታወቂያው ቻናል ላይ እና ለ ${count} ተጠቃሚዎች Inbox ተልኳል!` });
    } catch (e) { res.status(500).json({ success: false }); }
});

const botState = {};

// 🔥 TELEGRAM BOT MENU BUTTONS 🔥
function getMainMenu(phone, password) {
    let playUrl = (phone && password) ? `${WEB_URL}/?phone=${phone}&pass=${password}` : WEB_URL;
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🎮 Play (ወደ ጌም ግባ)", web_app: { url: playUrl } }],
                [{ text: "💰 ሂሳብ" }, { text: "📥 ገቢ ማድረግ" }],
                [{ text: "📤 ወጪ ማድረግ" }, { text: "🔗 ጋብዝ & አግኝ" }],
                [{ text: "🌐 Language / ቋንቋ" }, { text: "🌟 Special Promoter" }],
                [{ text: "🆘 እርዳታ" }]
            ],
            resize_keyboard: true
        }
    };
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id; botState[chatId] = { step: 'idle' }; 
    bot.sendMessage(chatId, "👋 እንኳን ወደ <b>BINGO HABESHA</b> በደህና መጡ!\n\nጌሙን ለመጀመር እባክዎ ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> የሚለውን ቁልፍ ይጫኑ።", { parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } });
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id; let phone = msg.contact.phone_number;
    if (phone.startsWith('251')) phone = '0' + phone.substring(3); if (phone.startsWith('+251')) phone = '0' + phone.substring(4);
    let name = msg.contact.first_name || "Bingo User"; const newPassword = Math.random().toString(36).slice(-6);
    try {
        let user = await User.findOne({ phone: phone });
        if (!user) { user = new User({ phone, name, password: newPassword, playBalance: 100, telegramChatId: chatId }); await user.save(); } 
        else { user.password = newPassword; user.telegramChatId = chatId; await user.save(); }
        bot.sendMessage(chatId, `🎉 ምዝገባው ተሳክቷል!\n\n👤 ስም: ${name}\n📱 ስልክ: ${phone}\n🔑 Web Pass: ${newPassword}\n\nአሁን ከታች <b>🎮 Play (ወደ ጌም ግባ)</b> የሚለውን በመንካት በቀጥታ ወደ ጌሙ መግባት ይችላሉ!`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
        botState[chatId] = { phone: phone, step: 'idle' };
    } catch (error) {}
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if(!text || text.startsWith('/start') || msg.contact) return;
    let state = botState[chatId] || { step: 'idle' }; let userPhone = state.phone;

    if (text === "💰 ሂሳብ") {
        if(!userPhone) return; let user = await User.findOne({ phone: userPhone });
        if(user) bot.sendMessage(chatId, `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n👤 ስም: ${user.name}\n📱 ስልክ: ${user.phone}\n\n🟢 መጫወቻ ሂሳብ: <b>${user.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና (ያሸነፉት) ሂሳብ: <b>${user.mainBalance.toFixed(2)} ETB</b>`, { parse_mode: "HTML", ...getMainMenu(user.phone, user.password) });
    } else if (text === "🔗 ጋብዝ & አግኝ") {
        if(userPhone) { let u = await User.findOne({phone: userPhone}); bot.sendMessage(chatId, "🔗 <b>ጋብዝ እና አግኝ:</b>\n\nጓደኛዎን ሲጋብዙ የ 10 ብር ቦነስ ያገኛሉ! የጋበዙት ሰው ሲመዘገብ የርስዎን ስልክ ቁጥር ያስገባ።", { parse_mode: "HTML", ...getMainMenu(u.phone, u.password) }); }
    } else if (text === "🌟 Special Promoter") {
        if(userPhone) { let u = await User.findOne({phone: userPhone}); bot.sendMessage(chatId, "🌟 <b>Special Promoter:</b>\n\nልዩ አስተዋዋቂ በመሆን ገቢ ለማግኘት አድሚን ያናግሩ።", { parse_mode: "HTML", ...getMainMenu(u.phone, u.password) }); }
    } else if (text === "🌐 Language / ቋንቋ") {
        // 🔥 LANGUAGE BOT REPLY 🔥
        bot.sendMessage(chatId, "🌐 <b>ቋንቋ / Language</b>\n\nየቋንቋ ምርጫ (AM/EN) የሚገኘው በጌሙ ዋና ገፅ (Website) ላይ ነው። እባክዎ <b>'🎮 Play'</b> የሚለውን ተጭነው ሲገቡ ከላይ ቋንቋዎን መቀየር ይችላሉ።", { parse_mode: "HTML" });
    } else if (text === "🆘 እርዳታ") {
        // 🔥 SUPPORT CLICKABLE INLINE BUTTON 🔥
        bot.sendMessage(chatId, "🆘 <b>የእርዳታ ማዕከል</b>\n\nለማንኛውም ጥያቄ ወይም ድጋፍ እባክዎ ከታች ያለውን ሊንክ በመንካት ያነጋግሩን:", { 
            parse_mode: "HTML", reply_markup: { inline_keyboard: [[ { text: "💬 አድሚን አናግር (Contact Admin)", url: "https://t.me/bingohabesh_support" } ]] }
        });
    }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));

