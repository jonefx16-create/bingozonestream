const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api'); 

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.disable('x-powered-by');    

const registerRateLimiter = new Map();

const io = new Server(server, { 
    cors: { origin: "*" },
    perMessageDeflate: { threshold: 1024 } 
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const dbUser = "bingostream";
const dbPass = encodeURIComponent("Jo97BJbi0422");
const dbName = "BingoDB";
const dbCluster = "cluster0.hefpgl6.mongodb.net";

const mongoURI = `mongodb+srv://${dbUser}:${dbPass}@${dbCluster}/${dbName}?retryWrites=true&w=majority`;

mongoose.connect(mongoURI, { 
    autoIndex: true, 
    maxPoolSize: 500 
}).then(() => console.log("✅ Database Connected Successfully"))
  .catch(err => console.log("❌ DB Connection Error:", err.message));

const maleEthNames = ["Abebe", "Kebede", "Chala", "Hagos", "Dawit", "Yosef", "Ephrem", "Tesfaye", "Girma", "Bereket", "Abel", "Eyob", "Samuel", "Biniam", "Mulugeta", "Tewodros", "Lema", "Yonas", "Habtamu", "Surafel", "Natnael", "Nahom", "Kaleb", "Fasika", "Amanuel", "Henok", "Robel", "Mikias", "Abiy", "Bekele", "Zelalem", "Elias", "Daniel", "Ermias", "Tadesse", "Wondimu", "Gizachew", "Tamirat", "Mekonnen", "Getachew"];

const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true, index: true },
    refCode: { type: String, default: "", index: true }, 
    telegramId: { type: String, default: "", index: true }, 
    name: { type: String, index: true },
    password: { type: String, required: true },
    referredBy: { type: String, default: "", index: true },
    totalInvites: { type: Number, default: 0 }, 
    inviteBonusEarned: { type: Number, default: 0 },
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    unplayedRealDeposit: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 }, 
    won: { type: Number, default: 0 }, 
    totalDeposited: { type: Number, default: 0 }, 
    totalWithdrawn: { type: Number, default: 0 }, 
    totalTicketsBought: { type: Number, default: 0 }, 
    status: { type: String, default: 'active', index: true },
    language: { type: String, default: 'am' },
    isPromoter: { type: Boolean, default: false, index: true },
    promoterPercent: { type: Number, default: 10 },
    promoterEarned: { type: Number, default: 0 },
    promoterUnpaidBalance: { type: Number, default: 0 }, 
    hasMadeFirstDeposit: { type: Boolean, default: false }, 
    promoterCommissionGenerated: { type: Number, default: 0 },
    referredViaPromo: { type: Boolean, default: false }, 
    compensatedInvites: { type: Number, default: 0 },
    diagnosticFraudReported: { type: Boolean, default: false },
    diagnosticNegativeReported: { type: Boolean, default: false }
}));

const { BotUser, initBotDatabase } = require('./bots/bot.model');
initBotDatabase();

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: { type: String, index: true }, 
    type: { type: String, index: true }, 
    amount: Number, 
    bonusGiven: { type: Number, default: 0 }, 
    method: String, 
    status: { type: String, default: 'Pending', index: true }, 
    date: { type: Date, default: Date.now, index: true }, 
    smsText: {type: String, default: ""},
    txRef: { type: String, default: "", index: true },
    hiddenFromAdmin: { type: Boolean, default: false } 
}));

const BankSMS = mongoose.model('BankSMS', new mongoose.Schema({
    rawText: String, 
    txRef: { type: String, index: true }, 
    amount: Number, 
    isUsed: { type: Boolean, default: false, index: true }, 
    dateReceived: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: { type: Number, index: true }, 
    ticketId: String, 
    winnerName: String, 
    winnerPhone: { type: String, index: true }, 
    prize: Number,
    adminProfit: { type: Number, default: 0 }, 
    ticketPrice: Number, 
    winningGrid: Array, 
    calledNumbers: Array, 
    playersData: Array, 
    date: { type: Date, default: Date.now, index: true }
}));

const ActiveBonus = mongoose.model('ActiveBonus', new mongoose.Schema({
    amount: Number, 
    maxUsers: Number, 
    currentClaims: { type: Number, default: 0 }, 
    claimedBy: [String], 
    expiresAt: Date, 
    isActive: { type: Boolean, default: true }, 
    date: { type: Date, default: Date.now },
    depositorsOnly: { type: Boolean, default: false },
    minDepositAmount: { type: Number, default: 0 },
    requireDepositWithinHours: { type: Number, default: 0 }
}));

const PromoCode = mongoose.model('PromoCode', new mongoose.Schema({
    code: { type: String, unique: true, index: true },
    amount: Number,
    maxUses: Number,
    currentUses: { type: Number, default: 0 },
    expiresAt: { type: Date, default: () => Date.now() + 30*24*60*60*1000 }, 
    usedBy: [String],
    requireDeposit: { type: Boolean, default: false }, 
    minDepositAmount: { type: Number, default: 0 },
    requireDepositWithinHours: { type: Number, default: 0 } 
}));

// 🔥 አዲስ ሞዴል ለ Scheduled Telegram Broadcast
const ScheduledBroadcast = mongoose.model('ScheduledBroadcast', new mongoose.Schema({
    message: String,
    photoUrl: String,
    targetPlatform: String,
    depositorsOnly: Boolean,
    minDepositAmount: Number,
    requireDepositWithinHours: Number,
    scheduledTime: String, // EAT Time (YYYY-MM-DDTHH:mm)
    status: { type: String, default: 'pending', index: true },
    date: { type: Date, default: Date.now }
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "bingo1234" }, 
    financePass: { type: String, default: "finance1234" }, 
    telegramChannel: { type: String, default: "" }, 
    ticketPrice: { type: Number, default: 10 }, 
    isGamePaused: { type: Boolean, default: false }, 
    gameTimer: { type: Number, default: 40 },
    
    virtualPrizePool: { type: Number, default: 0 }, // 🏦 ካዝና 1
    vaultTwoBalance: { type: Number, default: 0 },  // 🛡️ ካዝና 2
    vaultTwoPercent: { type: Number, default: 10 }, 
    
    // 🔥 አዲሱ ካዝና 3
    vaultThreeBalance: { type: Number, default: 0 }, // 🌟 ካዝና 3 (ለ 2 የሚያካፍለው)
    vaultThreePercent: { type: Number, default: 15 },

    decoyChancePercent: { type: Number, default: 15 }, 
    bonusWinPercent: { type: Number, default: 0 }, 
    
    isBotSystemActive: { type: Boolean, default: false },
    botWinnerForce: { type: String, default: 'bots' }, 
    mixBotCount: { type: Number, default: 1 }, 
    botDist1: { type: Number, default: 5 }, 
    botDist2: { type: Number, default: 4 }, 
    botDist3: { type: Number, default: 3 }, 
    botDist4: { type: Number, default: 3 }, 

    isBotScheduleActive: { type: Boolean, default: false },
    botSchedule1: { type: Object, default: { start: 0, end: 8, min: 10, max: 15 } },
    botSchedule2: { type: Object, default: { start: 8, end: 12, min: 15, max: 25 } },
    botSchedule3: { type: Object, default: { start: 12, end: 18, min: 20, max: 40 } },
    botSchedule4: { type: Object, default: { start: 18, end: 24, min: 40, max: 60 } },
    
    depBonusMinAmount: { type: Number, default: 50 }, 
    depBonusPercent: { type: Number, default: 50 }, 
    depBonusTier2Min: { type: Number, default: 200 },
    depBonusTier2Percent: { type: Number, default: 100 },
    depBonusTier3Min: { type: Number, default: 300 },
    depBonusTier3Percent: { type: Number, default: 150 },

    depBonusTimeRestricted: { type: Boolean, default: false }, 
    happyHourStart: { type: Number, default: 0 }, 
    happyHourEnd: { type: Number, default: 23 },
    depBannerTextAm: { type: String, default: "" }, 
    depBannerTextEn: { type: String, default: "" },
    
    witBonusMinAmount: { type: Number, default: 100 }, 
    witBonusPercent: { type: Number, default: 5 }, 
    isWitBonusActive: { type: Boolean, default: false }, 
    witBonusTimeRestricted: { type: Boolean, default: false }, 
    witHappyHourStart: { type: Number, default: 0 }, 
    witHappyHourEnd: { type: Number, default: 23 },
    witBannerTextAm: { type: String, default: "" }, 
    witBannerTextEn: { type: String, default: "" },
    
    registerBonus: { type: Number, default: 10 }, 
    inviteBonus: { type: Number, default: 10 }, 
    adminProfitPercent: { type: Number, default: 15 },
    maxTicketsPerUser: { type: Number, default: 4 },
    minWithdrawLimit: { type: Number, default: 50 },
    winPopupTimer: { type: Number, default: 12 },
    jackpotBoostAmount: { type: Number, default: 0 }
}));

const SystemLog = mongoose.model('SystemLog', new mongoose.Schema({
    phone: String,
    actionType: String,
    details: String,
    severity: String,
    date: { type: Date, default: Date.now }
}));

const SupportMessage = mongoose.model('SupportMessage', new mongoose.Schema({
    telegramId: String,
    phone: String,
    name: String,
    text: String,
    sender: String,
    isLatest: { type: Boolean, default: true },
    date: { type: Date, default: Date.now }
}));

let dailyHouseProfit = 0;
let currentDayTracker = new Date().getDate();

setInterval(() => {
    let today = new Date().getDate();
    if (today !== currentDayTracker) {
        dailyHouseProfit = 0;
        currentDayTracker = today;
    }
}, 60000);

let GLOBAL_SETTINGS = {};
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { 
        adminPass: s.adminPass, 
        financePass: s.financePass, 
        telegramChannel: s.telegramChannel || "",
        ticketPrice: s.ticketPrice, 
        isGamePaused: s.isGamePaused, 
        gameTimer: s.gameTimer || 40, 
        
        virtualPrizePool: s.virtualPrizePool || 0, // Vault 1
        vaultTwoBalance: s.vaultTwoBalance || 0,   // Vault 2
        vaultTwoPercent: s.vaultTwoPercent !== undefined ? s.vaultTwoPercent : 10,
        
        vaultThreeBalance: s.vaultThreeBalance || 0, // Vault 3
        vaultThreePercent: s.vaultThreePercent !== undefined ? s.vaultThreePercent : 15,

        decoyChancePercent: s.decoyChancePercent !== undefined ? s.decoyChancePercent : 15, 
        bonusWinPercent: s.bonusWinPercent !== undefined ? s.bonusWinPercent : 0, 

        isBotSystemActive: s.isBotSystemActive || false,
        botWinnerForce: s.botWinnerForce || 'bots',
        mixBotCount: s.mixBotCount !== undefined ? s.mixBotCount : 1,
        botDist1: s.botDist1 !== undefined ? s.botDist1 : 5,
        botDist2: s.botDist2 !== undefined ? s.botDist2 : 4,
        botDist3: s.botDist3 !== undefined ? s.botDist3 : 3,
        botDist4: s.botDist4 !== undefined ? s.botDist4 : 3,

        isBotScheduleActive: s.isBotScheduleActive || false,
        botSchedule1: s.botSchedule1 || { start: 0, end: 8, min: 10, max: 15 },
        botSchedule2: s.botSchedule2 || { start: 8, end: 12, min: 15, max: 25 },
        botSchedule3: s.botSchedule3 || { start: 12, end: 18, min: 20, max: 40 },
        botSchedule4: s.botSchedule4 || { start: 18, end: 24, min: 40, max: 60 },
        
        depBonusMinAmount: s.depBonusMinAmount !== undefined ? s.depBonusMinAmount : 50, 
        depBonusPercent: s.depBonusPercent !== undefined ? s.depBonusPercent : 50, 
        depBonusTier2Min: s.depBonusTier2Min !== undefined ? s.depBonusTier2Min : 200, 
        depBonusTier2Percent: s.depBonusTier2Percent !== undefined ? s.depBonusTier2Percent : 100, 
        depBonusTier3Min: s.depBonusTier3Min !== undefined ? s.depBonusTier3Min : 300, 
        depBonusTier3Percent: s.depBonusTier3Percent !== undefined ? s.depBonusTier3Percent : 150, 

        depBonusTimeRestricted: s.depBonusTimeRestricted || false, 
        happyHourStart: s.happyHourStart !== undefined ? s.happyHourStart : 0, 
        happyHourEnd: s.happyHourEnd !== undefined ? s.happyHourEnd : 23, 
        depBannerTextAm: s.depBannerTextAm || "", 
        depBannerTextEn: s.depBannerTextEn || "",
        
        witBonusMinAmount: s.witBonusMinAmount !== undefined ? s.witBonusMinAmount : 100, 
        witBonusPercent: s.witBonusPercent !== undefined ? s.witBonusPercent : 5, 
        isWitBonusActive: s.isWitBonusActive || false,
        witBonusTimeRestricted: s.witBonusTimeRestricted || false, 
        witHappyHourStart: s.witHappyHourStart !== undefined ? s.witHappyHourStart : 0, 
        witHappyHourEnd: s.witHappyHourEnd !== undefined ? s.witHappyHourEnd : 23,
        witBannerTextAm: s.witBannerTextAm || "", 
        witBannerTextEn: s.witBannerTextEn || "",
        
        registerBonus: s.registerBonus !== undefined ? s.registerBonus : 10, 
        inviteBonus: s.inviteBonus !== undefined ? s.inviteBonus : 10,
        adminProfitPercent: s.adminProfitPercent !== undefined ? s.adminProfitPercent : 15, 
        maxTicketsPerUser: s.maxTicketsPerUser !== undefined ? s.maxTicketsPerUser : 4,
        minWithdrawLimit: s.minWithdrawLimit !== undefined ? s.minWithdrawLimit : 50,
        winPopupTimer: s.winPopupTimer !== undefined ? s.winPopupTimer : 12,
        jackpotBoostAmount: s.jackpotBoostAmount !== undefined ? s.jackpotBoostAmount : 0
    };
    jackpotBoostAmount = GLOBAL_SETTINGS.jackpotBoostAmount;
}
loadSettings();

const telegramToken = "8369500524:AAEUhhLqyIua26Hjcmn-iJisQrVDJSAHcek";
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://bingohabesha.onrender.com"; 

async function checkTelegramJoin(telegramId) {
    if (!GLOBAL_SETTINGS.telegramChannel || !telegramId) return true; 
    let channel = GLOBAL_SETTINGS.telegramChannel.startsWith('@') ? GLOBAL_SETTINGS.telegramChannel : '@' + GLOBAL_SETTINGS.telegramChannel;
    try {
        let member = await bot.getChatMember(channel, telegramId);
        if (['member', 'administrator', 'creator'].includes(member.status)) return true;
        return false;
    } catch (e) { return true; } 
}

function generateRefCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

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

async function autoApprovePendingDeposits() {
    try {
        const pendingTxs = await Transaction.find({ type: 'deposit', status: 'Pending' }).limit(500);
        const unusedSMS = await BankSMS.find({ isUsed: false }).limit(500);
        for (let tx of pendingTxs) {
            if (!tx.txRef) continue; 
            let matchedSMS = unusedSMS.find(sms => sms.txRef === tx.txRef);
            if (matchedSMS) {
                let user = await User.findOne({ phone: tx.phone });
                if (user) {
                    let actualReceivedAmount = matchedSMS.amount;
                    let bonus = 0;
                    let set = GLOBAL_SETTINGS;
                    let giveBonus = true;
                    
                    if (set.depBonusTimeRestricted) {
                        let currentHour = new Date().getHours();
                        if (currentHour < set.happyHourStart || currentHour > set.happyHourEnd) { giveBonus = false; }
                    }
                    
                    if (giveBonus) {
                        if (set.depBonusTier3Min && actualReceivedAmount >= set.depBonusTier3Min && user.hasMadeFirstDeposit) {
                            bonus = actualReceivedAmount * (set.depBonusTier3Percent / 100);
                        }
                        else if (set.depBonusTier2Min && actualReceivedAmount >= set.depBonusTier2Min) {
                            bonus = actualReceivedAmount * (set.depBonusTier2Percent / 100);
                        } 
                        else if (set.depBonusMinAmount && actualReceivedAmount >= set.depBonusMinAmount) {
                            bonus = actualReceivedAmount * (set.depBonusPercent / 100);
                        }
                    }
                    
                    let totalCredit = actualReceivedAmount + bonus;
                    tx.amount = actualReceivedAmount; 
                    tx.bonusGiven = bonus; 
                    tx.status = 'Approved';
                    await tx.save();
                    matchedSMS.isUsed = true;
                    await matchedSMS.save();
                    
                    user.playBalance += totalCredit;
                    user.totalDeposited += actualReceivedAmount;
                    user.unplayedRealDeposit += actualReceivedAmount; 

                    let adminPercent = GLOBAL_SETTINGS.adminProfitPercent || 30; 
                    let vaultTwoPercent = GLOBAL_SETTINGS.vaultTwoPercent !== undefined ? GLOBAL_SETTINGS.vaultTwoPercent : 10; 
                    let vaultThreePercent = GLOBAL_SETTINGS.vaultThreePercent !== undefined ? GLOBAL_SETTINGS.vaultThreePercent : 15; 
                    
                    let adminCut = actualReceivedAmount * (adminPercent / 100);
                    let vaultTwoCut = actualReceivedAmount * (vaultTwoPercent / 100);
                    let vaultThreeCut = actualReceivedAmount * (vaultThreePercent / 100);
                    let vaultAddition = actualReceivedAmount - adminCut - vaultTwoCut - vaultThreeCut; 
                    
                    await SystemSettings.updateOne({}, { 
                        $inc: { 
                            virtualPrizePool: vaultAddition,
                            vaultTwoBalance: vaultTwoCut,
                            vaultThreeBalance: vaultThreeCut
                        } 
                    });
                    GLOBAL_SETTINGS.virtualPrizePool += vaultAddition;
                    GLOBAL_SETTINGS.vaultTwoBalance += vaultTwoCut;
                    GLOBAL_SETTINGS.vaultThreeBalance += vaultThreeCut;
                    dailyHouseProfit += adminCut; 

                    if(user.referredBy && user.referredViaPromo) {
                        let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                        if(promoter) {
                            let commission = actualReceivedAmount * (promoter.promoterPercent / 100);
                            promoter.promoterUnpaidBalance += commission; 
                            promoter.promoterEarned += commission;
                            await promoter.save();
                            user.promoterCommissionGenerated += commission; 
                            io.emit('balance_updated', promoter.phone);
                        }
                    }
                    if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true; 
                    await user.save();
                    io.emit('balance_updated', tx.phone);
                    
                    if(bonus > 0) {
                        io.emit('deposit_bonus_alert', { phone: tx.phone, depositAmount: actualReceivedAmount, bonusAmount: bonus });
                    }
                }
            }
        }
    } catch (err) {}
}

app.post('/api/webhook/iphone-sms-Tside04', async (req, res) => {
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

app.set('trust proxy', 1);

const ddosLimiterMap = new Map();
const strictRateLimiter = (req, res, next) => {
    const ip = req.ip; 
    const userAgent = req.headers['user-agent'] || "";

    if (!userAgent || userAgent.toLowerCase().includes('curl') || userAgent.toLowerCase().includes('python')) {
        return res.status(403).json({ success: false, message: "Security Blocked!" });
    }

    const now = Date.now();
    const windowMs = 60 * 1000; 
    const maxRequests = 5; 

    if (!ddosLimiterMap.has(ip)) {
        ddosLimiterMap.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }

    const limitData = ddosLimiterMap.get(ip);
    if (now > limitData.resetTime) {
        limitData.count = 1;
        limitData.resetTime = now + windowMs;
        return next();
    }

    limitData.count++;
    if (limitData.count > maxRequests) {
        console.log(`🚨 DOS ATTACK BLOCKED! IP: ${ip}`);
        return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
    }
    next();
};

const ipCreationCounts = new Map();

app.post('/api/register', strictRateLimiter, async (req, res) => {
    try {
        const clientIp = req.ip;

        let count = ipCreationCounts.get(clientIp) || 0;
        if (count >= 3) {
            return res.status(429).json({ success: false, message: "❌ ከዚህ ኢንተርኔት (IP) ብዙ አካውንት ተከፍቷል! (Spam Blocked)" });
        }

        let phone = String(req.body.phone).trim();
        let name = String(req.body.name).trim();
        let password = String(req.body.password).trim();
        let refCode = String(req.body.refCode || "").trim();

        if (!/^(09|07)\d{8}$/.test(phone)) {
            return res.json({ success: false, message: "❌ እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ! (09... ወይም 07...)" });
        }
        if (name.toLowerCase().startsWith('user') && /\d+$/.test(name)) {
            return res.json({ success: false, message: "❌ ይህን ስም መጠቀም አይቻልም! እባክዎ ትክክለኛ ስምዎን ያስገቡ።" });
        }

        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ተመዝግቧል!" });

        let actualRef = "";
        let cleanRefCode = refCode;
        let isPromoLink = false;

        if (cleanRefCode.startsWith('promo_')) {
            cleanRefCode = cleanRefCode.replace('promo_', '');
            isPromoLink = true;
        }

        if (cleanRefCode && cleanRefCode !== phone) {
            let refUser = await User.findOne({ $or: [{ phone: cleanRefCode }, { refCode: cleanRefCode }] });
            if (refUser && refUser.phone !== phone) {
                actualRef = refUser.phone;
                refUser.totalInvites = (refUser.totalInvites || 0) + 1;

                if (isPromoLink && refUser.isPromoter) {
                    await refUser.save();
                } else {
                    refUser.playBalance += GLOBAL_SETTINGS.inviteBonus;
                    refUser.inviteBonusEarned = (refUser.inviteBonusEarned || 0) + GLOBAL_SETTINGS.inviteBonus;
                    await refUser.save();
                    io.emit('balance_updated', refUser.phone);
                    isPromoLink = false;
                }
            }
        }

        let myRefCode = generateRefCode();
        await new User({ phone, name, password, refCode: myRefCode, referredBy: actualRef, referredViaPromo: isPromoLink, playBalance: GLOBAL_SETTINGS.registerBonus }).save();

        ipCreationCounts.set(clientIp, count + 1);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let phone = String(req.body.phone);
    let password = String(req.body.password);
    
    let user = await User.findOne({ phone: phone, password: password });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ አካውንትዎ ታግዷል!" });
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); } 
    
    if (user) {
        let safeUser = user.toObject();
        delete safeUser.password; 
        res.json({ success: true, user: safeUser });
    } else {
        res.json({ success: false, message: "ስልክ ቁጥር ወይም ፓስወርድ ተሳስቷል!" });
    }
});

app.post('/api/telegram-login', async (req, res) => {
    let user = await User.findOne({ telegramId: String(req.body.telegramId) });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ የታገደ አካውንት!" });
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); } 
    if(user) res.json({ success: true, user });
    else res.json({ success: false, message: "Share contact in bot first." });
});

