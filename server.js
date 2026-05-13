// --- START OF FILE server.js ---
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
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI).then(() => console.log("✅ Database Connected")).catch(err => console.log(err));

// ==========================================
// 🔵 MODELS 
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true }, 
    refCode: { type: String, default: "" }, // 🔥 አጭር መጋበዣ ኮድ መያዣ
    telegramId: { type: String, default: "" }, 
    name: String, 
    password: { type: String, required: true },
    referredBy: { type: String, default: "" }, 
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 }, 
    won: { type: Number, default: 0 }, 
    status: { type: String, default: 'active' },
    language: { type: String, default: 'am' },
    // 🔥 PROMOTER & FIRST DEPOSIT FIELDS 🔥
    isPromoter: { type: Boolean, default: false },
    promoterPercent: { type: Number, default: 10 },
    promoterEarned: { type: Number, default: 0 },
    hasMadeFirstDeposit: { type: Boolean, default: false }, 
    promoterCommissionGenerated: { type: Number, default: 0 } 
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }, smsText: {type: String, default: ""},
    txRef: { type: String, default: "" }
}));

const BankSMS = mongoose.model('BankSMS', new mongoose.Schema({
    rawText: String, txRef: String, amount: Number, isUsed: { type: Boolean, default: false }, dateReceived: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: Number, ticketId: String, winnerName: String, winnerPhone: String, prize: Number,
    adminProfit: { type: Number, default: 0 }, ticketPrice: Number, winningGrid: Array, calledNumbers: Array, playersData: Array, date: { type: Date, default: Date.now }
}));

const ActiveBonus = mongoose.model('ActiveBonus', new mongoose.Schema({
    amount: Number, maxUsers: Number, currentClaims: { type: Number, default: 0 }, claimedBy: [String], expiresAt: Date, isActive: { type: Boolean, default: true }, date: { type: Date, default: Date.now }
}));

const SupportMessage = mongoose.model('SupportMessage', new mongoose.Schema({
    telegramId: String, phone: String, name: String, text: String, sender: { type: String, enum: ['user', 'admin'] }, date: { type: Date, default: Date.now }, isRead: { type: Boolean, default: false }
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }, gameTimer: { type: Number, default: 40 },
    depBonusMinAmount: { type: Number, default: 100 }, depBonusPercent: { type: Number, default: 20 }, depBonusTimeRestricted: { type: Boolean, default: false }, happyHourStart: { type: Number, default: 0 }, happyHourEnd: { type: Number, default: 23 },
    depBannerTextAm: { type: String, default: "" }, depBannerTextEn: { type: String, default: "" },
    witBonusMinAmount: { type: Number, default: 100 }, witBonusPercent: { type: Number, default: 5 }, isWitBonusActive: { type: Boolean, default: false }, witBonusTimeRestricted: { type: Boolean, default: false }, witHappyHourStart: { type: Number, default: 0 }, witHappyHourEnd: { type: Number, default: 23 },
    cashbackMinLoss: { type: Number, default: 200 }, cashbackAmount: { type: Number, default: 10 }, isCashbackActive: { type: Boolean, default: false },
    registerBonus: { type: Number, default: 10 }, inviteBonus: { type: Number, default: 10 }, adminProfitPercent: { type: Number, default: 15 },
    maxTicketsPerUser: { type: Number, default: 4 }
}));

let GLOBAL_SETTINGS = {};
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { 
        adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused, gameTimer: s.gameTimer || 40, 
        depBonusMinAmount: s.depBonusMinAmount !== undefined ? s.depBonusMinAmount : 100, depBonusPercent: s.depBonusPercent !== undefined ? s.depBonusPercent : 20, 
        depBonusTimeRestricted: s.depBonusTimeRestricted || false, happyHourStart: s.happyHourStart !== undefined ? s.happyHourStart : 0, 
        happyHourEnd: s.happyHourEnd !== undefined ? s.happyHourEnd : 23, 
        depBannerTextAm: s.depBannerTextAm || "", depBannerTextEn: s.depBannerTextEn || "",
        witBonusMinAmount: s.witBonusMinAmount !== undefined ? s.witBonusMinAmount : 100, witBonusPercent: s.witBonusPercent !== undefined ? s.witBonusPercent : 5, isWitBonusActive: s.isWitBonusActive || false,
        witBonusTimeRestricted: s.witBonusTimeRestricted || false, witHappyHourStart: s.witHappyHourStart !== undefined ? s.witHappyHourStart : 0, witHappyHourEnd: s.witHappyHourEnd !== undefined ? s.witHappyHourEnd : 23,
        cashbackMinLoss: s.cashbackMinLoss !== undefined ? s.cashbackMinLoss : 200, cashbackAmount: s.cashbackAmount !== undefined ? s.cashbackAmount : 10, isCashbackActive: s.isCashbackActive || false,
        registerBonus: s.registerBonus !== undefined ? s.registerBonus : 10, inviteBonus: s.inviteBonus !== undefined ? s.inviteBonus : 10,
        adminProfitPercent: s.adminProfitPercent !== undefined ? s.adminProfitPercent : 15, maxTicketsPerUser: s.maxTicketsPerUser !== undefined ? s.maxTicketsPerUser : 4
    };
}
loadSettings();

// 🔥 አጭር ኮድ መፍጠሪያ 🔥
function generateRefCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const bankAccounts = { 'TeleBirr': { num: '0953839231', name: 'Yohannes aberham' }, 'CBEBirr': { num: '0953839231', name: 'Yohannes aberham' } };
const WELCOME_PHOTO_URL = "https://i.postimg.cc/fyRC4Vsq/IMG-20260510-002811-640.jpg";

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
    return !!inTxRef;
}

// ==========================================
// 🟢 AUTOMATIC DEPOSIT ENGINE (Promoter Included)
// ==========================================
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
                    let bonus = 0;
                    let set = GLOBAL_SETTINGS;
                    if (actualReceivedAmount >= set.depBonusMinAmount) {
                        let giveBonus = true;
                        if (set.depBonusTimeRestricted) {
                            let currentHour = new Date().getHours();
                            if (currentHour < set.happyHourStart || currentHour > set.happyHourEnd) { giveBonus = false; }
                        }
                        if (giveBonus) { bonus = actualReceivedAmount * (set.depBonusPercent / 100); }
                    }
                    let totalCredit = actualReceivedAmount + bonus;
                    tx.amount = actualReceivedAmount; 
                    tx.status = 'Approved';
                    await tx.save();
                    matchedSMS.isUsed = true;
                    await matchedSMS.save();
                    user.playBalance += totalCredit;

                    // 🔥 PROMOTER COMMISSION LOGIC (FIRST DEPOSIT ONLY & TELEGRAM USERS ONLY) 🔥
                    if(user.referredBy && !user.hasMadeFirstDeposit && user.telegramId && user.telegramId.trim() !== "") {
                        let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                        if(promoter) {
                            let commission = actualReceivedAmount * (promoter.promoterPercent / 100);
                            promoter.mainBalance += commission; 
                            promoter.promoterEarned += commission;
                            await promoter.save();
                            user.promoterCommissionGenerated = commission; 
                            io.emit('balance_updated', promoter.phone);
                        }
                        user.hasMadeFirstDeposit = true; 
                    }
                    
                    await user.save();
                    io.emit('balance_updated', tx.phone);
                }
            }
        }
    } catch (err) { console.log("Auto-Approve Error:", err); }
}

