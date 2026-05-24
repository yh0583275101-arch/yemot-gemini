const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { EdgeTTS } = require('edge-tts');

router.get('/', async (req, res) => {
    const { ApiCallId, user_audio, next_action, gemini_key, groq_key, yemot_token } = req.query;

    if (!global.sessions[ApiCallId]) {
        global.sessions[ApiCallId] = { history: [] };
    }

    // שלב 1: שלום ראשוני בקול הקריין ובקשת הקלטה מהמשתמש
    if (!user_audio && !next_action) {
        return res.send('read=f-greeting=user_audio,,record,10,60,no,yes,yes');
    }

    // שלב 2: הלקוח הקליט שאלה, כעת נוריד, נתמלל, נשאל AI ונקריא
    if (user_audio) {
        try {
            // 1. הורדת קובץ האודיו מימות המשיח
            const fileUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${yemot_token}&path=${user_audio}`;
            const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });

            // 2. תמלול דרך Groq (חינם, Whisper)
            const groq = new Groq({ apiKey: groq_key });
            const formData = new FormData();
            formData.append('file', audioRes.data, { filename: 'audio.wav' });
            formData.append('model', 'whisper-large-v3');
            
            const transcription = await groq.audio.transcriptions.create({
                file: audioRes.data,
                model: 'whisper-large-v3'
            });
            const userText = transcription.text;

            // 3. שליחה למודל ה-AI שנבחר
            let aiText = "";
            global.sessions[ApiCallId].history.push({ role: 'user', content: userText });

            if (global.selectedModel === 'gemini') {
                const genAI = new GoogleGenerativeAI(gemini_key);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: global.systemPrompt });
                const result = await model.generateContent(global.sessions[ApiCallId].history.map(h => h.content).join("\n"));
                aiText = result.response.text();
            } else {
                const modelName = global.selectedModel === 'llama_lite' ? 'llama-3.1-8b-instant' : 'llama-3.1-70b-versatile';
                const messages = [{ role: 'system', content: global.systemPrompt }, ...global.sessions[ApiCallId].history];
                const chatCompletion = await groq.chat.completions.create({ messages, model: modelName });
                aiText = chatCompletion.choices.message.content;
            }

            global.sessions[ApiCallId].history.push({ role: 'assistant', content: aiText });

            // 4. המרת התשובה לקול (TTS) עם מנוע Edge בחינם
            const tts = new EdgeTTS();
            await tts.voice('he-IL-AvriNeural'); // קול גברי צעיר וטבעי
            const audioBuffer = await tts.synthesize(aiText);

            // 5. העלאת קובץ התשובה הקולי לימות המשיח
            const uploadForm = new FormData();
            uploadForm.append('token', yemot_token);
            uploadForm.append('path', 'ivr2:/1/ai_answer.mp3');
            uploadForm.append('file', audioBuffer, { filename: 'ai_answer.mp3' });
            await axios.post('https://www.call2all.co.il/ym/api/UploadFile', uploadForm, { headers: uploadForm.getHeaders() });

            // 6. השמעת התשובה ותפריט המשך
            return res.send('read=f-ai_answer.f-options=next_action,,1,1,7,Digits,yes,no');
            
        } catch (error) {
            console.error(error);
            return res.send('id_list_message=f-error_msg&go_to_folder=/');
        }
    }

    // שלב 3: תפריט המשך אחרי התשובה
    if (next_action) {
        if (next_action === '1') { // שאלה נוספת
            return res.send('read=f-ask_again=user_audio,,record,10,60,no,yes,yes');
        } else if (next_action === '2') { // שמיעה חוזרת של התשובה
            return res.send('read=f-ai_answer.f-options=next_action,,1,1,7,Digits,yes,no');
        } else {
            return res.send('go_to_folder=/');
        }
    }
});

module.exports = router;
4. בתיקיית routes, צור קובץ prompt.js (שלוחה 2 - עדכון הנחיית מערכת)
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Groq = require('groq-sdk');
const FormData = require('form-data');

router.get('/', async (req, res) => {
    const { prompt_audio, groq_key, yemot_token } = req.query;

    if (!prompt_audio) {
        // בקשת הקלטה מהמנהל להנחיית המערכת החדשה
        return res.send('read=f-record_prompt=prompt_audio,,record,10,60,no,yes,yes');
    }

    if (prompt_audio) {
        try {
            // הורדה ותמלול בחינם דרך גרוק
            const fileUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${yemot_token}&path=${prompt_audio}`;
            const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            
            const groq = new Groq({ apiKey: groq_key });
            const formData = new FormData();
            formData.append('file', audioRes.data, { filename: 'audio.wav' });
            formData.append('model', 'whisper-large-v3');
            
            const transcription = await groq.audio.transcriptions.create({
                file: audioRes.data,
                model: 'whisper-large-v3'
            });

            // עדכון המשתנה הגלובלי בשרת והוספת הוראות הפיסוק הקשיחות
            global.systemPrompt = transcription.text + " הוראת חובה: אסור להשתמש בכוכביות, סולמיות או סימנים. פסק עם נקודות ופסיקים כדי שהקריין ינשום.";
            
            return res.send('id_list_message=f-prompt_saved&go_to_folder=/');
        } catch (err) {
            return res.send('id_list_message=f-error_msg&go_to_folder=/');
        }
    }
});

module.exports = router;
