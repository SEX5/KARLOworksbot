// index.js (Main Controller - Final Version with All Enhancements)
const express = require('express');
const secrets = require('./secrets.js');
const stateManager = require('./state_manager.js');
const messengerApi = require('./messenger_api.js');
const toolHandlers = require('./tool_handlers.js');
const axios = require('axios');

const { VERIFY_TOKEN } = secrets;
const app = express();
app.use(express.json());

// --- Main Menu ---
async function showMainMenu(psid) {
    const menuText = `🤖 Multi-Tool Bot 🤖

What would you like to do?

--- AI Models ---
1. OpenRouter (Official API)
2. GPT-4o (Advanced)
3. Grok
4. Claude 3 Haiku
5. O3 Mini
6. ChatGot.io (Memory)
7. Gemini Pro (Memory)
8. Kaiz AI (Vision & Memory)

--- Media Tools ---
9. Facebook Downloader
10. YouTube Downloader
11. TikTok Downloader
12. Pinterest Search
13. Ghibli Image Filter ✨
14. Anime Heaven Downloader
15. Spotify Search 🎵

--- Utility Tools ---
16. Google Search 🔍 (AI-powered analysis & summaries)
17. Google Translate
18. AI Text Humanizer ✍️

Just type the number of your choice.`;
    await messengerApi.sendText(psid, menuText);
}

// --- Updated OpenRouter Sub-Menu ---
async function showVisionOpenRouterMenu(psid) {
    const menuText = `🧠 OpenRouter Model Selection 🧠

All models below have conversation memory and support image viewing! 🖼️

Please choose a model:

1. Llama 3.3 (70B)
2. Qwen 2.5 (72B) - Vision Model
3. GLM-4.5-air - Vision Model
4. Kimi K2
5. GPT-OSS (20B)
6. Llama 4 Maverick (8B)
7. DeepSeek R1

Note: All models can view and analyze images you send during conversation.`;
    await messengerApi.sendText(psid, menuText);
}


// --- Message Handlers ---
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
        switch (userState.state) {
            case 'in_chat':
                handleInChat(psid, lowerCaseText, messageText, userState.model, userState.roleplay, userState.system);
                return;
            case 'awaiting_openrouter_model':
                handleOpenRouterModelSelection(psid, lowerCaseText);
                return;
            case 'awaiting_openrouter_system':
                handleOpenRouterSystemPrompt(psid, messageText, userState.model);
                return;
            case 'awaiting_gpt4o_roleplay':
                handleGpt4oRoleplay(psid, messageText);
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
            case 'awaiting_anime_title':
                stateManager.setUserState(psid, 'awaiting_anime_episode', { title: messageText });
                await messengerApi.sendText(psid, "Got it. Now, what episode number would you like?");
                return;
            case 'awaiting_anime_episode':
                toolHandlers.handleAnimeHeavenRequest(psid, userState.title, messageText);
                return;
            case 'awaiting_spotify_query':
                toolHandlers.handleSpotifySearch(psid, messageText);
                return;
            case 'awaiting_search_refinement':
                handleSearchRefinement(psid, messageText);
                return;
        }
    }

    handleMenuSelection(psid, lowerCaseText);
}

async function handleImageAttachment(psid, imageUrl) {
    const userState = stateManager.getUserState(psid);
    if (userState?.state === 'in_chat') {
        // Check if model is an OpenRouter model or Kaiz (which also supports images)
        if (userState.model.includes('/') || userState.model === 'kaiz') {
            let aiName = userState.model.includes('/') ? 
                userState.model.split('/')[1].split(':')[0] : 
                'Kaiz AI';
                
            await messengerApi.sendText(psid, `🖼️ Image received! Analyzing with ${aiName}...`);
            toolHandlers.forwardToAI(psid, "What do you see in this image?", userState.model, '', imageUrl, userState.system);
        } 
        else {
            await messengerApi.sendText(psid, "⚠️ This AI model doesn't support image viewing. Please use an OpenRouter model or Kaiz AI for image analysis.");
        }
    } 
    else if (userState?.state === 'awaiting_ghibli_image') {
        toolHandlers.handleGhibliRequest(psid, imageUrl);
    } else {
        await messengerApi.sendText(psid, "I see you've sent an image, but I'm not sure what to do with it. Please select an option from the menu first or in an active chat with a model that supports images.");
    }
}


