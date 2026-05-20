const axios = require('axios');

module.exports = function(app) {
    
    // נקודת קצה ראשית שמטפלת בכל השלוחות
    app.get('/answer', async (req, res) => {
        let phone = req.query.ApiPhone || 'unknown';
        if (phone.startsWith('972')) { phone = '0' + phone.substring(3); }
        
        const ext = req.query.ApiExtension;
        const userText = req.query.user_voice_input || req.query.val; 
        const selection = req.query.user_digits_input || req.query.val;
        
        // שלוחה 1: שיחה עם ה-AI (הראשיבע)
        if (ext === '1') {
            if (!userText) {
                // המאזין רק נכנס לשלוחה - נבקש ממנו להקליט
                return res.send('read=t-נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.=user_voice_input,no,speech,he-IL,50,no');
            }
            
            try {
                // משיכת המודל שנבחר (ברירת מחדל היא פלאש 2.5)
                const chosenModel = global.userSettings.models[phone] || 'gemini-2.5-flash';
                // משיכת ההנחיה המותאמת אישית
                const customInstruction = global.userSettings.customInstructions[phone] || '';

                const geminiText = await callGemini(userText, apiKey, chosenModel, customInstruction);
                
                // ניקוי מוחלט של כוכביות, סולמיות ומקפים כדי שלא ישבשו את הקריין ויגרמו לו להקריא תווים מוזרים
                const cleanText = geminiText.replace(/[*#\-_]/g, '').trim();

                // הפיכה לשמע באמצעות מנוע ה-Neural TTS של גוגל
                const audioUrl = await textToSpeechAndGetUrl(cleanText, apiKey);

                // השמעת התשובה
                return res.send(`playfile=${audioUrl}`);
            } catch (error) {
                return res.send('id_list_message=t-חלה שגיאה בעיבוד הנתונים מול הבינה המלאכותית.&hangup=yes');
            }
        }

        // שלוחה 2: הגדרת הנחיית מערכת מותאמת אישית בדיבור (תמלול)
        if (ext === '2') {
            if (!userText) {
                return res.send('read=t-נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.=user_voice_input,no,speech,he-IL,50,no');
            }
            // שמירת ההנחיה בזיכרון השרת עבור מספר הטלפון הזה
            global.userSettings.customInstructions[phone] = userText;
            return res.send('id_list_message=t-הוראות המערכת המותאמות אישית עודכנו בהצלחה.&go_to_folder=/');
        }

        // שלוחה 3: בחירת מודל באמצעות מקשים (1, 2 או 3)
        if (ext === '3') {
            const selection = req.query.ApiDigits;
            if (!selection) {
                return res.send('read=t-לבחירת מודל גמיני שתיים נקודה חמש פלאש הקש אחת. לבחירת מודל שלוש נקודה אחת לייט הקש שתיים. לבחירת מודל שלוש נקודה אחת פרו הקש שלוש.=user_digits_input,1,1,1,7,Number,no');
            }
            
            if (selection === '1') {
                global.userSettings.models[phone] = 'gemini-2.5-flash';
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שתיים נקודה חמש פלאש.&go_to_folder=/');
            } else if (selection === '2') {
                global.userSettings.models[phone] = 'gemini-3.1-flash'; // הערה: 3.1 לייט/פלאש מוגדר במערכת כ-gemini-3.1-flash
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שלוש נקודה אחת לייט.&go_to_folder=/');
            } else if (selection === '3') {
                global.userSettings.models[phone] = 'gemini-3.1-pro';
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שלוש נקודה אחת פרו.&go_to_folder=/');
            } else {
                return res.send('id_list_message=t-בחירה לא חוקית.&go_to_folder=/3');
            }
        }

        return res.send('ok');
    });
};

async function callGemini(promptText, apiKey, modelName, customInstruction) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    // חוק ברזל מובנה בקוד נגד כוכביות וסימני עיצוב, בשילוב עם מה שהמשתמש הגדיר בשלוחה 2
    let systemInstruction = "חוקי הגשת הטקסט (קריטי עבור קריין טלפוני): " +
    "אסור לחלוטין להשתמש בסימני עיצוב טקסט כגון כוכביות (*), סולמיות (#), קווים תחתונים (_) או מקפים משולבים. הטקסט חייב להיכתב כפסקאות נקיות ורציפות בלבד. " +
    "השתמש בסימני פיסוק סטנדרטיים (נקודות, פסיקים) בצורה נכונה וטבעית בלבד, על מנת לעזור למנוע ההקראה לדעת היכן לעצור ולקחת אוויר בצורה אנושית. אל תכתוב את המילה 'פסיק' או 'נקודה' בטקסט עצמו. " +
    "ספק תשובה מקיפה, מעמיקה ועשירה המפרקת את הנושא לגורמים. התחל את דבריך מיד ללא הקדמות או ברכות. " +
    "זהות המודל: אתה מציג את עצמך כ'הראשיבע'. ";

    if (customInstruction) {
        systemInstruction += `\nהנחיות נוספות מותאמות אישית מהמשתמש שיש לשלב: ${customInstruction}`;
    }

    const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
    };

    const response = await axios.post(url, payload);
    return response.data.candidates[0].content.parts[0].text;
}

async function textToSpeechAndGetUrl(textToSpeak, apiKey) {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const payload = {
        input: { text: textToSpeak },
        voice: { languageCode: "he-IL", name: "he-IL-Neural2-F" }, // קול איכותי ואנושי מאוד
        audioConfig: { audioEncoding: "MP3" }
    };

    const response = await axios.post(url, payload);
    const audioContent = response.data.audioContent;
    return `data:audio/mp3;base64,${audioContent}`;
}