// ==========================================
// 🔵 IPHONE SMS WEBHOOK
// ==========================================
app.post('/api/webhook/iphone-sms', async (req, res) => {
    try {
        const { secret, message } = req.body;
        if(secret !== "Bingo1234Secure") return res.status(401).json({ error: "Unauthorized" });
        if (!message) return res.json({ success: false, msg: "Empty message" });
        let isReceivingMsg = /received|credited|transfer|gebi|into your account/i.test(message);
        if(!isReceivingMsg) return res.json({ success: false, msg: "Not a receiving message" });
        let txRef = getTxRef(message);
        let amount = getBankAmount(message);
        if(amount > 0 && txRef) {
            const exists = await BankSMS.findOne({ txRef: txRef });
            if (!exists) {
                await BankSMS.create({ rawText: message, txRef: txRef, amount: amount });
                await autoApprovePendingDeposits(); 
            }
            res.json({ success: true, amount, txRef });
        } else { res.json({ success: false }); }
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
            let ref = await User.findOne({ $or: [{ phone: refCode.trim() }, { refCode: refCode.trim() }] }); 
            if (ref) { 
                ref.playBalance += GLOBAL_SETTINGS.inviteBonus; 
                await ref.save(); io.emit('balance_updated', ref.phone); actualRef = ref.phone; 
            } 
        }
        let myRefCode = generateRefCode();
        await new User({ phone, name, password, refCode: myRefCode, referredBy: actualRef, playBalance: GLOBAL_SETTINGS.registerBonus }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.password });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ አካውንትዎ ታግዷል!" });
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); } // Backward compatibility
    res.json(user ? { success: true, user } : { success: false, message: "ስልክ ቁጥር ወይም ፓስወርድ ተሳስቷል!" });
});

app.post('/api/telegram-login', async (req, res) => {
    let user = await User.findOne({ telegramId: req.body.telegramId.toString() });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ የታገደ አካውንት!" });
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); } // Backward compatibility
    if(user) res.json({ success: true, user });
    else res.json({ success: false, message: "Share contact in bot first." });
});

app.post('/api/user/change-password', async (req, res) => {
    const { phone, oldPass, newPass } = req.body;
    let user = await User.findOne({ phone, password: oldPass });
    if (!user) return res.json({ success: false, message: "❌ የድሮው ፓስወርድ ትክክል አይደለም!" });
    user.password = newPass; await user.save();
    res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone }); res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    try {
        const { phone, type, amount, method, sms, destinationPhone } = req.body; 
        let user = await User.findOne({phone}); if(!user) return res.json({success: false});
        if(type === 'withdraw') {
            if(user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
            user.mainBalance -= amount; await user.save();
            await new Transaction({ phone, type, amount, method, smsText: `Transfer to: ${destinationPhone || phone}` }).save();
        } else {
            let txRef = getTxRef(sms);
            if (!txRef) return res.json({ success: false, message: "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) አልተገኘም!" });
            if (await isSmsAlreadyUsed(sms)) return res.json({ success: false, message: "❌ ይህ SMS ቀድሞ ጥቅም ላይ ውሏል!" });
            await new Transaction({ phone, type, amount, method, smsText: sms, txRef: txRef }).save();
            await autoApprovePendingDeposits();
        }
        res.json({ success: true, message: "✅ ጥያቄዎ ደርሶናል!" });
    } catch(e) { res.status(500).json({ success: false }); }
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
        let leaderboard = await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10).select('name won'); 
        res.json({ success: true, leaderboard }); 
    } catch(e) { res.json({ success: false }); }
});

