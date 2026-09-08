"use strict";

(function initializeInventoryUtils(globalScope) {
  function getSafeInquiryUrl(value) {
    if (typeof value !== "string" || !/^(?:https:|mailto:)/iu.test(value.trim())) return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
    } catch {
      return null;
    }
  }

  const api = { getSafeInquiryUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.InventoryUtils = api;
}(globalThis));
