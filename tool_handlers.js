// tool_handlers.js (Final Version with ChatGot.io)
const axios = require('axios');
const stateManager = require('./state_manager.js');
const messengerApi = require('./messenger_api.js');
const secrets = require('./secrets.js');

const kaizApiKey = "732ce71f-4761-474d-adf2-5cd2d315ad18";
const hajiApiKey = secrets.HAJI_API_KEY;
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

// --- UPDATED AI FORWARDING FUNCTION ---
async function forwardToAI(psid, query, model, roleplay = '') {
    if (['grok', 'claude', 'o3mini', 'chatgot'].includes(model) && query.length > URL_CHARACTER_LIMIT) {
        await messengerApi.sendText(psid, `⚠️ Your message is too long for this AI model. Please try a shorter message or switch to Advanced GPT-4o.`);
        return;
    }
    let apiUrl, response;
    const encodedQuery = encodeURIComponent(query);
    try {
        if (model === 'gpt4o_advanced') {
            const encodedRoleplay = encodeURIComponent(roleplay);
            apiUrl = `https://haji-mix-api.gleeze.com/api/gpt4o?ask=${encodedQuery}&uid=${psid}&roleplay=${encodedRoleplay}&api_key=${hajiApiKey}`;
            response = await axios.get(apiUrl, { timeout: 60000 });
        } else {
            if (model === 'grok') apiUrl = `https://rapido.zetsu.xyz/api/grok?query=${encodedQuery}`;
            if (model === 'claude') apiUrl = `https://kaiz-apis.gleeze.com/api/claude3-haiku?ask=${encodedQuery}&apikey=${kaizApiKey}`;
            if (model === 'o3mini') apiUrl = `https://kaiz-apis.gleeze.com/api/o3-mini?ask=${encodedQuery}&apikey=${kaizApiKey}`;
            // --- NEW: Added ChatGot.io ---
            if (model === 'chatgot') apiUrl = `https://kaiz-apis.gleeze.com/api/chatgot-io?ask=${encodedQuery}&uid=${psid}&apikey=${kaizApiKey}`;
            
            response = await axios.get(apiUrl, { timeout: 60000 });
        }
        const reply = response.data?.answer || response.data?.response;
        if (reply) {
            await messengerApi.sendText(psid, reply);
            stateManager.setUserState(psid, 'in_chat', { model, roleplay });
        } else {
            await messengerApi.sendText(psid, `Sorry, an error occurred: ${response.data?.error || 'The AI failed to respond.'}`);
        }
    } catch (error) {
        console.error(`Error calling ${model} API:`, error.response?.data || error.message);
        await messengerApi.sendText(psid, "Sorry, the AI assistant is currently unavailable or the request timed out.");
    }
}

async function handleAnimeHeavenRequest(psid, title, episode) {
    await messengerApi.sendText(psid, `Searching for "${title}" Episode ${episode}...`);
    try {
        const apiUrl = `https://kaiz-apis.gleeze.com/api/animeheaven?title=${encodeURIComponent(title)}&episode=${encodeURIComponent(episode)}&apikey=${kaizApiKey}`;
        const response = await axios.get(apiUrl, { timeout: 60000 });
        if (response.data && response.data.response) {
            const animeData = response.data.response;
            const episodeInfo = animeData.episodeList?.find(ep => ep.episode === episode);
            if (episodeInfo && episodeInfo.download_url) {
                let details = `✅ Found it!\n\n*Title:* ${animeData.title}\n*Description:* ${animeData.description}\n*Score:* ${animeData.score}`;
                await messengerApi.sendImage(psid, animeData.thumbnail);
                await messengerApi.sendText(psid, details);
                await messengerApi.sendVideo(psid, episodeInfo.download_url, `${animeData.title} - Episode ${episode}`);
            } else {
                await messengerApi.sendText(psid, `❌ I found the anime "${animeData.title}", but I couldn't find Episode ${episode}.`);
            }
        } else {
            await messengerApi.sendText(psid, `❌ Sorry, I couldn't find any anime with that title.`);
        }
    } catch (error) {
        await messengerApi.sendText(psid, "❌ Sorry, the Anime Heaven service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

async function handleSpotifySearch(psid, query) {
    await messengerApi.sendText(psid, `🎵 Searching Spotify for "${query}"...`);
    try {
        const spResponse = await axios.get(`https://rapido.zetsu.xyz/api/sp?query=${encodeURIComponent(query)}`);
        const results = Object.values(spResponse.data).filter(item => typeof item === 'object');
        if (results.length > 0) {
            await messengerApi.sendText(psid, "Here are the top tracks I found:");
            const elements = [];
            for (const track of results.slice(0, 5)) {
                const artQuery = `${track.name} ${track.artist} album art`;
                const pinResponse = await axios.get(`https://rapido.zetsu.xyz/api/pin?search=${encodeURIComponent(artQuery)}&count=1`);
                const imageUrl = pinResponse.data?.data?.[0] || 'https://i.imgur.com/8Q0m4p8.png';
                elements.push({
                    title: track.name,
                    subtitle: `by ${track.artist}`,
                    image_url: imageUrl,
                    default_action: { type: "web_url", url: track.url, webview_height_ratio: "tall" }
                });
            }
            await messengerApi.sendGenericTemplate(psid, elements);
        } else {
            await messengerApi.sendText(psid, "Sorry, I couldn't find any tracks for that search.");
        }
    } catch (error) {
        await messengerApi.sendText(psid, "Sorry, the Spotify search service is currently unavailable.");
    } finally {
        stateManager.clearUserState(psid);
        await messengerApi.sendText(psid, "Type 'menu' to start a new task.");
    }
}

module.exports = {
    handleDownloadRequest,
    handleGoogleSearch,
    handlePinterestSearch,
    handleTranslateRequest,
    handleGhibliRequest,
    handleHumanizerRequest,
    forwardToAI,
    handleAnimeHeavenRequest,
    handleSpotifySearch
};
