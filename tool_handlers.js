// tool_handlers.js (Final Version with Enhanced Google Search and Image Support)
const axios = require('axios');
const stateManager = require('./state_manager.js');
const messengerApi = require('./messenger_api.js');
const secrets = require('./secrets.js');

const kaizApiKey = "732ce71f-4761-474d-adf2-5cd2d315ad18";
const hajiApiKey = secrets.HAJI_API_KEY;
const openRouterApiKey = secrets.OPENROUTER_API_KEY;

// THIS IS THE NEW, OFFICIAL AI FORWARDING FUNCTION
async function forwardToAI(psid, query, model, roleplay = '', imageUrl = '', system = '') {
    const userState = stateManager.getUserState(psid);
    // Get the conversation history, or start with an empty array
    const history = userState?.messages || [];

    // For vision models, the content is an array of parts (text and image)
    let userContent;
    if (imageUrl && (model.includes('/') || model === 'kaiz')) {
        if (model.includes('qwen') || model.includes('glm')) {
            userContent = [
                { type: "text", text: query },
                { type: "image_url", image_url: { url: imageUrl } }
            ];
        } else {
            // For other models that don't support image URLs directly, describe the image
            userContent = `I've sent you an image. Please analyze it. The image URL is: ${imageUrl}\n\nHere's my question: ${query}`;
        }
    } else {
        userContent = query;
    }
    
    // Add the user's new message to the history for the API call
    stateManager.addMessageToHistory(psid, 'user', userContent);
    // Get the most up-to-date history right after adding the new message
    const updatedHistory = stateManager.getUserState(psid).messages;
    
    let apiUrl, headers, data, response;

    try {
        // --- Official OpenRouter Models ---
        if (model.includes('/')) {
            apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://www.facebook.com/share/1PAggxknpP/', // Replace with your Page URL
                'X-Title': 'Multi-Tool Bot' // Replace with your Bot's Name
            };
            
            let messages = [];
            // Add the system prompt first if it exists
            if (system) {
                messages.push({ role: 'system', content: system });
            }
            // Add the rest of the conversation history
            messages = messages.concat(updatedHistory);

            data = {
                model: model,
                messages: messages,
                // For models that support vision parameters
                extra_body: {
                    max_tokens: 4096,
                    temperature: model.includes('deepseek') ? 0.1 : 0.7,
                }
            };
            
            console.log(`Forwarding to OpenRouter (${model}) via POST...`);
            response = await axios.post(apiUrl, data, { headers, timeout: 120000 });
        
        // --- Fallback for other APIs ---
        } else {
             // Logic for Haji, Kaiz, Rapido APIs remains here
             const encodedQuery = encodeURIComponent(query);
             if (model === 'gpt4o_advanced') {
                apiUrl = `https://haji-mix-api.gleeze.com/api/gpt4o?ask=${encodedQuery}&uid=${psid}&roleplay=${encodeURIComponent(roleplay)}&api_key=${hajiApiKey}`;
             } // Add other non-OpenRouter models here if needed
             response = await axios.get(apiUrl, { timeout: 60000 });
        }
        
        let reply = '';
        if (model.includes('/')) {
            reply = response.data?.choices?.[0]?.message?.content;
        } else {
            reply = response.data?.answer || response.data?.response;
        }

        if (reply) {
            await messengerApi.sendText(psid, reply);
            // Add the AI's reply to the history to complete the conversation turn
            stateManager.addMessageToHistory(psid, 'assistant', reply);
            stateManager.setUserState(psid, 'in_chat', { model, system }); // Update timestamp and keep state
        } else {
            await messengerApi.sendText(psid, `Sorry, the AI returned an empty response.`);
        }
    } catch (error) {
        console.error(`Error calling ${model} API:`, error.response?.data || error.message);
        await messengerApi.sendText(psid, "Sorry, the AI assistant is currently unavailable or the request timed out.");
    }
}

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

// Enhanced Google Search with AI analysis
async function handleGoogleSearch(psid, query) {
    await messengerApi.sendText(psid, `🔍 Searching Google for "${query}"...`);
    try {
        const response = await axios.get(`https://rapido.zetsu.xyz/api/google?q=${encodeURIComponent(query)}`);
        if (response.data?.results?.length > 0) {
            // Prepare results for AI analysis
            const resultsText = response.data.results.slice(0, 5).map(res => 
                `Title: ${res.title}\nURL: ${res.link}\nDescription: ${res.snippet}\n\n`
            ).join('');
            
            // Analyze using the new API endpoint
            await messengerApi.sendText(psid, "🧠 Analyzing search results...");
            const analysisResponse = await axios.get(
                `https://rapido.zetsu.xyz/api/gpt4-1?query=Analyze%20these%20search%20results%20for%20the%20query%20%22${encodeURIComponent(query)}%22%20and%20provide%20a%20concise%20summary%20of%20the%20most%20relevant%20information:%0A%0A${encodeURIComponent(resultsText)}&uid=${psid}`,
                { timeout: 120000 }
            );
            
            // Send AI analysis
            if (analysisResponse.data?.response) {
                await messengerApi.sendText(psid, `📊 Analysis:\n\n${analysisResponse.data.response}`);
            } else {
                await messengerApi.sendText(psid, "I found some results, but couldn't analyze them properly. Here are the raw results:");
            }
            
            // Additionally, create a more comprehensive analysis
            if (analysisResponse.data?.response) {
                const followUpResponse = await axios.get(
                    `https://rapido.zetsu.xyz/api/gpt4-1?query=Based%20on%20these%20search%20results%20for%20%22${encodeURIComponent(query)}%22%2C%20create%20a%20bullet%20point%20summary%20of%20the%20main%20topics%20found%20and%20identify%20the%20most%20relevant%20source%20for%20each%20topic:%0A%0A${encodeURIComponent(resultsText)}&uid=${psid}`,
                    { timeout: 120000 }
                );
                
                if (followUpResponse.data?.response) {
                    await messengerApi.sendText(psid, `🔍 Key Topics:\n\n${followUpResponse.data.response}`);
                }
            }
            
            // Send the original results as links
            const elements = response.data.results.slice(0, 5).map(res => ({
                title: res.title,
                subtitle: res.snippet,
                image_url: res.image,
                default_action: { type: "web_url", url: res.link, webview_height_ratio: "tall" }
            }));
            await messengerApi.sendText(psid, "\n📎 Here are the top search results I found:");
            await messengerApi.sendGenericTemplate(psid, elements);
            
            // Ask if they want to refine the search
            await messengerApi.sendText(psid, "\nWould you like to refine your search or ask a follow-up question? (Type 'no' to exit)");
            stateManager.setUserState(psid, 'awaiting_search_refinement', { query });
        } else {
            await messengerApi.sendText(psid, "Sorry, I couldn't find any results for that search. Could you try rephrasing your query?");
        }
    } catch (error) {
        console.error("Google search error:", error);
        await messengerApi.sendText(psid, "Sorry, the search service is currently unavailable. Please try again later.");
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
