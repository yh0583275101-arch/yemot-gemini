const express = require('express'); // הוספתי רק למקרה שאין לך, כי חייבים app
const axios = require('axios');

// "מחסן" בזיכרון כדי להעביר את קבצי השמע של גוגל לימות המשיח
const audioCache = new Map();
// "מחסן" לקבצים קבועים (כדי לא לבזבז זמן בהקראת תפריטים קבועים בכל שיחה מחדש)
const staticPrompts = {};

module.exports = function(app) {
    
    // נתיב חדש וקטן - ימות המשיח ייכנסו לכאן כדי לשמוע את קובץ האודיו שהבינה יצרה
    app.get('/stream_audio/:id', (req, res) => {
        const base64Audio = audioCache.get(req.params.id);
        if (!base64Audio) return res.send('playfile=000'); // קובץ שקט למקרה של שגיאה
        const buffer = Buffer.from(base64Audio, 'base64');
        res.set('Content-Type', 'audio/mp3');
        res.send(buffer);
        // מחיקה מהזיכרון אחרי השמעה אחת כדי לא להעמיס על השרת
        if (!req.params.id.startsWith('static_')) {
            audioCache.delete(req.params.id);
        }
    });

    app.get('/answer', async (req, res) => {
        let phone = req.query.ApiPhone || 'unknown';
        if (phone.startsWith('972')) { phone = '0' + phone.substring(3); }
        
        const ext = req.query.ApiExtension;
        const apiKey = req.query.gemini_key;
        
        const fileName = req.query.ApiFileName;
        const pathFile = req.query.ApiPathFile;
        const selection = req.query.selection || req.query.val;

        // בניית כתובת הבסיס של השרת שלך באופן אוטומטי
        const hostUrl = `https://${req.get('host')}`;

        // --- שלוחה 1: שיחה עם הראשיבע (הקלטה) ---
        if (ext === '1') {
            if (!fileName) {
                if (!apiKey) return res.send('id_list_message=t-שגיאה, מפתח אי פי איי לא הוגדר בשלוחה זו.&hangup=yes');
                
                // יצירת קול אנושי להודעת הפתיחה (נשמר בזיכרון פעם אחת כדי שימות המשיח לא יתנתקו מהמתנה)
                if (!staticPrompts.askQuestion) {
                    staticPrompts.askQuestion = await textToSpeechAndGetUrl("נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.", apiKey);
                    audioCache.set('static_ask', staticPrompts.askQuestion);
                }
                
                // התיקון: קודם id_list_message עם הקול האנושי, ואז פקודת record נקייה להקלטה לקובץ אוטומטי
                const playGreeting = `${hostUrl}/stream_audio/static_ask`;
                return res.send(`id_list_message=${playGreeting}&record=q_${Date.now()},no,3,15`);
            }
            
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, apiKey);
                
                if (!userText || userText.trim() === "") {
                    return res.send('id_list_message=t-לא הצלחתי לשמוע את השאלה ברור. נא לנסות שוב.&go_to_folder=/1');
                }

                // ודא שיש לך אובייקטים אלו מוגדרים איפשהו בקוד הגלובלי שלך
                if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };
                const chosenModel = global.userSettings.models[phone] || 'gemini-2.5-flash';
                const customInstruction = global.userSettings.customInstructions[phone] || '';

                const geminiText = await callGemini(userText, apiKey, chosenModel, customInstruction);
                const cleanText = geminiText.replace(/[*#\-_]/g, '').trim();
                
                // יצירת קול אנושי לתשובה של הבינה המלאכותית
                const base64AudioAnswer = await textToSpeechAndGetUrl(cleanText, apiKey);
                const answerId = 'ans_' + Date.now();
                audioCache.set(answerId, base64AudioAnswer); // שומרים בזיכרון
                
                const playAnswerUrl = `${hostUrl}/stream_audio/${answerId}`;

                // משמיע את התשובה האנושית, וחוזר לשלוחה 1 לעוד שאלה
                return res.send(`playfile=${playAnswerUrl}&go_to_folder=/1`);
            } catch (error) {
                console.error(error);
                return res.send('id_list_message=t-חלה שגיאה בעיבוד הנתונים מול הבינה המלאכותית.&go_to_folder=/1');
            }
        }

        // --- שלוחה 2: הגדרת הנחיית מערכת (הקלטה) ---
        if (ext === '2') {
            if (!apiKey) return res.send('id_list_message=t-שגיאה, מפתח אי פי איי לא הוגדר.&hangup=yes');

            if (!fileName) {
                if (!staticPrompts.systemInst) {
                    staticPrompts.systemInst = await textToSpeechAndGetUrl("נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.", apiKey);
                    audioCache.set('static_inst', staticPrompts.systemInst);
                }
                const playInst = `${hostUrl}/stream_audio/static_inst`;
                return res.send(`id_list_message=${playInst}&record=inst_${Date.now()},no,3,15`);
            }
            
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, apiKey);
                
                if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };
                global.userSettings.customInstructions[phone] = userText;
                
                return res.send('id_list_message=t-הוראות המערכת המותאמות אישית עודכנו בהצלחה.&go_to_folder=/');
            } catch (error) {
                return res.send('id_list_message=t-חלה שגיאה בעיבוד ההקלטה.&go_to_folder=/');
            }
        }

        // --- שלוחה 3: בחירת מודל (הקשת מקשים) ---
        if (ext === '3') {
            if (!apiKey) return res.send('id_list_message=t-שגיאה, מפתח.&hangup=yes');

            if (!selection) {
                if (!staticPrompts.menuMenu) {
                    const menuText = "לבחירת מודל גמיני שתיים נקודה חמש פלאש הקש אחת. לבחירת מודל שלוש נקודה אחת לייט הקש שתיים. לבחירת מודל שלוש נקודה אחת פרו הקש שלוש.";
                    staticPrompts.menuMenu = await textToSpeechAndGetUrl(menuText, apiKey);
                    audioCache.set('static_menu', staticPrompts.menuMenu);
                }
                const playMenu = `${hostUrl}/stream_audio/static_menu`;
                // שימוש בקול האנושי בתוך פקודת ה-read
                return res.send(`read=${playMenu}=selection,no,1,1,7`);
            }
            
            if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };

            if (selection === '1') {
                global.userSettings.models[phone] = 'gemini-2.5-flash';
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שתיים נקודה חמש פלאש.&go_to_folder=/');
            } else if (selection === '2') {
                global.userSettings.models[phone] = 'gemini-3.1-flash'; 
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שלוש נקודה אחת לייט.&go_to_folder=/');
            } else if (selection === '3') {
                global.userSettings.models[phone] = 'gemini-3.1-pro';
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שלוש נקודה אחת פרו.&go_to_folder=/');
            } else {
                return res.send('id_list_message=t-בחירה לא חוקית.&go_to_folder=/3');
            }
        }

        return res.send('id_list_message=t-השלוחה אינה נתמכת בשרת.&hangup=yes');
    });
};

