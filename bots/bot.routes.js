const express = require('express');
const router = express.Router();
const { BotUser } = require('./bot.model');

// server.js ላይ ያሉትን Settings እና Auth ወደዚህ ፋይል ለማምጣት በ Parameter እንቀበላቸዋለን
module.exports = function(SystemSettings, loadSettings, auth) {
    
    // 1. የቦቶችን ዝርዝር ወደ Admin የሚያልከው
    router.post('/bots-list', auth, async (req, res) => {
        try {
            let bots = await BotUser.find().sort({ _id: -1 });
            let s = await SystemSettings.findOne(); // ለ settings ዳታ
            res.json({ success: true, bots: bots, settings: s });
        } catch(e) { 
            res.json({ success: false }); 
        }
    });

    // 2. Admin ላይ የሚስተካከለውን Bot Settings ሴቭ የሚያደርገው
    router.post('/bot-master-update', auth, async (req, res) => {
        try {
            let s = await SystemSettings.findOne();
            s.isBotSystemActive = req.body.isBotSystemActive;
            s.botWinnerForce = req.body.botWinnerForce;
            s.botDist1 = req.body.botDist1;
            s.botDist2 = req.body.botDist2;
            s.botDist3 = req.body.botDist3;
            s.botDist4 = req.body.botDist4;
            
            await s.save();
            await loadSettings(); // አዲሱን Setting Update እንዲያደርግ
            res.json({ success: true });
        } catch(e) { 
            res.json({ success: false }); 
        }
    });

    return router;
};
