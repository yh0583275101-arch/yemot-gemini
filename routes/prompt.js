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