async function speechToTextWithGemini(audioFileUrl, apiKey) {
    try {
        const fileResponse = await axios.get(audioFileUrl, { responseType: 'arraybuffer' });
        const base64Audio = Buffer.from(fileResponse.data, 'binary').toString('base64');
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{
                parts: [
                    { inlineData: { mimeType: "audio/wav", data: base64Audio } },
                    { text: "תמלל במדויק את מה שנאמר בקובץ השמע הזה לעברית. אל תוסיף שום הערה או הסבר, רק את הטקסט הנקי שנאמר." }
                ]
            }]
        };
        
        const response = await axios.post(url, payload);
        return response.data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("STT Error:", e.message);
        return "";
    }
}

async function callGemini(promptText, apiKey, modelName, customInstruction) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    let systemInstruction = "חוקי הגשת הטקסט (קריטי עבור קריין טלפוני): " +
    "אסור לחלוטין להשתמש בסימני עיצוב טקסט כגון כוכביות (*), סולמיות (#), קווים תחתונים (_) או מקפים משולבים. הטקסט חייב להיכתב כפסקאות נקיות ורציפות בלבד. " +
    "השתמש בסימני פיסוק סטנדרטיים (נקודות, פסיקים) בצורה נכונה וטבעית בלבד. אל תכתוב את המילה 'פסיק' או 'נקודה' בטקסט עצמו. " +
    "ספק תשובה מקיפה, מעמיקה ועשירה המפרקת את הנושא לגורמים. התחל את דבריך מיד ללא הקדמות או ברכות. " +
    "זהות המפתח: חברת סמרטאל אפליקציות חכמות. " +
    "זהות המודל: אתה מציג את עצמך כ'הַרֹאּׁשיבֶע'. ";

    if (customInstruction) {
        systemInstruction += `\nהנחיות מהמשתמש שיש לשלב: ${customInstruction}`;
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
        voice: { languageCode: "he-IL", name: "he-IL-Neural2-F" }, 
        audioConfig: { audioEncoding: "MP3" }
    };

    const response = await axios.post(url, payload);
    // התיקון: מחזיר אך ורק את ה-Base64 הנקי (הוסר ה- data:audio/mp3;base64)
    // השרת ישתמש בזה בנתיב החדש כדי לשדר את זה לימות המשיח כקובץ שמע אמיתי
    return response.data.audioContent;
}