app.post('/api/user/change-password', async (req, res) => {
    const phone = String(req.body.phone);
    const oldPass = String(req.body.oldPass);
    const newPass = String(req.body.newPass);
    let user = await User.findOne({ phone, password: oldPass });
    if (!user) return res.json({ success: false, message: "❌ የድሮው ፓስወርድ ትክክል አይደለም!" });
    user.password = newPass; await user.save();
    res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const referer = req.headers.referer || req.headers.origin || "";
    const userAgent = (req.headers['user-agent'] || "").toLowerCase();
    const fetchSite = req.headers['sec-fetch-site'];

    const isFromOurSite = referer.includes("bingohabesha.onrender.com") || referer.includes("localhost");
    const isHackerTool = !userAgent || userAgent.includes("postman") || userAgent.includes("python") || userAgent.includes("curl") || userAgent.includes("axios");
    const isFakeBrowser = fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site';

    if (!isFromOurSite || isHackerTool || isFakeBrowser) {
        console.log(`🚨 HACKER BLOCKED! Phone target: ${req.params.phone}, UA: ${userAgent}`);
        return res.status(403).json({ success: false, message: "❌ Access Denied! የተከለከለ (Security Block)" });
    }

    const user = await User.findOne({ phone: String(req.params.phone) }).select('-password -telegramId -unplayedRealDeposit');
    res.json(user ? { success: true, user } : { success: false, message: "User not found" });
});

const txLocks = new Set();

app.post('/api/request-tx', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass || req.body.password || ""); 
        const type = String(req.body.type);
        const amount = Number(req.body.amount);
        const method = String(req.body.method);
        const sms = String(req.body.sms);
        const destinationPhone = String(req.body.destinationPhone);
        
        const lockKey = `${phone}_${type}`;
        if (txLocks.has(lockKey)) {
            return res.json({ success: false, message: "⚠️ እባክዎ ትንሽ ይጠብቁ... (Please wait)" });
        }
        txLocks.add(lockKey);
        setTimeout(() => txLocks.delete(lockKey), 5000); 

        let user = await User.findOne({ phone: phone }); 
        if(!user) { txLocks.delete(lockKey); return res.json({success: false, message: "User not found!"}); }

        let tenSecondsAgo = new Date(Date.now() - 15000);
        let dupCheck = await Transaction.findOne({ 
            phone: phone, type: type, amount: amount, date: { $gte: tenSecondsAgo } 
        });
        if(dupCheck) {
            txLocks.delete(lockKey);
            return res.json({ success: false, message: "⚠️ ይህ ጥያቄ በቅርቡ ተልኳል (Duplicate request)!" });
        }

        if(type === 'withdraw') {
            if(amount < GLOBAL_SETTINGS.minWithdrawLimit) { txLocks.delete(lockKey); return res.json({success: false, message: `❌ ማውጣት የሚችሉት ቢያንስ ${GLOBAL_SETTINGS.minWithdrawLimit} ብር ነው!`}); }
            if(user.mainBalance < amount) { txLocks.delete(lockKey); return res.json({success: false, message: "በቂ ብር የለም!"}); }
            
            user.mainBalance -= amount; await user.save();
            await new Transaction({ phone, type, amount, method, smsText: `Transfer to: ${destinationPhone || phone}` }).save();
        } else {
            let txRef = getTxRef(sms);
            if (!txRef) { txLocks.delete(lockKey); return res.json({ success: false, message: "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) አልተገኘም!" }); }
            if (await isSmsAlreadyUsed(sms)) {
                txLocks.delete(lockKey); return res.json({ success: false, message: "❌ ይህ SMS ቀድሞ ጥቅም ላይ ውሏል!" });
            }
            await new Transaction({ phone, type, amount, method, smsText: sms, txRef: txRef }).save();
            await autoApprovePendingDeposits();
        }
        
        res.json({ success: true, message: "✅ ጥያቄዎ ደርሶናል!" });
    } catch(e) { 
        res.status(500).json({ success: false }); 
    }
});

app.post('/api/promoter/withdraw', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass);
        let user = await User.findOne({ phone, password: pass });
        if (!user || !user.isPromoter) return res.json({ success: false, message: "Unauthorized" });

        let reqAmt = Number(req.body.amount);
        if (isNaN(reqAmt) || reqAmt < 1000) return res.json({ success: false, message: "❌ ቢያንስ 1000 ብር መሆን አለበት!" });
        if (user.promoterUnpaidBalance < reqAmt) return res.json({ success: false, message: "❌ ያልተከፈለ ቀሪ ሂሳብዎ በቂ አይደለም!" });

        user.promoterUnpaidBalance -= reqAmt;
        await user.save();

        await new Transaction({ phone: user.phone, type: 'withdraw', amount: reqAmt, method: "Promoter Comm", smsText: `Transfer to: ${req.body.account}` }).save();

        res.json({ success: true, message: `✅ የወጪ ጥያቄዎ ለአድሚን ተልኳል!\nበቅርቡ ${reqAmt} ETB ወደ ${req.body.account} ይላካል።` });
    } catch (e) { res.json({ success: false, message: "ስህተት አጋጥሟል" }); }
});

app.get('/api/user/transactions/:phone', async (req, res) => { 
    const referer = req.headers.referer || req.headers.origin || "";
    const isFromOurSite = referer.includes("bingohabesha.onrender.com") || referer.includes("localhost");
    
    if (!isFromOurSite) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const txs = await Transaction.find({ 
        phone: String(req.params.phone), 
        method: { $ne: 'Promoter Comm' }
    }).select('type amount method status date').sort({ date: -1 }).limit(30); 
    
    res.json({ success: true, txs }); 
});

app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[String(req.params.phone)];
    res.json({ success: true, ticketsData: p ? p.ticketsData : [], calledNumbers: [...calledNumbers], gameState, gameId, globalTakenTickets: [...globalTakenTickets] });
});

app.get('/api/leaderboard', async (req, res) => { 
    try {
        let leaderboard = await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10).select('name won'); 
        res.json({ success: true, leaderboard }); 
    } catch(e) { res.json({ success: false }); }
});

const promoLocks = new Set();

app.post('/api/claim-promo-code', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass);
        const code = String(req.body.code || "");
        
        if (promoLocks.has(phone)) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ..." });
        promoLocks.add(phone);

        if (!code) { promoLocks.delete(phone); return res.json({ success: false, message: "እባክዎ ኮድ ያስገቡ!" }); }
        let user = await User.findOne({ phone, password: pass });
        if(!user) { promoLocks.delete(phone); return res.json({success: false, message: "User not found!"}); }

        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) { promoLocks.delete(phone); return res.json({ success: false, message: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}` }); }
        
        let promo = await PromoCode.findOne({ code: code.toUpperCase() });
        if (!promo) { promoLocks.delete(phone); return res.json({ success: false, message: "ትክክለኛ ያልሆነ ኮድ!" }); }
        
        if (new Date(promo.expiresAt) < new Date()) { promoLocks.delete(phone); return res.json({ success: false, message: "የዚህ ኩፖን ጊዜ አልፏል!" }); }
        if (promo.currentUses >= promo.maxUses) { promoLocks.delete(phone); return res.json({ success: false, message: "ይቅርታ! ይህ ኩፖን በሌሎች ሰዎች ሙሉ በሙሉ ጥቅም ላይ ውሏል።" }); }
        if (promo.usedBy.includes(user.phone)) { promoLocks.delete(phone); return res.json({ success: false, message: "እርስዎ ይህንን ኩፖን ቀድመው ወስደዋል!" }); }
        
        if (promo.requireDeposit) {
            let minDep = promo.minDepositAmount || 0;
            if (promo.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (promo.requireDepositWithinHours * 60 * 60 * 1000));
                let recentDep = await Transaction.findOne({ 
                    phone: user.phone, 
                    type: 'deposit', 
                    status: 'Approved', 
                    date: { $gte: cutoff },
                    amount: { $gte: minDep } 
                });
                if (!recentDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ባለፉት ${promo.requireDepositWithinHours} ሰዓታት ውስጥ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት!` });
                }
            } else {
                let validDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep } });
                if (!validDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ከዚህ በፊት ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት!` });
                }
            }
        }

        promo.usedBy.push(user.phone);
        promo.currentUses += 1;
        await promo.save();
        
        user.playBalance += promo.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        
        promoLocks.delete(phone);
        res.json({ success: true, message: `እንኳን ደስ አሎት! የ ${promo.amount} ETB ቦነስ አግኝተዋል!`, amount: promo.amount });
    } catch(e) { promoLocks.delete(String(req.body.phone)); res.json({success: false}); }
});

app.post('/api/claim-promo-web', async (req, res) => {
    try {
        let phone = String(req.body.phone);
        if (promoLocks.has(phone)) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ..." });
        promoLocks.add(phone);

        let user = await User.findOne({ phone: phone });
        if(!user) { promoLocks.delete(phone); return res.json({success: false, message: "User not found!"}); }

        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) { promoLocks.delete(phone); return res.json({ success: false, message: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}` }); }
        
        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!" }); }
        if (activeBonus.currentClaims >= activeBonus.maxUsers) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።" }); }
        if (activeBonus.claimedBy.includes(user.phone)) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!" }); }
        
        if (activeBonus.depositorsOnly) {
            let minDep = activeBonus.minDepositAmount || 0;
            if (activeBonus.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (activeBonus.requireDepositWithinHours * 60 * 60 * 1000));
                let recentDep = await Transaction.findOne({
                    phone: user.phone,
                    type: 'deposit',
                    status: 'Approved',
                    date: { $gte: cutoff },
                    amount: { $gte: minDep }
                });
                if (!recentDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ባለፉት ${activeBonus.requireDepositWithinHours} ሰዓታት ውስጥ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት!` });
                }
            } else {
                let validDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep } });
                if (!validDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት!` });
                }
            }
        }

        activeBonus.claimedBy.push(user.phone);
        activeBonus.currentClaims += 1;
        await activeBonus.save();
        
        user.playBalance += activeBonus.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        
        promoLocks.delete(phone);
        res.json({ success: true, amount: activeBonus.amount });
    } catch(e) { promoLocks.delete(String(req.body.phone)); res.json({success: false}); }
});

const auth = (req, res, next) => { 
    const pass = String(req.body.adminPass || ""); 
    if(pass !== GLOBAL_SETTINGS.adminPass) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

const financeAuth = (req, res, next) => { 
    const pass = String(req.body.adminPass || req.body.financePass || ""); 
    if(pass !== GLOBAL_SETTINGS.financePass && pass !== GLOBAL_SETTINGS.adminPass) {
        return res.status(401).json({error:"Unauthorized"}); 
    }
    next(); 
};

app.post('/api/admin/wipe-fake-balances', auth, async (req, res) => {
    try {
        let result = await User.updateMany(
            { totalDeposited: 0, $or: [{ totalInvites: { $gt: 5 } }, { playBalance: { $gt: 50 } }] },
            { $set: { playBalance: 0, totalInvites: 0, inviteBonusEarned: 0, compensatedInvites: 0 } }
        );
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ${result.modifiedCount} የውሸት አካውንቶች እና የሰረቁት ቦነስ ዜሮ ገብቷል!` });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/delete-fake-referrals', auth, async (req, res) => {
    try {
        let scammers = await User.find({ totalDeposited: 0, totalInvites: { $gt: 5 } });

        let totalFakesDeleted = 0;
        let totalBonusRecovered = 0;

        for (let scammer of scammers) {
            let fakeAccounts = await User.find({ referredBy: scammer.phone, totalDeposited: 0 });

            for (let fake of fakeAccounts) {
                await User.findByIdAndDelete(fake._id);
                totalFakesDeleted++;

                scammer.playBalance -= GLOBAL_SETTINGS.inviteBonus;
                scammer.inviteBonusEarned -= GLOBAL_SETTINGS.inviteBonus;
                scammer.totalInvites -= 1;

                if (scammer.playBalance < 0) scammer.playBalance = 0;
                if (scammer.inviteBonusEarned < 0) scammer.inviteBonusEarned = 0;
                if (scammer.totalInvites < 0) scammer.totalInvites = 0;
                totalBonusRecovered += GLOBAL_SETTINGS.inviteBonus;
            }
            await scammer.save();
        }

        res.json({ 
            success: true, 
            message: `✅ የፅዳት ስራው ተጠናቋል!\n\n🗑️ የጠፉ የውሸት አካውንቶች: ${totalFakesDeleted}\n💰 የተመለሰ የተሰረቀ ቦነስ: ${totalBonusRecovered} ETB` 
        });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/manual-receipt-deposit', auth, async (req, res) => {
    try {
        const { phone, amount, txRef, bank } = req.body;
        let user = await User.findOne({ phone: String(phone) });
        if (!user) return res.json({ success: false, message: "❌ ተጠቃሚው አልተገኘም!" });

        if (!txRef || !amount) return res.json({ success: false, message: "❌ እባክዎ ደረሰኝ እና የብር መጠን ያስገቡ!" });
        
        let isUsed = await isSmsAlreadyUsed(txRef);
        if (isUsed) return res.json({ success: false, message: "❌ ይቅርታ! ይህ ደረሰኝ (TxRef) ቀድሞ ጥቅም ላይ ውሏል!" });

        let actualAmount = Number(amount);
        let bonus = 0;
        let set = GLOBAL_SETTINGS;
        let giveBonus = true;
        
        if (set.depBonusTimeRestricted) {
            let currentHour = new Date().getHours();
            if (currentHour < set.happyHourStart || currentHour > set.happyHourEnd) giveBonus = false;
        }
        
        if (giveBonus) {
            if (set.depBonusTier3Min && actualAmount >= set.depBonusTier3Min && user.hasMadeFirstDeposit) {
                bonus = actualAmount * (set.depBonusTier3Percent / 100);
            }
            else if (set.depBonusTier2Min && actualAmount >= set.depBonusTier2Min) {
                bonus = actualAmount * (set.depBonusTier2Percent / 100);
            } 
            else if (set.depBonusMinAmount && actualAmount >= set.depBonusMinAmount) {
                bonus = actualAmount * (set.depBonusPercent / 100);
            }
        }

        await new Transaction({
            phone: user.phone,
            type: 'deposit',
            amount: actualAmount,
            bonusGiven: bonus,
            method: bank,
            smsText: `Admin Entry (Support): ${txRef}`,
            txRef: txRef,
            status: 'Approved'
        }).save();

        user.playBalance += (actualAmount + bonus);
        user.totalDeposited += actualAmount;
        user.unplayedRealDeposit += actualAmount; 

        let adminPercent = GLOBAL_SETTINGS.adminProfitPercent || 30; 
        let vaultTwoPercent = GLOBAL_SETTINGS.vaultTwoPercent !== undefined ? GLOBAL_SETTINGS.vaultTwoPercent : 10; 
        let vaultThreePercent = GLOBAL_SETTINGS.vaultThreePercent !== undefined ? GLOBAL_SETTINGS.vaultThreePercent : 15; 
        
        let adminCut = actualAmount * (adminPercent / 100);
        let vaultTwoCut = actualAmount * (vaultTwoPercent / 100);
        let vaultThreeCut = actualAmount * (vaultThreePercent / 100);
        let vaultAddition = actualAmount - adminCut - vaultTwoCut - vaultThreeCut; 
        
        await SystemSettings.updateOne({}, { 
            $inc: { 
                virtualPrizePool: vaultAddition,
                vaultTwoBalance: vaultTwoCut,
                vaultThreeBalance: vaultThreeCut
            } 
        });
        GLOBAL_SETTINGS.virtualPrizePool += vaultAddition;
        GLOBAL_SETTINGS.vaultTwoBalance += vaultTwoCut;
        GLOBAL_SETTINGS.vaultThreeBalance += vaultThreeCut;
        dailyHouseProfit += adminCut;

        if(user.referredBy && user.referredViaPromo) {
            let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
            if(promoter) {
                let commission = actualAmount * (promoter.promoterPercent / 100);
                promoter.promoterUnpaidBalance += commission; 
                promoter.promoterEarned += commission;
                await promoter.save();
                user.promoterCommissionGenerated += commission;
            }
        }

        if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true;
        await user.save();

        io.emit('balance_updated', user.phone);
        if (bonus > 0) io.emit('deposit_bonus_alert', { phone: user.phone, depositAmount: actualAmount, bonusAmount: bonus });

        res.json({ success: true, message: `✅ በተሳካ ሁኔታ የ ${actualAmount} ETB ዴፖዚት ለ ${user.name} ገቢ ተደርጓል!` });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/inject-jackpot-bonus', auth, (req, res) => {
    let amount = Number(req.body.amount);
    if(amount && amount > 0) {
        jackpotBoostAmount += amount; 
        totalPrizePool += amount;     
        
        io.emit('game_status', { 
            state: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
            totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit 
        });
        
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ${amount} ETB ደራሽ ላይ ተጨምሯል!` });
    } else {
        res.json({ success: false, message: "❌ ትክክለኛ የብር መጠን ያስገቡ!" });
    }
});

app.post('/api/admin/bot-add-custom', auth, async (req, res) => {
    try {
        let amount = parseInt(req.body.amount);
        if(!amount || amount <= 0) return res.json({success:false, message:"Invalid amount"});
        
        let count = 0;
        for(let i=0; i<amount; i++) {
            let rndName = maleEthNames[Math.floor(Math.random() * maleEthNames.length)];
            let rndPhone = "09" + Math.floor(10000000 + Math.random() * 90000000);
            await new BotUser({ name: rndName, phone: rndPhone, isActive: true, cardsCount: 1 }).save();
            count++;
        }
        res.json({ success: true, message: `Successfully added ${count} new bots.` });
    } catch(e) { res.json({ success: false, message: "Error adding bots" }); }
});

app.post('/api/admin/bots-rename-all', auth, async (req, res) => {
    try {
        let limit = parseInt(req.body.limit) || 0;
        let query = BotUser.find();
        if(limit > 0) query = query.sort({lastPlayed: -1}).limit(limit);
        
        let bots = await query.exec();
        for(let b of bots) {
            b.name = maleEthNames[Math.floor(Math.random() * maleEthNames.length)];
            b.phone = "09" + Math.floor(10000000 + Math.random() * 90000000);
            await b.save();
        }
        res.json({ success: true, message: `✅ የተመረጡት ${bots.length} ቦቶች ስም እና ስልክ ተቀይሯል!` });
    } catch(e) { res.json({ success: false }); }
});

const botRoutes = require('./bots/bot.routes');
app.use('/api/admin', botRoutes(SystemSettings, loadSettings, auth));

