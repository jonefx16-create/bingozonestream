const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Socket.io ለ Live ጨዋታ

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⚠️ MONGODB CONNECTION
const mongoURI = "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ዳታቤዝ ጋር በትክክል ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

const userSchema = new mongoose.Schema({
    phone: String, name: String, password: String,
    mainBalance: Number, playBalance: Number, played: Number, won: Number
});
const User = mongoose.model('User', userSchema);

// ==========================================
// 🎮 የ LIVE GAME (ሰርቨር) ሎጂክ
// ==========================================
let gameState = "WAITING"; // WAITING, PLAYING
let countdown = 25; // መመደቢያ ሰከንድ
let globalJackpot = 0; // የተሰበሰበ ጠቅላላ ብር
let livePlayers = 0; // የተጫዋቾች ብዛት
let calledNumbers = []; 
let numberPool = [];
let gameLoopInterval = null;

// ሰርቨሩ በየሰከንዱ ለሁሉም ዩዘሮች መረጃ ይልካል
setInterval(() => {
    if (gameState === "WAITING") {
        countdown--;
        io.emit('game_sync', { state: gameState, time: countdown, jackpot: globalJackpot, players: livePlayers });
        
        if (countdown <= 0) {
            if (globalJackpot > 0) {
                startGame(); // ብር የተመደበበት ከሆነ ጨዋታው ይጀመራል
            } else {
                countdown = 25; // ማንም ካልተጫወተ ሰዓቱ ሪሴት ይደረጋል
            }
        }
    }
}, 1000);

function startGame() {
    gameState = "PLAYING";
    numberPool = Array.from({length: 75}, (_, i) => i + 1);
    calledNumbers = [];
    
    // 10% ለካምፓኒ ተቆርጦ ለተጫዋቾች የሚሰጠው ሽልማት
    let prizePool = globalJackpot - (globalJackpot * 0.10); 
    io.emit('game_started', { prize: prizePool, players: livePlayers });

    // በየ 3 ሰከንዱ ቁጥር ያወጣል
    gameLoopInterval = setInterval(() => {
        if (numberPool.length === 0) {
            endGame(null, null, prizePool);
            return;
        }
        let randomIndex = Math.floor(Math.random() * numberPool.length);
        let num = numberPool.splice(randomIndex, 1)[0];
        calledNumbers.push(num);
        
        io.emit('number_called', { number: num, count: calledNumbers.length });
    }, 3000);
}

function endGame(winnerName, winningTicket, prize) {
    clearInterval(gameLoopInterval);
    io.emit('game_over', { winner: winnerName, ticket: winningTicket, prize: prize });
    
    // ለቀጣይ ዙር ሪሴት ማድረግ (ከ 10 ሰከንድ በኋላ)
    setTimeout(() => {
        gameState = "WAITING";
        countdown = 25;
        globalJackpot = 0;
        livePlayers = 0;
    }, 10000); 
}

// ==========================================
// 🔌 SOCKET.IO (ከክሊየንት ጋር መገናኛ)
// ==========================================
io.on('connection', (socket) => {
    socket.emit('game_sync', { state: gameState, time: countdown, jackpot: globalJackpot, players: livePlayers });

    socket.on('place_bet', (betAmount) => {
        if (gameState === "WAITING") {
            globalJackpot += betAmount;
            livePlayers++;
        }
    });

    socket.on('bingo_won', (data) => {
        if (gameState === "PLAYING") {
            let prizePool = globalJackpot - (globalJackpot * 0.10);
            endGame(data.playerName, data.ticketId, prizePool);
        }
    });
});

// ==========================================
// 🗄 API ROUTES (Authentication & Data)
// ==========================================

// 1. መመዝገቢያ (Register) API
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password } = req.body;
        const existingUser = await User.findOne({ phone: phone });
        
        if (existingUser) {
            return res.json({ success: false, message: "ይህ ስልክ ቁጥር አስቀድሞ ተመዝግቧል! እባክዎ Login ያድርጉ።" });
        }

        const newUser = new User({ phone, name, password, mainBalance: 100, playBalance: 100, played: 0, won: 0 });
        await newUser.save();
        
        res.json({ success: true, message: "በተሳካ ሁኔታ ተመዝግበዋል! እባክዎ አሁን Login አድርገው ይግቡ።" });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// 2. መግቢያ (Login) API
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone: phone });
        
        if (!user) return res.json({ success: false, message: "ስልክ ቁጥሩ አልተመዘገበም! እባክዎ መጀመሪያ Register ያድርጉ።" });
        if (user.password !== password) return res.json({ success: false, message: "የይለፍ ቃል ተሳስቷል!" });

        res.json({ success: true, user: user });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 3. ዳታ ማደሻ (Sync) API
app.post('/api/syncUser', async (req, res) => {
    try {
        const { phone, mainBalance, playBalance, played, won } = req.body;
        await User.findOneAndUpdate({ phone: phone }, { mainBalance, playBalance, played, won });
        res.json({ success: true });
    } catch (error) {}
});

// ሰርቨሩን ማስነሳት
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Live Server running on port ${PORT}`));