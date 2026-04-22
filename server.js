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

// Admin APIs
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// ==========================================
// 🟢 የ LIVE BINGO ማሽን (SERVER MASTER CLOCK)
// ==========================================
let gameState = "WAITING";
let timer = 25; // 25 ሰከንድ
let activePlayers = {};
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let pool = [];
let gameInterval;

function startCountdown() {
    gameState = "WAITING"; 
    timer = 25; 
    activePlayers = {}; 
    totalPrizePool = 0; 
    totalTickets = 0; 
    calledNumbers = [];
    
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer: timer, totalPrizePool, totalTickets, calledNumbers });
        
        if (timer <= 0) {
            clearInterval(waitInterval);
            if (totalTickets > 0) {
                startGame(); 
            } else {
                startCountdown(); 
            }
        }
    }, 1000); 
}

function startGame() {
    gameState = "PLAYING";
    pool = Array.from({length: 75}, (_, i) => i + 1);
    
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers });

    gameInterval = setInterval(() => {
        if (calledNumbers.length >= 75 || gameState !== "PLAYING") { 
            clearInterval(gameInterval); 
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
            activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount };
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
            setTimeout(() => { startCountdown(); }, 10000); 
        }
    });
});

startCountdown();

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Bingo Server running on port ${PORT}`));