app.post('/api/admin/finance-raw-data', financeAuth, async (req, res) => {
    try {
        let txs = await Transaction.find({ status: { $in: ['Approved', 'Pending'] } }).sort({date: -1}).limit(500);
        let games = await GameHistory.find().sort({date: -1}).limit(100);
        let bonuses = await ActiveBonus.find().sort({date: -1}).limit(50);
        let users = await User.find({}, 'mainBalance playBalance'); 
        res.json({ success: true, txs, games, bonuses, users, settings: GLOBAL_SETTINGS });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/finance-stats', financeAuth, async (req, res) => {
    try {
        const { period, customDate, rangeStart, rangeEnd } = req.body;
        let dateQuery = {};
        let now = new Date();

        if (period === 'daily') {
            let start = new Date(); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'weekly') {
            let start = new Date(); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'monthly') {
            let start = new Date(now.getFullYear(), now.getMonth(), 1); dateQuery = { $gte: start };
        } else if (period === 'custom' && customDate) {
            let start = new Date(customDate); let end = new Date(customDate); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        } else if (period === 'range' && rangeStart && rangeEnd) {
            let start = new Date(rangeStart); let end = new Date(rangeEnd); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        }

        let txQuery = { status: 'Approved' };
        let gameQuery = {};
        let bonusQuery = {};
        
        if (Object.keys(dateQuery).length > 0) {
            txQuery.date = dateQuery; gameQuery.date = dateQuery; bonusQuery.date = dateQuery;
        }

        let txs = await Transaction.find(txQuery);
        let tDep = 0, tWit = 0, tPromoterPaid = 0;
        txs.forEach(t => {
            if (t.type === 'deposit') tDep += t.amount;
            if (t.type === 'withdraw' && t.method !== 'Promoter Comm') tWit += t.amount;
            if (t.type === 'withdraw' && t.method === 'Promoter Comm') tPromoterPaid += t.amount;
        });
        let netCash = tDep - (tWit + tPromoterPaid);

        let games = await GameHistory.find(gameQuery);
        let tWinnings = 0, tProf = 0, tTurnover = 0;
        games.forEach(g => {
            tWinnings += (g.prize || 0); tProf += (g.adminProfit || 0); tTurnover += ((g.prize || 0) + (g.adminProfit || 0));
        });

        let promos = await ActiveBonus.find(bonusQuery);
        let totalBonusPaid = 0;
        promos.forEach(p => { totalBonusPaid += ((p.amount || 0) * (p.currentClaims || 0)); });

        let usersResult = await User.aggregate([{ $group: { _id: null, main: { $sum: "$mainBalance" }, play: { $sum: "$playBalance" } } }]);
        let liability = usersResult.length > 0 ? usersResult[0].main + usersResult[0].play : 0;

        let netProfit = dailyHouseProfit - totalBonusPaid - tPromoterPaid; 

        res.json({ success: true, stats: { tDep, tWit, netCash, tTurnover, tWinnings, tProf, totalBonusPaid, tPromoterPaid, liability, netProfit } });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/finance-stats', financeAuth, async (req, res) => {
    try {
        const { period, customDate, rangeStart, rangeEnd } = req.body;
        let dateQuery = {};
        let now = new Date();

        if (period === 'daily') {
            let start = new Date(); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'weekly') {
            let start = new Date(); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'monthly') {
            let start = new Date(now.getFullYear(), now.getMonth(), 1); dateQuery = { $gte: start };
        } else if (period === 'custom' && customDate) {
            let start = new Date(customDate); let end = new Date(customDate); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        } else if (period === 'range' && rangeStart && rangeEnd) {
            let start = new Date(rangeStart); let end = new Date(rangeEnd); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        }

        let txQuery = { status: 'Approved' };
        let gameQuery = {};
        let bonusQuery = {};
        
        if (Object.keys(dateQuery).length > 0) {
            txQuery.date = dateQuery; gameQuery.date = dateQuery; bonusQuery.date = dateQuery;
        }

        let txs = await Transaction.find(txQuery);
        let tDep = 0, tWit = 0, tPromoterPaid = 0;
        txs.forEach(t => {
            if (t.type === 'deposit') tDep += t.amount;
            if (t.type === 'withdraw' && t.method !== 'Promoter Comm') tWit += t.amount;
            if (t.type === 'withdraw' && t.method === 'Promoter Comm') tPromoterPaid += t.amount;
        });
        let netCash = tDep - (tWit + tPromoterPaid);

        let games = await GameHistory.find(gameQuery);
        let tWinnings = 0, tProf = 0, tTurnover = 0;
        games.forEach(g => {
            tWinnings += (g.prize || 0); tProf += (g.adminProfit || 0); tTurnover += ((g.prize || 0) + (g.adminProfit || 0));
        });

        let promos = await ActiveBonus.find(bonusQuery);
        let totalBonusPaid = 0;
        promos.forEach(p => { totalBonusPaid += ((p.amount || 0) * (p.currentClaims || 0)); });

        let usersResult = await User.aggregate([{ $group: { _id: null, main: { $sum: "$mainBalance" }, play: { $sum: "$playBalance" } } }]);
        let liability = usersResult.length > 0 ? usersResult[0].main + usersResult[0].play : 0;

        let netProfit = dailyHouseProfit - totalBonusPaid - tPromoterPaid; 

        res.json({ success: true, stats: { tDep, tWit, netCash, tTurnover, tWinnings, tProf, totalBonusPaid, tPromoterPaid, liability, netProfit } });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/users', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');
        let query = {};
        if (search) {
            query = { $or: [{ phone: new RegExp(search, 'i') }, { name: new RegExp(search, 'i') }] };
        }

        let total = await User.countDocuments(query);
        let users = await User.find(query).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit);

        let phoneList = users.map(u => u.phone);
        let actualInviteCounts = await User.aggregate([
            { $match: { referredBy: { $in: phoneList } } },
            { $group: { _id: "$referredBy", count: { $sum: 1 } } }
        ]);
        let inviteMap = {};
        actualInviteCounts.forEach(i => inviteMap[i._id] = i.count);

        let updatedUsers = [];
        for (let u of users) {
            let userObj = u.toObject();
            let trueCount = inviteMap[userObj.phone] || 0;
            
            userObj.totalInvites = Math.max(userObj.totalInvites || 0, trueCount);
            if (!userObj.isPromoter) {
                userObj.inviteBonusEarned = Math.max(userObj.inviteBonusEarned || 0, trueCount * GLOBAL_SETTINGS.inviteBonus);
            }
            updatedUsers.push(userObj);
            
            if ((u.totalInvites || 0) < trueCount || (!u.isPromoter && (u.inviteBonusEarned || 0) < (trueCount * GLOBAL_SETTINGS.inviteBonus))) {
                User.updateOne({ phone: u.phone }, { $set: { totalInvites: userObj.totalInvites, inviteBonusEarned: userObj.inviteBonusEarned } }).exec();
            }
        }

        res.json({ success: true, users: updatedUsers, total, settings: GLOBAL_SETTINGS });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/transactions', auth, async (req, res) => {
    try {
        if (req.body.isPending) {
            let txs = await Transaction.find({ status: 'Pending', hiddenFromAdmin: { $ne: true } }).sort({ date: -1 });
            return res.json({ success: true, txs });
        }
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');
        let type = String(req.body.type || 'deposit');
        
        let query = { hiddenFromAdmin: { $ne: true } }; 
        if (type === 'rejected') { 
            query.status = 'Rejected'; 
        } else if (type === 'win') {
            query.type = 'win';
            query.status = 'Approved';
        } else { 
            query.type = type; 
            query.status = 'Approved'; 
        }
        
        if (search) query.phone = new RegExp(search, 'i');
        
        let total = await Transaction.countDocuments(query);
        let txs = await Transaction.find(query).sort({ date: -1 }).skip((page - 1) * limit).limit(limit);
        res.json({ success: true, txs, total });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/history', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');
        
        let query = {};
        
        if (search) {
            query.$or = [
                { winnerPhone: new RegExp(search, 'i') },
                { ticketId: new RegExp(search, 'i') } 
            ];
            if(!isNaN(search)) query.$or.push({ gameId: Number(search) });
        }
        
        let total = await GameHistory.countDocuments(query);
        let history = await GameHistory.find(query).sort({ date: -1 }).skip((page - 1) * limit).limit(limit);
        res.json({ success: true, history, total });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/search-bets', auth, async (req, res) => {
    try {
        let search = String(req.body.search || '').trim();
        if (!search) return res.json({ success: true, games: [] });

        let query = { $or: [
            { "playersData.phone": new RegExp(search, 'i') }
        ] };
        if (!isNaN(search)) {
            query.$or.push({ "playersData.ticketsData.id": Number(search) });
            query.$or.push({ gameId: Number(search) });
        }

        let games = await GameHistory.find(query).sort({ date: -1 }).limit(20);
        res.json({ success: true, games });
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/user-details', auth, async (req, res) => {
    try {
        let phone = String(req.body.phone);
        let txs = await Transaction.find({ phone: phone, hiddenFromAdmin: { $ne: true } }).sort({ date: -1 }).limit(100);
        
        let allTxs = await Transaction.find({ phone: phone, status: 'Approved' });
        let aggDep = 0, aggWit = 0, aggBonus = 0, aggWin = 0;
        allTxs.forEach(t => {
            if(t.type === 'deposit') { aggDep += t.amount; aggBonus += (t.bonusGiven || 0); }
            if(t.type === 'withdraw') { aggWit += t.amount; }
            if(t.type === 'win') { aggWin += t.amount; }
        });

        res.json({ success: true, txs, aggDep, aggWit, aggBonus, aggWin });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/live-players-list', auth, (req, res) => {
    try {
        let playersArray = Object.values(activePlayers).map(p => ({
            name: p.name,
            phone: p.phone,
            tickets: p.tickets,
            isBot: p.isBot
        }));
        res.json({ success: true, players: playersArray });
    } catch (e) {
        res.json({ success: false, message: "Error fetching live players" });
    }
});

app.post('/api/admin/live-stats', auth, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        let startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        let txStats = await Transaction.aggregate([
            { $match: { date: { $gte: startOfDay }, status: 'Approved' } },
            { $group: { _id: "$type", total: { $sum: "$amount" } } }
        ]);
        let dailyDeposit = 0;
        let dailyWithdraw = 0;
        txStats.forEach(t => {
            if (t._id === 'deposit') dailyDeposit = t.total;
            if (t._id === 'withdraw') dailyWithdraw = t.total;
        });

        let bonusStats = await ActiveBonus.aggregate([
            { $match: { date: { $gte: startOfDay } } },
            { $group: { _id: null, totalBonus: { $sum: { $multiply: ["$amount", "$currentClaims"] } } } }
        ]);
        let dailyBonus = bonusStats.length > 0 ? bonusStats[0].totalBonus : 0;

        let bonusAgg = await User.aggregate([{ $group: { _id: null, totalUnplayed: { $sum: "$playBalance" } } }]);
        let totalUnplayedBonus = bonusAgg.length > 0 ? bonusAgg[0].totalUnplayed : 0;

        let realMoney = 0;
        let botMoney = 0;
        let realCount = 0;
        let botCount = 0;

        Object.values(activePlayers).forEach(p => {
            if (p.isBot) {
                botMoney += (p.tickets * GLOBAL_SETTINGS.ticketPrice);
                botCount++;
            } else {
                realMoney += (p.tickets * GLOBAL_SETTINGS.ticketPrice);
                realCount++;
            }
        });

        let eatTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
        let cHour = eatTime.getUTCHours();
        let cMin = eatTime.getUTCMinutes();
        let timeStr = `${cHour.toString().padStart(2, '0')}:${cMin.toString().padStart(2, '0')} (EAT)`;
        
        let activeSchName = "None";
        let schMin = 0, schMax = 0;
        
        if (GLOBAL_SETTINGS.isBotScheduleActive) {
            let schedules = [
                {n: "Sch 1", d: GLOBAL_SETTINGS.botSchedule1}, {n: "Sch 2", d: GLOBAL_SETTINGS.botSchedule2},
                {n: "Sch 3", d: GLOBAL_SETTINGS.botSchedule3}, {n: "Sch 4", d: GLOBAL_SETTINGS.botSchedule4}
            ];
            for(let s of schedules) {
                let st = s.d.start || 0; let en = s.d.end || 24;
                if ((st < en && cHour >= st && cHour < en) || (st > en && (cHour >= st || cHour < en))) {
                    activeSchName = s.n; schMin = s.d.min; schMax = s.d.max; break;
                }
            }
        }

        res.json({ 
            totalUsers, 
            livePlayers: Object.keys(activePlayers).length, 
            realPlayersCount: realCount,
            botPlayersCount: botCount,
            activeBotPhones: Object.values(activePlayers).filter(p => p.isBot).map(p => p.phone), 
            gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, 
            gameId, 
            totalProfit: dailyHouseProfit, 
            currentJackpot: totalPrizePool, 
            realMoney: realMoney,
            botMoney: botMoney,
            settings: GLOBAL_SETTINGS, 
            dailyDeposit, 
            dailyWithdraw, 
            dailyBonus,
            totalUnplayedBonus,
            scheduleStatus: { active: GLOBAL_SETTINGS.isBotScheduleActive, time: timeStr, name: activeSchName, min: schMin, max: schMax }
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/bot-master-update-v2', auth, async (req, res) => {
    try {
        let s = await SystemSettings.findOne();
        
        let d1 = req.body.botDist1 !== undefined ? req.body.botDist1 : 5;
        let d2 = req.body.botDist2 !== undefined ? req.body.botDist2 : 4;
        let d3 = req.body.botDist3 !== undefined ? req.body.botDist3 : 3;
        let d4 = req.body.botDist4 !== undefined ? req.body.botDist4 : 3;
        
        if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
            d1 = 5; d2 = 4; d3 = 3; d4 = 3;
        }

        s.isBotSystemActive = !!req.body.isBotSystemActive;
        s.botWinnerForce = req.body.botWinnerForce;
        s.mixBotCount = req.body.mixBotCount !== undefined ? req.body.mixBotCount : 1;
        s.botDist1 = d1; 
        s.botDist2 = d2; 
        s.botDist3 = d3; 
        s.botDist4 = d4;
        
        s.isBotScheduleActive = !!req.body.isBotScheduleActive;
        if(req.body.botSchedule1) { s.botSchedule1 = req.body.botSchedule1; s.markModified('botSchedule1'); }
        if(req.body.botSchedule2) { s.botSchedule2 = req.body.botSchedule2; s.markModified('botSchedule2'); }
        if(req.body.botSchedule3) { s.botSchedule3 = req.body.botSchedule3; s.markModified('botSchedule3'); }
        if(req.body.botSchedule4) { s.botSchedule4 = req.body.botSchedule4; s.markModified('botSchedule4'); }

        await s.save(); 
        await loadSettings();

        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/admin/referrals', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');

        let query = { $or: [{ totalInvites: { $gt: 0 } }, { inviteBonusEarned: { $gt: 0 } }] };

        if (search) {
            query.phone = new RegExp(search, 'i');
        }

        let total = await User.countDocuments(query);
        let referrers = await User.find(query)
            .sort({ totalInvites: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        let mappedData = referrers.map(r => {
            let actualInvites = r.totalInvites || 0;
            let bonusAmount = GLOBAL_SETTINGS.inviteBonus || 10; 
            let expectedEarned = actualInvites * bonusAmount;
            let alreadyEarned = r.inviteBonusEarned || 0;

            return {
                _id: r.phone,
                count: actualInvites,
                earned: Math.max(expectedEarned, alreadyEarned)
            };
        });

        res.json({ success: true, referrals: mappedData, total });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/bot-master-update-v2', auth, async (req, res) => {
    try {
        let s = await SystemSettings.findOne();
        
        let d1 = req.body.botDist1 !== undefined ? req.body.botDist1 : 5;
        let d2 = req.body.botDist2 !== undefined ? req.body.botDist2 : 4;
        let d3 = req.body.botDist3 !== undefined ? req.body.botDist3 : 3;
        let d4 = req.body.botDist4 !== undefined ? req.body.botDist4 : 3;
        
        if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
            d1 = 5; d2 = 4; d3 = 3; d4 = 3;
        }

        s.isBotSystemActive = !!req.body.isBotSystemActive;
        s.botWinnerForce = req.body.botWinnerForce;
        s.mixBotCount = req.body.mixBotCount !== undefined ? req.body.mixBotCount : 1;
        s.botDist1 = d1; 
        s.botDist2 = d2; 
        s.botDist3 = d3; 
        s.botDist4 = d4;
        
        s.isBotScheduleActive = !!req.body.isBotScheduleActive;
        if(req.body.botSchedule1) { s.botSchedule1 = req.body.botSchedule1; s.markModified('botSchedule1'); }
        if(req.body.botSchedule2) { s.botSchedule2 = req.body.botSchedule2; s.markModified('botSchedule2'); }
        if(req.body.botSchedule3) { s.botSchedule3 = req.body.botSchedule3; s.markModified('botSchedule3'); }
        if(req.body.botSchedule4) { s.botSchedule4 = req.body.botSchedule4; s.markModified('botSchedule4'); }

        await s.save(); 
        await loadSettings();

        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/admin/referrals', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');

        let query = { $or: [{ totalInvites: { $gt: 0 } }, { inviteBonusEarned: { $gt: 0 } }] };

        if (search) {
            query.phone = new RegExp(search, 'i');
        }

        let total = await User.countDocuments(query);
        let referrers = await User.find(query)
            .sort({ totalInvites: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        let mappedData = referrers.map(r => {
            let actualInvites = r.totalInvites || 0;
            let bonusAmount = GLOBAL_SETTINGS.inviteBonus || 10; 
            let expectedEarned = actualInvites * bonusAmount;
            let alreadyEarned = r.inviteBonusEarned || 0;

            return {
                _id: r.phone,
                count: actualInvites,
                earned: Math.max(expectedEarned, alreadyEarned)
            };
        });

        res.json({ success: true, referrals: mappedData, total });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/referral-details', auth, async (req, res) => {
    try {
        let users = await User.find({ referredBy: String(req.body.phone) }).select('name phone _id').sort({ _id: -1 });
        let mappedUsers = users.map(u => ({
            name: u.name,
            phone: u.phone,
            date: u._id.getTimestamp()
        }));
        res.json({ success: true, users: mappedUsers });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/fix-missing-invites', auth, async (req, res) => {
    try {
        let users = await User.find({ referredBy: { $ne: "" } });
        let inviteCounts = {};
        
        users.forEach(u => {
            inviteCounts[u.referredBy] = (inviteCounts[u.referredBy] || 0) + 1;
        });

        let fixedCount = 0;
        let totalPaid = 0;

        for (let phone in inviteCounts) {
            let actualInvites = inviteCounts[phone];
            let referrer = await User.findOne({ phone: phone, isPromoter: false }); 
            
            if (referrer) {
                let paidSoFar = referrer.compensatedInvites || 0;
                
                if (actualInvites > paidSoFar) {
                    let unpaidCount = actualInvites - paidSoFar;
                    let bonusAmount = unpaidCount * GLOBAL_SETTINGS.inviteBonus;
                    
                    referrer.playBalance += bonusAmount;
                    referrer.compensatedInvites = actualInvites; 
                    referrer.totalInvites = actualInvites;
                    referrer.inviteBonusEarned = (referrer.inviteBonusEarned || 0) + bonusAmount;
                    await referrer.save();
                    
                    fixedCount++;
                    totalPaid += bonusAmount;
                    io.emit('balance_updated', referrer.phone);
                }
            }
        }
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ተስተካክሏል!\n\nለ ${fixedCount} ሰዎች አጠቃላይ ${totalPaid} ETB ቦነስ ተከፍሏል።` });
    } catch(e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/list-promo-codes', auth, async (req, res) => {
    try {
        let codes = await PromoCode.find().sort({ _id: -1 });
        res.json({ success: true, codes });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/create-promo-code', auth, async (req, res) => {
    try {
        let exists = await PromoCode.findOne({ code: String(req.body.code) });
        if(exists) return res.json({ success: false, message: "Code already exists!" });
        await new PromoCode({ 
            code: String(req.body.code), 
            amount: Number(req.body.amount), 
            maxUses: Number(req.body.maxUses),
            requireDeposit: !!req.body.requireDeposit,
            minDepositAmount: Number(req.body.minDepositAmount) || 0,
            requireDepositWithinHours: Number(req.body.requireDepositWithinHours) || 0
        }).save();
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/delete-promo-code', auth, async (req, res) => {
    try { await PromoCode.findByIdAndDelete(req.body.id); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/delete-users', auth, async (req, res) => {
    try { await User.deleteMany({ phone: { $in: req.body.phones } }); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-history', auth, async (req, res) => {
    try { await GameHistory.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-transactions', auth, async (req, res) => {
    try { 
        await Transaction.updateMany({ _id: { $in: req.body.ids } }, { hiddenFromAdmin: true }); 
        res.json({ success: true }); 
    } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-game-player', auth, async (req, res) => {
    try {
        let h = await GameHistory.findById(req.body.id);
        if(h) {
            h.playersData = h.playersData.filter(p => p.phone !== req.body.phone);
            await h.save();
            res.json({ success: true });
        } else { res.json({ success: false }); }
    } catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-old-history', auth, async (req, res) => {
    try {
        let cutoff = new Date(Date.now() - (6 * 60 * 60 * 1000));
        await GameHistory.deleteMany({ date: { $lt: cutoff } });
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/promoters-data', financeAuth, async (req, res) => {
    try {
        let promoters = await User.find({ isPromoter: true });
        let data = [];
        for (let p of promoters) {
            let refUsers = await User.find({ referredBy: p.phone, referredViaPromo: true });
            let refPhones = refUsers.map(u => u.phone);
            let activeDepositors = refUsers.filter(u => u.totalDeposited > 0).length;

            let deps = await Transaction.find({ phone: { $in: refPhones }, type: 'deposit', status: 'Approved' });
            let totalDep = deps.reduce((sum, tx) => sum + tx.amount, 0);
            
            data.push({
                name: p.name, phone: p.phone, percent: p.promoterPercent,
                earned: p.promoterEarned, unpaidBalance: p.promoterUnpaidBalance, 
                usersBrought: refUsers.length, activeDepositors: activeDepositors, totalDeposits: totalDep
            });
        }
        res.json({ success: true, promoters: data });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/set-promoter', auth, async (req, res) => {
    try {
        const { phone, isPromoter, percent } = req.body;
        let user = await User.findOne({ phone: String(phone) });
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
        let p = await User.findOne({ phone: String(req.body.phone), isPromoter: true });
        if(!p) return res.json({ success: false });

        let refUsers = await User.find({ referredBy: p.phone, referredViaPromo: true });
        let details = [];
        for(let u of refUsers) {
            let deps = await Transaction.find({ phone: u.phone, type: 'deposit', status: 'Approved' });
            let totalDep = deps.reduce((sum, tx) => sum + tx.amount, 0);
            details.push({
                name: u.name, phone: u.phone, totalDeposit: totalDep, commission: u.promoterCommissionGenerated || 0
            });
        }
        res.json({ success: true, promoter: p, details });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/pay-promoter', auth, async (req, res) => {
    try {
        let p = await User.findOne({ phone: String(req.body.phone), isPromoter: true });
        if(p) {
            let deductAmt = Number(req.body.amount);
            p.promoterUnpaidBalance -= deductAmt;
            if(p.promoterUnpaidBalance < 0) p.promoterUnpaidBalance = 0;
            await p.save();
            
            await new Transaction({ 
                phone: p.phone, 
                type: 'withdraw', 
                amount: deductAmt, 
                method: "Promoter Comm", 
                smsText: "Manual Admin Payment",
                status: "Approved"
            }).save();

            res.json({ success: true, message: `✅ ለ ${p.name} በተሳካ ሁኔታ ${deductAmt} ETB ተቀንሷል።` });
        } else res.json({ success: false, message: "Promoter not found" });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    if (req.body.action === 'Approve') { 
        tx.status = 'Approved'; 
        if(tx.type === 'deposit') {
            let actualAmount = tx.amount;
            let bonus = 0;
            let set = GLOBAL_SETTINGS;
            let giveBonus = true;
            
            if (set.depBonusTimeRestricted) {
                let currentHour = new Date().getHours();
                if (currentHour < set.happyHourStart || currentHour > set.happyHourEnd) { giveBonus = false; }
            }
            
            if (giveBonus) {
                if (set.depBonusTier3Min && actualAmount >= set.depBonusTier3Min && user.hasMadeFirstDeposit) {
                    bonus = actualAmount * (set.depBonusTier3Percent / 100);
                }
                else if (set.depBonusTier2Min && actualAmount >= set.depBonusTier2Min) {
                    bonus = actualAmount * (set.depBonusTier2Percent / 100);
                } 
                else if (set.depBonusMinAmount && actualAmount >= set.depBonusMinAmount) {
                    bonus = actualAmount * (set.depBonusPercent / 100);
                }
            }
            
            let totalCredit = actualAmount + bonus;
            tx.bonusGiven = bonus;
            user.playBalance += totalCredit;
            user.totalDeposited += actualAmount;
            user.unplayedRealDeposit += actualAmount; 

            let adminPercent = GLOBAL_SETTINGS.adminProfitPercent || 30; 
            let vaultTwoPercent = GLOBAL_SETTINGS.vaultTwoPercent !== undefined ? GLOBAL_SETTINGS.vaultTwoPercent : 10; 
            let vaultThreePercent = GLOBAL_SETTINGS.vaultThreePercent !== undefined ? GLOBAL_SETTINGS.vaultThreePercent : 15; 
            
            let adminCut = actualAmount * (adminPercent / 100);
            let vaultTwoCut = actualAmount * (vaultTwoPercent / 100);
            let vaultThreeCut = actualAmount * (vaultThreePercent / 100);
            let vaultAddition = actualAmount - adminCut - vaultTwoCut - vaultThreeCut; 
            
            await SystemSettings.updateOne({}, { 
                $inc: { 
                    virtualPrizePool: vaultAddition,
                    vaultTwoBalance: vaultTwoCut,
                    vaultThreeBalance: vaultThreeCut
                } 
            });
            GLOBAL_SETTINGS.virtualPrizePool += vaultAddition;
            GLOBAL_SETTINGS.vaultTwoBalance += vaultTwoCut;
            GLOBAL_SETTINGS.vaultThreeBalance += vaultThreeCut;
            dailyHouseProfit += adminCut;

            if(user.referredBy && user.referredViaPromo) {
                let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                if(promoter) {
                    let commission = actualAmount * (promoter.promoterPercent / 100);
                    promoter.promoterUnpaidBalance += commission; 
                    promoter.promoterEarned += commission;
                    await promoter.save();
                    user.promoterCommissionGenerated += commission;
                }
            }
            if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true;
            user.totalWithdrawn = user.totalWithdrawn || 0;
            
            if (bonus > 0) {
                io.emit('deposit_bonus_alert', { phone: tx.phone, depositAmount: actualAmount, bonusAmount: bonus });
            }

        } else if (tx.type === 'withdraw') {
            let set = GLOBAL_SETTINGS;
            user.totalWithdrawn = (user.totalWithdrawn || 0) + tx.amount;
            
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
        if(tx.type === 'withdraw' && tx.method === 'Promoter Comm') {
            user.promoterUnpaidBalance += tx.amount;
        } else if(tx.type === 'withdraw') {
            user.mainBalance += tx.amount; 
        }
    }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
});

app.post('/api/admin/sms-comparison', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = 20; 
        let skip = (page - 1) * limit;

        let total = await BankSMS.countDocuments();
        let smsList = await BankSMS.find().sort({ dateReceived: -1 }).skip(skip).limit(limit);

        let comparisonData = [];
        for (let sms of smsList) {
            let tx = await Transaction.findOne({ txRef: sms.txRef });
            comparisonData.push({
                smsDate: sms.dateReceived,
                iphoneSms: sms.rawText, 
                txRef: sms.txRef,
                extraction: sms.amount,
                systemData: tx ? {
                    txId: tx._id,
                    phone: tx.phone,
                    amount: tx.amount,
                    status: tx.status, 
                    userSms: tx.smsText, 
                    date: tx.date
                } : null
            });
        }
        res.json({ success: true, data: comparisonData, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e) { res.json({ success: false, message: "Error loading data" }); }
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass;
    if(req.body.newFinancePass) s.financePass = req.body.newFinancePass;
    
    if(req.body.vaultTwoBalance !== undefined) s.vaultTwoBalance = req.body.vaultTwoBalance;
    if(req.body.vaultTwoPercent !== undefined) s.vaultTwoPercent = req.body.vaultTwoPercent;
    
    if(req.body.vaultThreeBalance !== undefined) s.vaultThreeBalance = req.body.vaultThreeBalance;
    if(req.body.vaultThreePercent !== undefined) s.vaultThreePercent = req.body.vaultThreePercent;

    if(req.body.decoyChancePercent !== undefined) s.decoyChancePercent = req.body.decoyChancePercent;
    if(req.body.virtualPrizePool !== undefined) s.virtualPrizePool = req.body.virtualPrizePool;
    if(req.body.bonusWinPercent !== undefined) s.bonusWinPercent = req.body.bonusWinPercent;

    if(req.body.ticketPrice !== undefined) s.ticketPrice = req.body.ticketPrice;
    if(req.body.gameTimer !== undefined) s.gameTimer = req.body.gameTimer;
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    
    if(req.body.depBonusMinAmount !== undefined) s.depBonusMinAmount = req.body.depBonusMinAmount;
    if(req.body.depBonusPercent !== undefined) s.depBonusPercent = req.body.depBonusPercent;
    
    if(req.body.depBonusTier2Min !== undefined) s.depBonusTier2Min = req.body.depBonusTier2Min;
    if(req.body.depBonusTier2Percent !== undefined) s.depBonusTier2Percent = req.body.depBonusTier2Percent;

    if(req.body.depBonusTier3Min !== undefined) s.depBonusTier3Min = req.body.depBonusTier3Min;
    if(req.body.depBonusTier3Percent !== undefined) s.depBonusTier3Percent = req.body.depBonusTier3Percent;
    
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
    if(req.body.witBannerTextAm !== undefined) s.witBannerTextAm = req.body.witBannerTextAm;
    if(req.body.witBannerTextEn !== undefined) s.witBannerTextEn = req.body.witBannerTextEn;

    if(req.body.registerBonus !== undefined) s.registerBonus = req.body.registerBonus;
    if(req.body.inviteBonus !== undefined) s.inviteBonus = req.body.inviteBonus;
    if(req.body.adminProfitPercent !== undefined) s.adminProfitPercent = req.body.adminProfitPercent; 
    if(req.body.maxTicketsPerUser !== undefined) s.maxTicketsPerUser = req.body.maxTicketsPerUser; 
    
    if(req.body.minWithdrawLimit !== undefined) s.minWithdrawLimit = req.body.minWithdrawLimit;
    
    if(req.body.winPopupTimer !== undefined) s.winPopupTimer = req.body.winPopupTimer;
    
    if(req.body.telegramChannel !== undefined) s.telegramChannel = req.body.telegramChannel;

    if(req.body.jackpotBoostAmount !== undefined) {
        s.jackpotBoostAmount = req.body.jackpotBoostAmount;
        jackpotBoostAmount = req.body.jackpotBoostAmount;
    }

    await s.save(); await loadSettings();
    res.json({ success: true });
});

app.post('/api/admin/trigger-cashback', auth, async (req, res) => {
    try {
        const minL = GLOBAL_SETTINGS.cashbackMinLoss || 200;
        const cAmt = GLOBAL_SETTINGS.cashbackAmount || 10;
        
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

app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const oldPhone = String(req.body.oldPhone);
        const newPhone = String(req.body.newPhone);
        const name = String(req.body.name);
        const userPass = String(req.body.userPass || "");
        
        let updateData = { 
            phone: newPhone, 
            name: name,
            mainBalance: Number(req.body.mainBalance), 
            playBalance: Number(req.body.playBalance), 
            won: Number(req.body.won) 
        };
        
        if (userPass.trim() !== "") { 
            updateData.password = userPass.trim(); 
        }
        
        let updatedUser = await User.findOneAndUpdate(
            { phone: oldPhone }, 
            { $set: updateData }, 
            { new: true } 
        );
        
        if(updatedUser) {
            if (activePlayers[oldPhone]) {
                if (oldPhone !== newPhone) {
                    activePlayers[newPhone] = activePlayers[oldPhone];
                    delete activePlayers[oldPhone];
                    activePlayers[newPhone].phone = newPhone;
                }
                activePlayers[newPhone].name = name;
            }
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch(e) { 
        res.json({ success: false, message: "Error saving data." }); 
    }
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: String(req.body.phone) }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/unban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: String(req.body.phone) }, { status: 'active' }); res.json({ success: true }); });

app.post('/api/admin/factory-reset', auth, async (req, res) => {
    await User.deleteMany({}); await Transaction.deleteMany({}); await GameHistory.deleteMany({}); await BankSMS.deleteMany({}); await ActiveBonus.deleteMany({}); await ScheduledBroadcast.deleteMany({});
    res.json({ success: true, message: "✅ ሲስተሙ ሙሉ በሙሉ ፀድቷል! ሁሉም ዳታ ጠፍቷል እንደ አዲስ ይጀምራል።" });
});

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    let user = await User.findOne({ phone: String(req.body.phone) });
    if(user) { 
        user.playBalance += Number(req.body.amount); 
        await user.save(); 
        io.emit('balance_updated', user.phone); 
        res.json({ success: true, message: `✅ Bonus of ${req.body.amount} ETB successfully sent to ${req.body.phone}!` });
    } else {
        res.json({ success: false, message: `❌ User with phone ${req.body.phone} not found! Check the number.` });
    }
});

app.post('/api/admin/send-bulk-bonus', auth, async (req, res) => {
    if (req.body.phones === "ALL") { await User.updateMany({}, { $inc: { playBalance: Number(req.body.amount) } }); } 
    else { await User.updateMany({ phone: { $in: req.body.phones } }, { $inc: { playBalance: Number(req.body.amount) } }); }
    res.json({ success: true, message: `✅ Bulk Bonus of ${req.body.amount} ETB successfully sent!` });
});

app.post('/api/admin/claim-bonus-list', auth, async (req, res) => {
    try {
        let activeBonus = await ActiveBonus.findOne({ isActive: true });
        if(!activeBonus) return res.json({ success: false, message: "No active promo." });
        res.json({ success: true, claimedBy: activeBonus.claimedBy, max: activeBonus.maxUsers });
    } catch(e) { res.status(500).json({ success: false }); }
});

let isBroadcasting = false; 

app.post('/api/admin/create-claim-bonus', auth, async (req, res) => {
    if (isBroadcasting) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ! አሁን መልዕክት በመላክ ላይ ነው። (Please wait, sending in progress...)" });
    isBroadcasting = true;
    try {
        const { maxUsers, amount, minutes, message, photoUrl, depositorsOnly, minDepositAmount, requireDepositWithinHours, platform } = req.body;
        let expires = new Date(Date.now() + (minutes * 60000));
        await ActiveBonus.updateMany({}, { isActive: false });
        
        await new ActiveBonus({ 
            amount, maxUsers, expiresAt: expires, isActive: true, 
            depositorsOnly: depositorsOnly,
            minDepositAmount: minDepositAmount || 0,
            requireDepositWithinHours: requireDepositWithinHours || 0
        }).save();
        
        if (platform === 'web' || platform === 'both') {
            io.emit('new_promo_alert', { amount: amount, msg: message });
        }

        if ((platform === 'tg' || platform === 'both') && message) {
            let query = { telegramId: { $ne: "" } };
            
            const users = await User.find(query);
            lastBroadcasts = []; 
            const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: `🎁 Claim ${amount} ETB Bonus`, callback_data: 'claim_promo' }]] } };

            for (let u of users) {
                if(depositorsOnly) {
                    if (requireDepositWithinHours > 0) {
                        let cutoff = new Date(Date.now() - (requireDepositWithinHours * 60 * 60 * 1000));
                        let recentDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) }, date: { $gte: cutoff } });
                        if (!recentDep) continue;
                    } else {
                        let validDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) } });
                        if (!validDep) continue;
                    }
                }

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
        res.json({ success: true, message: `✅ Promo Created & Broadcasted Successfully!` });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error processing promo." });
    } finally {
        isBroadcasting = false;
    }
});

let lastBroadcasts = []; 

// 🔥 Scheduled Broadcast Logic 🔥
app.post('/api/admin/schedule-telegram', auth, async (req, res) => {
    try {
        const { message, photoUrl, depositorsOnly, minDepositAmount, requireDepositWithinHours, scheduledTime } = req.body;
        if (!message || !scheduledTime) return res.json({ success: false, message: "Message & Time are required." });

        await ScheduledBroadcast.create({
            message, photoUrl, targetPlatform: 'tg',
            depositorsOnly, minDepositAmount, requireDepositWithinHours,
            scheduledTime, status: 'pending'
        });

        res.json({ success: true, message: `✅ Broadcast Scheduled successfully for ${scheduledTime} (EAT)!` });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    if (isBroadcasting) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ! አሁን መልዕክት በመላክ ላይ ነው።" });
    isBroadcasting = true;
    try {
        const { message, photoUrl, depositorsOnly, minDepositAmount, requireDepositWithinHours } = req.body;
        if (!message) {
            isBroadcasting = false;
            return res.json({ success: false, message: "No message entered." });
        }
        
        let query = { telegramId: { $ne: "" } };
        const users = await User.find(query);
        lastBroadcasts = []; 
        let count = 0;
        
        res.json({ success: true, message: `✅ መልዕክቱ መላክ ጀምሯል። ለ ${users.length} ሰዎች ከበስተጀርባ (Background) ይላካል።` });

        (async () => {
            for (let u of users) {
                if(depositorsOnly) {
                    if (requireDepositWithinHours > 0) {
                        let cutoff = new Date(Date.now() - (requireDepositWithinHours * 60 * 60 * 1000));
                        let recentDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) }, date: { $gte: cutoff } });
                        if (!recentDep) continue;
                    } else {
                        let validDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) } });
                        if (!validDep) continue;
                    }
                }

                try {
                    let sentMsg;
                    if (photoUrl && photoUrl.startsWith('data:image')) {
                        let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); let photoBuffer = Buffer.from(base64Data, 'base64');
                        sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, parse_mode: "HTML" });
                    } else if (photoUrl && photoUrl.startsWith('http')) { 
                        sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, parse_mode: "HTML" });
                    } else { 
                        sentMsg = await bot.sendMessage(u.telegramId, message, { parse_mode: "HTML" }); 
                    }
                    lastBroadcasts.push({ chatId: u.telegramId, messageId: sentMsg.message_id }); 
                    count++;
                } catch(e) {} 
                
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            isBroadcasting = false;
        })();
        
    } catch (e) { 
        isBroadcasting = false;
    } 
});

app.post('/api/admin/delete-broadcast', auth, async (req, res) => {
    try {
        if(lastBroadcasts.length === 0) return res.json({ success: false, message: "No recent broadcast found." });
        let count = 0;
        for (let b of lastBroadcasts) { try { await bot.deleteMessage(b.chatId, b.messageId); count++; } catch(e) {} }
        lastBroadcasts = []; res.json({ success: true, message: `🗑️ Deleted ${count} messages.` });
    } catch(e) { res.status(500).json({ success: false, message: "Error deleting broadcast." }); }
});

app.post('/api/admin/inject-live-bots', auth, async (req, res) => {
    try {
        if (gameState !== "WAITING") {
            return res.json({ success: false, message: "❌ ጌሙ እየተጫወተ ነው! ቦቶችን ማስገባት የሚቻለው ሰዓት እየቆጠረ (WAITING) ላይ ሲሆን ብቻ ነው።" });
        }

        let amount = parseInt(req.body.amount);
        if (!amount || amount <= 0) return res.json({ success: false, message: "ትክክለኛ ቁጥር ያስገቡ!" });

        let bots = await BotUser.find({ isActive: true }).sort({ lastPlayed: 1 }).limit(amount);
        if (bots.length === 0) return res.json({ success: false, message: "በዳታቤዝ ውስጥ ምንም ቦት የለም!" });

        let d1 = req.body.dist1 !== undefined ? req.body.dist1 : (GLOBAL_SETTINGS.botDist1 || 5);
        let d2 = req.body.dist2 !== undefined ? req.body.dist2 : (GLOBAL_SETTINGS.botDist2 || 4);
        let d3 = req.body.dist3 !== undefined ? req.body.dist3 : (GLOBAL_SETTINGS.botDist3 || 3);
        let d4 = req.body.dist4 !== undefined ? req.body.dist4 : (GLOBAL_SETTINGS.botDist4 || 3);
        
        let totalRatio = d1 + d2 + d3 + d4;
        if(totalRatio === 0) { 
            d1 = 40; d2 = 30; d3 = 20; d4 = 10; 
            totalRatio = 100; 
        }

        let count1 = Math.round((d1 / totalRatio) * amount);
        let count2 = Math.round((d2 / totalRatio) * amount);
        let count3 = Math.round((d3 / totalRatio) * amount);
        let count4 = amount - (count1 + count2 + count3); 

        let distArray = [];
        for(let i=0; i<count1; i++) distArray.push(1);
        for(let i=0; i<count2; i++) distArraypush(2);
        for(let i=0; i<count3; i++) distArray.push(3);
        for(let i=0; i<count4; i++) distArray.push(4);
        
        distArray = distArray.sort(() => Math.random() - 0.5);

        let actualQueued = 0;
        for (let i = 0; i < bots.length; i++) {
            if (activePlayers[bots[i].phone]) continue; 
            
            let baseTix = distArray[i] || 1;
            
            let rand = Math.random();
            if (rand < 0.20 && baseTix < 4) baseTix += 1;
            else if (rand > 0.90 && baseTix > 1) baseTix -= 1;

            gameBotsQueue.push({ bot: bots[i], tixCount: baseTix });
            actualQueued++;
        }

        gameBotsQueue = gameBotsQueue.sort(() => Math.random() - 0.5);
        
        res.json({ success: true, message: `✅ ${actualQueued} ቦቶች ወረፋ ይዘዋል። ሰዓቱ እያለቀ ሲሄድ ልክ እንደ ሰው ቀስ እያሉ (Randomly) ጌሙን ይቀላቀላሉ!` });

    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE
// ==========================================
let gameState = "WAITING";
let gameClock = 40; 
let activePlayers = {}; 
let totalPrizePool = 0; 
let jackpotBoostAmount = 0; 
let totalCollectedMoney = 0; 
let totalTickets = 0;
let calledNumbers = []; 
let currentDrawSequence = []; 
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

let gameBotsQueue = [];
let botWinTargetTurn = null; 
let mixWinTargetTurn = null; 
let mixDepWinnersHistory = []; 

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

function getRiggedSequence() {
    return Array.from({length: 75}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
}

function generateFakeGrid() {
    let grid = [];
    for (let c = 0; c < 5; c++) {
        let col = [];
        while (col.length < 5) {
            let num = Math.floor(Math.random() * 15) + 1 + (c * 15);
            if (!col.includes(num)) col.push(num);
        }
        grid.push(col);
    }
    grid[2][2] = "FREE";
    return grid;
}

function getUnusedFakeTicketId() {
    let attempts = 0;
    while(attempts < 1000) {
        let fakeId = Math.floor(Math.random() * 550) + 1; 
        if(!globalTakenTickets.includes(fakeId) && !globalTakenTickets.includes(fakeId.toString())) {
            return fakeId; 
        }
        attempts++;
    }
    return Math.floor(Math.random() * 550) + 1;
}

function makeNaturalBotTicket(tix, calledNums, winNum) {
    let winCol = Math.floor((winNum - 1) / 15);
    if (winCol < 0) winCol = 0; 
    if (winCol > 4) winCol = 4;
    
    let validRows = [0, 1, 3, 4]; 
    let winRow = validRows[Math.floor(Math.random() * validRows.length)];
    
    tix.grid[winCol][winRow] = winNum;
    
    for (let c = 0; c < 5; c++) {
        if (c === winCol) continue;
        let colNumbers = calledNums.filter(n => n !== winNum && Math.floor((n - 1) / 15) === c);
        
        if (colNumbers.length > 0) {
            tix.grid[c][winRow] = colNumbers[Math.floor(Math.random() * colNumbers.length)];
        } else {
            tix.grid[c][winRow] = (c * 15) + Math.floor(Math.random() * 15) + 1;
        }
    }
}

async function declareWinners(winners) {
    gameState = "FINISHED"; 
    gameClock = GLOBAL_SETTINGS.winPopupTimer || 12; 
    
    let finalTotalPrize = totalPrizePool + jackpotBoostAmount; 
    let splitPrize = Number((finalTotalPrize / winners.length).toFixed(2));
    
    let realMoneyInThisRound = 0;
    Object.values(activePlayers).forEach(p => {
        if(!p.isBot) realMoneyInThisRound += (p.realBetAmount || 0); 
    });
    
    let adminProfit = 0; 
    
    let winnerNames = [];
    let winnerPhones = [];
    let ticketIds = [];
    let winnerDetails = []; 
    
    let realMoneyOut = 0;
    let botWinnersPrize = 0;

    for (let w of winners) {
        if (!w.player.isBot) {
            const user = await User.findOne({phone: w.player.phone});
            if(user) { 
                user.mainBalance += splitPrize; 
                user.won += splitPrize; 
                await user.save(); 
                io.emit('balance_updated', user.phone); 

                await new Transaction({
                    phone: user.phone,
                    type: 'win',
                    amount: splitPrize,
                    method: `Game #${gameId}`,
                    status: 'Approved',
                    smsText: `Bingo Win - Ticket #${w.ticket.id}`
                }).save();
            }
            realMoneyOut += splitPrize; 
        } else {
            botWinnersPrize += splitPrize;
        }
        winnerNames.push(w.player.name);
        winnerPhones.push(w.player.phone);
        ticketIds.push(w.ticket.id);

        winnerDetails.push({
            name: w.player.name,
            phone: w.player.phone,
            ticket: w.ticket.id,
            prize: splitPrize
        });
    }

    // 🔥 አዲሱ የ 3 ካዝናዎች አከፋፈል ሎጂክ
    if (realMoneyOut > 0) {
        if (botWinnersPrize === 0 && GLOBAL_SETTINGS.vaultTwoBalance >= realMoneyOut) {
            GLOBAL_SETTINGS.vaultTwoBalance -= realMoneyOut;
            await SystemSettings.updateOne({}, { $set: { vaultTwoBalance: GLOBAL_SETTINGS.vaultTwoBalance } });
        } 
        else if (winners.length === 2 && botWinnersPrize > 0 && GLOBAL_SETTINGS.vaultThreeBalance >= realMoneyOut) {
            // 1 ሰው 1 ቦት ከሆነ ከካዝና 3 ይቀነሳል
            GLOBAL_SETTINGS.vaultThreeBalance -= realMoneyOut;
            await SystemSettings.updateOne({}, { $set: { vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance } });
        } 
        else {
            GLOBAL_SETTINGS.virtualPrizePool -= realMoneyOut;
            if(GLOBAL_SETTINGS.virtualPrizePool < 0) GLOBAL_SETTINGS.virtualPrizePool = 0; 
            await SystemSettings.updateOne({}, { $set: { virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool } });
        }
    }

    let uniqueNames = [...new Set(winnerNames)];
    let displayNames = uniqueNames.join(' እና ');

    await GameHistory.create({ 
        gameId, 
        ticketId: ticketIds.join(', '), 
        winnerName: displayNames, 
        winnerPhone: winnerPhones.join(', '), 
        prize: finalTotalPrize,
        adminProfit, 
        ticketPrice: GLOBAL_SETTINGS.ticketPrice, 
        winningGrid: winners[0].ticket.grid, 
        calledNumbers: [...calledNumbers], 
        playersData: Object.values(activePlayers) 
    });

    let maskedPhones = winnerPhones.map(p => {
        if(p && p.length >= 10) return p.substring(0, 3) + '****' + p.substring(7);
        return p;
    }).join(', ');

    let safeWinnerDetails = winnerDetails.map(w => ({
        name: w.name,
        phone: w.phone && w.phone.length >= 10 ? w.phone.substring(0, 3) + '****' + w.phone.substring(7) : w.phone,
        ticket: w.ticket,
        prize: w.prize
    }));

    io.emit('game_winner', { 
        winnerName: displayNames, 
        ticketId: ticketIds.join(', '), 
        prize: splitPrize, 
        totalPrize: finalTotalPrize, 
        phone: maskedPhones, 
        ticketGrid: winners[0].ticket.grid, 
        calledNumbers: [...calledNumbers],
        isShared: winners.length > 1,
        winnerCount: winners.length,
        winnerDetails: safeWinnerDetails
    });
}

function resetToWaiting() {
    gameState = "WAITING"; gameClock = GLOBAL_SETTINGS.gameTimer; activePlayers = {}; 
    totalPrizePool = 0; totalCollectedMoney = 0; totalTickets = 0; 
    
    jackpotBoostAmount = 0; 

    calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; 
    gameBotsQueue = [];
    botWinTargetTurn = null;
    mixWinTargetTurn = null; 
    io.emit('update_taken_tickets', globalTakenTickets); 
    
    SystemSettings.findOneAndUpdate({}, { jackpotBoostAmount: 0 }).exec();
}

setInterval(() => {
    if(GLOBAL_SETTINGS.isGamePaused) { 
        io.emit('game_status', { 
            state: "MAINTENANCE", timer: 0, totalPrizePool: 0, jackpotBoost: jackpotBoostAmount,
            totalTickets: 0, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers: [], playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit 
        }); 
        return; 
    }
    
    if (gameState === "WAITING") {
        gameClock--;
        
        if (gameClock === GLOBAL_SETTINGS.gameTimer - 2 && GLOBAL_SETTINGS.isBotSystemActive && gameBotsQueue.length === 0) {
            BotUser.find({isActive: true}).sort({ lastPlayed: 1 }).then(bots => {
                let availableBots = [...bots];
                let totalBotsToInject = 0;

                let eatTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
                let currentHour = eatTime.getUTCHours();
                let activeSchedule = null;

                if (GLOBAL_SETTINGS.isBotScheduleActive) {
                    let schedules = [GLOBAL_SETTINGS.botSchedule1, GLOBAL_SETTINGS.botSchedule2, GLOBAL_SETTINGS.botSchedule3, GLOBAL_SETTINGS.botSchedule4];
                    for(let s of schedules) {
                        let sStart = s.start || 0;
                        let sEnd = s.end || 24;
                        if (sStart < sEnd) {
                            if (currentHour >= sStart && currentHour < sEnd) { activeSchedule = s; break; }
                        } else if (sStart > sEnd) {
                            if (currentHour >= sStart || currentHour < sEnd) { activeSchedule = s; break; }
                        }
                    }
                }
                
                if (activeSchedule) {
                    let mn = activeSchedule.min || 0;
                    let mx = activeSchedule.max || 0;
                    totalBotsToInject = Math.floor(Math.random() * (mx - mn + 1)) + mn;
                } else {
                    totalBotsToInject = GLOBAL_SETTINGS.botDist1 + GLOBAL_SETTINGS.botDist2 + GLOBAL_SETTINGS.botDist3 + GLOBAL_SETTINGS.botDist4;
                    if (totalBotsToInject <= 0) totalBotsToInject = 15;
                }

                let r1 = GLOBAL_SETTINGS.botDist1; 
                let r2 = GLOBAL_SETTINGS.botDist2; 
                let r3 = GLOBAL_SETTINGS.botDist3; 
                let r4 = GLOBAL_SETTINGS.botDist4;

                let totalRatio = r1 + r2 + r3 + r4;
                if(totalRatio === 0) { r1 = 40; r2 = 30; r3 = 20; r4 = 10; totalRatio = 100; }

                let c1 = Math.round((r1 / totalRatio) * totalBotsToInject);
                let c2 = Math.round((r2 / totalRatio) * totalBotsToInject);
                let c3 = Math.round((r3 / totalRatio) * totalBotsToInject);
                let c4 = totalBotsToInject - (c1 + c2 + c3);

                let distArray = [];
                for(let i=0; i<c1; i++) distArray.push(1);
                for(let i=0; i<c2; i++) distArray.push(2);
                for(let i=0; i<c3; i++) distArray.push(3);
                for(let i=0; i<c4; i++) distArray.push(4);
                
                distArray = distArray.sort(() => Math.random() - 0.5);

                for(let i=0; i<totalBotsToInject; i++) {
                    if(availableBots.length === 0) break;
                    let b = availableBots.shift();
                    let baseTix = distArray[i] || 1;
                    let rand = Math.random();
                    if (rand < 0.20 && baseTix < 4) baseTix += 1;
                    else if (rand > 0.90 && baseTix > 1) baseTix -= 1;
                    gameBotsQueue.push({ bot: b, tixCount: baseTix });
                }
                gameBotsQueue = gameBotsQueue.sort(() => Math.random() - 0.5);
            });
        }

        if (gameBotsQueue.length > 0 && gameClock > 3 && gameState === "WAITING") {
            let timeRemainingForBots = gameClock - 3; 
            let idealRate = gameBotsQueue.length / timeRemainingForBots; 

            let maxBotsThisTick = Math.ceil(idealRate * 1.8); 
            let minBotsThisTick = 0;
            if (idealRate > 3) minBotsThisTick = 1; 

            let botsToInjectNow = Math.floor(Math.random() * (maxBotsThisTick - minBotsThisTick + 1)) + minBotsThisTick;
            if (timeRemainingForBots <= 2) {
                botsToInjectNow = gameBotsQueue.length;
            }
            if (botsToInjectNow > gameBotsQueue.length) botsToInjectNow = gameBotsQueue.length;

            let didInject = false;
            for(let i=0; i<botsToInjectNow; i++) {
                if(gameBotsQueue.length === 0) break;
                let queueItem = gameBotsQueue.shift();
                let botDb = queueItem.bot;
                let buyNow = queueItem.tixCount;
                
                let cost = buyNow * GLOBAL_SETTINGS.ticketPrice;
                totalPrizePool += cost; 
                totalTickets += buyNow;

                let ticketsData = [];
                for(let t=0; t<buyNow; t++) {
                    let fakeId = getUnusedFakeTicketId();
                    globalTakenTickets.push(fakeId);
                    ticketsData.push({ id: fakeId, grid: generateFakeGrid(), paidFromPlay: GLOBAL_SETTINGS.ticketPrice, paidFromMain: 0 });
                }
                activePlayers[botDb.phone] = { name: botDb.name, phone: botDb.phone, tickets: buyNow, ticketsData: ticketsData, isBot: true, hasDeposited: false };
                
                botDb.lastPlayed = Date.now();
                botDb.save();
                didInject = true;
            }
            if(didInject) io.emit('update_taken_tickets', globalTakenTickets);
        }

        io.emit('game_status', { 
            state: gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
            totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit,
            takenTickets: globalTakenTickets
        });
        
        if (gameClock <= 0) { 
            if(Object.keys(activePlayers).length > 1) { 
                gameState = "PLAYING"; gameClock = 3; 
                currentDrawSequence = getRiggedSequence(); 
                
                botWinTargetTurn = Math.floor(Math.random() * (21 - 12 + 1)) + 12;
                mixWinTargetTurn = Math.floor(Math.random() * (24 - 15 + 1)) + 15;

                io.emit('game_status', { 
                    state: gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
                    totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
                    maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit, 
                });
            } else { 
                gameClock = GLOBAL_SETTINGS.gameTimer; 
            }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 3; 
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; } 

            let turn = calledNumbers.length + 1;
            
            let winForReal = [];  
            let winForBots = [];  

            for(let testNum of currentDrawSequence) {
                 let tempCalled = [...calledNumbers, testNum];
                 let realWins = false;
                 let botWins = false;
                 
                 for(let p of Object.values(activePlayers)) {
                     for(let t of p.ticketsData) {
                         if(serverCheckBingo(t.grid, tempCalled)) {
                             if(p.isBot) botWins = true;
                             else realWins = true;
                         }
                     }
                 }
                 
                 if(realWins) winForReal.push({num: testNum});
                 if(botWins) winForBots.push({num: testNum});
            }

            let numToCall = null;
            let forceWinner = GLOBAL_SETTINGS.botWinnerForce; 

            let realPlayers = Object.values(activePlayers).filter(p => !p.isBot);
            let botPlayers = Object.values(activePlayers).filter(p => p.isBot);
            let depositorPlayers = realPlayers.filter(p => p.hasDeposited); 

            // 🔥 አዲሱ የ 3 ካዝናዎች AI Logic 🔥
            if (forceWinner === 'ai') {
                let v1 = GLOBAL_SETTINGS.virtualPrizePool || 0;
                let v2 = GLOBAL_SETTINGS.vaultTwoBalance || 0;
                let v3 = GLOBAL_SETTINGS.vaultThreeBalance || 0;
                let prize = totalPrizePool + jackpotBoostAmount;
                let decoyChance = (GLOBAL_SETTINGS.decoyChancePercent !== undefined ? GLOBAL_SETTINGS.decoyChancePercent : 15) / 100;
                let isBonusLucky = (Math.random() * 100) < (GLOBAL_SETTINGS.bonusWinPercent || 0);

                if (Math.random() < decoyChance) {
                    forceWinner = 'bots';
                } else {
                    if (v2 >= prize) {
                        // ካዝና 2 ሙሉውን ከቻለ፣ ሰው 100% ይበላዋል
                        forceWinner = isBonusLucky ? 'real' : 'mix_dep';
                        GLOBAL_SETTINGS.mixBotCount = 0; 
                    } 
                    else if (v3 >= (prize / 2)) {
                        // ካዝና 3 ግማሹን ከቻለ፣ 1 ሰው እና 1 ቦት ይካፈላሉ
                        forceWinner = isBonusLucky ? 'mix' : 'mix_dep';
                        GLOBAL_SETTINGS.mixBotCount = 1; 
                    } 
                    else if (v1 >= prize * 1.5) {
                        // ካዝና 1 በጣም ከሞላ ለሰዎች ያከፋፍላል (አንዳንዴ ለብቻው አንዳንዴ ይከፋፈላሉ)
                        forceWinner = isBonusLucky ? 'real' : 'mix_dep';
                        GLOBAL_SETTINGS.mixBotCount = Math.floor(Math.random() * 2); // 0 or 1
                    } 
                    else if (v1 >= (prize / 3)) {
                        // ካዝና 1 በከፊል ከቻለ፣ ለ 3 (1 ሰው 2 ቦት) ወዘተ ይከፈላል
                        forceWinner = isBonusLucky ? 'mix' : 'mix_dep';
                        GLOBAL_SETTINGS.mixBotCount = 2; // 2 ቦት 1 ሰው
                    } 
                    else {
                        // የትኛውም ካዝና የማይችል ከሆነ ቦት ይበላዋል
                        forceWinner = 'bots';
                    }
                }
            }

            if (realPlayers.length === 0) forceWinner = 'bots';
            if (botPlayers.length === 0 && (forceWinner === 'mix' || forceWinner === 'mix_dep')) forceWinner = 'real';
            if (depositorPlayers.length === 0 && forceWinner === 'mix_dep') forceWinner = 'bots'; 

            if (forceWinner === 'real') {
                let safeFromBots = currentDrawSequence.filter(n => !winForBots.some(w => w.num === n));
                let realWinNum = safeFromBots.find(n => winForReal.some(w => w.num === n));

                if (realWinNum) {
                    numToCall = realWinNum; 
                } else {
                    numToCall = safeFromBots.length > 0 ? safeFromBots[0] : currentDrawSequence[0];
                }
            } 
            else if (forceWinner === 'mix') {
                let maxMixTurn = mixWinTargetTurn || 24; 
                let safeFromBots = currentDrawSequence.filter(n => !winForBots.some(w => w.num === n));
                let realWinNum = safeFromBots.find(n => winForReal.some(w => w.num === n));
                
                if (realWinNum) {
                    numToCall = realWinNum; 
                } else {
                    numToCall = safeFromBots.length > 0 ? safeFromBots[0] : currentDrawSequence[0];
                }
            }
            else if (forceWinner === 'mix_dep') {
                let maxMixTurn = mixWinTargetTurn || 24;

                let winForNonDepositor = [];
                for(let testNum of currentDrawSequence) {
                     let tempCalled = [...calledNumbers, testNum];
                     for(let p of realPlayers) {
                         if (!p.hasDeposited) {
                             for(let t of p.ticketsData) {
                                 if(serverCheckBingo(t.grid, tempCalled)) {
                                     winForNonDepositor.push(testNum);
                                     break;
                                 }
                             }
                         }
                     }
                }

                let safeFromBotsAndNonDep = currentDrawSequence.filter(n => !winForBots.some(w => w.num === n) && !winForNonDepositor.includes(n));
                
                let winForDepositor = [];
                for(let testNum of safeFromBotsAndNonDep) {
                     let tempCalled = [...calledNumbers, testNum];
                     for(let p of depositorPlayers) {
                         for(let t of p.ticketsData) {
                             if(serverCheckBingo(t.grid, tempCalled)) {
                                 winForDepositor.push(testNum);
                                 break;
                             }
                         }
                     }
                }

                let depWinNum = winForDepositor.length > 0 ? winForDepositor[0] : null;

                if (depWinNum) {
                    numToCall = depWinNum; 
                } else {
                    numToCall = safeFromBotsAndNonDep.length > 0 ? safeFromBotsAndNonDep[0] : currentDrawSequence[0];
                    if(!numToCall) numToCall = currentDrawSequence[0]; 
                }
            }
            else if (forceWinner === 'bots') {
                let safeFromReal = currentDrawSequence.filter(n => !winForReal.some(w => w.num === n));

                if (turn >= botWinTargetTurn || safeFromReal.length === 0) {
                    if (botPlayers.length > 0) {
                        let chosenBot = botPlayers[Math.floor(Math.random() * botPlayers.length)];
                        let tix = chosenBot.ticketsData[0]; 
                        
                        let safeNum = safeFromReal.length > 0 ? safeFromReal[0] : currentDrawSequence[0];
                        numToCall = safeNum;
                        
                        makeNaturalBotTicket(tix, calledNumbers, numToCall);
                    } else {
                        numToCall = safeFromReal.length > 0 ? safeFromReal[0] : currentDrawSequence[0];
                    }
                } else {
                    numToCall = safeFromReal.length > 0 ? safeFromReal[0] : currentDrawSequence[0];
                }
            }
            
            if (numToCall === null) numToCall = currentDrawSequence[0];
            
            currentDrawSequence = currentDrawSequence.filter(n => n !== numToCall);
            calledNumbers.push(numToCall);
            io.emit('new_number', numToCall);

            let winnersThisRound = [];
            for (let player of Object.values(activePlayers)) {
                for (let ticket of player.ticketsData) {
                    if (serverCheckBingo(ticket.grid, calledNumbers)) {
                        winnersThisRound.push({ player, ticket });
                    }
                }
            }

            if(winnersThisRound.length > 0) {
                if (forceWinner === 'real' || forceWinner === 'mix' || forceWinner === 'mix_dep') {
                    winnersThisRound = winnersThisRound.filter(w => !w.player.isBot);
                }

                if (winnersThisRound.length === 0) {
                    return; 
                }

                let actualReals = winnersThisRound.filter(w => !w.player.isBot);

                if (forceWinner === 'mix' && actualReals.length > 0) {
                    let mixCount = GLOBAL_SETTINGS.mixBotCount === 0 ? 0 : (GLOBAL_SETTINGS.mixBotCount || 1);
                    let availableBots = botPlayers.sort(() => Math.random() - 0.5);
                    let toAdd = Math.min(mixCount, availableBots.length);
                    for (let i = 0; i < toAdd; i++) {
                        let b = availableBots.pop();
                        let tix = b.ticketsData[0];
                        
                        makeNaturalBotTicket(tix, calledNumbers, numToCall); // 🎯
                        
                        winnersThisRound.push({ player: b, ticket: { id: tix.id, grid: tix.grid, paidFromPlay: GLOBAL_SETTINGS.ticketPrice, paidFromMain: 0 } });
                    }
                }
                
                else if (forceWinner === 'mix_dep' && actualReals.length > 0) {
                    actualReals.forEach(w => {
                        if (!mixDepWinnersHistory.includes(w.player.phone)) {
                            mixDepWinnersHistory.push(w.player.phone);
                        }
                    });

                    let mixCount = GLOBAL_SETTINGS.mixBotCount === 0 ? 0 : (GLOBAL_SETTINGS.mixBotCount || 1);
                    let availableBots = botPlayers.sort(() => Math.random() - 0.5);
                    let toAdd = Math.min(mixCount, availableBots.length);
                    for (let i = 0; i < toAdd; i++) {
                        let b = availableBots.pop();
                        let tix = b.ticketsData[0];
                        
                        makeNaturalBotTicket(tix, calledNumbers, numToCall); // 🎯
                        
                        winnersThisRound.push({ player: b, ticket: { id: tix.id, grid: tix.grid, paidFromPlay: GLOBAL_SETTINGS.ticketPrice, paidFromMain: 0 } });
                    }
                }
                
                declareWinners(winnersThisRound);
                return;
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) resetToWaiting();
    }
}, 1000);

let buyingLocks = {}; 
io.on('connection', (socket) => {
    let stateToSend = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
    socket.emit('game_status', { 
        state: stateToSend, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
        totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
        maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit 
    });
    
    socket.on('get_initial_data', (phone) => { let myData = activePlayers[phone]; socket.emit('sync_data', { gameState: stateToSend, globalTakenTickets, calledNumbers, myTickets: myData ? myData.ticketsData : [] }); });
    
    socket.on('buy_tickets', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return; 
        if (buyingLocks[data.phone]) return; 
        buyingLocks[data.phone] = true;

        try {
            let currentTickets = activePlayers[data.phone] ? activePlayers[data.phone].tickets : 0;
            if (currentTickets + data.ticketCount > GLOBAL_SETTINGS.maxTicketsPerUser) {
                socket.emit('bet_error', `❌ ይቅርታ! በአጠቃላይ ከ ${GLOBAL_SETTINGS.maxTicketsPerUser} ካርቴላ በላይ መግዛት አይቻልም!`);
                return;
            }

            const betAmount = data.ticketCount * GLOBAL_SETTINGS.ticketPrice;
            const user = await User.findOne({phone: data.phone});
            
            if(user && (user.playBalance + user.mainBalance) >= betAmount) {
                let playDeducted = 0;
                let mainDeducted = 0;
                
                if (user.mainBalance >= betAmount) { 
                    user.mainBalance -= betAmount;
                    mainDeducted = betAmount;
                } else { 
                    mainDeducted = user.mainBalance;
                    playDeducted = betAmount - user.mainBalance;
                    user.mainBalance = 0;
                    user.playBalance -= playDeducted; 
                }

                if (playDeducted > 0) {
                    if (user.unplayedRealDeposit >= playDeducted) {
                        user.unplayedRealDeposit -= playDeducted;
                    } else {
                        user.unplayedRealDeposit = 0;
                    }
                }

                // 🔥 አዲሱ ከ Main Balance የሚከፈል የካዝና ክፍፍል (ያለ Admin Profit)
                if (mainDeducted > 0) {
                    let v2Cut = mainDeducted * (GLOBAL_SETTINGS.vaultTwoPercent / 100);
                    let v3Cut = mainDeducted * (GLOBAL_SETTINGS.vaultThreePercent / 100);
                    let v1Cut = mainDeducted - v2Cut - v3Cut;

                    GLOBAL_SETTINGS.vaultTwoBalance += v2Cut;
                    GLOBAL_SETTINGS.vaultThreeBalance += v3Cut;
                    GLOBAL_SETTINGS.virtualPrizePool += v1Cut;

                    await SystemSettings.updateOne({}, {
                        $inc: {
                            vaultTwoBalance: v2Cut,
                            vaultThreeBalance: v3Cut,
                            virtualPrizePool: v1Cut
                        }
                    });
                }

                let realBetAmount = mainDeducted;
                
                user.played += 1; 
                user.totalTicketsBought = (user.totalTicketsBought || 0) + data.ticketCount; 
                await user.save();

                let playPerTicket = playDeducted / data.ticketCount;
                let mainPerTicket = mainDeducted / data.ticketCount;
                
                data.ticketsData.forEach(t => {
                    t.paidFromPlay = playPerTicket;
                    t.paidFromMain = mainPerTicket;
                });

                if (!activePlayers[data.phone]) {
                    activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData, isBot: false, hasDeposited: (user.totalDeposited > 0), realBetAmount: realBetAmount };
                } else { 
                    activePlayers[data.phone].tickets += data.ticketCount; 
                    activePlayers[data.phone].ticketsData.push(...data.ticketsData); 
                    activePlayers[data.phone].hasDeposited = (user.totalDeposited > 0);
                    activePlayers[data.phone].realBetAmount = (activePlayers[data.phone].realBetAmount || 0) + realBetAmount;
                }
                
                totalTickets += data.ticketCount; 
                totalCollectedMoney += betAmount;

                let uiAdminPercent = GLOBAL_SETTINGS.adminProfitPercent || 15;
                totalPrizePool += betAmount * ((100 - uiAdminPercent) / 100); 
                
                data.ticketIds.forEach(id => globalTakenTickets.push(id));
                io.emit('update_taken_tickets', globalTakenTickets); 
                socket.emit('balance_updated', data.phone);
            }
        } finally {
            delete buyingLocks[data.phone];
        }
    });

    socket.on('cancel_ticket', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return; 
        if (buyingLocks[data.phone]) return; 
        buyingLocks[data.phone] = true;

        try {
            const user = await User.findOne({phone: data.phone});
            if(user) {
                let p = activePlayers[data.phone];
                let canceledTicket = p ? p.ticketsData.find(t => t.id === data.ticketId) : null;
                
                if(p && canceledTicket) {
                    
                    let refundPlay = canceledTicket.paidFromPlay || 0;
                    let refundMain = canceledTicket.paidFromMain || 0;
                    
                    if (refundPlay === 0 && refundMain === 0) { refundPlay = GLOBAL_SETTINGS.ticketPrice; }

                    user.playBalance += refundPlay;
                    user.mainBalance += refundMain;
                    user.played = Math.max(0, user.played - 1);
                    user.totalTicketsBought = Math.max(0, (user.totalTicketsBought || 0) - 1); 
                    await user.save();

                    // 🔥 Cancel ሲያደርግ ከካዝናዎቹ ላይ ብሩን መልሶ መቀነስ ይኖርብናል (ካዝናው እንዳይሰፋ)
                    if (refundMain > 0) {
                        let v2Cut = refundMain * (GLOBAL_SETTINGS.vaultTwoPercent / 100);
                        let v3Cut = refundMain * (GLOBAL_SETTINGS.vaultThreePercent / 100);
                        let v1Cut = refundMain - v2Cut - v3Cut;

                        GLOBAL_SETTINGS.vaultTwoBalance -= v2Cut;
                        GLOBAL_SETTINGS.vaultThreeBalance -= v3Cut;
                        GLOBAL_SETTINGS.virtualPrizePool -= v1Cut;

                        if (GLOBAL_SETTINGS.vaultTwoBalance < 0) GLOBAL_SETTINGS.vaultTwoBalance = 0;
                        if (GLOBAL_SETTINGS.vaultThreeBalance < 0) GLOBAL_SETTINGS.vaultThreeBalance = 0;
                        if (GLOBAL_SETTINGS.virtualPrizePool < 0) GLOBAL_SETTINGS.virtualPrizePool = 0;

                        await SystemSettings.updateOne({}, {
                            $set: {
                                vaultTwoBalance: GLOBAL_SETTINGS.vaultTwoBalance,
                                vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance,
                                virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool
                            }
                        });
                    }

                    p.ticketsData = p.ticketsData.filter(t => t.id !== data.ticketId);
                    p.tickets -= 1;
                    if(p.tickets === 0) delete activePlayers[data.phone];

                    totalTickets -= 1;
                    totalCollectedMoney -= GLOBAL_SETTINGS.ticketPrice;
                    totalPrizePool -= (GLOBAL_SETTINGS.ticketPrice * ((100 - GLOBAL_SETTINGS.adminProfitPercent) / 100));
                    globalTakenTickets = globalTakenTickets.filter(id => id !== data.ticketId);

                    io.emit('update_taken_tickets', globalTakenTickets); 
                    socket.emit('balance_updated', data.phone);
                    socket.emit('ticket_cancelled_success', data.ticketId);
                }
            }
        } finally {
            delete buyingLocks[data.phone];
        }
    });

});

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
const botState = {};

const t = {
    am: {
        welcome: "🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n🎉 <b>እንኳን ወደ BINGO HABESHA በደህና መጡ!</b> 🎉\n\nየኢትዮጵያ #1 እና በጣም ታማኝ የሆነው የቢንጎ መጫወቻ ፕላትፎርም። አሁኑኑ ይጫወቱ፣ ያሸንፉ፣ እና ወዲያውኑ ወደ ሂሳብዎ ገቢ ያድርጉ!\n\n👇 <b>ከታች ካሉት አማራጮች የሚፈልጉትን ይምረጡ፡</b>",
        btn_play: "🎮 ጌም ይጫወቱ (PLAY)", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሂሳብ", btn_deposit: "📥 ገቢ (Deposit)", btn_withdraw: "📤 ወጪ (Withdraw)", btn_invite: "🔗 ጋብዝ & አግኝ", btn_promo: "🗣 ድርጅቱን አስተዋውቅ", btn_guide: "📖 መመሪያ", btn_help: "🆘 እርዳታ", btn_rules: "📜 ደንቦች", btn_lang: "🌐 ቋንቋ (Language)", btn_bonus: "🎁 ቦነስ (Claim Promo)", btn_back: "🔙 ወደ ኋላ ተመለስ", btn_promocode: "🎟️ ፕሮሞ ኮድ",
        share_contact: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", err_reg_first: "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።", err_cancel: "❌ ትዕዛዙ ተቋርጧል።",
        profile_text: (u) => `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልክ:</b> ${u.phone}\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n🟢 መጫወቻ ሂሳብ (Play): <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና ሂሳብ (Main): <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>የትኛውን የባንክ አማራጭ መጠቀም ይፈልጋሉ?</b>", wit_msg: "🏦 <b>በየትኛው ባንክ ወጪ ማድረግ ይፈልጋሉ?</b>",
        invite_msg: (l) => `🔗 <b>ጋብዝ እና አግኝ</b>\n\nይህንን የራስዎ የሆነ መጋበዣ ሊንክ ለጓደኞችዎ ይላኩ። ጓደኛዎ በእርስዎ ሊንክ ገብቶ ሲመዘገብ <b>እርስዎም ሆነ ጓደኛዎ ልዩ የመጫወቻ ቦነስ ያገኛላችሁ!</b>\n\n👇 የጋብዝ ሊንክዎ:\n${l}`,
        guide_msg: `📖 <b>የጨዋታው መመሪያ:</b>\n\n1️⃣ ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል።\n2️⃣ ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል።\n3️⃣ ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።\n\n🏆 <b>እንዴት ያሸንፋሉ?</b>\nየተጠሩት ቁጥሮች በአግድም፣ ወደ ታች፣ በማዕዘን (X ቅርፅ) ወይም 4ቱን ጥግ ከሰሩ <b>BINGO!</b> ብለው ያሸንፋሉ።`,
        rules_msg: `📜 <b>የጨዋታው ደንቦች:</b>\n\n1️⃣ <b>የሂሳብ ደንቦች:</b>\n🟢 <b>መጫወቻ ሂሳብ:</b> ካርድ ገዝቶ ለመጫወት ብቻ የሚያገለግል ሲሆን በፍፁም ወጪ (Withdraw) ማድረግ አይቻልም።\n🟡 <b>ዋና ሂሳብ:</b> ተጫውተው ሲያሸንፉ የሚገባበት ሲሆን፣ በማንኛውም ሰዓት ወጪ ማድረግ ይችላሉ።\n\n2️⃣ <b>የገቢ ደንብ:</b>\n👉 ከ ቴሌብር ወደ ቴሌብር\n👉 ከ ሲቢኢ ብር ወደ ሲቢኢ ብር ብቻ ያስገቡ።\n\n3️⃣ <b>ማረጋገጫ:</b> ገቢ ሲያደርጉ የደረሰዎትን ትክክለኛ የባንክ (SMS/TxRef) በትክክል ያስገቡ።\n4️⃣ <b>እድሜ:</b> ተጫዋቾች ከ 21 ዓመት በላይ መሆን አለባቸው።`,
        choose_lang: "እባክዎ ቋንቋ ይምረጡ:", lang_set: "✅ ቋንቋ በተሳካ ሁኔታ ተቀይሯል!",
        warn_telebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር (Telebirr to Telebirr) ብቻ ያስገቡ!\n\n", warn_cbebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBEBirr to CBEBirr) ብቻ ያስገቡ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንክ: <b>${method}</b>\n\n${warning}እባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: <b>${name}</b>\n👉 ቁጥር: <b>${num}</b>\n\nከዚያም <b>ያስገቡትን የብር መጠን</b> ብቻ እዚህ ይፃፉልኝ (ምሳሌ: 100):`,
        wit_info: (method) => `🏦 ባንክ: <b>${method}</b>\n\nገንዘቡ እንዲላክልዎ የሚፈልጉትን <b>ስልክ ቁጥር ወይም አካውንት</b> ያስገቡ፦`,
        invalid_amt: (min) => `❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ ${min} ብር):`, enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nእባክዎ ክፍያ የፈጸሙበትን የ <b>ትክክለኛውን የባንክ SMS ማረጋገጫ (Tx Ref) ፅሁፍ</b> አሁን እዚህ ይላኩ፦`,
        dep_success: "✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።",
        enter_wit_amt: (acc, min) => `✅ አካውንት: <b>${acc}</b>\n\nማውጣት የሚፈልጉትን መጠን ያስገቡ (ቢያንስ ${min} ብር):`, insufficient: "❌ በዋና ሂሳብዎ ላይ በቂ ብር የለም!", wit_success: (amt, acc) => `✅ <b>የወጪ ጥያቄዎ ተልኳል!</b>\n\nመጠን: ${amt} ETB\nወደ: ${acc}\n\nበቅርቡ ይላካል!`,
        play_msg: "በቢንጎ ሐበሻ ቤት ይጫወቱ ይዝናኑ በሺዎች ያሸንፉ\nመልካም እድል ይሁንሎት"
    },
    en: {
        welcome: "🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n🎉 <b>Welcome to BINGO HABESHA!</b> 🎉\n\nEthiopia's #1 BINGO platform.\n\n👇 <b>Choose an option:</b>",
        btn_play: "🎮 PLAY BINGO", btn_profile: "👤 Profile", btn_balance: "💰 Balance", btn_deposit: "📥 Deposit", btn_withdraw: "📤 Withdraw", btn_invite: "🔗 Invite & Earn", btn_promo: "🗣 Promote", btn_guide: "📖 Guide", btn_help: "🆘 Help", btn_rules: "📜 Rules", btn_lang: "🌐 Language", btn_bonus: "🎁 Claim Promo Bonus", btn_back: "🔙 Go Back", btn_promocode: "🎟️ Promo Code",
        share_contact: "📱 Share Contact", err_reg_first: "Register first by sending /start.", err_cancel: "❌ Action cancelled.",
        profile_text: (u) => `👤 <b>Your Profile</b>\n\n🔹 <b>Name:</b> ${u.name}\n🔹 <b>Phone:</b> ${u.phone}\n\n💰 <b>Play Balance:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Main Balance:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Wallet Balance:</b>\n\n🟢 Play Balance: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Main Balance: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Choose a bank to Deposit:</b>", wit_msg: "🏦 <b>Choose a bank to Withdraw:</b>",
        invite_msg: (l) => `🔗 <b>Invite & Earn</b>\n\nWhen a friend joins, <b>both YOU and YOUR FRIEND get special Play Bonus!</b>\n\n👇 Your Link:\n${l}`,
        guide_msg: `📖 <b>How to Play:</b>\n\n1️⃣ Get a 5x5 card.\n2️⃣ System calls a number every 3 sec.\n3️⃣ System auto-daubs.\n\n🏆 Match 5 in a row or 4 corners to win <b>BINGO!</b>`,
        rules_msg: `📜 <b>Rules:</b>\n\n👉 Telebirr to Telebirr ONLY.\n👉 CBEBirr to CBEBirr ONLY.\n👉 Paste exact SMS.\n👉 Must be 21+.`,
        choose_lang: "Please choose your language:", lang_set: "✅ Language changed successfully!",
        warn_telebirr: "⚠️ <b>WARNING:</b> Send Telebirr to Telebirr ONLY!\n\n", warn_cbebirr: "⚠️ <b>WARNING:</b> Send CBEBirr to CBEBirr ONLY!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Bank: <b>${method}</b>\n\n${warning}Send money to:\n👤 Name: <b>${name}</b>\n👉 Account: <b>${num}</b>\n\nType the <b>amount you sent</b> here (e.g., 100):`,
        wit_info: (method) => `🏦 Bank: <b>${method}</b>\n\nEnter the <b>Account or Phone number</b>:`,
        invalid_amt: (min) => `❌ Invalid Amount. Min ${min} ETB:`, enter_sms: (amt) => `✅ Amount: <b>${amt} ETB</b>\n\nPaste exact <b>Bank SMS</b>:`,
        dep_success: "✅ <b>Deposit Request Sent!</b>", enter_wit_amt: (acc, min) => `✅ Account: <b>${acc}</b>\n\nEnter withdrawal amount (Min ${min} ETB):`, insufficient: "❌ Insufficient Main Balance!", wit_success: (amt, acc) => `✅ <b>Withdrawal Request Sent!</b>\nAmount: ${amt} ETB\nTo: ${acc}`,
        play_msg: "Play and have fun at Bingo Habesha and win thousands!\nGood luck!"
    },
    or: {
        welcome: "🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n🎉 <b>Baga nagaan dhuftan!</b> 🎉", btn_play: "🎮 Tapadhu", btn_profile: "👤 Pirofaayilii", btn_balance: "💰 Herrega", btn_deposit: "📥 Galchuu", btn_withdraw: "📤 Baasuu", btn_invite: "🔗 Afeeri", btn_promo: "🗣 Promote", btn_guide: "📖 Qajeelfama", btn_help: "🆘 Gargaarsa", btn_rules: "📜 Seera", btn_lang: "🌐 Afaan", btn_bonus: "🎁 Boonasii", btn_back: "🔙 Duubatti", btn_promocode: "🎟️ Promo Code", share_contact: "📱 Lakkoofsa ergi", err_reg_first: "Dura /start tuqi.", err_cancel: "❌ Haqameera.",
        profile_text: (u) => `👤 <b>Pirofaayilii</b>\n\n🔹 <b>Maqaa:</b> ${u.name}\n🔹 <b>Lakkoofsa:</b> ${u.phone}\n\n💰 <b>Herrega Taphaa:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Muummee:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Herrega Kee:</b>\n\n🟢 Tapha: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Muummee: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Baankii filadhu:</b>", wit_msg: "🏦 <b>Baankii baasuuf filadhu:</b>", invite_msg: (l) => `🔗 <b>Afeeri</b>\n\nLachuun keessan Boonasii argattu!\n\n👇 Liinkii Kee:\n${l}`, guide_msg: `📖 <b>Akkaataa Tapha:</b> Sarara guutu BINGO!`, rules_msg: `📜 <b>Seera:</b> Telebirr gara Telebirr QOFA. CBEBirr gara CBEBirr QOFA.`, choose_lang: "Afaan filadhu:", lang_set: "✅ Jijjiirameera!", warn_telebirr: "⚠️ Telebirr gara Telebirr QOFA!\n\n", warn_cbebirr: "⚠️ CBEBirr gara CBEBirr QOFA!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Baankii: <b>${method}</b>\n\n${warning}Qarshii ergaa:\n👤 Maqaa: <b>${name}</b>\n👉 Lakkoofsa: <b>${num}</b>\n\n<b>Hamma qarshii</b> asitti barreessaa (Fkn: 100):`,
        wit_info: (method) => `🏦 Baankii: <b>${method}</b>\n\nLakkoofsa barreessaa:`, invalid_amt: (min) => `❌ Yoo xiqqaate ${min} ETB:`, enter_sms: (amt) => `✅ Hamma: <b>${amt} ETB</b>\n\nAmma <b>SMS Baankii</b> asitti ergaa:`, dep_success: "✅ <b>Ergameera!</b>", enter_wit_amt: (acc, min) => `✅ Herrega: <b>${acc}</b>\n\nHamma galchaa (Min ${min}):`, insufficient: "❌ Qarshiን ga'aan hin jiru!", wit_success: (amt, acc) => `✅ <b>Ergameera!</b>`,
        play_msg: "BINGO HABESHA irratti taphadhaa, bashannanaa, kumaatama mo'adhaa!\nCarraa Gaarii!"
    },
    ti: {
        welcome: "🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n🎉 <b>እንቋዕ ብደሓን መጻእኩም!</b> 🎉", btn_play: "🎮 ጻወት", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሕሳብ", btn_deposit: "📥 ኣእቱ", btn_withdraw: "📤 ኣውጽእ", btn_invite: "🔗 ዕደም", btn_promo: "🗣 Promote", btn_guide: "📖 መምርሒ", btn_help: "🆘 ሓገዝ", btn_rules: "📜 ሕግታት", btn_lang: "🌐 ቋንቋ", btn_bonus: "🎁 ቦነስ", btn_back: "🔙 ንድሕሪት", btn_promocode: "🎟️ Promo Code", share_contact: "📱 ቁጽሪ ኣካፍል", err_reg_first: "ቅድም /start በሉ።", err_cancel: "❌ ተቋሪጹ።",
        profile_text: (u) => `👤 <b>ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልኪ:</b> ${u.phone}\n\n💰 <b>መጻወቲ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ቀንዲ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>ናይ ሕሳብ ሓበሬታ:</b>\n\n🟢 መጻወቲ: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ቀንዲ: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>ባንኪ ምረጽ?</b>", wit_msg: "🏦 <b>ባንኪ ምረጽ?</b>", invite_msg: (l) => `🔗 <b>ዕደምን ረኸብን</b>\n\nንስኹም ሆነ ንሱ ፍሉይ ቦነስ ክትረኽቡ ኢኹም!\n\n👇 ሊንክ:\n${l}`, guide_msg: `📖 <b>መምርሒ:</b> ምሉእ መስመር እንተሰሪሖም BINGO!`, rules_msg: `📜 <b>ሕግታት:</b> ካብ ቴሌብር ናብ ቴሌብር ጥራይ። ካብ CBEBirr ናብ CBEBirr ጥራይ።`, choose_lang: "ቋንቋ ምረጹ:", lang_set: "✅ ተቐይሩ ኣሎ!", warn_telebirr: "⚠️ ካብ ቴሌብር ናብ ቴሌብር ጥራይ!\n\n", warn_cbebirr: "⚠️ ካብ CBEBirr ናብ CBEBirr ጥራይ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንኪ: <b>${method}</b>\n\n${warning}ገንዘብ ናብዚ ኣእትዉ:\n👤 ስም: <b>${name}</b>\n👉 ቁጽሪ: <b>${num}</b>\n\n<b>መጠን ገንዘብ</b> ኣብዚ ጽሓፉ (ንኣብነት: 100):`,
        wit_info: (method) => `🏦 ባንኪ: <b>${method}</b>\n\n<b>ቁጽሪ ስልኪ ወይ ኣካውንት</b> ኣእትዉ፦`, invalid_amt: (min) => `❌ እንተወሓደ ${min} ብር:`, enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nሕጂ <b>ትኽክለኛ SMS</b> ስደዱ፦`, dep_success: "✅ <b>ተላኢኹ!</b>", enter_wit_amt: (acc, min) => `✅ ኣካውንት: <b>${acc}</b>\n\nመጠን ኣእትዉ (Min ${min}):`, insufficient: "❌ እኹል ገንዘብ የለን!", wit_success: (amt, acc) => `✅ <b>ተላኢኹ!</b>`,
        play_msg: "ኣብ ቢንጎ ሓበሻ ጻወቱ፡ ተዘናግዑ፡ ብኣሽሓት ድማ ዕወቱ!\nሰናይ ዕድል!"
    }
};

function getLang(user) { return user && user.language && t[user.language] ? t[user.language] : t['am']; }
function getMainMenu(user) {
    let ln = getLang(user);
    return { reply_markup: { keyboard: [ 
        [{ text: ln.btn_play }], 
        [{ text: ln.btn_profile }, { text: ln.btn_balance }], 
        [{ text: ln.btn_deposit }, { text: ln.btn_withdraw }], 
        [{ text: ln.btn_invite }, { text: ln.btn_promo }], 
        [{ text: ln.btn_promocode }, { text: ln.btn_lang }], 
        [{ text: ln.btn_guide }, { text: ln.btn_help }, { text: ln.btn_rules }]
    ], resize_keyboard: true } };
}
const cancelKeyboard = (ln) => ({ reply_markup: { keyboard: [[{ text: ln.btn_back }]], resize_keyboard: true } });

bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id; let user = await User.findOne({ telegramId: msg.from.id.toString() }); let ln = getLang(user);
    if(user) { 
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: ln.welcome, parse_mode: "HTML", ...getMainMenu(user) }); }
        catch(e) { bot.sendMessage(chatId, ln.welcome, { parse_mode: "HTML", ...getMainMenu(user) }); }
    } else {
        botState[chatId] = { step: 'idle', refCode: match[1] };
        const cap = `🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n👋 <b>እንኳን ወደ BINGO HABESHA መጡ!</b>\n\nጌሙን ለመጀመር ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> ይጫኑ።`;
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
            let cleanRefCode = state.refCode || "";

            let isPromoLink = false;
            if (cleanRefCode.startsWith('promo_')) { 
                cleanRefCode = cleanRefCode.replace('promo_', ''); 
                isPromoLink = true;
            }

            if (cleanRefCode && cleanRefCode !== phone) { 
                let refUser = await User.findOne({ $or: [{ phone: cleanRefCode }, { refCode: cleanRefCode }] }); 
                if (refUser && refUser.phone !== phone) { 
                    actualRef = refUser.phone;
                    if (isPromoLink && refUser.isPromoter) {
                        refUser.totalInvites = (refUser.totalInvites || 0) + 1;
                        await refUser.save();
                    } else {
                        refUser.playBalance += GLOBAL_SETTINGS.inviteBonus; 
                        refUser.totalInvites = (refUser.totalInvites || 0) + 1;
                        refUser.inviteBonusEarned = (refUser.inviteBonusEarned || 0) + GLOBAL_SETTINGS.inviteBonus;
                        await refUser.save(); 
                        io.emit('balance_updated', refUser.phone);
                        isPromoLink = false; 
                    }
                } 
            }
            let myRefCode = generateRefCode();
            user = await User.create({ phone, name: msg.contact.first_name || "User", password: Math.random().toString(36).slice(-6), refCode: myRefCode, telegramId: msg.from.id.toString(), referredBy: actualRef, referredViaPromo: isPromoLink, playBalance: GLOBAL_SETTINGS.registerBonus, language: 'am' });
            
            const cap = `🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n🎉 እንኳን ደስ አሎት <b>${user.name}</b>! ምዝገባው ተጠናቋል።\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
            try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
            catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
        } else {
            user.telegramId = msg.from.id.toString(); await user.save();
            const cap = `🟢 <b>ቢንጎ</b> ⚪️ <b>ሀበሻ</b>\n\n✅ አካውንትዎ ተገናኝቷል!\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
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
        
        io.emit('new_support_message'); 

        bot.sendMessage(chatId, "✅ መልዕክትዎ ደርሶናል! አድሚን ሲያይ በዚሁ ቦት በኩል ይመልስሎታል።", { parse_mode: "HTML", ...getMainMenu(user) });
        state.step = 'idle';
        botState[chatId] = state;
        return;
    }

    if (text === t.am.btn_play || text === t.en.btn_play || text === t.or.btn_play || text === t.ti.btn_play || text.includes('PLAY') || text.includes('ጌም ይጫወቱ') || text.includes('Tapadhu') || text.includes('ጻወት') || text === '/play') {
        bot.sendMessage(chatId, ln.play_msg, { reply_markup: { inline_keyboard: [[{ text: ln.btn_play, web_app: { url: (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL } }]] } });
    }
    else if (text === t.am.btn_promocode || text === t.en.btn_promocode || text === t.or.btn_promocode || text === t.ti.btn_promocode || text.includes('ፕሮሞ ኮድ') || text.includes('Promo Code') || text === '/promocode') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, "🎟️ <b>ኩፖን (Promo Code)</b>\n\nከታች ያለውን ቁልፍ ተጭነው ኩፖንዎን ያስገቡ።", { 
            parse_mode: "HTML", 
            reply_markup: { inline_keyboard: [[{ text: "🎟️ ኩፖን አስገባ (Enter Code)", web_app: { url: `${WEB_URL}/promo_app?phone=${user.phone}&pass=${user.password}` } }]] } 
        });
    }
    else if (text === t.am.btn_profile || text === t.en.btn_profile || text === t.or.btn_profile || text === t.ti.btn_profile || text.includes('ፕሮፋይል') || text.includes('Profile') || text.includes('Pirofaayilii') || text === '/profile' || text === '/account') { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        const cap = `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
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
        
        let actualInvites = user.totalInvites || 0; 
        let displayEarned = actualInvites * GLOBAL_SETTINGS.inviteBonus;

        if (user.isPromoter) {
            let normalLink = `https://t.me/bingo_habesha_bot?start=${user.refCode}`;
            let promoLink = `https://t.me/bingo_habesha_bot?start=promo_${user.refCode}`;

            let msg = `📊 <b>የእርስዎ መረጃ (Your Stats):</b>\n👥 <b>ያመጡት ሰው (Invited):</b> ${actualInvites} ሰው\n🎁 <b>በጋባዥነት ያገኙት (Invite Bonus):</b> ${displayEarned} ETB\n💸 <b>የኮሚሽን ገቢ (Commission):</b> ${(user.promoterEarned || 0).toLocaleString()} ETB\n💰 <b>አሁን ያለው ሂሳብዎ:</b> ${user.playBalance.toFixed(2)} ETB\n\n`;
            msg += `🌟 <b>እርስዎ ልዩ አስተዋዋቂ ነዎት! ከታች 2 አይነት ሊንክ አለዎት፡</b>\n\n`;
            msg += `1️⃣ <b>የመጫወቻ ቦነስ ማግኛ ሊንክ (Normal Link):</b>\nይህንን ለሰው ሲልኩ፣ ሰውየው ሲገባ እርስዎ ወዲያውኑ የመጫወቻ ቦነስ ያገኛሉ። (ሰውየው ብር ቢያስገባ ግን ፐርሰንት የለዎትም)\n👇\n${normalLink}\n\n`;
            msg += `2️⃣ <b>የኮሚሽን ማግኛ ሊንክ (Promoter Link):</b>\nይህንን ለሰው ሲልኩ ወዲያውኑ የመጫወቻ ቦነስ አያገኙም፣ ነገር ግን ሰውየው ብር ሲያስገባ እርስዎ የገንዘብ ፐርሰንት (ኮሚሽን) ያገኛሉ።\n👇\n${promoLink}`;

            bot.sendMessage(chatId, msg, { parse_mode: "HTML", disable_web_page_preview: true, ...getMainMenu(user) });
        } else {
            let normalLink = `https://t.me/bingo_habesha_bot?start=${user.refCode}`;
            let statsText = `\n\n📊 <b>የእርስዎ መረጃ (Your Stats):</b>\n👥 <b>የጋበዙት ሰው (Invited):</b> ${actualInvites} ሰው\n💰 <b>አሁን ያለው መጫወቻ ሂሳብዎ:</b> ${user.playBalance.toFixed(2)} ETB`;
            bot.sendMessage(chatId, ln.invite_msg(normalLink) + statsText, { parse_mode: "HTML", disable_web_page_preview: true, ...getMainMenu(user) });
        }
    } 
    else if (text === t.am.btn_promo || text === t.en.btn_promo || text === t.or.btn_promo || text === t.ti.btn_promo || text.includes('ድርጅቱን አስተዋውቅ') || text.includes('አስተዋውቅ') || text.includes('Promote') || text.includes('Promoter')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        if(user.isPromoter) {
            bot.sendMessage(chatId, "📊 <b>የአስተዋዋቂ ዳሽቦርድ (Promoter Dashboard)</b>\n\nከታች ያለውን ቁልፍ ተጭነው መረጃዎን ይመልከቱ፣ እንዲሁም ያገኙትን ኮሚሽን ወጪ (Withdraw) ያድርጉ።", {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "🚀 ዳሽቦርድ ክፈት (Open Dashboard)", web_app: { url: `${WEB_URL}/promoter?phone=${user.phone}&pass=${user.password}` } }]]
                }
            });
        } else {
            bot.sendMessage(chatId, "🗣 <b>ልዩ አስተዋዋቂ (Promoter) ይሁኑ!</b>\n\nልዩ አስተዋዋቂ ለመሆን እና ኮሚሽን በየቀኑ ለመሰብሰብ እባክዎ አድሚን ያናግሩ: <b>@bingohabesha</b>", { parse_mode: "HTML", ...getMainMenu(user) });
        }
    } 
    else if (text === t.am.btn_guide || text === t.en.btn_guide || text === t.or.btn_guide || text === t.ti.btn_guide || text.includes('መመሪያ') || text.includes('Guide') || text.includes('Qajeelfama') || text.includes('መምርሒ')) { 
        if(!user) return; 
        let langParam = user.language || 'am';
        let guideTxt = langParam === 'en' ? "Open Guide" : (langParam === 'or' ? "Qajeelfama Bani" : (langParam === 'ti' ? "መምርሒ ክፈት" : "መመሪያ ክፈት"));
        bot.sendMessage(chatId, "📖 <b>እንዴት መጫወት እና ማሸነፍ ይቻላል? (How to Play)</b>\n\nከታች ያለውን ቁልፍ በመጫን በምስል የተደገፈ መመሪያ ይመልከቱ።", { 
            parse_mode: "HTML", 
            reply_markup: { inline_keyboard: [[{ text: `📖 ${guideTxt}`, web_app: { url: `${WEB_URL}/guide?lang=${langParam}` } }]] }
        }); 
    }
    else if (text === t.am.btn_help || text === t.en.btn_help || text === t.or.btn_help || text === t.ti.btn_help || text.includes('እርዳታ') || text.includes('Help') || text.includes('Gargaarsa') || text.includes('ሓገዝ') || text === '/help') { 
        if(!user) return; 
        bot.sendMessage(chatId, "💬 <b>ማንኛውም ጥያቄ ወይም አስተያየት ካለዎት አድሚኑን ቀጥታ በ @bingohabesha ያናግሩ።</b>", { parse_mode: "HTML", ...getMainMenu(user) }); 
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
    
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt(50), cancelKeyboard(ln));
        bot.sendMessage(chatId, ln.enter_sms(state.amount), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) { 
            let txRef = getTxRef(text);
            if (!txRef) { return bot.sendMessage(chatId, "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) ከፅሁፉ ውስጥ አልተገኘም። እባክዎ ትክክለኛውን የባንክ SMS ይላኩ።", { parse_mode: "HTML", ...getMainMenu(user) }); }
            let isUsed = await isSmsAlreadyUsed(text);
            if (isUsed) { 
                await SystemLog.create({ phone: user.phone, actionType: "Fake Deposit Attempt", details: `Tried to use existing TxRef: ${txRef}`, severity: "High" });
                return bot.sendMessage(chatId, "❌ ያስገቡት sms (TxRef) ቀድሞ ጥቅም ላይ ውሏል!", { parse_mode: "HTML", ...getMainMenu(user) }); 
            }

            await new Transaction({ phone: user.phone, type: 'deposit', amount: state.amount, method: state.method, smsText: text, txRef: txRef }).save(); 
            bot.sendMessage(chatId, `✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\n📌 ማረጋገጫ ኮድ: <b>${txRef}</b>\n\nአድሚን ሲያረጋግጠው (Approve ሲያደርገው) ሂሳብዎ ላይ ይገባል።`, { parse_mode: "HTML", ...getMainMenu(user) }); 
            await autoApprovePendingDeposits(); 
        }
        state.step = 'idle';
    } 
    else if (state.step === 'awaiting_wit_acc') {
        state.destinationPhone = text.trim(); 
        bot.sendMessage(chatId, ln.enter_wit_amt(state.destinationPhone, GLOBAL_SETTINGS.minWithdrawLimit), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_wit_amt';
    }
    else if (state.step === 'awaiting_wit_amt') {
        state.amount = parseFloat(text); 
        if(isNaN(state.amount) || state.amount < GLOBAL_SETTINGS.minWithdrawLimit) return bot.sendMessage(chatId, ln.invalid_amt(GLOBAL_SETTINGS.minWithdrawLimit), cancelKeyboard(ln));
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
        
        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}`, show_alert: true });

        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) return bot.answerCallbackQuery(query.id, { text: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!", show_alert: true });
        if (activeBonus.currentClaims >= activeBonus.maxUsers) return bot.answerCallbackQuery(query.id, { text: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።", show_alert: true });
        if (activeBonus.claimedBy.includes(user.phone)) return bot.answerCallbackQuery(query.id, { text: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!", show_alert: true });
        
        if (activeBonus.depositorsOnly) {
            let minDep = activeBonus.minDepositAmount || 0;
            if (activeBonus.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (activeBonus.requireDepositWithinHours * 60 * 60 * 1000));
                let recentDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep }, date: { $gte: cutoff } });
                if (!recentDep) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለማግኘት ባለፉት ${activeBonus.requireDepositWithinHours} ሰዓታት ውስጥ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት!`, show_alert: true });
            } else {
                let validDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep } });
                if (!validDep) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለማግኘት ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት!`, show_alert: true });
            }
        }

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
        bot.sendMessage(chatId, ln.enter_wit_amt(user.phone, GLOBAL_SETTINGS.minWithdrawLimit), { parse_mode: "HTML", ...cancelKeyboard(ln) }); 
    }
    botState[chatId] = state; bot.answerCallbackQuery(query.id);
});

// 🔥 SECURITY FIX: ለ Admin እና ለ Finance መግቢያ ጥብቅ ቁጥጥር
const basicAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    
    if (req.path === '/Tside0422') {
        if (login === 'admin' && password === GLOBAL_SETTINGS.adminPass) { 
            return next(); 
        }
    }
    
    if (req.path === '/papi2204') {
        if ((login === 'finance' && password === GLOBAL_SETTINGS.financePass) || 
            (login === 'admin' && password === GLOBAL_SETTINGS.adminPass)) { 
            return next(); 
        }
    }
    
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    res.status(401).send('<h1>🔒 Private Page. Access Denied.</h1><p>እባክዎ ትክክለኛውን Username እና Password ያስገቡ።</p>');
};

app.get('/guide', (req, res) => {
    let lang = req.query.lang || 'am';
    
    const guideTrans = {
        am: {
            title: "📖 የጨዋታው መመሪያ እና ደንቦች",
            rule1_title: "1️⃣ የሂሳብ ደንቦች:",
            rule1_a: "🟢 <b>መጫወቻ ሂሳብ (Play Balance):</b> ካርድ ገዝቶ ለመጫወት ብቻ የሚያገለግል ሲሆን ወጪ (Withdraw) ማድረግ አይቻልም።",
            rule1_b: "🟡 <b>ዋና ሂሳብ (Main Balance):</b> ተጫውተው ሲያሸንፉ የሚገባበት ሲሆን፣ በማንኛውም ሰዓት ወጪ ማድረግ ይችላሉ።",
            rule2_title: "2️⃣ የገቢ ደንብ:",
            rule2_a: "👉 ከ ቴሌብር ወደ ቴሌብር አካውንት ብቻ!",
            rule2_b: "👉 ከ ሲቢኢ ብር ወደ ሲቢኢ ብር አካውንት ብቻ ያስገቡ።",
            rule3_title: "3️⃣ የጨዋታው ሂደት:",
            rule3_a: "ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል። ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል። ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።",
            win_title: "🏆 ማሸነፊያ መንገዶች (Winning Patterns)",
            win_desc: "ከታች ባሉት አራት ቅርፆች መሰረት ከተጠሩት ቁጥሮች አምስቱን ካገኙ <b>BINGO</b> ብለው ያሸንፋሉ!",
            horiz: "1. በአግድም (Horizontal)",
            vert: "2. ወደ ታች (Vertical)",
            diag: "3. በማዕዘን (Diagonal / X)",
            corner: "4. አራቱ ጥግ (Four Corners)",
            hint: "💡 ሲስተሙ ራሱ አሸናፊውን ስለሚለይ ምንም መነካት አይጠበቅብዎትም!",
            back: "🔙 ወደ ኋላ ተመለስ"
        },
        en: {
            title: "📖 Game Guide & Rules",
            rule1_title: "1️⃣ Account Rules:",
            rule1_a: "🟢 <b>Play Balance:</b> Used only for buying tickets. Cannot be withdrawn.",
            rule1_b: "🟡 <b>Main Balance:</b> Your winnings go here. Can be withdrawn at any time.",
            rule2_title: "2️⃣ Deposit Rules:",
            rule2_a: "👉 TeleBirr to TeleBirr account ONLY!",
            rule2_b: "👉 CBEBirr to CBEBirr account ONLY.",
            rule3_title: "3️⃣ Gameplay:",
            rule3_a: "When you buy a ticket, you get a 5x5 grid with numbers 1-75. The system calls a number every 3 seconds and automatically marks it for you.",
            win_title: "🏆 Winning Patterns",
            win_desc: "Match 5 numbers based on the four patterns below to win <b>BINGO</b>!",
            horiz: "1. Horizontal",
            vert: "2. Vertical",
            diag: "3. Diagonal (X)",
            corner: "4. Four Corners",
            hint: "💡 The system detects winners automatically. You don't need to touch anything!",
            back: "🔙 Go Back"
        }
    };

    let tr = guideTrans[lang] || guideTrans['am'];

    let html = `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${tr.title}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: white; padding: 20px; text-align: center; margin: 0; padding-bottom: 90px !important; }
            h2 { color: #4ade80; margin-top: 10px; }
            .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; max-width: 280px; margin: 15px auto 30px auto; background: #1e293b; padding: 12px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            .cell { background: #334155; padding: 12px 0; border-radius: 6px; font-weight: bold; font-size: 15px; color: #cbd5e1; display:flex; align-items:center; justify-content:center; }
            .hl { background: #fbbf24; color: black; box-shadow: 0 0 10px rgba(251,191,36,0.6); transform: scale(1.05); }
            .title { color: #38bdf8; font-size: 18px; font-weight: bold; border-bottom: 2px dashed #334155; display: inline-block; padding-bottom: 5px; margin-bottom: 5px; }
            .free { background: #0f172a; color: white; border: 1px solid #4ade80; font-size: 12px; }
            .free.hl { background: #4ade80; color: black; border: none; }
            
            .back-btn-wrapper {
                position: fixed; bottom: 15px; left: 50%; transform: translateX(-50%);
                width: 90%; max-width: 400px; z-index: 9999;
            }
            .back-btn-wrapper button {
                width: 100%; padding: 16px; border-radius: 14px;
                background: linear-gradient(135deg, #1e293b, #0f172a);
                border: 2px solid #4ade80; color: #4ade80;
                font-size: 16px; font-weight: 900;
                box-shadow: 0 10px 25px rgba(0,0,0,0.8); cursor: pointer;
                text-transform: uppercase; letter-spacing: 1px;
                transition: 0.3s;
            }
            .back-btn-wrapper button:active { transform: scale(0.95); }
        </style>
    </head>
    <body>
        <div style="text-align: left; margin-bottom: 10px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; font-weight: 900; letter-spacing: 1px; background: rgba(0,0,0,0.3); display: inline-block; padding: 5px 10px; border-radius: 6px; float: left;">
            <span style="color: #4ade80;">ቢንጎ</span> <span style="color: #ffffff;">ሀበሻ</span>
        </div>
        <div style="clear: both;"></div>

        <h2>${tr.title}</h2>
        
        <div style="text-align: left; background: #1e293b; padding: 15px; border-radius: 10px; margin-bottom: 30px; font-size: 14px; line-height: 1.6; border: 1px solid #334155; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
            <b style="color:#fbbf24;">${tr.rule1_title}</b><br>
            ${tr.rule1_a}<br>
            ${tr.rule1_b}<br><br>
            
            <b style="color:#fbbf24;">${tr.rule2_title}</b><br>
            ${tr.rule2_a}<br>
            ${tr.rule2_b}<br><br>
            
            <b style="color:#fbbf24;">${tr.rule3_title}</b><br>
            ${tr.rule3_a}
        </div>

        <h2 style="color: #38bdf8;">${tr.win_title}</h2>
        <p style="color:#94a3b8; font-size:14px; margin-bottom: 30px;">${tr.win_desc}</p>

        <div class="title">${tr.horiz}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell hl">16</div><div class="cell hl">31</div><div class="cell hl">46</div><div class="cell hl">61</div>
            <div class="cell">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell">65</div>
        </div>

        <div class="title">${tr.vert}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell">61</div>
            <div class="cell hl">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell hl">3</div><div class="cell">18</div><div class="cell free hl">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell hl">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell hl">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell">65</div>
        </div>

        <div class="title">${tr.diag}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell">61</div>
            <div class="cell">2</div><div class="cell hl">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free hl">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell hl">49</div><div class="cell">64</div>
            <div class="cell">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell hl">65</div>
        </div>

        <div class="title">${tr.corner}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell hl">61</div>
            <div class="cell">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell hl">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell hl">65</div>
        </div>
        
        <p style="color:#4ade80; font-size:12px; margin-top:20px; border:1px dashed #4ade80; padding:10px; border-radius:8px;">${tr.hint}</p>

        <div class="back-btn-wrapper">
            <button onclick="window.location.href='/'">${tr.back}</button>
        </div>

    </body>
    </html>
    `;
    res.send(html);
});

app.get('/promoter', async (req, res) => {
    let phone = req.query.phone;
    let pass = req.query.pass;
    let user = await User.findOne({ phone, password: pass });
    if(!user || !user.isPromoter) return res.send("<h1 style='color:red; text-align:center; margin-top:50px;'>❌ Unauthorized / የተፈቀደ አስተዋዋቂ አይደሉም!</h1>");

    let referredUsers = await User.find({ referredBy: user.phone });
    let activeDepositedUsers = referredUsers.filter(u => u.totalDeposited > 0).length;

    let txHistory = await Transaction.find({ phone: user.phone, method: "Promoter Comm" }).sort({ date: -1 }).limit(15);
    
    let myCode = user.refCode ? user.refCode : user.phone;
    let link = `https://t.me/bingo_habesha_bot?start=promo_${myCode}`;

    let lang = user.language || 'am';
    
    const proTrans = {
        am: {
            dash: "📊 ዳሽቦርድ (Dashboard)",
            brought: "👥 ያመጧቸው (Total)", active: "✅ ገቢ ያደረጉ (Active)", bal: "💰 ሂሳብ (Balance)", earned: "🎁 የተሰበሰበ ኮሚሽን",
            perc: "📈 የኮሚሽን መጠንዎ", link_title: "🔗 ኮሚሽን ማግኛ ሊንክ (Promo Link):", copy_hint: "📋 ይጫኑ ኮፒ ለማድረግ", copied: "✅ ሊንክዎ ኮፒ ተደርጓል (Link Copied)!",
            wit_title: "💸 ኮሚሽን ወጪ ማድረጊያ", wit_desc: "ያገኙትን ኮሚሽን በቀጥታ ወደ አካውንትዎ ያስገቡ",
            amt_ph: "የብር መጠን (ቢያንስ 1000 ብር)", acc_ph: "የባንክ አካውንት (ወይም ስልክ)", btn_wit: "ወጪ አድርግ (Withdraw)",
            wait: "እባክዎ ይጠብቁ...", alert_fill: "እባክዎ መረጃውን በትክክል ይሙሉ!", err_conn: "ግንኙነት ተቋርጧል",
            hist_title: "📜 የወጪ ታሪክ (Withdraw History)", date: "ቀን", amt: "መጠን", status: "ሁኔታ", no_hist: "ምንም ታሪክ የለም (No History)"
        },
        en: {
            dash: "📊 Promoter Dashboard",
            brought: "👥 Total Invited", active: "✅ Active Depositors", bal: "💰 Unpaid Balance", earned: "🎁 Total Earned",
            perc: "📈 Your Commission %", link_title: "🔗 Your Share Link:", copy_hint: "📋 Click to Copy", copied: "✅ Link Copied!",
            wit_title: "💸 Withdraw Commission", wit_desc: "Withdraw your earned commissions directly",
            amt_ph: "Amount (Min 1000 ETB)", acc_ph: "Bank Account (or Phone)", btn_wit: "Withdraw Now",
            wait: "Please wait...", alert_fill: "Please fill in all details!", err_conn: "Connection Error",
            hist_title: "📜 Withdrawal History", date: "Date", amt: "Amount", status: "Status", no_hist: "No History Found"
        }
    };
    
    let pr = proTrans[lang] || proTrans['am'];

    let html = `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Promoter Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: white; margin: 0; padding: 20px; }
            .card { background: linear-gradient(145deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .title { font-size: 22px; font-weight: bold; color: #38bdf8; text-align: center; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .stat-box { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 15px; border-left: 4px solid #38bdf8; display:flex; justify-content: space-between; align-items:center;}
            .stat-box.green { border-left-color: #34d399; }
            .stat-box.orange { border-left-color: #fb923c; }
            .stat-title { font-size: 13px; color: #94a3b8; margin-bottom:5px;}
            .stat-value { font-size: 22px; font-weight: bold; color: #fff; }
            .input-group { margin-bottom: 15px; }
            input { width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; box-sizing: border-box; font-size:16px; outline:none; text-align:center;}
            input:focus { border-color: #fb923c; }
            .btn { background: #fb923c; color: #fff; border: none; padding: 16px; width: 100%; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s;}
            .btn:active { transform: scale(0.98); }
            .link-box { background: #020617; padding: 15px; border-radius: 8px; font-size: 13px; color: #34d399; word-break: break-all; text-align:center; border: 1px dashed #34d399; cursor:pointer;}
            .loader { display: none; margin-top: 10px; text-align: center; color: #fb923c; font-size:14px;}
        </style>
    </head>
    <body>
        <div style="text-align: left; margin-bottom: 15px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; font-weight: 900; letter-spacing: 1px; background: rgba(0,0,0,0.3); display: inline-block; padding: 5px 10px; border-radius: 6px;">
            <span style="color: #4ade80;">ቢንጎ</span> <span style="color: #ffffff;">ሀበሻ</span>
        </div>

        <div class="card">
            <div class="title">${pr.dash}</div>
            
            <div class="stat-box">
                <div style="flex:1;">
                    <div class="stat-title">${pr.brought}</div>
                    <div class="stat-value">${referredUsers.length}</div>
                </div>
                <div style="flex:1; border-left: 1px solid #334155; padding-left: 15px;">
                    <div class="stat-title">${pr.active}</div>
                    <div class="stat-value" style="color:#4ade80;">${activeDepositedUsers}</div>
                </div>
                <div style="font-size:30px; margin-left: 10px;">🧑‍🤝‍🧑</div>
            </div>

            <div class="stat-box orange">
                <div><div class="stat-title">${pr.bal}</div><div class="stat-value" id="unpaidBal">${(user.promoterUnpaidBalance || 0).toLocaleString()} ETB</div></div>
                <div style="font-size:30px;">💳</div>
            </div>

            <div class="stat-box green">
                <div><div class="stat-title">${pr.earned}</div><div class="stat-value">${(user.promoterEarned || 0).toLocaleString()} ETB</div></div>
                <div style="font-size:30px;">💸</div>
            </div>

            <div class="stat-box" style="border-left-color: #a855f7;">
                <div><div class="stat-title">${pr.perc}</div><div class="stat-value" style="color:#a855f7;">${user.promoterPercent}%</div></div>
                <div style="font-size:30px;">🔥</div>
            </div>

            <h3 style="font-size:14px; color:#94a3b8; margin-top:20px;">${pr.link_title}</h3>
            <div class="link-box" onclick="navigator.clipboard.writeText('${link}'); alert('${pr.copied}');">${link} <br><br><span style="color:white; font-size:11px; background:#1e293b; padding:5px 10px; border-radius:5px;">${pr.copy_hint}</span></div>
        </div>

        <div class="card" style="border-top: 4px solid #fb923c;">
            <h3 style="margin-top:0; color:#fb923c; text-align:center;">${pr.wit_title}</h3>
            <p style="color:#94a3b8; font-size:12px; text-align:center; margin-bottom:20px;">${pr.wit_desc}</p>
            <div class="input-group">
                <input type="number" id="wAmt" placeholder="${pr.amt_ph}">
            </div>
            <div class="input-group">
                <input type="text" id="wAcc" placeholder="${pr.acc_ph}">
            </div>
            <button class="btn" id="wBtn" onclick="requestWithdraw()">${pr.btn_wit}</button>
            <div class="loader" id="loader">${pr.wait}</div>
        </div>

        <div class="card" style="margin-top:20px; padding: 15px;">
            <h3 style="color:#38bdf8; text-align:center; margin-top:0;">${pr.hist_title}</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                <thead>
                    <tr style="border-bottom: 1px solid #475569; color:#94a3b8;">
                        <th style="padding: 10px 5px;">${pr.date}</th>
                        <th style="padding: 10px 5px;">${pr.amt}</th>
                        <th style="padding: 10px 5px;">${pr.status}</th>
                    </tr>
                </thead>
                <tbody>
                    ${txHistory.length > 0 ? txHistory.map(tx => `
                        <tr style="border-bottom: 1px solid #334155;">
                            <td style="padding: 10px 5px;">${new Date(tx.date).toLocaleDateString()}</td>
                            <td style="padding: 10px 5px; font-weight:bold; color:#fb923c;">${tx.amount} ETB</td>
                            <td style="padding: 10px 5px;">
                                <span style="background:${tx.status==='Approved'?'#064e3b':(tx.status==='Pending'?'#78350f':'#7f1d1d')}; color:${tx.status==='Approved'?'#34d399':(tx.status==='Pending'?'#fbbf24':'#f87171')}; padding: 3px 8px; border-radius: 4px; font-size:11px;">${tx.status}</span>
                            </td>
                        </tr>
                    `).join('') : `<tr><td colspan="3" style="text-align:center; padding: 15px; color:#94a3b8;">${pr.no_hist}</td></tr>`}
                </tbody>
            </table>
        </div>

        <script>
            async function requestWithdraw() {
                let amt = document.getElementById('wAmt').value;
                let acc = document.getElementById('wAcc').value;
                if(!amt || !acc) return alert('${pr.alert_fill}');
                
                document.getElementById('wBtn').style.display = 'none';
                document.getElementById('loader').style.display = 'block';

                try {
                    let res = await fetch('/api/promoter/withdraw', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone: '${phone}', pass: '${pass}', amount: amt, account: acc })
                    });
                    let data = await res.json();
                    alert(data.message);
                    if(data.success) { window.location.reload(); }
                } catch(e) {
                    alert('${pr.err_conn}');
                }
                
                document.getElementById('wBtn').style.display = 'block';
                document.getElementById('loader').style.display = 'none';
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/promo_app', async (req, res) => {
    let phone = req.query.phone;
    let pass = req.query.pass;
    let user = await User.findOne({ phone, password: pass });
    if(!user) return res.send("<h1 style='color:red; text-align:center; margin-top:50px;'>❌ Unauthorized</h1>");

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Promo Code - Bingo Habesha</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;900&display=swap');
            body { font-family: 'Poppins', sans-serif; background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%); color: white; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; box-sizing: border-box; overflow: hidden; position: relative;}
            
            .btn-back { position: absolute; top: 20px; left: 20px; background: rgba(0,0,0,0.5); border: 1px solid #334155; color: white; padding: 8px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; text-decoration: none; font-size: 14px; transition: 0.3s; z-index: 1000;}
            .btn-back:hover { background: rgba(74, 222, 128, 0.2); border-color: #4ade80; }

            .brand-header { background: rgba(0,0,0,0.4); border: 1px solid #334155; padding: 10px 20px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); display: inline-block;}
            .brand-header span:first-child { color: #4ade80; font-weight: 900; font-size: 24px; letter-spacing: 2px;}
            .brand-header span:last-child { color: #ffffff; font-weight: 900; font-size: 24px; letter-spacing: 2px;}

            .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(74, 222, 128, 0.2); border-radius: 20px; padding: 35px 25px; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); text-align: center;}
            
            .icon-gift { font-size: 50px; margin-bottom: 10px; filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.5)); animation: bounce 2s infinite;}
            @keyframes bounce { 0%, 100% {transform: translateY(0);} 50% {transform: translateY(-10px);} }

            h2 { color: #fbbf24; margin-top: 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px; }
            p { color: #94a3b8; font-size: 13px; margin-bottom: 25px; line-height: 1.6; }
            
            input { width: 100%; padding: 18px; border-radius: 12px; border: 2px solid #334155; background: rgba(0,0,0,0.5); color: white; box-sizing: border-box; font-size:20px; font-weight: 900; outline:none; text-align:center; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 20px; transition: 0.3s;}
            input:focus { border-color: #fbbf24; box-shadow: 0 0 15px rgba(251, 191, 36, 0.2); background: rgba(0,0,0,0.8);}
            
            .btn { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; border: none; padding: 16px; width: 100%; border-radius: 12px; font-size: 16px; font-weight: 900; cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 5px 15px rgba(245, 158, 11, 0.4); margin-bottom: 10px;}
            .btn:active { transform: scale(0.95); box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4);}
            .btn:hover { background: linear-gradient(135deg, #fcd34d, #fbbf24); }

            .loader { display: none; margin-top: 15px; color: #4ade80; font-size:14px; font-weight: bold; animation: pulse 1s infinite;}
            @keyframes pulse { 0% {opacity:0.5;} 100% {opacity:1;} }
        </style>
    </head>
    <body>
        <a href="/?phone=${phone}&pass=${pass}" class="btn-back">🔙 ተመለስ</a>

        <div class="brand-header">
            <span>ቢንጎ</span> <span>ሀበሻ</span>
        </div>

        <div class="card">
            <div class="icon-gift">🎁</div>
            <h2>ኩፖን (Promo Code)</h2>
            <p>በተለያዩ መንገዶች ያገኙትን የፕሮሞ ኮድ እዚህ በማስገባት የተዘጋጀልዎትን ቦነስ ይቀበሉ!</p>
            
            <input type="text" id="pCode" placeholder="ኮድ ያስገቡ..." autocomplete="off">
            
            <button class="btn" id="claimBtn" onclick="claimCode()">🚀 ቦነስ ተቀበል</button>
            <div class="loader" id="loader">እባክዎ ይጠብቁ...</div>
        </div>

        <script>
            async function claimCode() {
                let code = document.getElementById('pCode').value.trim();
                if(!code) return alert('እባክዎ ኮድ ያስገቡ!');
                
                document.getElementById('claimBtn').style.display = 'none';
                document.getElementById('loader').style.display = 'block';

                try {
                    let res = await fetch('/api/claim-promo-code', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone: '${phone}', pass: '${pass}', code: code })
                    });
                    let data = await res.json();
                    
                    if(data.success) {
                        alert("✅ " + data.message);
                        document.getElementById('pCode').value = '';
                    } else {
                        alert("❌ " + data.message);
                    }
                } catch(e) {
                    alert('❌ Connection Error!');
                }
                
                document.getElementById('claimBtn').style.display = 'block';
                document.getElementById('loader').style.display = 'none';
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/Tside0422', basicAuth, (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'admin.html')) ? path.join(__dirname, 'admin.html') : path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h2 style='color:red;'>❌ Error: admin.html አልተገኘም!</h2>");
});

app.get('/papi2204', basicAuth, (req, res) => {
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
        </style>

        <div id="dynamic-maintenance">
            <h1 style="color:#ea580c;font-size:50px;margin-bottom:10px;font-family:sans-serif;text-shadow: 0 4px 10px rgba(0,0,0,0.8);">⚠️ ጥገና ላይ ነን!</h1>
            <p style="font-size:24px;color:#cbd5e1;font-family:sans-serif;margin-top:0;font-weight:bold;text-shadow: 0 2px 5px rgba(0,0,0,0.8);">(MAINTENANCE)</p>
            <p style="font-size:18px;color:#f8fafc;max-width:500px;line-height:1.6;font-family:sans-serif;background:rgba(0,0,0,0.7);padding:20px;border-radius:12px;border:1px solid #ea580c;">በአሁኑ ሰዓት ሲስተሙን እያሻሻልን ስለሆነ ጌም መጫወት አይቻልም።<br><br>እባክዎ ከጥቂት ደቂቃዎች በኋላ ተመልሰው ይሞክሩ። እናመሰግናለን!</p>
        </div>
        
        <!-- 🔥 WEB PROMO POPUP 🔥 -->
        <div id="web-promo-popup" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:99999; justify-content:center; align-items:center; backdrop-filter:blur(5px);">
            <div style="background:#1e293b; padding:20px; border-radius:12px; border:2px solid #fbbf24; text-align:center; max-width:320px; width:90%; color:white; box-shadow:0 10px 30px rgba(0,0,0,0.8);">
                <div style="font-size:50px; margin-bottom:10px;">🎁</div>
                <h2 style="color:#fbbf24; margin-top:0; font-size:22px;">ልዩ የቦነስ ስጦታ!</h2>
                <p id="web-promo-msg" style="font-size:14px; margin-bottom:20px; color:#cbd5e1; line-height:1.5;"></p>
                <button onclick="claimWebPromo()" style="background:linear-gradient(135deg, #4ade80, #16a34a); color:white; font-weight:bold; padding:12px 20px; border:none; border-radius:8px; cursor:pointer; width:100%; font-size:16px; box-shadow:0 4px 15px rgba(74,222,128,0.4);">🚀 አሁኑኑ ቦነሱን ይቀበሉ</button>
                <button onclick="document.getElementById('web-promo-popup').style.display='none'" style="background:transparent; color:#94a3b8; border:none; margin-top:15px; cursor:pointer; font-size:13px; text-decoration:underline;">አይ አሁን አልፈልግም (Close)</button>
            </div>
        </div>

        <script>
            window.claimWebPromo = async function() {
                if(!window.currentUser || !window.currentUser.phone) return alert("❌ እባክዎ መጀመሪያ Login ያድርጉ!");
                
                let btn = document.querySelector('#web-promo-popup button');
                let oldText = btn.innerText;
                btn.innerText = "እየተረጋገጠ ነው...";
                
                try {
                    let res = await fetch('/api/claim-promo-web', {
                        method: 'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({phone: window.currentUser.phone})
                    });
                    let data = await res.json();
                    if(data.success) {
                        alert("🎉 እንኳን ደስ አሎት! የ " + data.amount + " ETB ቦነስ አግኝተዋል!");
                        document.getElementById('web-promo-popup').style.display = 'none';
                    } else {
                        alert(data.message || "❌ ቦነሱን መውሰድ አልተቻለም።");
                    }
                } catch(e) {
                    alert("❌ Connection error.");
                }
                btn.innerText = oldText;
            };

            document.addEventListener("DOMContentLoaded", () => {
                let depBanner = document.querySelector('.dep-banner');
                if (depBanner && !document.getElementById('dep-strict-warn')) {
                    let warnHTML = '<div id="dep-strict-warn" style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.4); border-radius: 8px; padding: 10px; margin-bottom: 15px; font-size: 11px; color: #fde047; text-align: center;">⚠️ <b>ማሳሰቢያ:</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር፣ እንዲሁም ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBE Birr) ብቻ ገቢ ያድርጉ።</div>';
                    depBanner.insertAdjacentHTML('afterend', warnHTML);
                }

                if (typeof io !== 'undefined') {
                    const blurSocket = io();
                    
                    blurSocket.on('new_promo_alert', (data) => {
                        let msgDisplay = data.msg + "<br><br><span style='color:#4ade80; font-weight:bold; font-size:18px;'>💰 " + data.amount + " ETB</span>";
                        document.getElementById('web-promo-msg').innerHTML = msgDisplay;
                        document.getElementById('web-promo-popup').style.display = 'flex';
                    });

                    blurSocket.on('game_status', (data) => {
                        if (data.state === 'MAINTENANCE') {
                            document.body.classList.add('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'flex';
                        } else {
                            document.body.classList.remove('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'none';
                        }

                        if (data.minWithdrawLimit) {
                            let witInputs = document.querySelectorAll('input[type="number"]');
                            witInputs.forEach(input => {
                                let ph = input.getAttribute('placeholder') || '';
                                if (ph.includes('ቢያንስ') || ph.includes('Min')) {
                                    if (ph.includes('ብር') || ph.includes('ETB')) {
                                        input.setAttribute('placeholder', 'የብር መጠን (ቢያንስ ' + data.minWithdrawLimit + ' ብር)');
                                    }
                                }
                            });
                        }
                        
                        let stateHeader = document.getElementById('header-state');
                        let jackpotHeader = document.getElementById('header-jackpot');
                        if(stateHeader && jackpotHeader) {
                            stateHeader.innerText = data.state;
                            stateHeader.style.color = data.state === 'PLAYING' ? '#4ade80' : 'var(--orange)';
                            jackpotHeader.innerText = Number(data.totalPrizePool || 0).toLocaleString('en-US', {minimumFractionDigits: 2}) + " ETB";
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
    try { await autoApprovePendingDeposits(); } catch (error) {}
}, 30000); 

// 🔥 አዲሱ የ Telegram Scheduled Broadcast Loop (በየ 1 ደቂቃው የሚዞር) 🔥
setInterval(async () => {
    try {
        let nowEAT = new Date(Date.now() + (3 * 60 * 60 * 1000));
        let currentStr = nowEAT.toISOString().substring(0, 16); 
        
        let pendingBroadcasts = await ScheduledBroadcast.find({ status: 'pending', scheduledTime: { $lte: currentStr } });
        
        for (let b of pendingBroadcasts) {
            b.status = 'processing';
            await b.save();

            let query = { telegramId: { $ne: "" } };
            const users = await User.find(query);
            
            for (let u of users) {
                if(b.depositorsOnly) {
                    if (b.requireDepositWithinHours > 0) {
                        let cutoff = new Date(Date.now() - (b.requireDepositWithinHours * 60 * 60 * 1000));
                        let recentDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (b.minDepositAmount || 0) }, date: { $gte: cutoff } });
                        if (!recentDep) continue;
                    } else {
                        let validDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (b.minDepositAmount || 0) } });
                        if (!validDep) continue;
                    }
                }

                try {
                    if (b.photoUrl && b.photoUrl.startsWith('data:image')) {
                        let base64Data = b.photoUrl.replace(/^data:image\/\w+;base64,/, ""); 
                        let photoBuffer = Buffer.from(base64Data, 'base64');
                        await bot.sendPhoto(u.telegramId, photoBuffer, { caption: b.message, parse_mode: "HTML" });
                    } else if (b.photoUrl && b.photoUrl.startsWith('http')) { 
                        await bot.sendPhoto(u.telegramId, b.photoUrl, { caption: b.message, parse_mode: "HTML" });
                    } else { 
                        await bot.sendMessage(u.telegramId, b.message, { parse_mode: "HTML" }); 
                    }
                } catch(e) {} 
                await new Promise(resolve => setTimeout(resolve, 50)); 
            }
            b.status = 'completed';
            await b.save();
        }
    } catch (error) {}
}, 60000); 

setInterval(async () => {
    try {
        await User.updateMany({ totalDeposited: { $gt: 0 }, diagnosticFraudReported: true }, { $set: { diagnosticFraudReported: false } });
        await User.updateMany({ mainBalance: { $gte: 0 }, playBalance: { $gte: 0 }, diagnosticNegativeReported: true }, { $set: { diagnosticNegativeReported: false } });

        let negativeUsers = await User.find({ $or: [{mainBalance: {$lt: 0}}, {playBalance: {$lt: 0}}], diagnosticNegativeReported: { $ne: true } });
        for (let u of negativeUsers) {
            await SystemLog.create({ 
                phone: u.phone, 
                actionType: "CRITICAL: Negative Balance Detected", 
                details: `System Alert: Main: ${u.mainBalance}, Play: ${u.playBalance}`, 
                severity: "High" 
            });
            u.diagnosticNegativeReported = true;
            await u.save();
        }

        let fraudUsers = await User.find({ totalDeposited: 0, played: { $gte: 5 }, diagnosticFraudReported: { $ne: true } });
        for (let u of fraudUsers) {
            await SystemLog.create({ 
                phone: u.phone, 
                actionType: "FRAUD ALERT: Bonus Exploiter", 
                details: `Played ${u.played} times without making any deposit.`, 
                severity: "High" 
            });
            u.diagnosticFraudReported = true;
            await u.save();
        }
    } catch (error) {}
}, 15 * 60 * 1000); 

process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.message && reason.message.includes('bot was blocked by the user')) {
        console.log('⚠️ ማሳሰቢያ: አንድ ተጫዋች ቦቱን ብሎክ አድርጓል።');
    } else {
        console.log("Unhandled Error Ignored:", reason.message || reason);
    }
});

process.on('uncaughtException', (err) => {
    if (err && err.message && err.message.includes('bot was blocked by the user')) {
        console.log('⚠️ ማሳሰቢያ: ተጠቃሚው ቦቱን ብሎክ አድርጓል።');
    } else {
        console.error('Uncaught Exception thrown:', err);
    }
});

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));
















