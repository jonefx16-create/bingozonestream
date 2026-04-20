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

const mongoURI = "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ ከ MongoDB ዳታቤዝ ጋር በትክክል ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

const userSchema = new mongoose.Schema({
    phone: String, name: String, password: String,
    mainBalance: Number, playBalance: Number, played: Number, won: Number
});
const User = mongoose.model('User', userSchema);

let gameState = "WAITING";
let countdown = 25;
let globalJackpot = 0;
let livePlayers = 0;
let calledNumbers = []; 
let numberPool = [];
let gameLoopInterval = null;

setInterval(() => {
    if (gameState === "WAITING") {
        countdown--;
        io.emit('game_sync', { state: gameState, time: countdown, jackpot: globalJackpot, players: livePlayers });
        if (countdown <= 0) {
            if (globalJackpot > 0) startGame();
            else countdown = 25;
        }
    }
}, 1000);

function startGame() {
    gameState = "PLAYING";
    numberPool = Array.from({length: 75}, (_, i) => i + 1);
    calledNumbers = [];
    let prizePool = globalJackpot - (globalJackpot * 0.10); 
    io.emit('game_started', { prize: prizePool, players: livePlayers });
    gameLoopInterval = setInterval(() => {
        if (numberPool.length === 0) { endGame(null, null, prizePool); return; }
        let num = numberPool.splice(Math.floor(Math.random() * numberPool.length), 1)[0];
        calledNumbers.push(num);
        io.emit('number_called', { number: num, count: calledNumbers.length });
    }, 3000);
}

function endGame(winnerName, winningTicket, prize) {
    clearInterval(gameLoopInterval);
    io.emit('game_over', { winner: winnerName, ticket: winningTicket, prize: prize });
    setTimeout(() => { gameState = "WAITING"; countdown = 25; globalJackpot = 0; livePlayers = 0; }, 10000); 
}

io.on('connection', (socket) => {
    socket.emit('game_sync', { state: gameState, time: countdown, jackpot: globalJackpot, players: livePlayers });
    socket.on('place_bet', (betAmount) => { if (gameState === "WAITING") { globalJackpot += betAmount; livePlayers++; } });
    socket.on('bingo_won', (data) => { if (gameState === "PLAYING") { endGame(data.playerName, data.ticketId, globalJackpot * 0.90); } });
});

app.post('/api/register', async (req, res) => {
    try {
        const { phone, name, password } = req.body;
        const existingUser = await User.findOne({ phone: phone });
        if (existingUser) return res.json({ success: false, message: "ይህ ስልክ ቁጥር አስቀድሞ ተመዝግቧል!" });
        const newUser = new User({ phone, name, password, mainBalance: 100, playBalance: 100, played: 0, won: 0 });
        await newUser.save();
        res.json({ success: true, message: "በተሳካ ሁኔታ ተመዝግበዋል!" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone: phone });
        if (!user || user.password !== password) return res.json({ success: false, message: "ስልክ ቁጥር ወይም የይለፍ ቃል ተሳስቷል!" });
        res.json({ success: true, user: user });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/syncUser', async (req, res) => {
    try {
        const { phone, mainBalance, playBalance, played, won } = req.body;
        await User.findOneAndUpdate({ phone: phone }, { mainBalance, playBalance, played, won });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Live Server running on port ${PORT}`);
});