// --- Logic Handlers for Conversation Flow ---
function handleMenuSelection(psid, choice) {
    switch (choice) {
        // AI Models
        case '1':
            stateManager.setUserState(psid, 'awaiting_openrouter_model');
            showVisionOpenRouterMenu(psid);
            break;
        case '2':
            stateManager.setUserState(psid, 'awaiting_gpt4o_roleplay');
            messengerApi.sendText(psid, "🚀 Advanced GPT-4o selected.\nYou can set a custom roleplay for the AI (e.g., 'You are a helpful pirate'). Or, type 'skip' to use the default.");
            break;
        case '3': handleAiSelection(psid, 'grok'); break;
        case '4': handleAiSelection(psid, 'claude'); break;
        case '5': handleAiSelection(psid, 'o3mini'); break;
        case '6': handleAiSelection(psid, 'chatgot'); break;
        case '7': handleAiSelection(psid, 'geminipro'); break;
        case '8': handleAiSelection(psid, 'kaiz'); break;
        
        // Media Tools
        case '9': handleDownloaderSelection(psid, 'fb'); break;
        case '10': handleDownloaderSelection(psid, 'yt'); break;
        case '11': handleDownloaderSelection(psid, 'tik'); break;
        case '12':
            stateManager.setUserState(psid, 'awaiting_pinterest_query');
            messengerApi.sendText(psid, "✅ Pinterest Search selected. What do you want to search for?");
            break;
        case '13':
            stateManager.setUserState(psid, 'awaiting_ghibli_image');
            messengerApi.sendText(psid, "✅ Ghibli Filter selected. Please send an image you want to transform!");
            break;
        case '14':
            stateManager.setUserState(psid, 'awaiting_anime_title');
            messengerApi.sendText(psid, "✅ Anime Heaven selected. What is the title of the anime?");
            break;
        case '15':
            stateManager.setUserState(psid, 'awaiting_spotify_query');
            messengerApi.sendText(psid, "✅ Spotify Search selected. What song or artist?");
            break;

        // Utility Tools
        case '16':
            stateManager.setUserState(psid, 'awaiting_google_query');
            messengerApi.sendText(psid, "✅ Enhanced Google Search selected with AI analysis.\n\nWhat would you like to search for?");
            break;
        case '17':
            stateManager.setUserState(psid, 'awaiting_translate_text');
            messengerApi.sendText(psid, "✅ Google Translate selected. What text would you like to translate?");
            break;
        case '18':
            stateManager.setUserState(psid, 'awaiting_humanizer_text');
            messengerApi.sendText(psid, "✅ AI Text Humanizer selected. Please send the text to convert.");
            break;
        default:
            showMainMenu(psid);
            break;
    }
}

function handleOpenRouterModelSelection(psid, choice) {
    let model;
    switch (choice) {
        case '1': model = 'meta-llama/llama-3.3-70b-instruct:free'; break;
        case '2': model = 'qwen/qwen2.5-vl-72b-instruct:free'; break;
        case '3': model = 'z.ai/glm-4.5-air:free'; break;
        case '4': model = 'moonshotai/kimi-k2:free'; break;
        case '5': model = 'openai/gpt-oss-20b:free'; break;
        case '6': model = 'meta-llama/llama-4-maverick:free'; break;
        case '7': model = 'deepseek/deepseek-r1-0528:free'; break;
        default:
            messengerApi.sendText(psid, "Invalid selection. Please choose a number from the list.");
            return;
    }
    
    stateManager.setUserState(psid, 'awaiting_openrouter_system', { model });
    
    // Provide model-specific information
    let modelName = model.split('/')[1].split(':')[0];
    
    messengerApi.sendText(psid, `✅ ${modelName} selected.\n🖼️ This model supports image viewing!\n\nNow, please provide a system prompt (e.g., "You are a friendly assistant"). Or, type 'skip' for the default.`);
}

