const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// מאגר מקומי זמני בזיכרון השרת לשמירת הגדרות המשתמשים (מודל והנחיה) לפי מספר טלפון
// הערה: בשרת חינמי ב-Render זה מתאפס כשהשרת הולך לישון, אך זה פתרון מעולה ללא מסד נתונים חיצוני.
global.userSettings = {
    models: {}, // מפתח: טלפון, ערך: שם המודל
    customInstructions: {} // מפתח: טלפון, ערך: ההנחיה המותאמת
};

// טעינה דינמית של תוספים (Plugins)
const pluginsPath = path.join(__dirname, 'plugins');
if (!fs.existsSync(pluginsPath)){
    fs.mkdirSync(pluginsPath);
}

// קריאת כל קבצי הראוטינג מתיקיית plugins
fs.readdirSync(pluginsPath).forEach(file => {
    if (file.endsWith('.js')) {
        const plugin = require(path.join(pluginsPath, file));
        if (typeof plugin === 'function') {
            plugin(app);
            console.log(`טוען בהצלחה את התוסף: ${file}`);
        }
    }
});

// נתיב ברירת מחדל לבדיקה שהשרת עובד
app.get('/', (req, res) => {
    res.send('השרת המודולרי של ג'מיני פועל בהצלחה!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
