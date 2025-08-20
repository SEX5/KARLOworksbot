// tool_handlers.js (Final Version with Correct GET Method for All AIs)
const axios = require('axios');
const stateManager = require('./state_manager.js');
const messengerApi = require('./messenger_api.js');

const kaizApiKey = "732ce71f-4761-474d-adf2-5cd2d315ad18";
// A safe character limit for APIs that put the query in the URL.
const URL_CHARACTER_LIMIT = 10000;

async function handleDownloadRequest(psid, url, platform) {
    const encodedUrl = encodeURIComponent(url);
    let apiUrl = '', platformName = '';
    if (platform === 'fb') { apiUrl = `https://rapido.zetsu.xyz/api/fbdl?url=${encodedUrl}`; platformName = 'Facebook'; }
    if (platform === 'yt') { apiUrl = `https://rapido.zetsu.xyz/api/ytdl-v2?url=${encodedUrl}`; platformName = 'YouTube'; }
    if (platform === 'tik') { apiUrl = `https://rapido.zetsu.xyz/api/tikdl-v2?url=${encodedUrl}`; platformName = 'TikTok'; }
    await messengerApi.sendText(psid, `⏳ Please wait, I'm fetching your ${platformName} video...`);
    try {
        const response = await axios.get(apiUrl, { timeout: 60000 });
        const videoData = response.data.response || response.data;
        if (videoData && (videoData.status !== false) && (videoData.success !== false)) {
            const title = videoData.title || 'Your Video';
            await messengerApi.sendText(psid, `✅ Success! Found video:\n*${title}*`);
            let downloadLink = null;
            if (platform === 'fb') downloadLink = videoData.url;
            if (platform === 'yt') downloadLink = videoData.download_url;
            if (platform === 'tik') downloadLink = videoData.play;
            if (downloadLink) {
                await messengerApi.sendVideo(psid, downloadLink, title);
            } else {
                await messengerApi.sendText(psid, "❌ Sorry, I couldn't find a valid download link.");
            }
        } else {
            await messengerApi.sendText(psid, `❌ Error: ${response.data?.error || response.data?.message || 'The API failed.'}`);
        }
    } catch (error) {
        await messengerApi.sendText(psid, "❌ Sorry, an unexpected error occurred.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to see all options again.");
    }
}

