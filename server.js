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

// ⚠️ Environment Variables (እርስዎ Render ላይ የሚሞሉት)
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

// 1. ከ Database ጋር ማገናኘት
mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ዳታቤዝ ጋር በትክክል ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// 2. የ ዳታቤዝ ቅርፆች (Schemas)
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: String,
    password: { type: String, required: true },
    mainBalance: { type: Number, default: 0 },
    playBalance: { type: Number, default: 0 },
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const txSchema = new mongoose.Schema({
    phone: String,
    type: String, // 'deposit' or 'withdraw'
    amount: Number,
    method: String,
    status: { type: String, default: 'Pending' }, 
    date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', txSchema);

// ==========================================
// 🔵 የተጠቃሚ APIs (User Endpoints)
// ==========================================
app.post('/api/syncUser', async (req, res) => {
    try {
        const { phone, name, password, mainBalance, playBalance, played, won } = req.body;
        await User.findOneAndUpdate({ phone }, { name, password, mainBalance, playBalance, played, won }, { new: true, upsert: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/getUser/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (user) res.json({ success: true, user });
        else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/request-tx', async (req, res) => {
    try {
        const { phone, type, amount, method } = req.body;
        if(type === 'withdraw') {
            let user = await User.findOne({phone});
            if(!user || user.mainBalance < amount) return res.json({success: false, message: "በቂ ሂሳብ የሎትም!"});
            user.mainBalance -= amount; // Pending ስለሆነ ብሩን እናግደዋለን
            await user.save();
        }
        const newTx = new Transaction({ phone, type, amount, method });
        await newTx.save();
        res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል! በአድሚን ሲረጋገጥ ሂሳብዎ ላይ ይገባል።" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { phone, name, newPassword } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ሲስተሙ ላይ አልተገኘም!" });
        if (user.name.toLowerCase().trim() !== name.toLowerCase().trim()) return res.json({ success: false, message: "ያስገቡት ስም ከስልክ ቁጥሩ ጋር አይመሳሰልም!" });
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል! አሁን በአዲሱ የይለፍ ቃል መግባት ይችላሉ።" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🔴 የአድሚን APIs (Admin Endpoints)
// ==========================================
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.post('/api/admin/users', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const users = await User.find().sort({ won: -1 });
    res.json(users);
});

app.post('/api/admin/transactions', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const txs = await Transaction.find().sort({ date: -1 });
    res.json(txs);
});

app.post('/api/admin/action-tx', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const { txId, action } = req.body;
    try {
        const tx = await Transaction.findById(txId);
        if(!tx || tx.status !== 'Pending') return res.json({success: false});
        const user = await User.findOne({phone: tx.phone});
        if(!user) return res.json({success: false});

        if (action === 'Approve') {
            tx.status = 'Approved';
            if(tx.type === 'deposit') { user.mainBalance += tx.amount; user.playBalance += tx.amount; }
        } else if (action === 'Reject') {
            tx.status = 'Rejected';
            if(tx.type === 'withdraw') { user.mainBalance += tx.amount; } // ብሩን እንመልስለታለን
        }
        await tx.save(); await user.save();
        io.emit('balance_updated', tx.phone); // ለዩዘሩ ኖቲፊኬሽን
        res.json({success: true});
    } catch (e) { res.status(500).json({success: false}); }
});

app.post('/api/admin/send-bonus', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const { phone, amount } = req.body;
    try {
        await User.findOneAndUpdate({phone}, { $inc: { mainBalance: amount, playBalance: amount } });
        io.emit('balance_updated', phone);
        res.json({success: true});
    } catch(e) { res.json({success: false}); }
});

app.post('/api/admin/change-password', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const { phone, newPassword } = req.body;
    try {
        const user = await User.findOne({ phone });
        if(!user) return res.json({ success: false, message: "User not found!" });
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: `Password for ${phone} updated successfully!` });
    } catch(e) { res.json({ success: false }); }
});

// ==========================================
// 🟢 የ LIVE BINGO ጌም ማሽን (SOCKET.IO)
// ==========================================
let gameState = "WAITING";
let timer = 30;
let activePlayers = {};
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let pool = [];
let gameInterval;

function startCountdown() {
    gameState = "WAITING"; timer = 30; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = [];
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets });
        if (timer <= 0) {
            clearInterval(waitInterval);
            if (totalTickets > 0) startGame();
            else startCountdown(); // ሰው ከሌለ እንደገና ይቆጥራል
        }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING";
    pool = Array.from({length: 75}, (_, i) => i + 1);
    io.emit('game_status', { state: gameState, timer: 0, totalPrizePool, totalTickets });

    gameInterval = setInterval(() => {
        if (calledNumbers.length >= 75 || gameState !== "PLAYING") { clearInterval(gameInterval); return; }
        let num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        calledNumbers.push(num);
        io.emit('new_number', num);
    }, 3000);
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
    
    socket.on('buy_tickets', (data) => {
        if (gameState === "WAITING") {
            activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount };
            totalTickets += data.ticketCount;
            totalPrizePool = (totalTickets * 10) * 0.9; // 10% ለአድሚን ይቆረጣል
            io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets });
        }
    });

    socket.on('claim_bingo', (data) => {
        if (gameState === "PLAYING") {
            gameState = "FINISHED";
            clearInterval(gameInterval);
            io.emit('game_winner', { winnerName: data.name, ticketId: data.ticketId, prize: totalPrizePool });
            setTimeout(() => { startCountdown(); }, 10000); // አዲስ ዙር በ10 ሰከንድ ይጀምራል
        }
    });
});

startCountdown();

// ዌብሳይቱ ሲከፈት
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Bingo Server running on port ${PORT}`));

