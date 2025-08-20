// index.js (Main Controller)
const express = require('express');
const secrets = require('./secrets.js');
const stateManager = require('./state_manager.js');
const messengerApi = require('./messenger_api.js');
const toolHandlers = require('./tool_handlers.js');
const axios = require('axios'); // Needed for the keep-alive ping

const { VERIFY_TOKEN } = secrets;
const app = express();
app.use(express.json());

// --- Main Menu ---
async function showMainMenu(psid) {
    const menuText = `🤖 Multi-Tool Bot 🤖

What would you like to do?

--- AI Models ---
1. ChatGPT-4o
2. ChatGPT-4.1
3. Grok
12. Claude 3 Haiku 🆕

--- Media Tools ---
4. Facebook Downloader
5. YouTube Downloader
6. TikTok Downloader
7. Pinterest Search
10. Ghibli Image Filter ✨

--- Utility Tools ---
8. Google Search
9. Google Translate
11. AI Text Humanizer ✍️

Just type the number of your choice.`;
    await messengerApi.sendText(psid, menuText);
}

// --- Message Handlers (The "Brain") ---

async function handleTextMessage(psid, message) {
    const messageText = message.text?.trim();
    const lowerCaseText = messageText?.toLowerCase();
    
    const userState = stateManager.getUserState(psid);

    if (lowerCaseText === 'menu') {
        stateManager.clearUserState(psid);
        await showMainMenu(psid);
        return;
    }

    if (userState?.state) {
        // Route to the correct handler based on the user's current state
        switch (userState.state) {
            case 'in_chat':
                handleInChat(psid, lowerCaseText, messageText, userState.model);
                return;
            case 'awaiting_downloader_fb':
            case 'awaiting_downloader_yt':
            case 'awaiting_downloader_tik':
                const platform = userState.state.split('_')[2];
                toolHandlers.handleDownloadRequest(psid, messageText, platform);
                return;
            case 'awaiting_google_query':
                toolHandlers.handleGoogleSearch(psid, messageText);
                return;
            case 'awaiting_pinterest_query':
                stateManager.setUserState(psid, 'awaiting_pinterest_count', { query: messageText });
                await messengerApi.sendText(psid, "Got it. How many images would you like? (e.g., 5)");
                return;
            case 'awaiting_pinterest_count':
                toolHandlers.handlePinterestSearch(psid, userState.query, messageText);
                return;
            case 'awaiting_translate_text':
                stateManager.setUserState(psid, 'awaiting_translate_lang', { text: messageText });
                await messengerApi.sendText(psid, "Got it. Now, what language should I translate it to? (e.g., 'en' for English)");
                return;
            case 'awaiting_translate_lang':
                toolHandlers.handleTranslateRequest(psid, userState.text, messageText);
                return;
            case 'awaiting_humanizer_text':
                toolHandlers.handleHumanizerRequest(psid, messageText);
                return;
        }
    }

    // If no state, handle as a menu selection
    handleMenuSelection(psid, lowerCaseText);
}

async function handleImageAttachment(psid, imageUrl) {
    const userState = stateManager.getUserState(psid);
    if (userState?.state === 'awaiting_ghibli_image') {
        toolHandlers.handleGhibliRequest(psid, imageUrl);
    } else {
        await messengerApi.sendText(psid, "I see you've sent an image, but I'm not sure what to do with it. Please select an option from the menu first.");
    }
}

// --- Logic Handlers for Conversation Flow ---