function handleOpenRouterSystemPrompt(psid, text, model) {
    const system = text.toLowerCase() === 'skip' ? '' : text;
    stateManager.setUserState(psid, 'in_chat', { model, system });
    let modelFriendlyName = model.split('/')[1].split(':')[0];
    
    let confirmation = `✅ You are now chatting with OpenRouter's ${modelFriendlyName}.`;
    
    // All OpenRouter models support image viewing
    confirmation += `\n🖼️ This model supports image viewing - you can send images for analysis!`;
    
    // Special handling for DeepSeek R1
    if (modelFriendlyName.includes('deepseek')) {
        confirmation += `\n🔍 This model excels at complex reasoning tasks and provides detailed analysis.`;
    }
    // Special handling for Llama 4 Maverick
    else if (modelFriendlyName.includes('maverick')) {
        confirmation += `\n🔧 This is the newly released Llama 4 Maverick model - perfect for complex tasks!`;
    }
    
    if (system) {
        confirmation += `\n*System Prompt:* "${system}"`;
    }
    confirmation += `\n\nAsk me anything! This AI remembers your conversation.\n(Type 'switch' or 'exit' at any time.)`;
    messengerApi.sendText(psid, confirmation);
}

function handleGpt4oRoleplay(psid, text) {
    const roleplay = text.toLowerCase() === 'skip' ? '' : text;
    stateManager.setUserState(psid, 'in_chat', { model: 'gpt4o_advanced', roleplay });
    let confirmation = "✅ You are now chatting with Advanced GPT-4o.";
    if (roleplay) { confirmation += `\n*Roleplay set:* "${roleplay}"`; }
    confirmation += `\n\nAsk me anything! This AI remembers your conversation.\n(Type 'switch' or 'exit' at any time.)`;
    messengerApi.sendText(psid, confirmation);
}

function handleAiSelection(psid, model, fromMenu = true) {
    let modelName, modelDescription;
    
    if (fromMenu) {
        if (model === 'grok') { modelName = 'Grok'; modelDescription = 'Text only'; }
        if (model === 'claude') { modelName = 'Claude 3 Haiku'; modelDescription = 'Text only'; }
        if (model === 'o3mini') { modelName = 'O3 Mini'; modelDescription = 'Text only'; }
        if (model === 'chatgot') { modelName = 'ChatGot.io (w/ Memory)'; modelDescription = 'Text only'; }
        if (model === 'geminipro') { modelName = 'Gemini Pro (w/ Memory)'; modelDescription = 'Text only'; }
        if (model === 'kaiz') { modelName = 'Kaiz AI (Vision & Memory)'; modelDescription = 'Supports images'; }
        
        let visionWarning = '';
        if (model === 'kaiz') {
            visionWarning = '🖼️ This model supports image analysis - you can send images during chat!';
        } else {
            visionWarning = '⚠️ This model only supports text - images cannot be analyzed.';
        }
        
        modelDescription = `${modelDescription} - ${visionWarning}`;
    } else {
        // For direct model selection from the OpenRouter menu
        if (model.includes('/')) {
            modelName = model.split('/')[1].split(':')[0];
            modelDescription = '✨ Vision model - supports image analysis!';
        } else {
            modelName = model === 'kaiz' ? 'Kaiz AI' : model;
            modelDescription = model === 'kaiz' ? 'Vision model - supports image analysis!' : 'Text only model';
        }
    }
    
    let welcomeMessage = `✅ You are now chatting with ${modelName}. ${modelDescription}`;
    if (model === 'kaiz' || (model.includes('/'))) {
        welcomeMessage += `\n\nYou can ask questions or send images for analysis!\n\n(Type 'switch' or 'exit' at any time.)`;
    } else {
        welcomeMessage += `\n\nAsk me anything!\n\n(Type 'switch' or 'exit' at any time.)`;
    }
    
    stateManager.setUserState(psid, 'in_chat', { model });
    messengerApi.sendText(psid, welcomeMessage);
}

