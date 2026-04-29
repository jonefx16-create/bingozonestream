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

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: String,
    password: { type: String, required: true },
    mainBalance: { type: Number, default: 0 }, // ያሸነፉት (Withdrawable)
    playBalance: { type: Number, default: 0 }, // ያስገቡት እና ቦነስ (Betting power)
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
        
        user = new User({ phone, name, password, mainBalance: 0, playBalance: 100 });
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
            if(user.mainBalance < amount) return res.json({success: false, message: "በዋና (ያሸነፉት) ሂሳብዎ ላይ በቂ ብር የለም!"});
            user.mainBalance -= amount; 
            await user.save();
        }
        const newTx = new Transaction({ phone, type, amount, method });
        await newTx.save();
        res.json({ success: true, message: "✅ ጥያቄዎ በተሳካ ሁኔታ ተልኳል! በአድሚን ሲረጋገጥ ይስተካከላል።" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/user/transactions/:phone', async (req, res) => {
    try {
        const txs = await Transaction.find({ phone: req.params.phone, status: 'Approved' }).sort({ date: -1 }).limit(20);
        res.json({ success: true, txs });
    } catch (e) { res.status(500).json({ success: false }); }
});

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
                // 🟢 20% BONUS LOGIC (100 ETB እና ከዚያ በላይ ለሚያስገቡ) 🟢
                let bonus = tx.amount >= 100 ? (tx.amount * 0.20) : 0;
                user.playBalance += (tx.amount + bonus); 
            }
        } else if (action === 'Reject') {
            tx.status = 'Rejected';
            if(tx.type === 'withdraw') { user.mainBalance += tx.amount; } 
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
        user.playBalance += req.body.amount;
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

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE (SOCKET.IO)
// ==========================================
let gameState = "WAITING";
let timer = 40; // 🟢 ሰዓቱ 40 ሴኮንድ ሆኗል 🟢
let activePlayers = {};
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let currentDrawSequence = []; 
let gameInterval;
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

function serverCheckBingo(grid, called) {
    let m = Array(5).fill().map(() => Array(5).fill(false));
    for(let c=0; c<5; c++){
        for(let r=0; r<5; r++){
            if(c===2 && r===2) m[c][r] = true; 
            else if(called.includes(grid[c][r])) m[c][r] = true;
        }
    }
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
        let p = activePlayers[socketId];
        p.ticketsData.forEach(t => allTickets.push({ phone: p.phone, name: p.name, socketId: socketId, ticket: t }));
    }
    if (allTickets.length === 0) {
        let seq = [];
        for(let i=0; i<20; i++) seq.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        return seq;
    }
    let targetInfo = allTickets[Math.floor(Math.random() * allTickets.length)];
    let tg = targetInfo.ticket.grid;
    let requiredNumbers = [tg[0][2], tg[1][2], tg[3][2], tg[4][2]];
    requiredNumbers.forEach(n => { let idx = pool.indexOf(n); if(idx > -1) pool.splice(idx, 1); });
    let fillers = [];
    for(let i=0; i<16; i++) fillers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    let winningBall = requiredNumbers.pop(); 
    let mixed = [...requiredNumbers, ...fillers];
    mixed.sort(() => Math.random() - 0.5); 
    let winIndex = Math.floor(Math.random() * 5) + 15; 
    mixed.splice(winIndex, 0, winningBall);
    return mixed;
}

async function declareWinner(player, ticket) {
    gameState = "FINISHED";
    clearInterval(gameInterval);
    const user = await User.findOne({phone: player.phone});
    if(user) {
        user.mainBalance += totalPrizePool;
        user.won += totalPrizePool;
        await user.save();
        io.emit('balance_updated', player.phone);
    }
    io.emit('game_winner', { 
        winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers: calledNumbers
    });
    setTimeout(() => { startCountdown(); }, 12000); 
}

function startCountdown() {
    gameState = "WAITING"; 
    timer = 40; // 🟢 ሰዓቱ እዚህም 40 ሴኮንድ ሆኗል 🟢
    activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = []; currentDrawSequence = [];
    gameId = Math.floor(Math.random() * 9000) + 1000;
    globalTakenTickets = []; 
    io.emit('update_taken_tickets', globalTakenTickets); 
    clearInterval(gameInterval);
    
    let waitInterval = setInterval(() => {
        timer--;
        io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
        if (timer <= 0) {
            clearInterval(waitInterval);
            if (totalTickets > 0) startGame();
            else startCountdown();
        }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING";
    currentDrawSequence = generateRiggedDrawSequence(); 
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });

    gameInterval = setInterval(() => {
        if (gameState !== "PLAYING" || currentDrawSequence.length === 0) {
            clearInterval(gameInterval);
            if(gameState === "PLAYING") setTimeout(startCountdown, 5000); 
            return;
        }
        let num = currentDrawSequence.shift(); 
        calledNumbers.push(num);
        io.emit('new_number', num);

        let winnerFound = false;
        for (let socketId in activePlayers) {
            let player = activePlayers[socketId];
            for (let i = 0; i < player.ticketsData.length; i++) {
                let ticket = player.ticketsData[i];
                if (serverCheckBingo(ticket.grid, calledNumbers)) {
                    winnerFound = true;
                    declareWinner(player, ticket);
                    break;
                }
            }
            if(winnerFound) break;
        }
    }, 3000);
}

io.on('connection', (socket) => {
    socket.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
    socket.emit('update_taken_tickets', globalTakenTickets); 
    
    socket.on('buy_tickets', async (data) => {
        if (gameState === "WAITING") {
            const betAmount = data.ticketCount * 10;
            const user = await User.findOne({phone: data.phone});
            
            if(user && (user.playBalance + user.mainBalance) >= betAmount) {
                if (user.playBalance >= betAmount) {
                    user.playBalance -= betAmount;
                } else {
                    let remaining = betAmount - user.playBalance;
                    user.playBalance = 0;
                    user.mainBalance -= remaining;
                }
                user.played += 1;
                await user.save();
                
                activePlayers[socket.id] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
                totalTickets += data.ticketCount;
                totalPrizePool = (totalTickets * 10) * 0.85; 
                
                if(data.ticketIds) {
                    data.ticketIds.forEach(id => { if(!globalTakenTickets.includes(id)) globalTakenTickets.push(id); });
                }
                io.emit('update_taken_tickets', globalTakenTickets); 
                io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
                socket.emit('balance_updated', data.phone); 
            }
        }
    });
});

startCountdown();
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