function handleMenuSelection(psid, choice) {
    switch (choice) {
        case '1': case '2': case '3': case '12':
            handleAiSelection(psid, choice);
            break;
        case '4': case '5': case '6':
            handleDownloaderSelection(psid, choice);
            break;
        case '7':
            stateManager.setUserState(psid, 'awaiting_pinterest_query');
            messengerApi.sendText(psid, "✅ Pinterest Search selected. What do you want to search for?");
            break;
        case '8':
            stateManager.setUserState(psid, 'awaiting_google_query');
            messengerApi.sendText(psid, "✅ Google Search selected. What do you want to search for?");
            break;
        case '9':
            stateManager.setUserState(psid, 'awaiting_translate_text');
            messengerApi.sendText(psid, "✅ Google Translate selected. What text would you like to translate?");
            break;
        case '10':
            stateManager.setUserState(psid, 'awaiting_ghibli_image');
            messengerApi.sendText(psid, "✅ Ghibli Filter selected. Please send an image you want to transform!");
            break;
        case '11':
            stateManager.setUserState(psid, 'awaiting_humanizer_text');
            messengerApi.sendText(psid, "✅ AI Text Humanizer selected. Please send the AI-generated text you want me to convert.");
            break;
        default:
            showMainMenu(psid);
            break;
    }
}

function handleAiSelection(psid, choice) {
    let model, modelName;
    if (choice === '1') { model = 'gpt4o'; modelName = 'ChatGPT-4o'; }
    if (choice === '2') { model = 'gpt4-1'; modelName = 'ChatGPT-4.1'; }
    if (choice === '3') { model = 'grok'; modelName = 'Grok'; }
    if (choice === '12') { model = 'claude'; modelName = 'Claude 3 Haiku'; }
    stateManager.setUserState(psid, 'in_chat', { model });
    messengerApi.sendText(psid, `✅ You are now chatting with ${modelName}. Ask me anything!\n\n(Type 'switch' or 'exit' at any time.)`);
}

function handleDownloaderSelection(psid, choice) {
    let state, platformName;
    if (choice === '4') { state = 'awaiting_downloader_fb'; platformName = 'Facebook'; }
    if (choice === '5') { state = 'awaiting_downloader_yt'; platformName = 'YouTube'; }
    if (choice === '6') { state = 'awaiting_downloader_tik'; platformName = 'TikTok'; }
    stateManager.setUserState(psid, state);
    messengerApi.sendText(psid, `✅ ${platformName} Downloader selected. Please send me the full video URL.`);
}

function handleInChat(psid, lowerCaseText, originalText, model) {
    if (lowerCaseText === 'switch') {
        stateManager.clearUserState(psid);
        messengerApi.sendText(psid, "🔄 Switching tasks...");
        showMainMenu(psid);
    } else if (lowerCaseText === 'exit') {
        stateManager.clearUserState(psid);
        messengerApi.sendText(psid, "✅ You have exited the chat session. Type 'menu' to start again.");
    } else {
        toolHandlers.forwardToAI(psid, originalText, model);
    }
}

// --- Server and Webhook Setup ---
app.get('/', (req, res) => {
    res.status(200).send('✅ Multi-Tool Bot is online and healthy.');
});

app.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', (req, res) => {
    if (req.body.object === 'page') {
        req.body.entry.forEach(entry => {
            const event = entry.messaging[0];
            if (event?.sender?.id && event.message) {
                if (event.message.text) {
                    handleTextMessage(event.sender.id, event.message);
                } else if (event.message.attachments?.[0]?.type === 'image') {
                    const imageUrl = event.message.attachments[0].payload.url;
                    handleImageAttachment(event.sender.id, imageUrl);
                }
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`✅ Multi-Tool test bot is listening on port ${PORT}.`));

// --- API KEEPALIVE FUNCTION ---
async function keepApiKeyActive() {
    try {
        const apiKey = "732ce71f-4761-474d-adf2-5cd2d315ad18";
        const pingUrl = `https://kaiz-apis.gleeze.com/api/humanizer`;
        const payload = { q: "Hello", apikey: apiKey };
        console.log("Pinging Humanizer API to keep key active...");
        const response = await axios.post(pingUrl, payload);
        if (response.data && response.data.response) {
            console.log("✅ Humanizer API ping successful.");
        } else {
            console.warn("⚠️ Humanizer API ping returned an unexpected response, but was likely successful:", response.data);
        }
    } catch (error) {
        console.error("❌ Humanizer API ping failed:", error.message);
    }
}

const threeDaysInMs = 259200000;
server.on('listening', () => {
    keepApiKeyActive();
    setInterval(keepApiKeyActive, threeDaysInMs);
});
