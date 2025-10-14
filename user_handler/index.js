// user_handler/index.js

const menuHandler = require('./menu_handler');
const purchaseFlow = require('./purchase_flow');
const manualEntryFlow = require('./manual_entry_flow');
const accountServices = require('./account_services');
const customModFlow = require('./custom_mod_flow');
const supportFlow = require('./support_flow');
const directPurchaseFlow = require('./direct_purchase_flow'); // <-- ADD THIS LINE

module.exports = {
    ...menuHandler,
    ...purchaseFlow,
    ...manualEntryFlow,
    ...accountServices,
    ...customModFlow,
    ...supportFlow,
    ...directPurchaseFlow // <-- AND ADD THIS LINE
};