async function handleGoogleSearch(psid, query) {
    await messengerApi.sendText(psid, `🔍 Searching Google for "${query}"...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/google?q=${encodeURIComponent(query)}`);
        if (response.data?.results?.length > 0) {
            const elements = response.data.results.slice(0, 5).map(res => ({
                title: res.title,
                subtitle: res.snippet,
                image_url: res.image,
                default_action: { type: "web_url", url: res.link, webview_height_ratio: "tall" }
            }));
            await messengerApi.sendText(psid, "Here are the top results I found:");
            await messengerApi.sendGenericTemplate(psid, elements);
        } else {
            await messengerApi.sendText(psid, "Sorry, I couldn't find any results for that search.");
        }
    } catch (error) {
        await messengerApi.sendText(psid, "Sorry, the search service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handlePinterestSearch(psid, query, count) {
    const numCount = parseInt(count);
    if (isNaN(numCount) || numCount <= 0 || numCount > 10) {
        await messengerApi.sendText(psid, "Please enter a valid number between 1 and 10.");
        return;
    }
    await messengerApi.sendText(psid, `🎨 Searching Pinterest for ${numCount} image(s) of "${query}"...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/pin?search=${encodeURIComponent(query)}&count=${numCount}`);
        if (response.data?.data?.length > 0) {
            await messengerApi.sendText(psid, "Here are the images I found:");
            for (const imageUrl of response.data.data) {
                await messengerApi.sendImage(psid, imageUrl);
            }
        } else {
            await messengerApi.sendText(psid, "Sorry, I couldn't find any images for that search.");
        }
    } catch (error) {
        await messengerApi.sendText(psid, "Sorry, the Pinterest search service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleTranslateRequest(psid, text, lang) {
    await messengerApi.sendText(psid, `🌐 Translating to '${lang}'...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/translate?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`);
        if (response.data && response.data.translated) {
            await messengerApi.sendText(psid, `Original: ${response.data.original}\n\nTranslated: ${response.data.translated}`);
        } else {
            await messengerApi.sendText(psid, "Sorry, I couldn't translate that. The language code might be incorrect.");
        }
    } catch (error) {
        await messengerApi.sendText(psid, "Sorry, the translation service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleGhibliRequest(psid, imageUrl) {
    await messengerApi.sendText(psid, "🎨 Applying Ghibli filter... This might take a moment!");
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/ghibli?imageUrl=${encodeURIComponent(imageUrl)}`);
        if (response.data && response.data.imageUrl) {
            await messengerApi.sendText(psid, "✅ Transformation successful! Here is your image:");
            await messengerApi.sendImage(psid, response.data.imageUrl);
        } else {
             await messengerApi.sendText(psid, `❌ Sorry, something went wrong: ${response.data?.error || "Image transformation failed."}`);
        }
    } catch (error) {
        await messengerApi.sendText(psid, "❌ Sorry, the image transformation service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleHumanizerRequest(psid, text) {
    if (text.length > URL_CHARACTER_LIMIT) {
        await messengerApi.sendText(psid, `⚠️ Your text is too long for the Humanizer tool (over ${URL_CHARACTER_LIMIT} characters). Please try a shorter text.`);
        return;
    }
    
    await messengerApi.sendText(psid, "✍️ Humanizing your text... Please wait.");
    try {
        const apiUrl = `https://kaiz-apis.gleeze.com/api/humanizer?q=${encodeURIComponent(text)}&apikey=${kaizApiKey}`;
        const response = await axios.get(apiUrl);
        if (response.data && response.data.response) {
            await messengerApi.sendText(psid, "✅ Here is the humanized version:");
            await messengerApi.sendText(psid, response.data.response);
        } else {
            await messengerApi.sendText(psid, `❌ Sorry, something went wrong: ${response.data?.error || "Unexpected response."}`);
        }
    } catch (error) {
        await messengerApi.sendText(psid, "❌ Sorry, the humanizer service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

// --- THIS IS THE FINAL AI FORWARDING FUNCTION ---
async function forwardToAI(psid, query, model) {
    // Check if the message is too long for ANY of the GET-based APIs.
    if (query.length > URL_CHARACTER_LIMIT) {
        await messengerApi.sendText(psid, `⚠️ Your message is too long for this AI model (over ${URL_CHARACTER_LIMIT} characters). Please try a shorter message.`);
        return;
    }

    let apiUrl;
    
    try {
        const encodedQuery = encodeURIComponent(query);
        
        // All these APIs use the GET method with the query in the URL.
        if (model === 'gpt4o') apiUrl = `https://rapido.zetsu.xyz/api/gpt4o?query=${encodedQuery}&uid=${psid}`;
        if (model === 'gpt4-1') apiUrl = `https://rapido.zetsu.xyz/api/gpt4-1?query=${encodedQuery}&uid=${psid}`;
        if (model === 'grok') apiUrl = `https://rapido.zetsu.xyz/api/grok?query=${encodedQuery}`;
        if (model === 'claude') apiUrl = `https://kaiz-apis.gleeze.com/api/claude3-haiku?ask=${encodedQuery}&apikey=${kaizApiKey}`;

        console.log(`Forwarding to ${model.toUpperCase()} via GET: ${apiUrl}`);
        const response = await axios.get(apiUrl, { timeout: 60000 });

        if (response.data && response.data.response) {
            await messengerApi.sendText(psid, response.data.response);
            stateManager.setUserState(psid, 'in_chat', { model });
        } else {
            await messengerApi.sendText(psid, `Sorry, an error occurred: ${response.data?.error || 'The AI failed to respond.'}`);
        }
    } catch (error) {
        console.error(`Error calling ${model} API:`, error.response?.data || error.message);
        await messengerApi.sendText(psid, "Sorry, the AI assistant is currently unavailable or the request timed out.");
    }
}

module.exports = {
    handleDownloadRequest,
    handleGoogleSearch,
    handlePinterestSearch,
    handleTranslateRequest,
    handleGhibliRequest,
    handleHumanizerRequest,
    forwardToAI
};