// 🔥 CLAIM WEB PROMO BONUS API 🔥
app.post('/api/claim-promo-web', async (req, res) => {
    try {
        let user = await User.findOne({ phone: req.body.phone });
        if(!user) return res.json({success: false, message: "User not found!"});
        
        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) return res.json({ success: false, message: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!" });
        if (activeBonus.currentClaims >= activeBonus.maxUsers) return res.json({ success: false, message: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።" });
        if (activeBonus.claimedBy.includes(user.phone)) return res.json({ success: false, message: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!" });
        
        activeBonus.claimedBy.push(user.phone);
        activeBonus.currentClaims += 1;
        await activeBonus.save();
        
        user.playBalance += activeBonus.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        
        res.json({ success: true, amount: activeBonus.amount });
    } catch(e) { res.json({success: false}); }
});

// ==========================================
// 🔵 ADMIN CONTROL APIs
// ==========================================
const auth = (req, res, next) => { 
    const pass = req.body.adminPass; 
    if(pass !== GLOBAL_SETTINGS.adminPass) return res.status(401).json({error:"Unauthorized"}); 
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
        let users = await User.find({}, 'mainBalance playBalance'); 
        res.json({ success: true, txs, games, bonuses, users });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/live-stats', auth, async (req, res) => {
    const totalUsers = await User.countDocuments();
    const history = await GameHistory.find();
    let totalProfit = history.reduce((sum, h) => sum + (h.adminProfit || 0), 0);
    res.json({ totalUsers, livePlayers: Object.keys(activePlayers).length, gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, gameId, totalProfit, currentJackpot: totalPrizePool, settings: GLOBAL_SETTINGS });
});

// 🔥 PROMOTER APIs 🔥
app.post('/api/admin/promoters-data', auth, async (req, res) => {
    try {
        let promoters = await User.find({ isPromoter: true });
        let data = [];
        for (let p of promoters) {
            let refUsers = await User.find({ referredBy: p.phone });
            let refPhones = refUsers.map(u => u.phone);
            let deps = await Transaction.find({ phone: { $in: refPhones }, type: 'deposit', status: 'Approved' });
            let totalDep = deps.reduce((sum, tx) => sum + tx.amount, 0);
            data.push({
                name: p.name, phone: p.phone, percent: p.promoterPercent,
                earned: p.promoterEarned, usersBrought: refUsers.length, totalDeposits: totalDep
            });
        }
        res.json({ success: true, promoters: data });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/set-promoter', auth, async (req, res) => {
    try {
        const { phone, isPromoter, percent } = req.body;
        let user = await User.findOne({ phone });
        if (user) {
            user.isPromoter = isPromoter;
            if (percent !== undefined) user.promoterPercent = percent;
            await user.save();
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/promoter-details', auth, async (req, res) => {
    try {
        let p = await User.findOne({ phone: req.body.phone, isPromoter: true });
        if(!p) return res.json({ success: false });

        let refUsers = await User.find({ referredBy: p.phone });
        let details = [];
        for(let u of refUsers) {
            let deps = await Transaction.find({ phone: u.phone, type: 'deposit', status: 'Approved' });
            let totalDep = deps.reduce((sum, tx) => sum + tx.amount, 0);
            details.push({
                name: u.name, 
                phone: u.phone, 
                totalDeposit: totalDep, 
                commission: u.promoterCommissionGenerated || 0
            });
        }
        res.json({ success: true, promoter: p, details });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    if (req.body.action === 'Approve') { 
        tx.status = 'Approved'; 
        if(tx.type === 'deposit') {
            let actualAmount = tx.amount;
            let bonus = 0;
            let set = GLOBAL_SETTINGS;
            if (actualAmount >= set.depBonusMinAmount) {
                let giveBonus = true;
                if (set.depBonusTimeRestricted) {
                    let currentHour = new Date().getHours();
                    if (currentHour < set.happyHourStart || currentHour > set.happyHourEnd) { giveBonus = false; }
                }
                if (giveBonus) { bonus = actualAmount * (set.depBonusPercent / 100); }
            }
            let totalCredit = actualAmount + bonus;
            user.playBalance += totalCredit;

            // 🔥 PROMOTER COMMISSION LOGIC (FIRST DEPOSIT ONLY & TELEGRAM USERS ONLY) 🔥
            if(user.referredBy && !user.hasMadeFirstDeposit && user.telegramId && user.telegramId.trim() !== "") {
                let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                if(promoter) {
                    let commission = actualAmount * (promoter.promoterPercent / 100);
                    promoter.mainBalance += commission; 
                    promoter.promoterEarned += commission;
                    await promoter.save();
                    user.promoterCommissionGenerated = commission;
                    io.emit('balance_updated', promoter.phone);
                }
                user.hasMadeFirstDeposit = true;
            }

        } else if (tx.type === 'withdraw') {
            let set = GLOBAL_SETTINGS;
            if(set.isWitBonusActive && tx.amount >= set.witBonusMinAmount) {
                let giveBonus = true;
                if (set.witBonusTimeRestricted) {
                    let currentHour = new Date().getHours();
                    if (currentHour < set.witHappyHourStart || currentHour > set.witHappyHourEnd) { giveBonus = false; }
                }
                if(giveBonus) {
                    let wBonus = tx.amount * (set.witBonusPercent / 100);
                    user.playBalance += wBonus; 
                }
            }
        }
    } else { 
        tx.status = 'Rejected'; 
        if(tx.type === 'withdraw') user.mainBalance += tx.amount; 
    }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass;
    if(req.body.ticketPrice !== undefined) s.ticketPrice = req.body.ticketPrice;
    if(req.body.gameTimer !== undefined) s.gameTimer = req.body.gameTimer;
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    
    if(req.body.depBonusMinAmount !== undefined) s.depBonusMinAmount = req.body.depBonusMinAmount;
    if(req.body.depBonusPercent !== undefined) s.depBonusPercent = req.body.depBonusPercent;
    if(req.body.depBonusTimeRestricted !== undefined) s.depBonusTimeRestricted = req.body.depBonusTimeRestricted;
    if(req.body.happyHourStart !== undefined) s.happyHourStart = req.body.happyHourStart;
    if(req.body.happyHourEnd !== undefined) s.happyHourEnd = req.body.happyHourEnd;
    
    if(req.body.depBannerTextAm !== undefined) s.depBannerTextAm = req.body.depBannerTextAm;
    if(req.body.depBannerTextEn !== undefined) s.depBannerTextEn = req.body.depBannerTextEn;
    
    if(req.body.witBonusMinAmount !== undefined) s.witBonusMinAmount = req.body.witBonusMinAmount;
    if(req.body.witBonusPercent !== undefined) s.witBonusPercent = req.body.witBonusPercent;
    if(req.body.isWitBonusActive !== undefined) s.isWitBonusActive = req.body.isWitBonusActive;
    if(req.body.witBonusTimeRestricted !== undefined) s.witBonusTimeRestricted = req.body.witBonusTimeRestricted;
    if(req.body.witHappyHourStart !== undefined) s.witHappyHourStart = req.body.witHappyHourStart;
    if(req.body.witHappyHourEnd !== undefined) s.witHappyHourEnd = req.body.witHappyHourEnd;
    
    if(req.body.cashbackMinLoss !== undefined) s.cashbackMinLoss = req.body.cashbackMinLoss;
    if(req.body.cashbackAmount !== undefined) s.cashbackAmount = req.body.cashbackAmount;
    if(req.body.isCashbackActive !== undefined) s.isCashbackActive = req.body.isCashbackActive;

    if(req.body.registerBonus !== undefined) s.registerBonus = req.body.registerBonus;
    if(req.body.inviteBonus !== undefined) s.inviteBonus = req.body.inviteBonus;
    if(req.body.adminProfitPercent !== undefined) s.adminProfitPercent = req.body.adminProfitPercent; 
    if(req.body.maxTicketsPerUser !== undefined) s.maxTicketsPerUser = req.body.maxTicketsPerUser; 
    await s.save(); await loadSettings();
    res.json({ success: true });
});

// 🔥 Trigger Cashback API (Manual Force Override allowed)
app.post('/api/admin/trigger-cashback', auth, async (req, res) => {
    try {
        const minL = GLOBAL_SETTINGS.cashbackMinLoss;
        const cAmt = GLOBAL_SETTINGS.cashbackAmount;
        
        let users = await User.find();
        let count = 0;

        for(let u of users) {
            let totalLoss = (u.played * GLOBAL_SETTINGS.ticketPrice) - u.won;
            if(totalLoss >= minL) {
                u.playBalance += cAmt;
                u.played = 0; 
                u.won = 0;    
                await u.save();
                io.emit('balance_updated', u.phone);
                count++;
            }
        }

        if(count === 0) return res.json({ success: false, message: `No users have lost >= ${minL} ETB.` });
        res.json({ success: true, message: `✅ Successfully gave ${cAmt} ETB cashback to ${count} users!` });
    } catch(e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/get-messages', auth, async (req, res) => {
    try {
        let msgs = await SupportMessage.find().sort({ date: 1 });
        res.json({ success: true, msgs });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/reply-message', auth, async (req, res) => {
    try {
        const { telegramId, text } = req.body;
        await SupportMessage.create({ telegramId, text, sender: 'admin' });
        try {
            await bot.sendMessage(telegramId, `👨‍💻 <b>Admin:</b>\n${text}`, { parse_mode: "HTML" });
        } catch(e) { console.log("Bot send failed", e); }
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const { oldPhone, newPhone, userPass, mainBalance, playBalance, won } = req.body;
        let updateData = { phone: newPhone, mainBalance: Number(mainBalance), playBalance: Number(playBalance), won: Number(won) };
        if (userPass && userPass.trim() !== "") { updateData.password = userPass; }
        await User.findOneAndUpdate({ phone: oldPhone }, updateData);
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/unban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: req.body.phone }, { status: 'active' }); res.json({ success: true }); });

app.post('/api/admin/factory-reset', auth, async (req, res) => {
    await User.deleteMany({}); await Transaction.deleteMany({}); await GameHistory.deleteMany({}); await BankSMS.deleteMany({}); await ActiveBonus.deleteMany({}); await SupportMessage.deleteMany({});
    res.json({ success: true, message: "✅ ሲስተሙ ሙሉ በሙሉ ፀድቷል! ሁሉም ዳታ ጠፍቷል እንደ አዲስ ይጀምራል።" });
});

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

app.post('/api/admin/claim-bonus-list', auth, async (req, res) => {
    try {
        let activeBonus = await ActiveBonus.findOne({ isActive: true });
        if(!activeBonus) return res.json({ success: false, message: "No active promo." });
        res.json({ success: true, claimedBy: activeBonus.claimedBy, max: activeBonus.maxUsers });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/create-claim-bonus', auth, async (req, res) => {
    try {
        const { maxUsers, amount, minutes, message, photoUrl } = req.body;
        let expires = new Date(Date.now() + (minutes * 60000));
        await ActiveBonus.updateMany({}, { isActive: false });
        await new ActiveBonus({ amount, maxUsers, expiresAt: expires, isActive: true }).save();
        
        // 🔥 BROADCAST TO WEB APP USERS 🔥
        io.emit('new_promo_alert', { amount: amount, msg: message });

        if (message) {
            const users = await User.find({ telegramId: { $ne: "" } });
            lastBroadcasts = []; 
            const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: `🎁 Claim ${amount} ETB Bonus`, callback_data: 'claim_promo' }]] } };

            for (let u of users) {
                try {
                    let sentMsg;
                    if (photoUrl && photoUrl.startsWith('data:image')) {
                        let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); 
                        let photoBuffer = Buffer.from(base64Data, 'base64');
                        sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, ...opts });
                    } else if (photoUrl && photoUrl.startsWith('http')) { 
                        sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, ...opts });
                    } else { 
                        sentMsg = await bot.sendMessage(u.telegramId, message, opts); 
                    }
                    lastBroadcasts.push({ chatId: u.telegramId, messageId: sentMsg.message_id }); 
                } catch(e) {} 
            }
        }
        res.json({ success: true, message: `✅ Promo Created & Broadcasted to Telegram & Web App!` });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error processing promo." });
    }
});

