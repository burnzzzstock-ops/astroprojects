// The ranking/call-list logic the phone runs in the web version: the exact same
// code the local app runs on the PC (src/buyList.js), bundled by build.mjs into
// public/logic.js as the global `BuyLogic`.
export { OUTCOMES, buildCallList, browseListings, status, callListCsv } from "../src/buyList.js";
