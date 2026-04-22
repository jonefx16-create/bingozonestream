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

// Environment Variables
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ዳታቤዝ ጋር በትክክል ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

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
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', txSchema);

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
        if (user) res.json({ success: true, user }); else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/request-tx', async (req, res) => {
    try {
        const { phone, type, amount, method } = req.body;
        if(type === 'withdraw') {
            let user = await User.findOne({phone});
            if(!user || user.mainBalance < amount) return res.json({success: false, message: "በቂ ሂሳብ የሎትም!"});
            user.mainBalance -= amount; await user.save();
        }
        const newTx = new Transaction({ phone, type, amount, method }); await newTx.save();
        res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// ==========================================
// 🟢 የ LIVE BINGO ማሽን (SERVER MASTER CLOCK)
// ==========================================
let gameState = "WAITING";
let timer = 25; 
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let pool = [];
let gameInterval;

function startCountdown() {
    gameState = "WAITING"; 
    timer = 25; 
    totalPrizePool = 0; 
    totalTickets = 0; 
    calledNumbers = [];
    
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer: timer, totalPrizePool, totalTickets, calledNumbers });
        
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
        if (calledNumbers.length >= 20 || gameState !== "PLAYING") { 
            clearInterval(gameInterval);
            if (gameState === "PLAYING") {
                gameState = "FINISHED";
                io.emit('game_over_no_winner'); 
                setTimeout(() => { startCountdown(); }, 5000); 
            }
            return; 
        }
        let num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        calledNumbers.push(num);
        io.emit('new_number', num); 
    }, 3000); 
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
    
    socket.on('buy_tickets', (data) => {
        if (gameState === "WAITING") {
            totalTickets += data.ticketCount;
            totalPrizePool = (totalTickets * 10) * 0.9; 
            io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers });
        }
    });

    socket.on('claim_bingo', (data) => {
        if (gameState === "PLAYING") {
            gameState = "FINISHED";
            clearInterval(gameInterval);
            io.emit('game_winner', { winnerName: data.name, ticketId: data.ticketId, prize: totalPrizePool });
            setTimeout(() => { startCountdown(); }, 5000); 
        }
    });
});

startCountdown();

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Bingo Server running on port ${PORT}`));
