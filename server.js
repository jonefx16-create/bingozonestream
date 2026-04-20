const express = require('express');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// የ public ፎልደርን (index.html) እንዲያነብ ያደርጋል
app.use(express.static(path.join(__dirname, 'public')));

// ⚠️ የርስዎ MONGODB አድራሻ (የይለፍ ቃሉ ውስጥ ያለው '/' እንዳይበላሽ ወደ '%2F' ተቀይሯል)
const mongoURI = "mongodb+srv://bingostream:T01%2F22%2F2005t@cluster0.hefpgl6.mongodb.net/BingoDB?retryWrites=true&w=majority";

// ከ Database ጋር ማገናኘት
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ ከ MongoDB ዳታቤዝ ጋር በትክክል ተገናኝቷል!"))
    .catch(err => console.error("❌ ዳታቤዝ አልተገናኘም:", err));

// የ User ዳታቤዝ ቅርፅ (Schema)
const userSchema = new mongoose.Schema({
    phone: String,
    name: String,
    password: String,
    mainBalance: Number,
    playBalance: Number,
    played: Number,
    won: Number
});
const User = mongoose.model('User', userSchema);

// ዳታን ከ HTML ተቀብሎ Database ላይ Save የሚያደርግ API
app.post('/api/syncUser', async (req, res) => {
    try {
        const { phone, name, password, mainBalance, playBalance, played, won } = req.body;
        // ተጠቃሚው ካለ ዳታውን Update ያደርጋል፣ ከሌለ አዲስ ይመዘግባል
        await User.findOneAndUpdate(
            { phone: phone },
            { name, password, mainBalance, playBalance, played, won },
            { new: true, upsert: true }
        );
        res.json({ success: true, message: "✅ ዳታው Database ላይ ገብቷል!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ተጠቃሚው ዌብሳይቱን ሲከፍት index.html ን እንዲያገኝ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ሰርቨሩን ማስነሳት
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bingo Server is running on port ${PORT}`);
});