function handleDownloaderSelection(psid, platform) {
    let state, platformName;
    if (platform === 'fb') { state = 'awaiting_downloader_fb'; platformName = 'Facebook'; }
    if (platform === 'yt') { state = 'awaiting_downloader_yt'; platformName = 'YouTube'; }
    if (platform === 'tik') { state = 'awaiting_downloader_tik'; platformName = 'TikTok'; }
    stateManager.setUserState(psid, state);
    messengerApi.sendText(psid, `✅ ${platformName} Downloader selected. Please send me the full video URL.`);
}

function handleInChat(psid, lowerCaseText, originalText, model, roleplay, system) {
    if (lowerCaseText === 'switch') {
        stateManager.clearUserState(psid);
        
        // Provide guidance about vision models
        if (isVisionModel(model)) {
            messengerApi.sendText(psid, `🔄 Exiting chat with ${getVisionModelName(model)}. You can switch to another model or start a new task.`);
        } else {
            messengerApi.sendText(psid, `🔄 Exiting chat with ${model}. You can switch to another model or start a new task.`);
        }
        
        showMainMenu(psid);
    } else if (lowerCaseText === 'exit') {
        stateManager.clearUserState(psid);
        messengerApi.sendText(psid, "✅ You have exited the chat session. Type 'menu' to start again.");
    } else {
        toolHandlers.forwardToAI(psid, originalText, model, roleplay, '', system);
    }
}

// Helper functions
function isVisionModel(model) {
    // Check if model is an OpenRouter model (all OpenRouter models support vision)
    if (model.includes('/')) {
        return true;
    }
    
    // Specific vision models for non-OpenRouter
    const visionModels = [
        'kaiz'
    ];
    return visionModels.includes(model);
}

function getVisionModelName(model) {
    if (!model.includes('/')) {
        if (model === 'kaiz') return 'Kaiz AI';
        return 'Unknown Vision Model';
    }
    
    // Extract model name from OpenRouter identifier
    const modelName = model.split('/')[1].split(':')[0];
    return modelName;
}

// Added Handler for Search Refinement
function handleSearchRefinement(psid, text) {
    const userState = stateManager.getUserState(psid);
    if (userState?.state === 'awaiting_search_refinement') {
        const refinedQuery = text.trim().toLowerCase();
        if (refinedQuery === 'no' || refinedQuery === 'exit' || refinedQuery === 'menu') {
            stateManager.clearUserState(psid);
            messengerApi.sendText(psid, "✅ Exiting search mode. Type 'menu' to see all options again.");
        } else {
            // Clear refinement state and start a new search with the refined query
            stateManager.clearUserState(psid);
            toolHandlers.handleGoogleSearch(psid, refinedQuery);
        }
    }
}

// --- Server and Webhook Setup ---
app.get('/', (req, res) => res.status(200).send('✅ Multi-Tool Bot is online and healthy.'));
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
async function keepApiKeyActive() {
    try {
        const apiKey = "732ce71f-4761-474d-adf2-5cd2d315ad18";
        const pingUrl = `https://kaiz-apis.gleeze.com/api/humanizer?q=Hello&apikey=${apiKey}`;
        console.log("Pinging Humanizer API to keep key active...");
        const response = await axios.get(pingUrl);
        if (response.data && (response.data.response || response.data.result)) {
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
