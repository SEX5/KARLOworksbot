// index.js (With AI Chat, Downloaders, Search, Translate & Ghibli Filter)
const express = require('express');
const axios = require('axios');
const secrets = require('./secrets.js');
const stateManager = require('./state_manager.js');

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN } = secrets;
const app = express();
app.use(express.json());

// --- Main Menu Function ---
async function showMainMenu(psid) {
    const menuText = `🤖 Multi-Tool Bot 🤖

What would you like to do?

--- AI Models ---
1. ChatGPT-4o
2. ChatGPT-4.1
3. Grok

--- Media Tools ---
4. Facebook Downloader
5. YouTube Downloader
6. TikTok Downloader
7. Pinterest Search
10. Ghibli Image Filter ✨

--- Utility Tools ---
8. Google Search
9. Google Translate

Just type the number of your choice.`;
    await sendText(psid, menuText);
}

// --- Main Handlers for Text and Image Messages ---
async function handleTextMessage(psid, message) {
    const messageText = message.text?.trim();
    const lowerCaseText = messageText?.toLowerCase();
    
    const userState = stateManager.getUserState(psid);

    if (lowerCaseText === 'menu') {
        stateManager.clearUserState(psid);
        await showMainMenu(psid);
        return;
    }

    // --- State-Based Logic ---
    if (userState?.state) {
        if (userState.state === 'in_chat') {
            handleInChat(psid, lowerCaseText, messageText, userState.model);
            return;
        }
        if (userState.state.startsWith('awaiting_downloader_')) {
            const platform = userState.state.split('_')[2];
            handleDownloadRequest(psid, messageText, platform);
            return;
        }
        if (userState.state === 'awaiting_google_query') {
            handleGoogleSearch(psid, messageText);
            return;
        }
        if (userState.state === 'awaiting_pinterest_query') {
            stateManager.setUserState(psid, 'awaiting_pinterest_count', { query: messageText });
            await sendText(psid, "Got it. How many images would you like? (e.g., 5)");
            return;
        }
        if (userState.state === 'awaiting_pinterest_count') {
            handlePinterestSearch(psid, userState.query, messageText);
            return;
        }
        if (userState.state === 'awaiting_translate_text') {
            stateManager.setUserState(psid, 'awaiting_translate_lang', { text: messageText });
            await sendText(psid, "Got it. Now, what language should I translate it to? (e.g., 'en' for English, 'es' for Spanish)");
            return;
        }
        if (userState.state === 'awaiting_translate_lang') {
            handleTranslateRequest(psid, userState.text, messageText);
            return;
        }
    }

    // --- Main Menu Selection Logic ---
    switch (lowerCaseText) {
        case '1': case '2': case '3':
            handleAiSelection(psid, lowerCaseText);
            break;
        case '4': case '5': case '6':
            handleDownloaderSelection(psid, lowerCaseText);
            break;
        case '7':
            stateManager.setUserState(psid, 'awaiting_pinterest_query');
            await sendText(psid, "✅ Pinterest Search selected. What do you want to search for?");
            break;
        case '8':
            stateManager.setUserState(psid, 'awaiting_google_query');
            await sendText(psid, "✅ Google Search selected. What do you want to search for?");
            break;
        case '9':
            stateManager.setUserState(psid, 'awaiting_translate_text');
            await sendText(psid, "✅ Google Translate selected. What text would you like to translate?");
            break;
        case '10':
            stateManager.setUserState(psid, 'awaiting_ghibli_image');
            await sendText(psid, "✅ Ghibli Filter selected. Please send an image you want to transform!");
            break;
        default:
            await showMainMenu(psid);
            break;
    }
}

async function handleImageAttachment(psid, imageUrl) {
    const userState = stateManager.getUserState(psid);
    if (userState?.state === 'awaiting_ghibli_image') {
        await handleGhibliRequest(psid, imageUrl);
    } else {
        await sendText(psid, "I see you've sent an image, but I'm not sure what to do with it. Please select an option from the menu first.");
    }
}


