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

// Database Connection
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ጋር ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// Schemas
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true }, name: String, password: String,
    referredBy: String, mainBalance: { type: Number, default: 0 }, playBalance: { type: Number, default: 100 }, 
    played: { type: Number, default: 0 }, won: { type: Number, default: 0 }
}));
const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
}));

// Game Variables
let gameState = "WAITING";
let timer = 40; 
let activePlayers = {};
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let currentDrawSequence = []; 
let gameInterval;
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

// 🟢 የተረጋጋ ሰዓት ቆጣሪ (Stable Timer)
let gameEndTime = 0;

function startCountdown() {
    gameState = "WAITING"; 
    activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000;
    globalTakenTickets = []; 
    io.emit('update_taken_tickets', globalTakenTickets); 
    clearInterval(gameInterval);
    
    gameEndTime = Date.now() + 40000; // 40 seconds
    
    gameInterval = setInterval(() => {
        let remaining = Math.round((gameEndTime - Date.now()) / 1000);
        timer = remaining > 0 ? remaining : 0;
        
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        
        if (timer <= 0) {
            clearInterval(gameInterval);
            if (totalTickets > 0) startGame();
            else startCountdown();
        }
    }, 1000);
}

function serverCheckBingo(grid, called) {
    let m = Array(5).fill().map(() => Array(5).fill(false));
    for(let c=0; c<5; c++) for(let r=0; r<5; r++) if(c===2 && r===2 || called.includes(grid[c][r])) m[c][r] = true;
    for(let c=0; c<5; c++) if(m[c][0]&&m[c][1]&&m[c][2]&&m[c][3]&&m[c][4]) return true; 
    for(let r=0; r<5; r++) if(m[0][r]&&m[1][r]&&m[2][r]&&m[3][r]&&m[4][r]) return true; 
    if(m[0][0]&&m[1][1]&&m[2][2]&&m[3][3]&&m[4][4]) return true; 
    if(m[0][4]&&m[1][3]&&m[2][2]&&m[3][1]&&m[4][0]) return true; 
    return false;
}

function generateRiggedDrawSequence() {
    let pool = Array.from({length: 75}, (_, i) => i + 1);
    let allTickets = [];
    for (let socketId in activePlayers) {
        activePlayers[socketId].ticketsData.forEach(t => allTickets.push({ ticket: t }));
    }
    if (allTickets.length === 0) return pool.sort(() => Math.random() - 0.5).slice(0, 20);
    
    let target = allTickets[Math.floor(Math.random() * allTickets.length)].ticket.grid;
    let req = [target[0][2], target[1][2], target[3][2], target[4][2]];
    req.forEach(n => { let idx = pool.indexOf(n); if(idx > -1) pool.splice(idx, 1); });
    let fillers = []; for(let i=0; i<16; i++) fillers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    let winBall = req.pop(); 
    let mixed = [...req, ...fillers].sort(() => Math.random() - 0.5); 
    mixed.splice(Math.floor(Math.random() * 5) + 15, 0, winBall);
    return mixed;
}

async function startGame() {
    gameState = "PLAYING";
    currentDrawSequence = generateRiggedDrawSequence(); 
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });

    gameInterval = setInterval(() => {
        if (currentDrawSequence.length === 0) { clearInterval(gameInterval); setTimeout(startCountdown, 5000); return; }
        let num = currentDrawSequence.shift(); 
        calledNumbers.push(num);
        io.emit('new_number', num);

        for (let socketId in activePlayers) {
            let player = activePlayers[socketId];
            for (let ticket of player.ticketsData) {
                if (serverCheckBingo(ticket.grid, calledNumbers)) {
                    clearInterval(gameInterval);
                    declareWinner(player, ticket);
                    return;
                }
            }
        }
    }, 3000);
}

async function declareWinner(player, ticket) {
    gameState = "FINISHED";
    const user = await User.findOne({phone: player.phone});
    if(user) { user.mainBalance += totalPrizePool; user.won += totalPrizePool; await user.save(); io.emit('balance_updated', player.phone); }
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers });
    setTimeout(startCountdown, 12000); 
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
    
    socket.on('buy_tickets', async (data) => {
        if (gameState !== "WAITING") return;
        const betAmount = data.ticketCount * 10;
        const user = await User.findOne({phone: data.phone});
        if(user && (user.playBalance + user.mainBalance) >= betAmount) {
            if (user.playBalance >= betAmount) user.playBalance -= betAmount;
            else { user.mainBalance -= (betAmount - user.playBalance); user.playBalance = 0; }
            await user.save();
            
            if (!activePlayers[socket.id]) activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
            else { activePlayers[socket.id].tickets += data.ticketCount; activePlayers[socket.id].ticketsData.push(...data.ticketsData); }
            
            totalTickets += data.ticketCount;
            totalPrizePool = (totalTickets * 10) * 0.85; 
            if(data.ticketIds) globalTakenTickets.push(...data.ticketIds);
            
            io.emit('update_taken_tickets', globalTakenTickets); 
            socket.emit('balance_updated', data.phone); 
        }
    });
});

startCountdown();
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(process.env.PORT || 3000, () => console.log("🚀 Server Running!"));

