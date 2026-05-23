const express = require('express'); 
const axios = require('axios');
const { MsEdgeTTS } = require('msedge-tts'); 

const audioCache = new Map();

module.exports = function(app) {
    
    app.get('/stream_audio/:id', (req, res) => {
        const base64Audio = audioCache.get(req.params.id);
        if (!base64Audio) return res.send('playfile=000'); 
        const buffer = Buffer.from(base64Audio, 'base64');
        res.set('Content-Type', 'audio/mp3');
        res.send(buffer);
    });

    app.get('/answer', async (req, res) => {
        
        // עצירת לולאות ניתוק
        if (req.query.hangup === 'yes') return res.send('');

        let phone = req.query.ApiPhone || 'unknown';
        if (phone.startsWith('972')) { phone = '0' + phone.substring(3); }
        
        const ext = req.query.ApiExtension;
        
        // ניקוי המפתח מהבאג של ימות המשיח
        let geminiKey = req.query.gemini_key;
        if (geminiKey && geminiKey.includes('?')) {
            geminiKey = geminiKey.split('?')[0]; 
        }
        
        const fileName = req.query.ApiFileName;
        const pathFile = req.query.ApiPathFile;
        const selection = req.query.selection || req.query.val;

        const hostUrl = `https://${req.get('host')}`;

        // --- שלוחה 1: שיחה עם הראשיבע ---
        if (ext === '1') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח גמיני לא הוגדר בשלוחה זו.&hangup=yes');
            
            // שלב א': הלקוח רק נכנס, נשמיע הודעה (בקול ימות כדי שהצפצוף יעבוד) ונקליט
            if (!fileName) {
                // יצירת שם קובץ חוקי לימות המשיח (בלי קווים תחתונים!)
                const recordFileName = 'q' + Date.now();
                return res.send(`id_list_message=t-נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.&record=${recordFileName},no,3,15`);
            }
            
            // שלב ב': הלקוח דיבר! מעבדים את השאלה
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, geminiKey);
                
                if (!userText || userText.trim() === "") {
                    return res.send('id_list_message=t-לא הצלחתי לשמוע את השאלה ברור. נא לנסות שוב.&go_to_folder=/1');
                }

                if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };
                const chosenModel = global.userSettings.models[phone] || 'gemini-2.5-flash';
                const customInstruction = global.userSettings.customInstructions[phone] || '';

                const geminiText = await callGemini(userText, geminiKey, chosenModel, customInstruction);
                const cleanText = geminiText.replace(/[*#\-_]/g, '').trim();
                
                // שלב ג': ג'מיני ענה, נייצר קול אנושי של אברי ונשלח לימות המשיח!
                try {
                    const base64AudioAnswer = await textToSpeechAndGetUrl(cleanText);
                    const answerId = 'ans' + Date.now();
                    audioCache.set(answerId, base64AudioAnswer); 
                    
                    // מוחק מהזיכרון אחרי 3 דקות שלא יתמלא השרת
                    setTimeout(() => audioCache.delete(answerId), 180000);

                    const playAnswerUrl = `${hostUrl}/stream_audio/${answerId}`;
                    // משמיע את התשובה האנושית ואז חוזר מיד לתחילת השלוחה לעוד שאלה
                    return res.send(`playfile=${playAnswerUrl}&go_to_folder=/1`);
                } catch (error) {
                    // אם יצירת הקול נכשלה - הראשיבע יענה בקול הרובוטי
                    return res.send(`id_list_message=t-${cleanText}&go_to_folder=/1`);
                }

            } catch (error) {
                console.error("Error with Gemini:", error.message);
                return res.send('id_list_message=t-חלה שגיאה בעיבוד הנתונים מול הבינה המלאכותית.&go_to_folder=/1');
            }
        }

        // --- שלוחה 2: הגדרת הנחיית מערכת ---
        if (ext === '2') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח גמיני לא הוגדר.&hangup=yes');
            if (!fileName) {
                const recordFileName = 'inst' + Date.now();
                return res.send(`id_list_message=t-נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.&record=${recordFileName},no,3,15`);
            }
            
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, geminiKey);
                
                if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };
                global.userSettings.customInstructions[phone] = userText;
                
                return res.send('id_list_message=t-הוראות המערכת המותאמות אישית עודכנו בהצלחה.&go_to_folder=/');
            } catch (error) {
                return res.send('id_list_message=t-חלה שגיאה בעיבוד ההקלטה.&go_to_folder=/');
            }
        }

        // --- שלוחה 3: בחירת מודל ---
        if (ext === '3') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח.&hangup=yes');
            if (!selection) {
                const menuText = "לבחירת מודל גמיני שתיים נקודה חמש פלאש הקש אחת. לבחירת מודל שלוש נקודה אחת לייט הקש שתיים. לבחירת מודל שלוש נקודה אחת פרו הקש שלוש.";
                return res.send(`read=t-${menuText}=selection,no,1,1,7`);
            }
            
            if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };

            if (selection === '1') {
                global.userSettings.models[phone] = 'gemini-2.5-flash';
                return res.send('id_list_message=t-המודל עודכן בהצלחה לגמיני שתיים נקודה חמש פלאש.&go_to_folder=/');
            } else if (selection === '2') {
                global.userSettings.models[phone] = 'gemini-3.5-flash'; 
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
}

async function callGemini(promptText, apiKey, modelName, customInstruction) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    let systemInstruction = "חוקי הגשת הטקסט (קריטי עבור קריין טלפוני): " +
    "אסור לחלוטין להשתמש בסימני עיצוב טקסט כגון כוכביות (*), סולמיות (#), קווים תחתונים (_) או מקפים משולבים. הטקסט חייב להיכתב כפסקאות נקיות ורציפות בלבד. " +
    "השתמש בסימני פיסוק סטנדרטיים (נקודות, פסיקים) בצורה נכונה וטבעית בלבד. אל תכתוב את המילה 'פסיק' או 'נקודה' בטקסט עצמו. " +
    "ספק תשובה מקיפה, מעמיקה ועשירה המפרקת את הנושא לגורמים. התחל את דבריך מיד ללא הקדמות או ברכות. " +
    "זהות המפתח: חברת סמרטאל אפליקציות חכמות. " +
    "זהות המודל: אתה מציג את עצמך כ'הַרֹאּׁשיבֶע'. ";
    if (customInstruction) systemInstruction += `\nהנחיות מהמשתמש שיש לשלב: ${customInstruction}`;

    const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
    };
    const response = await axios.post(url, payload);
    return response.data.candidates[0].content.parts[0].text;
}

// פונקציית הקול - מיקרוסופט אברי (חינם)
async function textToSpeechAndGetUrl(textToSpeak) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata('he-IL-AvriNeural', 'audio-24khz-48kbitrate-mono-mp3');
    
    const stream = tts.toStream(textToSpeak);
    const chunks = [];
    
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    
    return Buffer.concat(chunks).toString('base64');
}
