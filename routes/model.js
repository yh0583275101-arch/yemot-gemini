const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    const { model_choice } = req.query;

    if (!model_choice) {
        return res.send('read=f-menu_model=model_choice,,1,1,7,Digits,yes,no');
    }

    if (model_choice === '1') global.selectedModel = 'gemini';
    else if (model_choice === '2') global.selectedModel = 'llama_lite';
    else if (model_choice === '3') global.selectedModel = 'llama_pro';

    return res.send('id_list_message=f-model_updated&go_to_folder=/');
});

module.exports = router;
