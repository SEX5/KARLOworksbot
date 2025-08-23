// state_manager.js (Upgraded with Conversation History)

const userStates = {};
const CONVERSATION_TIMEOUT = 1800000; // 30 minutes

const setUserState = (psid, state, data = {}) => {
  const existingHistory = userStates[psid]?.messages || [];
  userStates[psid] = {
    state,
    ...data,
    messages: data.messages || existingHistory,
    timestamp: Date.now()
  };
  console.log(`State set for ${psid}:`, userStates[psid]);
};

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

const clearUserState = (psid) => {
  if (userStates[psid]) {
    const history = userStates[psid].messages;
    delete userStates[psid];
    if (history && history.length > 0) {
        userStates[psid] = { messages: history, timestamp: Date.now() };
    }
  }
  console.log(`State cleared for ${psid}.`);
};

const addMessageToHistory = (psid, role, content) => {
    if (!userStates[psid]) {
        userStates[psid] = { messages: [], timestamp: Date.now() };
    }
    if (!userStates[psid].messages) {
        userStates[psid].messages = [];
    }
    userStates[psid].messages.push({ role, content });
    if (userStates[psid].messages.length > 20) {
        userStates[psid].messages.splice(0, 2);
    }
};

module.exports = {
  setUserState,
  getUserState,
  clearUserState,
  addMessageToHistory
};
