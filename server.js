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
let timer = 25; 
let activePlayers = {};
let totalPrizePool = 0;
let totalTickets = 0;
let calledNumbers = [];
let pool = [];
let gameInterval;
let gameId = Math.floor(Math.random() * 9000) + 1000;
let globalTakenTickets = []; 

// 🟢 ሰርቨር የቢንጎ ህግን የሚያረጋግጥበት ፈንክሽን
function checkServerBingo(ticket, calledNums) {
    let m = [[0,0,0,0,0], [0,0,0,0,0], [0,0,1,0,0], [0,0,0,0,0], [0,0,0,0,0]]; // መሃሉ Free (1) ነው
    
    // የወጡ ኳሶችን ካርቴላው ላይ ማመልከት
    for(let c=0; c<5; c++) {
        for(let r=0; r<5; r++) {
            if(calledNums.includes(ticket.grid[c][r])) {
                m[c][r] = 1;
            }
        }
    }
    
    // 1. ወደ ታች (Columns) ማረጋገጥ
    for(let c=0; c<5; c++) { if(m[c][0]&&m[c][1]&&m[c][2]&&m[c][3]&&m[c][4]) return true; } 
    // 2. ወደ ጎን (Rows) ማረጋገጥ
    for(let r=0; r<5; r++) { if(m[0][r]&&m[1][r]&&m[2][r]&&m[3][r]&&m[4][r]) return true; } 
    // 3. ማዕዘን (Diagonals) ማረጋገጥ
    if(m[0][0]&&m[1][1]&&m[2][2]&&m[3][3]&&m[4][4]) return true; 
    if(m[0][4]&&m[1][3]&&m[2][2]&&m[3][1]&&m[4][0]) return true; 
    
    return false;
}

function startCountdown() {
    gameState = "WAITING"; timer = 25; activePlayers = {}; totalPrizePool = 0; totalTickets = 0; calledNumbers = [];
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
            else startCountdown(); // ሰው ካልገባ ዳግም ይቆጥራል
        }
    }, 1000);
}

function startGame() {
    gameState = "PLAYING";
    pool = Array.from({length: 75}, (_, i) => i + 1);
    io.emit('game_status', { state: gameState, timer: "LIVE", totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });

    gameInterval = setInterval(async () => {
        if (gameState !== "PLAYING") {
            clearInterval(gameInterval);
            return;
        }

        let num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        calledNumbers.push(num);
        io.emit('new_number', num);

        // 🔴 አዲስ: አውቶማቲክ አሸናፊ ማረጋገጫ (Auto Winner Check)
        let winnerFound = null;
        for (let socketId in activePlayers) {
            let player = activePlayers[socketId];
            for (let t of player.fullTickets) {
                if (checkServerBingo(t, calledNumbers)) {
                    winnerFound = { name: player.name, phone: player.phone, ticketId: t.id };
                    break;
                }
            }
            if (winnerFound) break; // አንድ አሸናፊ ሲገኝ ፍለጋው ይቆማል
        }

        // አሸናፊ ከተገኘ ጌሙ ይቆማል
        if (winnerFound) {
            gameState = "FINISHED";
            clearInterval(gameInterval);
            
            // የገንዘብ ሽልማቱን ለአሸናፊው መስጠት
            const user = await User.findOne({phone: winnerFound.phone});
            if(user) {
                user.mainBalance += totalPrizePool;
                user.won += totalPrizePool;
                await user.save();
                io.emit('balance_updated', user.phone);
            }
            
            // ለሁሉም ሰው አሸናፊውን ማሳወቅ
            io.emit('game_winner', { winnerName: winnerFound.name, ticketId: winnerFound.ticketId, prize: totalPrizePool, phone: winnerFound.phone });
            
            // ከ 8 ሰከንድ በኋላ አዲስ ጌም መጀመር
            setTimeout(() => { startCountdown(); }, 8000);
            return;
        }

        // ሁሉም 75 ኳስ ካለቀ እና (እንዳጋጣሚ) ማንም ካላሸነፈ ይመለሳል
        if (calledNumbers.length >= 75) { 
            clearInterval(gameInterval); 
            setTimeout(startCountdown, 5000); 
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
            
            if(user && user.mainBalance >= betAmount) {
                user.mainBalance -= betAmount;
                user.played += 1;
                await user.save();
                
                // የገዛቸውን ሙሉ ካርቴላዎች (Grid ጭምር) ወደ ሰርቨር መመዝገብ
                activePlayers[socket.id] = { 
                    name: data.name, 
                    phone: data.phone, 
                    tickets: data.ticketCount, 
                    ticketIds: data.ticketIds,
                    fullTickets: data.fullTickets // አውቶማቲክ ለሚያነበው ሲስተም
                };
                
                totalTickets += data.ticketCount;
                
                // 15% ለአድሚን ይቆረጣል (85% ለአሸናፊው ይቀራል)
                totalPrizePool = (totalTickets * 10) * 0.85; 
                
                if(data.ticketIds) {
                    data.ticketIds.forEach(id => {
                        if(!globalTakenTickets.includes(id)) globalTakenTickets.push(id);
                    });
                }
                io.emit('update_taken_tickets', globalTakenTickets); 
                
                io.emit('game_status', { state: gameState, timer, totalPrizePool, totalTickets, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId });
                socket.emit('balance_updated', data.phone); 
            }
        }
    });

    // ማሳሰቢያ: ተጠቃሚዎች 'claim_bingo' መላክ አይጠበቅባቸውም። ሲስተሙ ራሱ ያውቀዋል!
});

startCountdown();

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

