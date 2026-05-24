const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { EdgeTTS } = require('edge-tts');

router.get('/', async (req, res) => {
    if (req.query.hangup === 'yes') {
        return res.send('OK');
    }

    const { ApiCallId, user_audio, next_action, gemini_key, groq_key, yemot_token } = req.query;

    if (!global.sessions) {
        global.sessions = {};
    }

    if (!global.sessions[ApiCallId]) {
        global.sessions[ApiCallId] = { history: [] };
    }

    if (!user_audio && !next_action) {
        return res.send('read=f-greeting=user_audio,,record,10,60,no,yes,yes');
    }

    if (user_audio) {
        try {
            const fileUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${yemot_token}&path=${user_audio}`;
            const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });

            const groq = new Groq({ apiKey: groq_key });
            const formData = new FormData();
            formData.append('file', audioRes.data, { filename: 'audio.wav' });
            formData.append('model', 'whisper-large-v3');
            
            const transcription = await groq.audio.transcriptions.create({
                file: audioRes.data,
                model: 'whisper-large-v3'
            });
            const userText = transcription.text;

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

            const tts = new EdgeTTS();
            await tts.voice('he-IL-AvriNeural'); 
            const audioBuffer = await tts.synthesize(aiText);

            const uploadForm = new FormData();
            uploadForm.append('token', yemot_token);
            uploadForm.append('path', 'ivr2:/1/ai_answer.mp3');
            uploadForm.append('file', audioBuffer, { filename: 'ai_answer.mp3' });
            await axios.post('https://www.call2all.co.il/ym/api/UploadFile', uploadForm, { headers: uploadForm.getHeaders() });

            return res.send('read=f-ai_answer.f-options=next_action,,1,1,7,Digits,yes,no');
            
        } catch (error) {
            console.error(error);
            return res.send('id_list_message=f-error_msg&go_to_folder=/');
        }
    }

    if (next_action) {
        if (next_action === '1') { 
            return res.send('read=f-ask_again=user_audio,,record,10,60,no,yes,yes');
        } else if (next_action === '2') { 
            return res.send('read=f-ai_answer.f-options=next_action,,1,1,7,Digits,yes,no');
        } else {
            return res.send('go_to_folder=/');
        }
    }
});

module.exports = router;
