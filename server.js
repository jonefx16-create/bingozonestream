const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI).then(() => console.log("✅ ከ MongoDB ጋር ተገናኝቷል!")).catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// --- Mongoose Models ---
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    referredBy: { type: String, default: "" }, 
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 }
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String,
    status: { type: String, default: 'Pending' }, 
    date: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: Number, winnerName: String, winnerPhone: String, prize: Number,
    winningGrid: Array, calledNumbers: Array, date: { type: Date, default: Date.now }
}));

const PromoCode = mongoose.model('PromoCode', new mongoose.Schema({
    code: { type: String, unique: true }, amount: Number, maxUsers: Number,
    currentClaims: { type: Number, default: 0 }, claimedBy: [String], expiresAt: Date
}));

// ==========================================
// 🔵 USER APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ስልክ ቁጥሩ ተመዝግቧል!" });
        let actualReferrer = "";
        if (refCode) {
            let referrer = await User.findOne({ phone: refCode.trim() });
            if (referrer) { referrer.playBalance += 10; await referrer.save(); io.emit('balance_updated', referrer.phone); actualReferrer = referrer.phone; }
        }
        let user = new User({ phone, name, password, referredBy: actualReferrer, mainBalance: 0, playBalance: 100 });
        await user.save(); res.json({ success: true, user });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.password });
    res.json(user ? { success: true, user } : { success: false, message: "ተሳስቷል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone });
    res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    try {
        const { phone, type, amount, method } = req.body;
        let user = await User.findOne({phone});
        if(!user) return res.json({success: false});
        if(type === 'withdraw') {
            if(user.mainBalance < amount) return res.json({success: false, message: "በቂ ብር የለም!"});
            user.mainBalance -= amount; await user.save();
        }
        await new Transaction({ phone, type, amount, method }).save();
        res.json({ success: true, message: "✅ ጥያቄዎ ተልኳል!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/user/claim-promo', async (req, res) => {
    try {
        const { phone, code } = req.body;
        let user = await User.findOne({ phone });
        if(!user) return res.json({ success: false, message: "ተጠቃሚው አልተገኘም!" });
        let promo = await PromoCode.findOne({ code: code.toUpperCase() });
        if(!promo) return res.json({ success: false, message: "ትክክለኛ ያልሆነ ኮድ!" });
        if(new Date() > promo.expiresAt) return res.json({ success: false, message: "የኮዱ ጊዜ አልፏል!" });
        if(promo.currentClaims >= promo.maxUsers) return res.json({ success: false, message: "ይህ ኮድ በሌሎች ሰዎች ተወስዶ አልቋል!" });
        if(promo.claimedBy.includes(phone)) return res.json({ success: false, message: "ይህን ኮድ ከዚህ በፊት ወስደዋል!" });

        user.playBalance += promo.amount; await user.save();
        promo.claimedBy.push(phone); promo.currentClaims += 1; await promo.save();
        io.emit('balance_updated', phone);
        res.json({ success: true, message: `✅ እንኳን ደስ አሎት! ${promo.amount} ETB ቦነስ አግኝተዋል።` });
    } catch (e) { res.status(500).json({ success: false, message: "የሰርቨር ስህተት!" }); }
});

// ==========================================
// 🔴 ADMIN APIs
// ==========================================
const auth = (req, res, next) => { 
    if(req.body.password !== ADMIN_PASS && req.body.adminPass !== ADMIN_PASS) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

app.post('/api/admin/users', auth, async (req, res) => { res.json(await User.find().sort({ _id: -1 })); });
app.post('/api/admin/transactions', auth, async (req, res) => { res.json(await Transaction.find().sort({ date: -1 })); });
app.post('/api/admin/history', auth, async (req, res) => { res.json(await GameHistory.find().sort({ date: -1 }).limit(50)); });
app.post('/api/admin/promos', auth, async (req, res) => { res.json(await PromoCode.find().sort({ expiresAt: -1 })); });

// NEW: FULL EDIT USER API (Includes migrating phone history)
app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const { oldPhone, newPhone, password, mainBalance, playBalance } = req.body;
        let user = await User.findOne({ phone: oldPhone });
        if (!user) return res.json({ success: false, message: "User not found!" });

        // If admin changed the phone number
        if (oldPhone !== newPhone) {
            let existing = await User.findOne({ phone: newPhone });
            if (existing) return res.json({ success: false, message: "New phone number is already registered to someone else!" });
            
            user.phone = newPhone;
            // Migrate History
            await Transaction.updateMany({ phone: oldPhone }, { $set: { phone: newPhone } });
            await GameHistory.updateMany({ winnerPhone: oldPhone }, { $set: { winnerPhone: newPhone } });
            // Update claims in promo codes
            await PromoCode.updateMany({ claimedBy: oldPhone }, { $set: { "claimedBy.$": newPhone } });
        }

        user.password = password;
        user.mainBalance = Number(mainBalance);
        user.playBalance = Number(playBalance);
        await user.save();

        io.emit('balance_updated', user.phone);
        res.json({ success: true, message: "✅ User updated successfully!" });
    } catch (e) { console.error(e); res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    try {
        const { txId, action } = req.body;
        const tx = await Transaction.findById(txId);
        const user = await User.findOne({phone: tx.phone});
        if (action === 'Approve') { tx.status = 'Approved'; if(tx.type === 'deposit') user.playBalance += tx.amount; } 
        else if (action === 'Reject') { tx.status = 'Rejected'; if(tx.type === 'withdraw') user.mainBalance += tx.amount; }
        await tx.save(); await user.save(); io.emit('balance_updated', tx.phone); res.json({success: true});
    } catch(e){ res.json({success:false}); }
});

app.post('/api/admin/send-bonus', auth, async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.body.phone });
        if(user) { user.playBalance += req.body.amount; await user.save(); io.emit('balance_updated', user.phone); res.json({ success: true }); }
        else res.json({ success: false });
    } catch(e) { res.json({success:false}); }
});

