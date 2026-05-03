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
    phone: { type: String, required: true, unique: true }, name: String, password: { type: String, required: true },
    referredBy: { type: String, default: "" }, mainBalance: { type: Number, default: 0 }, playBalance: { type: Number, default: 100 }, 
    played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, status: { type: String, default: 'active' }
}));

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: Number, ticketId: String, winnerName: String, winnerPhone: String, prize: Number,
    adminProfit: Number, ticketPrice: Number, winningGrid: Array, calledNumbers: Array, playersData: Array, date: { type: Date, default: Date.now }
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "bingo1234" }, ticketPrice: { type: Number, default: 10 }, isGamePaused: { type: Boolean, default: false }
}));

let GLOBAL_SETTINGS = { adminPass: "bingo1234", ticketPrice: 10, isGamePaused: false };
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) s = await new SystemSettings({}).save();
    GLOBAL_SETTINGS = { adminPass: s.adminPass, ticketPrice: s.ticketPrice, isGamePaused: s.isGamePaused };
}
loadSettings();

const auth = (req, res, next) => { 
    const pass = req.body.password || req.body.adminPass;
    if(pass !== GLOBAL_SETTINGS.adminPass && pass !== ADMIN_PASS) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

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
function serverCheckBingo(grid, called) {
    let m = Array(5).fill().map(() => Array(5).fill(false));
    for(let c=0; c<5; c++) for(let r=0; r<5; r++) if((c===2 && r===2) || called.includes(grid[c][r])) m[c][r] = true;
    for(let c=0; c<5; c++) if(m[c][0]&&m[c][1]&&m[c][2]&&m[c][3]&&m[c][4]) return true; 
    for(let r=0; r<5; r++) if(m[0][r]&&m[1][r]&&m[2][r]&&m[3][r]&&m[4][r]) return true; 
    if(m[0][0]&&m[1][1]&&m[2][2]&&m[3][3]&&m[4][4]) return true; 
    if(m[0][4]&&m[1][3]&&m[2][2]&&m[3][1]&&m[4][0]) return true; 
    return false;
}

function startCountdown() {
    gameState = "WAITING";
    timer = 40;
    calledNumbers = [];
    globalTakenTickets = [];
    if(gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        if(GLOBAL_SETTINGS.isGamePaused) { io.emit('game_status', { state: "PAUSED", timer: "PAUSED" }); return; }
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, gameId, ticketPrice: GLOBAL_SETTINGS.ticketPrice });
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
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, gameId, ticketPrice: GLOBAL_SETTINGS.ticketPrice });

    gameInterval = setInterval(() => {
        if (pool.length === 0 || gameState !== "PLAYING") {
            clearInterval(gameInterval);
            setTimeout(startCountdown, 10000);
            return;
        }
        let num = pool.shift();
        calledNumbers.push(num);
        io.emit('new_number', num);
        
        for (let player of Object.values(activePlayers)) {
            for (let ticket of player.ticketsData) {
                if (serverCheckBingo(ticket.grid, calledNumbers)) {
                    declareWinner(player, ticket);
                    return;
                }
            }
        }
    }, 3000);
}

async function declareWinner(player, ticket) {
    gameState = "FINISHED";
    clearInterval(gameInterval);
    let prize = totalPrizePool;
    const user = await User.findOne({ phone: player.phone });
    if(user) { user.mainBalance += prize; user.won += prize; await user.save(); io.emit('balance_updated', player.phone); }
    await GameHistory.create({ gameId, ticketId: ticket.id, winnerName: player.name, winnerPhone: player.phone, prize, adminProfit: (totalTickets * GLOBAL_SETTINGS.ticketPrice) - prize, ticketPrice: GLOBAL_SETTINGS.ticketPrice, winningGrid: ticket.grid, calledNumbers, playersData: Object.values(activePlayers) });
    io.emit('game_winner', { winnerName: player.name, ticketId: ticket.id, prize, phone: player.phone, ticketGrid: ticket.grid, calledNumbers });
    setTimeout(startCountdown, 12000);
}

// SOCKETS
io.on('connection', (socket) => {
    socket.emit('game_status', { state: GLOBAL_SETTINGS.isGamePaused ? "PAUSED" : gameState, timer: gameState === "PLAYING" ? "LIVE" : timer, totalPrizePool, totalTickets, calledNumbers, gameId, ticketPrice: GLOBAL_SETTINGS.ticketPrice });
    socket.emit('update_taken_tickets', globalTakenTickets);

    socket.on('buy_tickets', async (data) => {
        const user = await User.findOne({ phone: data.phone });
        if (!user || user.status === 'banned') return;
        let cost = data.ticketCount * GLOBAL_SETTINGS.ticketPrice;
        if ((user.playBalance + user.mainBalance) >= cost) {
            if (user.playBalance >= cost) user.playBalance -= cost;
            else { user.mainBalance -= (cost - user.playBalance); user.playBalance = 0; }
            user.played += 1; await user.save();
            
            if (!activePlayers[data.phone]) activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: 0, ticketsData: [] };
            activePlayers[data.phone].tickets += data.ticketCount;
            activePlayers[data.phone].ticketsData.push(...data.ticketsData);
            
            totalTickets += data.ticketCount;
            totalPrizePool = (totalTickets * GLOBAL_SETTINGS.ticketPrice) * 0.85;
            data.ticketIds.forEach(id => globalTakenTickets.push(id));
            
            io.emit('update_taken_tickets', globalTakenTickets);
            io.emit('game_status', { state: gameState, timer: gameState === "PLAYING" ? "LIVE" : timer, totalPrizePool, totalTickets, calledNumbers, gameId, ticketPrice: GLOBAL_SETTINGS.ticketPrice });
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

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId);
    if(!tx) return res.json({success: false});
    if (req.body.action === 'Approve') {
        const user = await User.findOne({ phone: tx.phone });
        user.playBalance += tx.amount;
        await user.save();
        tx.status = 'Approved';
    } else { tx.status = 'Rejected'; }
    await tx.save();
    io.emit('balance_updated', tx.phone);
    res.json({ success: true });
});

app.post('/api/admin/finance-report', auth, async (req, res) => {
    const txs = await Transaction.find({ status: 'Approved' });
    let totalDeposit = txs.filter(t => t.type === 'deposit').reduce((a, b) => a + b.amount, 0);
    let totalWithdraw = txs.filter(t => t.type === 'withdraw').reduce((a, b) => a + b.amount, 0);
    const games = await GameHistory.find();
    let totalGameProfit = games.reduce((sum, g) => sum + (g.adminProfit || 0), 0);
    res.json({ success: true, totalDeposit, totalWithdraw, totalGameProfit });
});

startCountdown();
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running!`));

