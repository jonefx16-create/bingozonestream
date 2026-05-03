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

// የ Database ኮኔክሽን
const mongoURI = process.env.MONGO_URI || "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
const ADMIN_PASS = process.env.ADMIN_PASS || "bingo1234";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ጋር ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// ==========================================
// 🗄️ MODELS
// ==========================================
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    referredBy: { type: String, default: "" }, 
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const txSchema = new mongoose.Schema({
    phone: String, type: String, amount: Number, method: String,
    status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', txSchema);

const gameHistorySchema = new mongoose.Schema({
    gameId: Number, ticketId: String, winnerName: String, winnerPhone: String, prize: Number,
    winningGrid: Array, calledNumbers: Array, date: { type: Date, default: Date.now }
});
const GameHistory = mongoose.model('GameHistory', gameHistorySchema);

const activeBonusSchema = new mongoose.Schema({
    amount: Number, maxUsers: Number, currentClaims: { type: Number, default: 0 },
    claimedBy: [String], expiresAt: Date, isActive: { type: Boolean, default: true }
});
const ActiveBonus = mongoose.model('ActiveBonus', activeBonusSchema);


// ==========================================
// 🔵 USER APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password, refCode } = req.body;
        let user = await User.findOne({ phone });
        if (user) return res.json({ success: false, message: "ይህ ስልክ ቁጥር አስቀድሞ ተመዝግቧል!" });
        
        let actualReferrer = "";
        // ሪፈራል ካስገባ ለጋበዘው ሰው 10 ብር ቦነስ ይሰጣል
        if (refCode && refCode.trim() !== "") {
            let referrer = await User.findOne({ phone: refCode.trim() });
            if (referrer) {
                referrer.playBalance += 10;
                await referrer.save();
                io.emit('balance_updated', referrer.phone);
                actualReferrer = referrer.phone;
            }
        }
        
        user = new User({ phone, name, password, referredBy: actualReferrer, mainBalance: 0, playBalance: 100 });
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
        const txs = await Transaction.find({ phone: req.params.phone }).sort({ date: -1 }).limit(30);
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

// User Claims Mass Bonus
app.post('/api/user/claim-mass-bonus', async (req, res) => {
    try {
        let user = await User.findOne({ phone: req.body.phone }); 
        if(!user) return res.json({ success: false, message: "User not found!" });
        
        let bonus = await ActiveBonus.findOne({ isActive: true });
        if(!bonus || new Date() > bonus.expiresAt) return res.json({ success: false, message: "No active bonus found or it has expired." });
        if(bonus.currentClaims >= bonus.maxUsers) return res.json({ success: false, message: "Bonus claim limit reached!" });
        if(bonus.claimedBy.includes(user.phone)) return res.json({ success: false, message: "You already claimed this bonus!" });

        user.playBalance += bonus.amount; await user.save();
        bonus.claimedBy.push(user.phone); bonus.currentClaims += 1; await bonus.save();
        
        io.emit('balance_updated', user.phone);
        res.json({ success: true, message: `✅ You successfully claimed ${bonus.amount} ETB Bonus!` });
    } catch (e) { res.status(500).json({ success: false }); }
});

// User Refresh - Get Active Tickets
app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[req.params.phone];
    res.json(p ? { success: true, ticketsData: p.ticketsData } : { success: false });
});

// ==========================================
// 🔴 ADMIN APIs
// ==========================================
const auth = (req, res, next) => { 
    if(req.body.password !== ADMIN_PASS && req.body.adminPass !== ADMIN_PASS) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

app.post('/api/admin/users', auth, async (req, res) => {
    const users = await User.find().sort({ _id: -1 });
    res.json(users);
});

app.post('/api/admin/transactions', auth, async (req, res) => {
    const txs = await Transaction.find().sort({ date: -1 });
    res.json(txs);
});

app.post('/api/admin/history', auth, async (req, res) => {
    res.json(await GameHistory.find().sort({ date: -1 }).limit(50));
});

app.post('/api/admin/active-bonus', auth, async (req, res) => {
    res.json(await ActiveBonus.findOne({ isActive: true }));
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const { txId, action } = req.body;
    try {
        const tx = await Transaction.findById(txId);
        if(!tx || tx.status !== 'Pending') return res.json({success: false});
        const user = await User.findOne({phone: tx.phone});
        if(!user) return res.json({success: false});

        if (action === 'Approve') {
            tx.status = 'Approved';
            if(tx.type === 'deposit') { 
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

app.post('/api/admin/send-bonus', auth, async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.body.phone });
        if(!user) return res.json({ success: false });
        user.playBalance += req.body.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/create-mass-bonus', auth, async (req, res) => {
    try {
        await ActiveBonus.updateMany({}, { isActive: false }); // Disable old bonuses
        let expires = new Date(); 
        expires.setMinutes(expires.getMinutes() + parseInt(req.body.timeMin));
        await new ActiveBonus({ amount: req.body.amount, maxUsers: req.body.maxUsers, expiresAt: expires }).save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const { oldPhone, newPhone, password, mainBalance, playBalance } = req.body;
        let user = await User.findOne({ phone: oldPhone });
        if (!user) return res.json({ success: false, message: "User not found!" });

        // Change Phone and Migrate
        if (oldPhone !== newPhone) {
            let existing = await User.findOne({ phone: newPhone });
            if (existing) return res.json({ success: false, message: "New phone number is already registered!" });
            
            user.phone = newPhone;
            await Transaction.updateMany({ phone: oldPhone }, { $set: { phone: newPhone } });
            await GameHistory.updateMany({ winnerPhone: oldPhone }, { $set: { winnerPhone: newPhone } });
        }

        user.password = password;
        user.mainBalance = Number(mainBalance);
        user.playBalance = Number(playBalance);
        await user.save();

        io.emit('balance_updated', user.phone);
        res.json({ success: true, message: "✅ User updated successfully!" });
    } catch (e) { res.status(500).json({ success: false, message: "Server error" }); }
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
let timer = 40; 
let activePlayers = {}; // Mapped by PHONE NUMBER for persistence
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
    // Convert activePlayers object to array
    Object.values(activePlayers).forEach(p => {
        p.ticketsData.forEach(t => allTickets.push({ phone: p.phone, name: p.name, ticket: t }));
    });
    
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
    
    // Save Game History
    await GameHistory.create({
        gameId: gameId, ticketId: ticket.id, winnerName: player.name, winnerPhone: player.phone,
        prize: totalPrizePool, winningGrid: ticket.grid, calledNumbers: [...calledNumbers]
    });

    io.emit('game_winner', { 
        winnerName: player.name, ticketId: ticket.id, prize: totalPrizePool, phone: player.phone, ticketGrid: ticket.grid, calledNumbers: calledNumbers
    });
    setTimeout(() => { startCountdown(); }, 12000); 
}

function startCountdown() {
    gameState = "WAITING"; 
    timer = 40; 
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
        // Check Bingo
        for (let player of Object.values(activePlayers)) {
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
    // 💡 SEND FULL STATE IMMEDIATELY ON CONNECT/REFRESH
    socket.emit('game_status', { 
        state: gameState, 
        timer: gameState === "PLAYING" ? "LIVE" : timer, 
        totalPrizePool, 
        totalTickets, 
        calledNumbers: [...calledNumbers], // Sync numbers
        playersCount: Object.keys(activePlayers).length, 
        gameId 
    });
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
                
                // Save state by PHONE NUMBER so it survives socket disconnects (refresh)
                activePlayers[data.phone] = { name: data.name, phone: data.phone, tickets: data.ticketCount, ticketsData: data.ticketsData };
                
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