// 🔥 TELEGRAM BOT INTEGRATION 🔥
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
let totalCollectedMoney = 0; 
let totalTickets = 0;
let calledNumbers = []; 
let currentDrawSequence = []; 
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

function serverCheckBingo(grid, called) {
    let m = Array(5).fill().map(() => Array(5).fill(false));
    for(let c=0; c<5; c++) {
        for(let r=0; r<5; r++) {
            if((c===2 && r===2) || called.includes(grid[c][r])) {
                m[c][r] = true;
            }
        }
    }
    for(let c=0; c<5; c++) if(m[c][0]&&m[c][1]&&m[c][2]&&m[c][3]&&m[c][4]) return true; 
    for(let r=0; r<5; r++) if(m[0][r]&&m[1][r]&&m[2][r]&&m[3][r]&&m[4][r]) return true; 
    if(m[0][0]&&m[1][1]&&m[2][2]&&m[3][3]&&m[4][4]) return true; 
    if(m[0][4]&&m[1][3]&&m[2][2]&&m[3][1]&&m[4][0]) return true; 
    if(m[0][0] && m[0][4] && m[4][0] && m[4][4]) return true;
    return false;
}

function generateDrawSequence() {
    let pool = Array.from({length: 75}, (_, i) => i + 1);
    return pool.sort(() => Math.random() - 0.5); 
}

async function declareWinners(winners) {
    gameState = "FINISHED"; gameClock = 12; 
    
    let splitPrize = Number((totalPrizePool / winners.length).toFixed(2));
    let adminProfit = totalCollectedMoney - totalPrizePool; 
    
    let winnerNames = [];
    let winnerPhones = [];
    let ticketIds = [];
    
    for (let w of winners) {
        const user = await User.findOne({phone: w.player.phone});
        if(user) { 
            user.mainBalance += splitPrize; 
            user.won += splitPrize; 
            await user.save(); 
            io.emit('balance_updated', w.player.phone); 
        }
        winnerNames.push(w.player.name);
        winnerPhones.push(w.player.phone);
        ticketIds.push(w.ticket.id);
    }

    let uniqueNames = [...new Set(winnerNames)];
    let displayNames = uniqueNames.join(' እና ');

    await GameHistory.create({ 
        gameId, 
        ticketId: ticketIds.join(', '), 
        winnerName: displayNames, 
        winnerPhone: winnerPhones.join(', '), 
        prize: totalPrizePool,
        adminProfit, 
        ticketPrice: GLOBAL_SETTINGS.ticketPrice, 
        winningGrid: winners[0].ticket.grid, 
        calledNumbers: [...calledNumbers], 
        playersData: Object.values(activePlayers) 
    });

    io.emit('game_winner', { 
        winnerName: displayNames, 
        ticketId: ticketIds.join(', '), 
        prize: splitPrize, 
        totalPrize: totalPrizePool, 
        phone: winnerPhones.join(', '), 
        ticketGrid: winners[0].ticket.grid, 
        calledNumbers: [...calledNumbers],
        isShared: winners.length > 1,
        winnerCount: winners.length
    });
}

function resetToWaiting() {
    gameState = "WAITING"; gameClock = GLOBAL_SETTINGS.gameTimer; activePlayers = {}; 
    totalPrizePool = 0; totalCollectedMoney = 0; totalTickets = 0; 
    calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
}

setInterval(() => {
    if(GLOBAL_SETTINGS.isGamePaused) { io.emit('game_status', { state: "MAINTENANCE", timer: 0, totalPrizePool: 0, totalTickets: 0, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers: [], playersCount: 0, gameId, maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn }); return; }
    if (gameState === "WAITING") {
        gameClock--;
        io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn });
        
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 1) { 
                gameState = "PLAYING"; gameClock = 3; currentDrawSequence = generateDrawSequence(); 
                io.emit('game_status', { state: gameState, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn });
            } else { 
                gameClock = GLOBAL_SETTINGS.gameTimer; 
            }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; 
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; } 
            
            let num = currentDrawSequence.shift(); 
            calledNumbers.push(num); 
            io.emit('new_number', num);
            
            let winnersThisRound = [];
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) { 
                    if (serverCheckBingo(ticket.grid, calledNumbers)) { 
                        winnersThisRound.push({ player, ticket });
                    } 
                }
            }
            if(winnersThisRound.length > 0) {
                declareWinners(winnersThisRound);
                return;
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) resetToWaiting();
    }
}, 1000);

io.on('connection', (socket) => {
    let stateToSend = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
    socket.emit('game_status', { state: stateToSend, timer: gameClock, totalPrizePool, totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn });
    socket.on('get_initial_data', (phone) => { let myData = activePlayers[phone]; socket.emit('sync_data', { gameState: stateToSend, globalTakenTickets, calledNumbers, myTickets: myData ? myData.ticketsData : [] }); });
    
    socket.on('buy_tickets', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return; 
        
        let currentTickets = activePlayers[data.phone] ? activePlayers[data.phone].tickets : 0;
        if (currentTickets + data.ticketCount > GLOBAL_SETTINGS.maxTicketsPerUser) {
            socket.emit('bet_error', `❌ ይቅርታ! በአጠቃላይ ከ ${GLOBAL_SETTINGS.maxTicketsPerUser} ካርቴላ በላይ መግዛት አይቻልም!`);
            return;
        }

        const betAmount = data.ticketCount * GLOBAL_SETTINGS.ticketPrice;
        const user = await User.findOne({phone: data.phone});
        if(user && (user.playBalance + user.mainBalance) >= betAmount) {
            if (user.playBalance >= betAmount) user.playBalance -= betAmount;
            else { user.mainBalance -= (betAmount - user.playBalance); user.playBalance = 0; }
            user.played += 1; await user.save();
            if (!activePlayers[data.phone]) activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
            else { activePlayers[data.phone].tickets += data.ticketCount; activePlayers[data.phone].ticketsData.push(...data.ticketsData); }
            
            totalTickets += data.ticketCount; 
            totalCollectedMoney += betAmount;
            totalPrizePool += betAmount * ((100 - GLOBAL_SETTINGS.adminProfitPercent) / 100);
            
            data.ticketIds.forEach(id => globalTakenTickets.push(id));
            io.emit('update_taken_tickets', globalTakenTickets); socket.emit('balance_updated', data.phone);
        }
    });
});

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
const botState = {};