app.post('/api/admin/create-promo', auth, async (req, res) => {
    try {
        const { code, maxUsers, amount, timeMin } = req.body;
        let expires = new Date(); expires.setMinutes(expires.getMinutes() + parseInt(timeMin));
        await new PromoCode({ code, maxUsers, amount, expiresAt: expires }).save();
        res.json({ success: true });
    } catch(e) { res.json({ success: false, message: "Code might already exist." }); }
});

app.post('/api/admin/ban-user', auth, async (req, res) => {
    try {
        await User.deleteOne({ phone: req.body.phone });
        res.json({ success: true });
    } catch(e) { res.json({success:false}); }
});


// ==========================================
// 🟢 LIVE BINGO GAME ENGINE
// ==========================================
let gameState = "WAITING";
let timer = 40; let activePlayers = {}; let totalPrizePool = 0; let totalTickets = 0;
let calledNumbers = []; let currentDrawSequence = []; 
let gameInterval; let gameId = Math.floor(Math.random() * 9000) + 1000;
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
    for (let s in activePlayers) activePlayers[s].ticketsData.forEach(t => allTickets.push({ phone: activePlayers[s].phone, ticket: t }));
    if (allTickets.length === 0) return pool.sort(() => Math.random() - 0.5).slice(0, 20);
    
    let target = allTickets[Math.floor(Math.random() * allTickets.length)];
    let req = [target.ticket.grid[0][2], target.ticket.grid[1][2], target.ticket.grid[3][2], target.ticket.grid[4][2]];
    req.forEach(n => { let i = pool.indexOf(n); if(i > -1) pool.splice(i, 1); });
    
    let fillers = []; for(let i=0; i<16; i++) fillers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    let winBall = req.pop(); let mixed = [...req, ...fillers].sort(() => Math.random() - 0.5); 
    mixed.splice(Math.floor(Math.random() * 5) + 15, 0, winBall);
    return mixed;
}

async function declareWinner(player, ticket) {
    gameState = "FINISHED"; clearInterval(gameInterval);
    const user = await User.findOne({phone: player.phone});
    if(user) { user.mainBalance += totalPrizePool; user.won += totalPrizePool; await user.save(); io.emit('balance_updated', player.phone); }
    
    await GameHistory.create({ gameId, winnerName: player.name, winnerPhone: player.phone, prize: totalPrizePool, winningGrid: ticket.grid, calledNumbers: [...calledNumbers] });
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers });
    setTimeout(startCountdown, 12000); 
}

function startCountdown() {
    gameState = "WAITING"; timer = 40; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000; globalTakenTickets = []; io.emit('update_taken_tickets', globalTakenTickets); 
    clearInterval(gameInterval);
    
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        if (timer <= 0) { clearInterval(waitInterval); totalTickets > 0 ? startGame() : startCountdown(); }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING"; currentDrawSequence = generateRiggedDrawSequence(); 
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });

    gameInterval = setInterval(() => {
        if (gameState !== "PLAYING" || currentDrawSequence.length === 0) { clearInterval(gameInterval); if(gameState === "PLAYING") setTimeout(startCountdown, 5000); return; }
        
        let num = currentDrawSequence.shift(); calledNumbers.push(num); io.emit('new_number', num);

        for (let s in activePlayers) {
            let p = activePlayers[s];
            for (let i = 0; i < p.ticketsData.length; i++) {
                if (serverCheckBingo(p.ticketsData[i].grid, calledNumbers)) { declareWinner(p, p.ticketsData[i]); return; }
            }
        }
    }, 3000);
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
    socket.on('buy_tickets', async (data) => {
        if (gameState === "WAITING") {
            const bet = data.ticketCount * 10;
            const user = await User.findOne({phone: data.phone});
            if(user && (user.playBalance + user.mainBalance) >= bet) {
                if (user.playBalance >= bet) user.playBalance -= bet; else { user.mainBalance -= (bet - user.playBalance); user.playBalance = 0; }
                user.played += 1; await user.save();
                activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
                totalTickets += data.ticketCount; totalPrizePool = (totalTickets * 10) * 0.85; 
                if(data.ticketIds) data.ticketIds.forEach(id => { if(!globalTakenTickets.includes(id)) globalTakenTickets.push(id); });
                socket.emit('balance_updated', data.phone); 
            }
        }
    });
});

startCountdown();
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running!`));

