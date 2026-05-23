const express = require('express'); 
const axios = require('axios');
const { MsEdgeTTS } = require('msedge-tts'); 

const audioCache = new Map();
const staticPrompts = {};

module.exports = function(app) {
    
    app.get('/stream_audio/:id', (req, res) => {
        const base64Audio = audioCache.get(req.params.id);
        if (!base64Audio) return res.send('playfile=000'); 
        const buffer = Buffer.from(base64Audio, 'base64');
        res.set('Content-Type', 'audio/mp3');
        res.send(buffer);
        if (!req.params.id.startsWith('static_')) {
            audioCache.delete(req.params.id);
        }
    });

    app.get('/answer', async (req, res) => {
        
        // תיקון קריטי: עוצר את השרת אם השיחה נותקה כדי למנוע לולאות
        if (req.query.hangup === 'yes') {
            return res.send('');
        }

        let phone = req.query.ApiPhone || 'unknown';
        if (phone.startsWith('972')) { phone = '0' + phone.substring(3); }
        
        const ext = req.query.ApiExtension;
        const geminiKey = req.query.gemini_key;
        
        const fileName = req.query.ApiFileName;
        const pathFile = req.query.ApiPathFile;
        const selection = req.query.selection || req.query.val;

        const hostUrl = `https://${req.get('host')}`;

        // --- שלוחה 1: שיחה עם הראשיבע (הקלטה) ---
        if (ext === '1') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח גמיני לא הוגדר בשלוחה זו.&hangup=yes');
            
            if (!fileName) {
                try {
                    if (!staticPrompts.askQuestion) {
                        staticPrompts.askQuestion = await textToSpeechAndGetUrl("נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.");
                        audioCache.set('static_ask', staticPrompts.askQuestion);
                    }
                    const playGreeting = `${hostUrl}/stream_audio/static_ask`;
                    // התיקון: משמיע את הקול האנושי (playfile) ומקליט לקובץ אוטומטי (ללא שם בעייתי)
                    return res.send(`playfile=${playGreeting}&record=,no,3,15`);
                } catch (error) {
                    console.log("TTS Error:", error.message);
                    // במקרה של שגיאה - יושמע הקול הרובוטי והקלטה אוטומטית
                    return res.send(`id_list_message=t-נא לומר את השאלה לאחר הצליל וללחוץ סולמית בסיום.&record=,no,3,15`);
                }
            }
            
            try {
                const fileUrl = `https://call.yemot.co.il/api/get_file?path=${pathFile}/${fileName}`;
                const userText = await speechToTextWithGemini(fileUrl, geminiKey);
                
                if (!userText || userText.trim() === "") {
                    return res.send('id_list_message=t-לא הצלחתי לשמוע את השאלה ברור. נא לנסות שוב.&go_to_folder=/1');
                }

                if (!global.userSettings) global.userSettings = { models: {}, customInstructions: {} };
                const chosenModel = global.userSettings.models[phone] || 'gemini-1.5-flash';
                const customInstruction = global.userSettings.customInstructions[phone] || '';

                const geminiText = await callGemini(userText, geminiKey, chosenModel, customInstruction);
                const cleanText = geminiText.replace(/[*#\-_]/g, '').trim();
                
                try {
                    const base64AudioAnswer = await textToSpeechAndGetUrl(cleanText);
                    const answerId = 'ans_' + Date.now();
                    audioCache.set(answerId, base64AudioAnswer); 
                    const playAnswerUrl = `${hostUrl}/stream_audio/${answerId}`;
                    return res.send(`playfile=${playAnswerUrl}&go_to_folder=/1`);
                } catch (error) {
                    return res.send(`id_list_message=t-${cleanText}&go_to_folder=/1`);
                }

            } catch (error) {
                console.error("Error with Gemini:", error.message);
                return res.send('id_list_message=t-חלה שגיאה בעיבוד הנתונים מול הבינה המלאכותית.&go_to_folder=/1');
            }
        }

        // --- שלוחה 2: הגדרת הנחיית מערכת (הקלטה) ---
        if (ext === '2') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח גמיני לא הוגדר.&hangup=yes');

            if (!fileName) {
                try {
                    if (!staticPrompts.systemInst) {
                        staticPrompts.systemInst = await textToSpeechAndGetUrl("נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.");
                        audioCache.set('static_inst', staticPrompts.systemInst);
                    }
                    const playInst = `${hostUrl}/stream_audio/static_inst`;
                    return res.send(`playfile=${playInst}&record=,no,3,15`);
                } catch (error) {
                     return res.send(`id_list_message=t-נא לומר כעת את הוראות המערכת המותאמות אישית עבורך וללחוץ סולמית בסיום.&record=,no,3,15`);
                }
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

        // --- שלוחה 3: בחירת מודל (הקשת מקשים) ---
        if (ext === '3') {
            if (!geminiKey) return res.send('id_list_message=t-שגיאה, מפתח.&hangup=yes');
            const menuText = "לבחירת מודל גמיני שתיים נקודה חמש פלאש הקש אחת. לבחירת מודל שלוש נקודה אחת לייט הקש שתיים. לבחירת מודל שלוש נקודה אחת פרו הקש שלוש.";

            if (!selection) {
                try {
                    if (!staticPrompts.menuMenu) {
                        staticPrompts.menuMenu = await textToSpeechAndGetUrl(menuText);
                        audioCache.set('static_menu', staticPrompts.menuMenu);
                    }
                    const playMenu = `${hostUrl}/stream_audio/static_menu`;
                    return res.send(`read=${playMenu}=selection,no,1,1,7`);
                } catch (error) {
                     return res.send(`read=t-${menuText}=selection,no,1,1,7`);
                }
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
    let systemInstruction = "חוקי הגשת הטקסט: אסור לחלוטין להשתמש בסימני עיצוב טקסט כגון כוכביות, סולמיות, קווים תחתונים וכו. כתוב בפסקאות נקיות. השתמש בסימני פיסוק טבעיים. ענה מיד ולעניין. זהותך: 'הראשיבע'. ";
    if (customInstruction) systemInstruction += `\nהנחיות מהמשתמש שיש לשלב: ${customInstruction}`;

    const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
    };
    const response = await axios.post(url, payload);
    return response.data.candidates[0].content.parts[0].text;
}

// ==========================================
// פונקציית הקול - מיקרוסופט אברי (חינם)
// ==========================================
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