// --- LOGIC HANDLERS ---

function handleAiSelection(psid, choice) {
    let model, modelName;
    if (choice === '1') { model = 'gpt4o'; modelName = 'ChatGPT-4o'; }
    if (choice === '2') { model = 'gpt4-1'; modelName = 'ChatGPT-4.1'; }
    if (choice === '3') { model = 'grok'; modelName = 'Grok'; }
    
    stateManager.setUserState(psid, 'in_chat', { model });
    sendText(psid, `✅ You are now chatting with ${modelName}. Ask me anything!\n\n(Type 'switch' or 'exit' at any time.)`);
}

function handleDownloaderSelection(psid, choice) {
    let state, platformName;
    if (choice === '4') { state = 'awaiting_downloader_fb'; platformName = 'Facebook'; }
    if (choice === '5') { state = 'awaiting_downloader_yt'; platformName = 'YouTube'; }
    if (choice === '6') { state = 'awaiting_downloader_tik'; platformName = 'TikTok'; }

    stateManager.setUserState(psid, state);
    sendText(psid, `✅ ${platformName} Downloader selected. Please send me the full video URL.`);
}

function handleInChat(psid, lowerCaseText, originalText, model) {
    if (lowerCaseText === 'switch') {
        stateManager.clearUserState(psid);
        sendText(psid, "🔄 Switching tasks...");
        showMainMenu(psid);
    } else if (lowerCaseText === 'exit') {
        stateManager.clearUserState(psid);
        sendText(psid, "✅ You have exited the chat session. Type 'menu' to start again.");
    } else {
        forwardToAI(psid, originalText, model);
    }
}

async function handleDownloadRequest(psid, url, platform) {
    const encodedUrl = encodeURIComponent(url);
    let apiUrl = '', platformName = '';
    if (platform === 'fb') { apiUrl = `https://rapido.zetsu.xyz/api/fbdl?url=${encodedUrl}`; platformName = 'Facebook'; }
    if (platform === 'yt') { apiUrl = `https://rapido.zetsu.xyz/api/ytdl?url=${encodedUrl}`; platformName = 'YouTube'; }
    if (platform === 'tik') { apiUrl = `https://rapido.zetsu.xyz/api/tikdl-v2?url=${encodedUrl}`; platformName = 'TikTok'; }

    await sendText(psid, `⏳ Please wait, I'm fetching your ${platformName} video...`);
    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.status === true && response.data.response) {
            const downloadLink = response.data.response.video_url || response.data.response.download_link || response.data.response.url;
            const title = response.data.response.title || 'Your Video';
            if (downloadLink) {
                await sendText(psid, `✅ Success!\n\nTitle: ${title}\n\nDownload Link: ${downloadLink}`);
            } else {
                await sendText(psid, "❌ Sorry, I couldn't find a download link in the response.");
            }
        } else {
            await sendText(psid, `❌ Error: ${response.data?.error || response.data?.message || 'The API failed to process the URL.'}`);
        }
    } catch (error) {
        console.error(`Error calling ${platform} downloader API:`, error.message);
        await sendText(psid, "❌ Sorry, an unexpected error occurred. The link might be invalid or the service is down.");
    } finally {
        stateManager.clearUserState(psid);
        await sendText(psid, "Type 'menu' to see all options again.");
    }
}

