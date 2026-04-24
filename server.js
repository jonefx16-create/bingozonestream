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

// የ Database ኮኔክሽን
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ጋር ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// Schemas
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
    type: String, 
    amount: Number,
    method: String,
    status: { type: String, default: 'Pending' }, 
    date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', txSchema);

// ==========================================
// 🔵 USER APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password } = req.body;
        let user = await User.findOne({ phone });
        if (user) return res.json({ success: false, message: "ይህ ስልክ ቁጥር አስቀድሞ ተመዝግቧል!" });
        
        user = new User({ phone, name, password, mainBalance: 100, playBalance: 100 });
        await user.save();
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        let user = await User.findOne({ phone, password });
        if (user) res.json({ success: true, user });
        else res.json({ success: false, message: "ስልክ ቁጥር ወይም የይለፍ ቃል ተሳስቷል!" });
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
        let user = await User.findOne({phone});
        if(!user) return res.json({success: false, message: "ተጠቃሚው አልተገኘም!"});

        if(type === 'withdraw') {
            if(user.mainBalance < amount) return res.json({success: false, message: "በቂ ሂሳብ የሎትም!"});
            user.mainBalance -= amount; 
            await user.save();
        }
        const newTx = new Transaction({ phone, type, amount, method });
        await newTx.save();
        res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል! በአድሚን ሲረጋገጥ ይስተካከላል።" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// አዲስ፡ User Change Password API
app.post('/api/user/change-password', async (req, res) => {
    try {
        const { phone, oldPass, newPass } = req.body;
        let user = await User.findOne({ phone, password: oldPass });
        if(!user) return res.json({ success: false, message: "የድሮው የይለፍ ቃል ተሳስቷል!" });
        
        user.password = newPass;
        await user.save();
        res.json({ success: true, message: "የይለፍ ቃል በተሳካ ሁኔታ ተቀይሯል!" });
    } catch (e) { res.status(500).json({ success: false, message: "የሰርቨር ስህተት አጋጥሟል" }); }
});

// አዲስ፡ Leaderboard (Rank) API
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10).select('name won');
        res.json({ success: true, leaderboard: topUsers });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🔴 ADMIN APIs
// ==========================================
app.post('/api/admin/users', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    const users = await User.find().sort({ _id: -1 });
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
            if(tx.type === 'deposit') { 
                user.mainBalance += tx.amount; 
                user.playBalance += tx.amount; 
            }
        } else if (action === 'Reject') {
            tx.status = 'Rejected';
            if(tx.type === 'withdraw') { 
                user.mainBalance += tx.amount; 
            } 
        }
        await tx.save(); await user.save();
        io.emit('balance_updated', tx.phone); 
        res.json({success: true});
    } catch (e) { res.status(500).json({success: false}); }
});

app.post('/api/admin/send-bonus', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    try {
        const user = await User.findOne({ phone: req.body.phone });
        if(!user) return res.json({ success: false });
        
        user.mainBalance += req.body.amount;
        await user.save();
        
        io.emit('balance_updated', user.phone);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/change-password', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    try {
        const user = await User.findOne({ phone: req.body.phone });
        if(!user) return res.json({ success: false, message: "User not found!" });
        
        user.password = req.body.newPassword;
        await user.save();
        
        res.json({ success: true, message: "Password updated successfully!" });
    } catch (e) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/admin/ban-user', async (req, res) => {
    if(req.body.password !== ADMIN_PASS) return res.status(401).json({error: "Unauthorized"});
    try {
        await User.findOneAndDelete({ phone: req.body.phone });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE (SOCKET.IO)
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
    clearInterval(gameInterval);
    
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
        if (timer <= 0) {
            clearInterval(waitInterval);
            if (totalTickets > 0) startGame();
            else startCountdown();
        }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING";
    pool = Array.from({length: 75}, (_, i) => i + 1);
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers });

    gameInterval = setInterval(() => {
        // 20 Ball Limit
        if (calledNumbers.length >= 20 || gameState !== "PLAYING") { 
            clearInterval(gameInterval); 
            if(gameState === "PLAYING") setTimeout(startCountdown, 5000); 
            return; 
        }
        let num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        calledNumbers.push(num);
        io.emit('new_number', num);
    }, 3000);
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
    
    socket.on('buy_tickets', async (data) => {
        if (gameState === "WAITING") {
            const betAmount = data.ticketCount * 10;
            const user = await User.findOne({phone: data.phone});
            
            if(user && user.mainBalance >= betAmount) {
                user.mainBalance -= betAmount;
                user.played += 1;
                await user.save();
                
                activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount };
                totalTickets += data.ticketCount;
                totalPrizePool = (totalTickets * 10) * 0.9; 
                
                io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
                socket.emit('balance_updated', data.phone); 
            }
        }
    });

    socket.on('claim_bingo', async (data) => {
        if (gameState === "PLAYING") {
            gameState = "FINISHED";
            clearInterval(gameInterval);
            
            const user = await User.findOne({phone: data.phone});
            if(user) {
                user.mainBalance += totalPrizePool;
                user.won += totalPrizePool;
                await user.save();
                io.emit('balance_updated', data.phone);
            }
            
            io.emit('game_winner', { winnerName: data.name, ticketId: data.ticketId, prize: totalPrizePool, phone: data.phone });
            setTimeout(() => { startCountdown(); }, 12000); 
        }
    });
});

startCountdown();

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
