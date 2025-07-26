// state_manager.js
const userStates = {};
function setUserState(userId, state, data = {}) { userStates[userId] = { state, ...data }; console.log(`State for ${userId} set to:`, userStates[userId]); }
function getUserState(userId) { return userStates[userId] || null; }
function clearUserState(userId) { delete userStates[userId]; console.log(`State for ${userId} cleared.`); }
module.exports = { setUserState, getUserState, clearUserState };