async function handleGoogleSearch(psid, query) {
    await sendText(psid, `🔍 Searching Google for "${query}"...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/google?q=${encodeURIComponent(query)}`);
        if (response.data && response.data.results && response.data.results.length > 0) {
            let searchResults = "Here are the top results:\n\n";
            response.data.results.slice(0, 4).forEach(res => {
                searchResults += `Title: ${res.title}\nSnippet: ${res.snippet}\nLink: ${res.link}\n\n`;
            });
            await sendText(psid, searchResults);
        } else {
            await sendText(psid, "Sorry, I couldn't find any results for that search.");
        }
    } catch (error) {
        console.error("Google Search API Error:", error.message);
        await sendText(psid, "Sorry, the search service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handlePinterestSearch(psid, query, count) {
    const numCount = parseInt(count);
    if (isNaN(numCount) || numCount <= 0 || numCount > 10) {
        await sendText(psid, "Please enter a valid number between 1 and 10.");
        return;
    }
    await sendText(psid, `🎨 Searching Pinterest for ${numCount} image(s) of "${query}"...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/pin?search=${encodeURIComponent(query)}&count=${numCount}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
            await sendText(psid, "Here are the images I found:");
            for (const imageUrl of response.data.data) {
                await sendText(psid, imageUrl);
            }
        } else {
            await sendText(psid, "Sorry, I couldn't find any images for that search.");
        }
    } catch (error) {
        console.error("Pinterest API Error:", error.message);
        await sendText(psid, "Sorry, the Pinterest search service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleTranslateRequest(psid, text, lang) {
    await sendText(psid, `🌐 Translating to '${lang}'...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/translate?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`);
        if (response.data && response.data.translated) {
            const result = `Original: ${response.data.original}\n\nTranslated: ${response.data.translated}`;
            await sendText(psid, result);
        } else {
            await sendText(psid, "Sorry, I couldn't translate that. The language code might be incorrect.");
        }
    } catch (error) {
        console.error("Translate API Error:", error.message);
        await sendText(psid, "Sorry, the translation service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleGhibliRequest(psid, imageUrl) {
    await sendText(psid, "🎨 Applying Ghibli filter... This might take a moment!");
    try {
        const encodedImageUrl = encodeURIComponent(imageUrl);
        const response = await axios.get(`https://rapido.zetsu.xyz/api/ghibli?imageUrl=${encodedImageUrl}`);
        
        if (response.data && response.data.imageUrl) {
            await sendText(psid, "✅ Transformation successful! Here is your image:");
            await sendText(psid, response.data.imageUrl); 
        } else {
             const errorMessage = response.data?.error || "Image transformation failed for an unknown reason.";
             await sendText(psid, `❌ Sorry, something went wrong: ${errorMessage}`);
        }
    } catch (error) {
        console.error("Ghibli API Error:", error.message);
        await sendText(psid, "❌ Sorry, the image transformation service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await sendText(psid, "Type 'menu' to start a new task.");
    }
}

// --- AI Forwarding Logic ---
async function forwardToAI(psid, query, model) {
    const encodedQuery = encodeURIComponent(query);
    let apiUrl = '';
    if (model === 'gpt4o') apiUrl = `https://rapido.zetsu.xyz/api/gpt4o?query=${encodedQuery}&uid=${psid}`;
    if (model === 'gpt4-1') apiUrl = `https://rapido.zetsu.xyz/api/gpt4-1?query=${encodedQuery}&uid=${psid}`;
    if (model === 'grok') apiUrl = `https://rapido.zetsu.xyz/api/grok?query=${encodedQuery}`;
    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.status === true && response.data.response) {
            await sendText(psid, response.data.response);
            stateManager.setUserState(psid, 'in_chat', { model });
        } else {
            await sendText(psid, `Sorry, an error occurred: ${response.data?.error || 'The AI failed to respond.'}`);
        }
    } catch (error) {
        console.error(`Error calling ${model} API:`, error.message);
        await sendText(psid, "Sorry, the AI assistant is currently unavailable.");
    }
}

// --- Helper & Server Functions ---
async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text } };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending message:", error.response?.data?.error || error.message);
    }
}

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
                } 
                else if (event.message.attachments?.[0]?.type === 'image') {
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
app.listen(PORT, () => console.log(`✅ Multi-Tool test bot is listening on port ${PORT}.`));