// ... (Rest of language dictionary)
const t = {
    am: {
        welcome: "🎉 <b>እንኳን ወደ BINGO HABESHA በደህና መጡ!</b> 🎉\n\nየኢትዮጵያ #1 እና በጣም ታማኝ የሆነው የቢንጎ መጫወቻ ፕላትፎርም። አሁኑኑ ይጫወቱ፣ ያሸንፉ፣ እና ወዲያውኑ ወደ ሂሳብዎ ገቢ ያድርጉ!\n\n👇 <b>ከታች ካሉት አማራጮች የሚፈልጉትን ይምረጡ፡</b>",
        btn_play: "🎮 ጌም ይጫወቱ (PLAY)", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሂሳብ", btn_deposit: "📥 ገቢ (Deposit)", btn_withdraw: "📤 ወጪ (Withdraw)", btn_invite: "🔗 ጋብዝ & አግኝ", btn_promo: "🗣 ድርጅቱን አስተዋውቅ", btn_guide: "📖 መመሪያ", btn_help: "🆘 እርዳታ", btn_rules: "📜 ደንቦች", btn_lang: "🌐 ቋንቋ (Language)", btn_bonus: "🎁 ቦነስ (Claim Promo)", btn_back: "🔙 ወደ ኋላ ተመለስ",
        share_contact: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", err_reg_first: "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።", err_cancel: "❌ ትዕዛዙ ተቋርጧል።",
        profile_text: (u) => `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልክ:</b> ${u.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${u.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n🟢 መጫወቻ ሂሳብ (Play): <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና ሂሳብ (Main): <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>የትኛውን የባንክ አማራጭ መጠቀም ይፈልጋሉ?</b>", wit_msg: "🏦 <b>በየትኛው ባንክ ወጪ ማድረግ ይፈልጋሉ?</b>",
        invite_msg: (l) => `🔗 <b>ጋብዝ እና አግኝ</b>\n\nይህንን የራስዎ የሆነ መጋበዣ ሊንክ ለጓደኞችዎ ይላኩ። ጓደኛዎ በእርስዎ ሊንክ ገብቶ ሲመዘገብ <b>እርስዎም ሆነ ጓደኛዎ ልዩ የመጫወቻ ቦነስ ያገኛላችሁ!</b>\n\n👇 የጋብዝ ሊንክዎ:\n${l}`,
        guide_msg: `📖 <b>የጨዋታው መመሪያ:</b>\n\n1️⃣ ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል።\n2️⃣ ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል።\n3️⃣ ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።\n\n🏆 <b>እንዴት ያሸንፋሉ?</b>\nየተጠሩት ቁጥሮች በአግድም፣ ወደ ታች፣ በማዕዘን (X ቅርፅ) ወይም 4ቱን ጥግ ከሰሩ <b>BINGO!</b> ብለው ያሸንፋሉ።`,
        rules_msg: `📜 <b>የጨዋታው ደንቦች:</b>\n\n1️⃣ <b>የሂሳብ ደንቦች:</b>\n🟢 <b>መጫወቻ ሂሳብ:</b> ካርድ ገዝቶ ለመጫወት ብቻ የሚያገለግል ሲሆን በፍፁም ወጪ (Withdraw) ማድረግ አይቻልም።\n🟡 <b>ዋና ሂሳብ:</b> ተጫውተው ሲያሸንፉ የሚገባበት ሲሆን፣ በማንኛውም ሰዓት ወጪ ማድረግ ይችላሉ።\n\n2️⃣ <b>የገቢ ደንብ:</b>\n👉 ከ ቴሌብር ወደ ቴሌብር\n👉 ከ ሲቢኢ ብር ወደ ሲቢኢ ብር ብቻ ያስገቡ።\n\n3️⃣ <b>ማረጋገጫ:</b> ገቢ ሲያደርጉ የደረሰዎትን ትክክለኛ የባንክ (SMS/TxRef) በትክክል ያስገቡ።\n4️⃣ <b>እድሜ:</b> ተጫዋቾች ከ 21 ዓመት በላይ መሆን አለባቸው።`,
        choose_lang: "እባክዎ ቋንቋ ይምረጡ:", lang_set: "✅ ቋንቋ በተሳካ ሁኔታ ተቀይሯል!",
        warn_telebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር (Telebirr to Telebirr) ብቻ ያስገቡ!\n\n", warn_cbebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBEBirr to CBEBirr) ብቻ ያስገቡ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንክ: <b>${method}</b>\n\n${warning}እባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: <b>${name}</b>\n👉 ቁጥር: <b>${num}</b>\n\nከዚያም <b>ያስገቡትን የብር መጠን</b> ብቻ እዚህ ይፃፉልኝ (ምሳሌ: 100):`,
        wit_info: (method) => `🏦 ባንክ: <b>${method}</b>\n\nገንዘቡ እንዲላክልዎ የሚፈልጉትን <b>ስልክ ቁጥር ወይም አካውንት</b> ያስገቡ፦`,
        invalid_amt: "❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ 50 ብር):", enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nእባክዎ ክፍያ የፈጸሙበትን የ <b>ትክክለኛውን የባንክ SMS ማረጋገጫ (Tx Ref) ፅሁፍ</b> አሁን እዚህ ይላኩ፦`,
        dep_success: "✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።",
        enter_wit_amt: (acc) => `✅ አካውንት: <b>${acc}</b>\n\nማውጣት የሚፈልጉትን መጠን ያስገቡ (ቢያንስ 50 ብር):`, insufficient: "❌ በዋና ሂሳብዎ ላይ በቂ ብር የለም!", wit_success: (amt, acc) => `✅ <b>የወጪ ጥያቄዎ ተልኳል!</b>\n\nመጠን: ${amt} ETB\nወደ: ${acc}\n\nበቅርቡ ይላካል!`,
        play_msg: "በቢንጎ ሐበሻ ቤት ይጫወቱ ይዝናኑ በሺዎች ያሸንፉ\nመልካም እድል ይሁንሎት"
    },
    en: {
        welcome: "🎉 <b>Welcome to BINGO HABESHA!</b> 🎉\n\nEthiopia's #1 BINGO platform.\n\n👇 <b>Choose an option:</b>",
        btn_play: "🎮 PLAY BINGO", btn_profile: "👤 Profile", btn_balance: "💰 Balance", btn_deposit: "📥 Deposit", btn_withdraw: "📤 Withdraw", btn_invite: "🔗 Invite & Earn", btn_promo: "🗣 Promote", btn_guide: "📖 Guide", btn_help: "🆘 Help", btn_rules: "📜 Rules", btn_lang: "🌐 Language", btn_bonus: "🎁 Claim Promo Bonus", btn_back: "🔙 Go Back",
        share_contact: "📱 Share Contact", err_reg_first: "Register first by sending /start.", err_cancel: "❌ Action cancelled.",
        profile_text: (u) => `👤 <b>Your Profile</b>\n\n🔹 <b>Name:</b> ${u.name}\n🔹 <b>Phone:</b> ${u.phone}\n🔑 <b>Password:</b> <code>${u.password}</code>\n\n💰 <b>Play Balance:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Main Balance:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Wallet Balance:</b>\n\n🟢 Play Balance: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Main Balance: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Choose a bank to Deposit:</b>", wit_msg: "🏦 <b>Choose a bank to Withdraw:</b>",
        invite_msg: (l) => `🔗 <b>Invite & Earn</b>\n\nWhen a friend joins, <b>both YOU and YOUR FRIEND get special Play Bonus!</b>\n\n👇 Your Link:\n${l}`,
        guide_msg: `📖 <b>How to Play:</b>\n\n1️⃣ Get a 5x5 card.\n2️⃣ System calls a number every 3 sec.\n3️⃣ System auto-daubs.\n\n🏆 Match 5 in a row or 4 corners to win <b>BINGO!</b>`,
        rules_msg: `📜 <b>Rules:</b>\n\n👉 Telebirr to Telebirr ONLY.\n👉 CBEBirr to CBEBirr ONLY.\n👉 Paste exact SMS.\n👉 Must be 21+.`,
        choose_lang: "Please choose your language:", lang_set: "✅ Language changed successfully!",
        warn_telebirr: "⚠️ <b>WARNING:</b> Send Telebirr to Telebirr ONLY!\n\n", warn_cbebirr: "⚠️ <b>WARNING:</b> Send CBEBirr to CBEBirr ONLY!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Bank: <b>${method}</b>\n\n${warning}Send money to:\n👤 Name: <b>${name}</b>\n👉 Account: <b>${num}</b>\n\nType the <b>amount you sent</b> here (e.g., 100):`,
        wit_info: (method) => `🏦 Bank: <b>${method}</b>\n\nEnter the <b>Account or Phone number</b>:`,
        invalid_amt: "❌ Invalid Amount. Min 50 ETB:", enter_sms: (amt) => `✅ Amount: <b>${amt} ETB</b>\n\nPaste exact <b>Bank SMS</b>:`,
        dep_success: "✅ <b>Deposit Request Sent!</b>", enter_wit_amt: (acc) => `✅ Account: <b>${acc}</b>\n\nEnter withdrawal amount (Min 50 ETB):`, insufficient: "❌ Insufficient Main Balance!", wit_success: (amt, acc) => `✅ <b>Withdrawal Request Sent!</b>\nAmount: ${amt} ETB\nTo: ${acc}`,
        play_msg: "Play and have fun at Bingo Habesha and win thousands!\nGood luck!"
    },
    or: {
        welcome: "🎉 <b>Baga nagaan dhuftan!</b> 🎉", btn_play: "🎮 Tapadhu", btn_profile: "👤 Pirofaayilii", btn_balance: "💰 Herrega", btn_deposit: "📥 Galchuu", btn_withdraw: "📤 Baasuu", btn_invite: "🔗 Afeeri", btn_promo: "🗣 Promote", btn_guide: "📖 Qajeelfama", btn_help: "🆘 Gargaarsa", btn_rules: "📜 Seera", btn_lang: "🌐 Afaan", btn_bonus: "🎁 Boonasii", btn_back: "🔙 Duubatti", share_contact: "📱 Lakkoofsa ergi", err_reg_first: "Dura /start tuqi.", err_cancel: "❌ Haqameera.",
        profile_text: (u) => `👤 <b>Pirofaayilii</b>\n\n🔹 <b>Maqaa:</b> ${u.name}\n🔹 <b>Lakkoofsa:</b> ${u.phone}\n🔑 <b>Iccitii:</b> <code>${u.password}</code>\n\n💰 <b>Herrega Taphaa:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Muummee:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Herrega Kee:</b>\n\n🟢 Tapha: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Muummee: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Baankii filadhu:</b>", wit_msg: "🏦 <b>Baankii baasuuf filadhu:</b>", invite_msg: (l) => `🔗 <b>Afeeri</b>\n\nLachuun keessan Boonasii argattu!\n\n👇 Liinkii Kee:\n${l}`, guide_msg: `📖 <b>Akkaataa Tapha:</b> Sarara guutu BINGO!`, rules_msg: `📜 <b>Seera:</b> Telebirr gara Telebirr QOFA. CBEBirr gara CBEBirr QOFA.`, choose_lang: "Afaan filadhu:", lang_set: "✅ Jijjiirameera!", warn_telebirr: "⚠️ Telebirr gara Telebirr QOFA!\n\n", warn_cbebirr: "⚠️ CBEBirr gara CBEBirr QOFA!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Baankii: <b>${method}</b>\n\n${warning}Qarshii ergaa:\n👤 Maqaa: <b>${name}</b>\n👉 Lakkoofsa: <b>${num}</b>\n\n<b>Hamma qarshii</b> asitti barreessaa (Fkn: 100):`,
        wit_info: (method) => `🏦 Baankii: <b>${method}</b>\n\nLakkoofsa barreessaa:`, invalid_amt: "❌ Yoo xiqqaate 50 ETB:", enter_sms: (amt) => `✅ Hamma: <b>${amt} ETB</b>\n\nAmma <b>SMS Baankii</b> asitti ergaa:`, dep_success: "✅ <b>Ergameera!</b>", enter_wit_amt: (acc) => `✅ Herrega: <b>${acc}</b>\n\nHamma galchaa (Min 50):`, insufficient: "❌ Qarshiin ga'aan hin jiru!", wit_success: (amt, acc) => `✅ <b>Ergameera!</b>`,
        play_msg: "BINGO HABESHA irratti taphadhaa, bashannanaa, kumaatama mo'adhaa!\nCarraa Gaarii!"
    },
    ti: {
        welcome: "🎉 <b>እንቋዕ ብደሓን መጻእኩም!</b> 🎉", btn_play: "🎮 ጻወት", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሕሳብ", btn_deposit: "📥 ኣእቱ", btn_withdraw: "📤 ኣውጽእ", btn_invite: "🔗 ዕደም", btn_promo: "🗣 Promote", btn_guide: "📖 መምርሒ", btn_help: "🆘 ሓገዝ", btn_rules: "📜 ሕግታት", btn_lang: "🌐 ቋንቋ", btn_bonus: "🎁 ቦነስ", btn_back: "🔙 ንድሕሪት", share_contact: "📱 ቁጽሪ ኣካፍል", err_reg_first: "ቅድም /start በሉ።", err_cancel: "❌ ተቋሪጹ።",
        profile_text: (u) => `👤 <b>ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልኪ:</b> ${u.phone}\n🔑 <b>መሕለፊ ቃል:</b> <code>${u.password}</code>\n\n💰 <b>መጻወቲ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ቀንዲ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>ናይ ሕሳብ ሓበሬታ:</b>\n\n🟢 መጻወቲ: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ቀንዲ: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>ባንኪ ምረጽ?</b>", wit_msg: "🏦 <b>ባንኪ ምረጽ?</b>", invite_msg: (l) => `🔗 <b>ዕደምን ረኸብን</b>\n\nንስኹም ሆነ ንሱ ፍሉይ ቦነስ ክትረኽቡ ኢኹም!\n\n👇 ሊንክ:\n${l}`, guide_msg: `📖 <b>መምርሒ:</b> ምሉእ መስመር እንተሰሪሖም BINGO!`, rules_msg: `📜 <b>ሕግታት:</b> ካብ ቴሌብር ናብ ቴሌብር ጥራይ። ካብ CBEBirr ናብ CBEBirr ጥራይ።`, choose_lang: "ቋንቋ ምረጹ:", lang_set: "✅ ተቐይሩ ኣሎ!", warn_telebirr: "⚠️ ካብ ቴሌብር ናብ ቴሌብር ጥራይ!\n\n", warn_cbebirr: "⚠️ ካብ CBEBirr ናብ CBEBirr ጥራይ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንኪ: <b>${method}</b>\n\n${warning}ገንዘብ ናብዚ ኣእትዉ:\n👤 ስም: <b>${name}</b>\n👉 ቁጽሪ: <b>${num}</b>\n\n<b>መጠን ገንዘብ</b> ኣብዚ ጽሓፉ (ንኣብነት: 100):`,
        wit_info: (method) => `🏦 ባንኪ: <b>${method}</b>\n\n<b>ቁጽሪ ስልኪ ወይ ኣካውንት</b> ኣእትዉ፦`, invalid_amt: "❌ እንተወሓደ 50 ብር:", enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nሕጂ <b>ትኽክለኛ SMS</b> ስደዱ፦`, dep_success: "✅ <b>ተላኢኹ!</b>", enter_wit_amt: (acc) => `✅ ኣካውንት: <b>${acc}</b>\n\nመጠን ኣእትዉ (Min 50):`, insufficient: "❌ እኹል ገንዘብ የለን!", wit_success: (amt, acc) => `✅ <b>ተላኢኹ!</b>`,
        play_msg: "ኣብ ቢንጎ ሓበሻ ጻወቱ፡ ተዘናግዑ፡ ብኣሽሓት ድማ ዕወቱ!\nሰናይ ዕድል!"
    }
};

function getLang(user) { return user && user.language && t[user.language] ? t[user.language] : t['am']; }
function getMainMenu(user) {
    let ln = getLang(user);
    return { reply_markup: { keyboard: [ [{ text: ln.btn_play }], [{ text: ln.btn_profile }, { text: ln.btn_balance }], [{ text: ln.btn_deposit }, { text: ln.btn_withdraw }], [{ text: ln.btn_invite }, { text: ln.btn_promo }], [{ text: ln.btn_guide }, { text: ln.btn_help }, { text: ln.btn_rules }], [{ text: ln.btn_lang }] ], resize_keyboard: true } };
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
            if (state.refCode) { let refUser = await User.findOne({ $or: [{ phone: state.refCode }, { refCode: state.refCode }] }); if (refUser) { refUser.playBalance += GLOBAL_SETTINGS.inviteBonus; await refUser.save(); io.emit('balance_updated', refUser.phone); actualRef = refUser.phone; } }
            let myRefCode = generateRefCode();
            user = await User.create({ phone, name: msg.contact.first_name || "User", password: Math.random().toString(36).slice(-6), refCode: myRefCode, telegramId: msg.from.id.toString(), referredBy: actualRef, playBalance: GLOBAL_SETTINGS.registerBonus, language: 'am' });
            
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

    if (state.step === 'support_chat') {
        if(!user) return;
        await SupportMessage.create({ telegramId: msg.from.id.toString(), phone: user.phone, name: user.name, text: text, sender: 'user' });
        bot.sendMessage(chatId, "✅ መልዕክትዎ ደርሶናል! አድሚን ሲያይ በዚሁ ቦት በኩል ይመልስሎታል።", { parse_mode: "HTML", ...getMainMenu(user) });
        state.step = 'idle';
        botState[chatId] = state;
        return;
    }

    if (text === t.am.btn_play || text === t.en.btn_play || text === t.or.btn_play || text === t.ti.btn_play || text.includes('PLAY') || text.includes('ጌም ይጫወቱ') || text.includes('Tapadhu') || text.includes('ጻወት') || text === '/play') {
        bot.sendMessage(chatId, ln.play_msg, { reply_markup: { inline_keyboard: [[{ text: ln.btn_play, web_app: { url: (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL } }]] } });
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
        if(!user.refCode) { user.refCode = generateRefCode(); await user.save(); }
        bot.sendMessage(chatId, ln.invite_msg(`https://t.me/bingo_habesha_bot?start=${user.refCode}`), { parse_mode: "HTML", disable_web_page_preview: false, ...getMainMenu(user) }); 
    } 
    // 🔥 PROMOTER BOT LOGIC 🔥
    else if (text === t.am.btn_promo || text === t.en.btn_promo || text === t.or.btn_promo || text === t.ti.btn_promo || text.includes('ድርጅቱን አስተዋውቅ') || text.includes('አስተዋውቅ') || text.includes('Promote') || text.includes('Promoter')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        if(user.isPromoter) {
            try {
                let referredUsers = await User.find({ referredBy: user.phone });
                let refPhones = referredUsers.map(u => u.phone);
                let deps = await Transaction.find({ phone: { $in: refPhones }, type: 'deposit', status: 'Approved' });
                let totalDep = deps.reduce((sum, tx) => sum + tx.amount, 0);
                
                let myCode = user.refCode ? user.refCode : user.phone;
                let msg = `📊 <b>የአስተዋዋቂ (Promoter) ዳሽቦርድ</b>\n\n` +
                          `👥 ያመጧቸው ሰዎች ብዛት: <b>${referredUsers.length}</b>\n` +
                          `💰 ያስገቡት ጠቅላላ የብር መጠን: <b>${totalDep.toLocaleString()} ETB</b>\n` +
                          `🎁 የእርስዎ የኮሚሽን ትርፍ (${user.promoterPercent}%): <b>${(user.promoterEarned || 0).toLocaleString()} ETB</b>\n\n` +
                          `💸 <i>ማሳሰቢያ፡ ኮሚሽን የሚታሰበው ሰዎች 'ለመጀመሪያ ጊዜ' በሚያስገቡት ዲፖዚት ላይ ብቻ ነው።</i>\n\n` +
                          `🔗 መጋበዣ ሊንክዎ:\nhttps://t.me/bingo_habesha_bot?start=${myCode}`;
                
                bot.sendMessage(chatId, msg, { parse_mode: "HTML", disable_web_page_preview: true, ...getMainMenu(user) });
            } catch(e) {
                bot.sendMessage(chatId, "❌ ስህተት አጋጥሟል", { ...getMainMenu(user) });
            }
        } else {
            bot.sendMessage(chatId, "🗣 <b>ልዩ አስተዋዋቂ (Promoter) ይሁኑ!</b>\n\nልዩ አስተዋዋቂ ለመሆን እና በኮሚሽን አብረውን ለመስራት እባክዎ አድሚን ያናግሩ: <b>@bingohabesha</b>", { parse_mode: "HTML", ...getMainMenu(user) });
        }
    } 
    else if (text === t.am.btn_guide || text === t.en.btn_guide || text === t.or.btn_guide || text === t.ti.btn_guide || text.includes('መመሪያ') || text.includes('Guide') || text.includes('Qajeelfama') || text.includes('መምርሒ')) { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.guide_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    }
    else if (text === t.am.btn_help || text === t.en.btn_help || text === t.or.btn_help || text === t.ti.btn_help || text.includes('እርዳታ') || text.includes('Help') || text.includes('Gargaarsa') || text.includes('ሓገዝ') || text === '/help') { 
        if(!user) return; 
        bot.sendMessage(chatId, "💬 <b>ማንኛውም ጥያቄ ወይም አስተያየት ካለዎት እዚሁ ይፃፉልን፣ በቅርቡ እንመልስሎታለን።</b>\n\n👉 (ወይም አድሚኑን ቀጥታ በ @bingohabesha ያናግሩ)", { parse_mode: "HTML", ...cancelKeyboard(ln) }); 
        state.step = 'support_chat';
    } 
    else if (text === t.am.btn_lang || text === t.en.btn_lang || text === t.or.btn_lang || text === t.ti.btn_lang || text.includes('ቋንቋ') || text.includes('Language') || text === '/lang') { 
        if(!user) return; 
        bot.sendMessage(chatId, "እባክዎ ቋንቋ ይምረጡ (Choose Language):", { 
            reply_markup: { 
                inline_keyboard: [
                    [{text: "🇪🇹 አማርኛ", callback_data: "lang_am"}, {text: "🇺🇸 English", callback_data: "lang_en"}],
                    [{text: "🌳 Afaan Oromoo", callback_data: "lang_or"}, {text: "🇪🇷 ትግርኛ", callback_data: "lang_ti"}]
                ] 
            } 
        }); 
    } 
    else if (text === t.am.btn_rules || text === t.en.btn_rules || text === t.or.btn_rules || text === t.ti.btn_rules || text.includes('ደንቦች') || text.includes('Rules') || text.includes('Seera') || text.includes('ሕግታት')) { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.rules_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    
    // Deposit / Withdraw Process
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt, cancelKeyboard(ln));
        bot.sendMessage(chatId, ln.enter_sms(state.amount), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) { 
            let txRef = getTxRef(text);
            
            if (!txRef) {
                return bot.sendMessage(chatId, "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) ከፅሁፉ ውስጥ አልተገኘም። እባክዎ ትክክለኛውን የባንክ SMS ይላኩ።", { parse_mode: "HTML", ...getMainMenu(user) });
            }

            let isUsed = await isSmsAlreadyUsed(text);
            if (isUsed) {
                return bot.sendMessage(chatId, "❌ ያስገቡት sms (TxRef) ቀድሞ ጥቅም ላይ ውሏል!", { parse_mode: "HTML", ...getMainMenu(user) });
            }

            await new Transaction({ 
                phone: user.phone, 
                type: 'deposit', 
                amount: state.amount, 
                method: state.method, 
                smsText: text, 
                txRef: txRef 
            }).save(); 

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
    else if (data.startsWith('wit_')) { 
        if(!user) return bot.answerCallbackQuery(query.id);
        state.method = data.split('_')[1]; 
        state.destinationPhone = user.phone; 
        state.step = 'awaiting_wit_amt'; 
        bot.sendMessage(chatId, ln.enter_wit_amt(user.phone), { parse_mode: "HTML", ...cancelKeyboard(ln) }); 
    }
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
        
        let maintenanceScript = `
        <style>
            #dynamic-maintenance {
                display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.5); z-index: 9999999; flex-direction: column; align-items: center;
                justify-content: center; color: white; text-align: center; padding: 20px; box-sizing: border-box;
                backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
            }
            body.paused-mode > *:not(#dynamic-maintenance) {
                filter: blur(12px) grayscale(50%);
                pointer-events: none;
                user-select: none;
            }
            
            .shared-alert-box {
                background: linear-gradient(135deg, rgba(22,163,74,0.3), rgba(5,150,105,0.3));
                border: 2px solid #4ade80;
                color: #ffffff;
                padding: 12px;
                border-radius: 12px;
                margin-top: 15px;
                font-size: 15px;
                font-weight: bold;
                text-align: center;
                box-shadow: 0 0 15px rgba(74,222,128,0.5);
                animation: popBlink 1s infinite alternate;
                width: 90%;
                margin-left: auto;
                margin-right: auto;
            }
            @keyframes popBlink { 
                from { transform: scale(1); box-shadow: 0 0 10px rgba(74,222,128,0.4); } 
                to { transform: scale(1.05); box-shadow: 0 0 25px rgba(74,222,128,0.8); } 
            }
            /* 🔥 WEB PROMO POPUP CSS 🔥 */
            .web-promo-popup { position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-150%); background: linear-gradient(135deg, #ea580c, #d97706); border: 2px solid #fbbf24; border-radius: 12px; padding: 15px; color: white; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 100000; width: 90%; max-width: 350px; text-align: center; transition: 0.5s cubic-bezier(0.175, 0.885, 0.32, 1); backdrop-filter: blur(10px); visibility: hidden; }
            .web-promo-popup.show { transform: translateX(-50%) translateY(0); visibility: visible; }
        </style>

        <div id="dynamic-maintenance">
            <h1 style="color:#ea580c;font-size:50px;margin-bottom:10px;font-family:sans-serif;text-shadow: 0 4px 10px rgba(0,0,0,0.8);">⚠️ ጥገና ላይ ነን!</h1>
            <p style="font-size:24px;color:#cbd5e1;font-family:sans-serif;margin-top:0;font-weight:bold;text-shadow: 0 2px 5px rgba(0,0,0,0.8);">(MAINTENANCE)</p>
            <p style="font-size:18px;color:#f8fafc;max-width:500px;line-height:1.6;font-family:sans-serif;background:rgba(0,0,0,0.7);padding:20px;border-radius:12px;border:1px solid #ea580c;">በአሁኑ ሰዓት ሲስተሙን እያሻሻልን ስለሆነ ጌም መጫወት አይቻልም።<br><br>እባክዎ ከጥቂት ደቂቃዎች በኋላ ተመልሰው ይሞክሩ። እናመሰግናለን!</p>
        </div>

        <script>
            document.addEventListener("DOMContentLoaded", () => {
                if (typeof io !== 'undefined') {
                    const blurSocket = io();
                    
                    blurSocket.on('game_status', (data) => {
                        if (data.state === 'MAINTENANCE') {
                            document.body.classList.add('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'flex';
                        } else {
                            document.body.classList.remove('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'none';
                        }
                    });

                    blurSocket.on('game_winner', (data) => {
                        let oldAlert = document.getElementById('shared-alert-msg');
                        if(oldAlert) oldAlert.remove();

                        setTimeout(() => {
                            let amIWinner = false;
                            if (window.currentUser && window.currentUser.phone && data.phone.includes(window.currentUser.phone)) {
                                amIWinner = true;
                            }

                            let titleEl = document.querySelector('.winner-card h3');
                            let nameEl = document.getElementById('win-name');
                            let winnerCard = document.querySelector('.winner-card');

                            if (amIWinner) {
                                if (titleEl) {
                                    titleEl.innerHTML = "🎉 እንኳን ደስ አሎት! 🎉";
                                    titleEl.style.color = "#4ade80";
                                    titleEl.style.fontSize = "16px";
                                }
                                if (nameEl) {
                                    nameEl.innerHTML = "እርስዎ አሸንፈዋል! 👏";
                                    nameEl.style.color = "#fbbf24";
                                }

                                let alertBox = document.createElement('div');
                                alertBox.id = 'shared-alert-msg';
                                alertBox.className = 'shared-alert-box';

                                if (data.isShared) {
                                    alertBox.innerHTML = "✨ ከሌሎች <b>" + (data.winnerCount - 1) + "</b> ሰዎች ጋር አሸንፈዋል! ✨<br><span style='font-size:12px; color:#ffffff; font-weight:normal; display:block; margin-top:5px;'>የእርስዎ ድርሻ: " + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB ሂሳብዎ ላይ ገቢ ተደርጓል!</span>";
                                } else {
                                    alertBox.style.background = "linear-gradient(135deg, rgba(234,88,12,0.3), rgba(217,119,6,0.3))";
                                    alertBox.style.borderColor = "#fbbf24";
                                    alertBox.style.boxShadow = "0 0 15px rgba(251,191,36,0.5)";
                                    alertBox.innerHTML = "✨ ጠቅላላ የደራሽ ሽልማትዎን ወስደዋል! ✨<br><span style='font-size:13px; color:#fbbf24; font-weight:bold; display:block; margin-top:5px;'>" + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB ሂሳብዎ ላይ ገቢ ተደርጓል!</span>";
                                }
                                if(winnerCard) winnerCard.appendChild(alertBox);

                            } else {
                                if (titleEl) {
                                    titleEl.innerHTML = "አሸናፊ (WINNER)";
                                    titleEl.style.color = "white";
                                }
                                if (data.isShared) {
                                    let alertBox = document.createElement('div');
                                    alertBox.id = 'shared-alert-msg';
                                    alertBox.className = 'shared-alert-box';
                                    alertBox.innerHTML = "✨ ሽልማቱ በእነዚህ <b>" + data.winnerCount + "</b> ሰዎች መካከል እኩል ተካፋይ ሆኗል! ✨<br><span style='font-size:12px; color:#4ade80; font-weight:normal; display:block; margin-top:5px;'>እያንዳንዳቸው: " + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB</span>";
                                    if(winnerCard) winnerCard.appendChild(alertBox);
                                }
                            }
                        }, 150); 
                    });
                }
            });
        </script>
        `;
        
        html = html.replace('<body>', '<body>\n' + maintenanceScript);
        
        if (GLOBAL_SETTINGS.isGamePaused) {
            html = html.replace('<body>', '<body class="paused-mode">');
        }
        
        res.send(html);
    } else {
        res.send("<h1>Bingo Habesha System is Running.</h1>");
    }
});

setInterval(async () => {
    try {
        await autoApprovePendingDeposits();
    } catch (error) {}
}, 30000); 

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));

















