const axios = require('axios');

module.exports = function(app) {
    
    app.get('/answer', async (req, res) => {
        let phone = req.query.ApiPhone || 'unknown';
        if (phone.startsWith('972')) { phone = '0' + phone.substring(3); }
        
        const ext = req.query.ApiExtension;
        const apiKey = req.query.gemini_key;
        
        // ימות המשיח שולחים את שם הקובץ רק לאחר שההקלטה מסתיימת
        const fileName = req.query.ApiFileName;
        const pathFile = req.query.ApiPathFile;
        const selection = req.query.user_digits_input || req.query.val;

        // --- שלוחה 1: שיחה עם הראשיבע (הקלטה) ---
        if (ext === '1') {
            if (!fileName) {
                // תיקון הפורמט: בדיוק 6 פרמטרים לפי הדרישה של ימות המשיח. 10 שניות המתנה, מקסימום 120, 5 שניות שתיקה לניתוק, וצפצוף (yes)
                return res.send('record=t-נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.=user_file,10,120,5,yes,no');
            }
            
            if (!apiKey) return res.send('id_list_message=t-שגיאה, מפתח אי פי איי לא הוגדר בשלוחה זו.&hangup=yes');
            
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, apiKey);
                
                if (!userText || userText.trim() === "") {
                    return res.send('id_list_message=t-לא הצלחתי לשמוע את השאלה ברור. נא לנסות שוב.&go_to_folder=/1');
                }

                const chosenModel = global.userSettings.models[phone] || 'gemini-2.5-flash';
                const customInstruction = global.userSettings.customInstructions[phone] || '';

                const geminiText = await callGemini(userText, apiKey, chosenModel, customInstruction);
                const cleanText = geminiText.replace(/[*#\-_]/g, '').trim();
                const audioUrl = await textToSpeechAndGetUrl(cleanText, apiKey);

                return res.send(`playfile=${audioUrl}&go_to_folder=/1`);
            } catch (error) {
                console.error(error);
                return res.send('id_list_message=t-חלה שגיאה בעיבוד הנתונים מול הבינה המלאכותית.&go_to_folder=/1');
            }
        }

        // --- שלוחה 2: הגדרת הנחיית מערכת (הקלטה) ---
        if (ext === '2') {
            if (!fileName) {
                return res.send('record=t-נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.=user_file,10,120,5,yes,no');
            }
            
            if (!apiKey) return res.send('id_list_message=t-שגיאה, מפתח אי פי איי לא הוגדר.&hangup=yes');

            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, apiKey);
                
                global.userSettings.customInstructions[phone] = userText;
                return res.send('id_list_message=t-הוראות המערכת המותאמות אישית עודכנו בהצלחה.&go_to_folder=/');
            } catch (error) {
                return res.send('id_list_message=t-חלה שגיאה בעיבוד ההקלטה.&go_to_folder=/');
            }
        }

        // --- שלוחה 3: בחירת מודל (הקשת מקשים) ---
        if (ext === '3') {
            if (!selection) {
                return res.send('read=t-לבחירת מודל גמיני שתיים נקודה חמש פלאש הקש אחת. לבחירת מודל שלוש נקודה אחת לייט הקש שתיים. לבחירת מודל שלוש נקודה אחת פרו הקש שלוש.=user_digits_input,1,1,7,3,Number,no');
            }
            
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
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const audioContent = response.data.audioContent;
    return `data:audio/mp3;base64,${audioContent}`;
}
