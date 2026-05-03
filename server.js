const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI).then(() => console.log("✅ Database Connected")).catch(err => console.log(err));

// MODELS
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true }, 
    name: String, 
    password: { type: String, required: true },
    referredBy: { type: String, default: "" }, 
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 100 }, 
    played: { type: Number, default: 0 }, 
    won: { type: Number, default: 0 },
    status: { type: String, default: 'active' }
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
}));

// GAME VARIABLES
let gameState = "WAITING";
let timer = 40;
let activePlayers = {}; 
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = [];
let gameInterval = null;

// GAME FUNCTIONS
function startCountdown() {
    gameState = "WAITING";
    timer = 40;
    calledNumbers = [];
    globalTakenTickets = [];
    
    if (gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, gameId });
        
        if (timer <= 0) {
            clearInterval(gameInterval);
            if (totalTickets > 0) startGame();
            else startCountdown();
        }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING";
    let pool = Array.from({length: 75}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, gameId });

    gameInterval = setInterval(() => {
        if (pool.length === 0 || gameState !== "PLAYING") {
            clearInterval(gameInterval);
            setTimeout(startCountdown, 10000);
            return;
        }
        let num = pool.shift();
        calledNumbers.push(num);
        io.emit('new_number', num);
    }, 3000);
}

// SOCKETS
io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer: gameState === "PLAYING" ? "LIVE" : timer, totalPrizePool, totalTickets, calledNumbers, gameId });
    socket.emit('update_taken_tickets', globalTakenTickets);

    socket.on('buy_tickets', async (data) => {
        const user = await User.findOne({ phone: data.phone });
        if (!user) return;
        
        let cost = data.ticketCount * 10;
        if ((user.playBalance + user.mainBalance) >= cost) {
            if (user.playBalance >= cost) user.playBalance -= cost;
            else { user.mainBalance -= (cost - user.playBalance); user.playBalance = 0; }
            user.played += 1;
            await user.save();
            
            activePlayers[data.phone] = { 
                name: data.name, 
                phone: data.phone, 
                tickets: (activePlayers[data.phone]?.tickets || 0) + data.ticketCount, 
                ticketsData: [...(activePlayers[data.phone]?.ticketsData || []), ...data.ticketsData] 
            };
            
            totalTickets += data.ticketCount;
            totalPrizePool = (totalTickets * 10) * 0.85;
            data.ticketIds.forEach(id => globalTakenTickets.push(id));
            
            io.emit('update_taken_tickets', globalTakenTickets);
            io.emit('game_status', { state: gameState, timer: gameState === "PLAYING" ? "LIVE" : timer, totalPrizePool, totalTickets, calledNumbers, gameId });
            socket.emit('balance_updated', data.phone);
        }
    });
});

// APIs
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password } = req.body;
        if (await User.findOne({ phone })) return res.json({ success: false, message: "ተመዝግቧል" });
        await new User({ phone, name, password }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.password });
    res.json(user ? { success: true, user } : { success: false });
});

app.get('/api/getUser/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone });
    res.json(user ? { success: true, user } : { success: false });
});

app.post('/api/request-tx', async (req, res) => {
    await new Transaction({ phone: req.body.phone, type: req.body.type, amount: req.body.amount, method: req.body.method }).save();
    res.json({ success: true });
});

app.get('/api/user/transactions/:phone', async (req, res) => {
    const txs = await Transaction.find({ phone: req.params.phone, status: 'Approved' });
    res.json({ success: true, txs });
});

app.post('/api/admin/action-tx', async (req, res) => {
    const { txId, action } = req.body;
    const tx = await Transaction.findById(txId);
    if (action === 'Approve') {
        const user = await User.findOne({ phone: tx.phone });
        user.playBalance += tx.amount;
        await user.save();
        tx.status = 'Approved';
    } else { tx.status = 'Rejected'; }
    await tx.save();
    io.emit('balance_updated', tx.phone);
    res.json({ success: true });
});

app.post('/api/user/change-password', async (req, res) => {
    let user = await User.findOne({ phone: req.body.phone, password: req.body.oldPass });
    if(!user) return res.json({success: false});
    user.password = req.body.newPass;
    await user.save();
    res.json({success: true});
});

app.get('/api/leaderboard', async (req, res) => {
    const top = await User.find({ won: { $gt: 0 } }).sort({ won: -1 }).limit(10);
    res.json({ success: true, leaderboard: top });
});

// START
startCountdown();
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));

