const express = require('express');
const app = express();

// משתנים גלובליים לזיכרון השרת (הנחיית מערכת ובחירת מודל)
global.systemPrompt = "אתה חבר ויועץ בשם 'הראשיבע'. המפתח שבנה אותך זה חברת סמרטאל אפליקציות חכמות. ענה בטבעיות ובידידותיות. אסור להשתמש בכוכביות, סולמיות, הדגשות, או סימנים מיוחדים. השתמש רק באותיות, פסיקים ונקודות. כתוב משפטים ברורים כדי שהקריין יקריא אותם נכון.";
global.selectedModel = "gemini"; // ברירת מחדל
global.sessions = {}; // זיכרון שיחות

const chatRoute = require('./routes/chat');
const promptRoute = require('./routes/prompt');
const modelRoute = require('./routes/model');

app.use('/api/chat', chatRoute);
app.use('/api/prompt', promptRoute);
app.use('/api/model', modelRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
