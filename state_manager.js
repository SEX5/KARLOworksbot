// state_manager.js (Upgraded with Conversation History)

const userStates = {};
const CONVERSATION_TIMEOUT = 1800000; // 30 minutes

/**
 * Sets the state for a user.
 */
const setUserState = (psid, state, data = {}) => {
  // When setting a new state, we must preserve the existing message history
  const existingHistory = userStates[psid]?.messages || [];
  userStates[psid] = {
    state,
    ...data,
    messages: data.messages || existingHistory, // Use new messages array or keep old one
    timestamp: Date.now()
  };
  console.log(`State set for ${psid}:`, userStates[psid]);
};

/**
 * Retrieves a user's state if it has not expired.
 */
const getUserState = (psid) => {
  const userState = userStates[psid];
  if (!userState) return null;
  if ((Date.now() - userState.timestamp) > CONVERSATION_TIMEOUT) {
    console.log(`State for ${psid} has expired. Clearing state.`);
    delete userStates[psid];
    return null;
  }
  return userState;
};

/**
 * Clears a user's current action state but keeps the conversation history.
 */
const clearUserState = (psid) => {
  if (userStates[psid]) {
    // This smart-clearing keeps the conversation memory intact when the user types 'menu'
    const history = userStates[psid].messages;
    delete userStates[psid];
    // Preserve the message history
    if (history && history.length > 0) {
        userStates[psid] = { messages: history, timestamp: Date.now() };
    }
  }
  console.log(`State cleared for ${psid}.`);
};

/**
 * Adds a new message to a user's conversation history.
 * @param {string} psid The user's Page-Scoped ID.
 * @param {string} role 'user' or 'assistant'.
 * @param {string|Array} content The text or content array for the message.
 */
const addMessageToHistory = (psid, role, content) => {
    // If this is the very first message, initialize the state
    if (!userStates[psid]) {
        userStates[psid] = { messages: [], timestamp: Date.now() };
    }
    // If the state exists but the messages array doesn't, initialize it
    if (!userStates[psid].messages) {
        userStates[psid].messages = [];
    }

    userStates[psid].messages.push({ role, content });

    // Keep the history from getting too long to save memory and API costs.
    // 20 messages = 10 turns of conversation.
    if (userStates[psid].messages.length > 20) {
        userStates[psid].messages.splice(0, 2); // Remove the oldest user/assistant pair
    }
};

module.exports = {
  setUserState,
  getUserState,
  clearUserState,
  addMessageToHistory
};
