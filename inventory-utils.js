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

  function createCarouselPauseState(reducedMotion = false) {
    let userPaused = Boolean(reducedMotion);
    let pointerActive = false;
    let focusActive = false;
    return {
      get userPaused() { return userPaused; },
      toggleUserPaused() {
        userPaused = !userPaused;
        return userPaused;
      },
      pauseForManualNavigation() { userPaused = true; },
      setPointerActive(active) { pointerActive = Boolean(active); },
      setFocusActive(active) { focusActive = Boolean(active); },
      canAdvance(pageHidden = false) {
        return !userPaused && !pointerActive && !focusActive && !pageHidden;
      }
    };
  }

  function getHighlightWindow(items, offset, limit) {
    if (!Array.isArray(items) || !items.length || !Number.isInteger(limit) || limit < 1) return [];
    const count = Math.min(limit, items.length);
    const start = ((Math.trunc(offset) % items.length) + items.length) % items.length;
    return Array.from({ length: count }, (_, index) => items[(start + index) % items.length]);
  }

  const api = { getSafeInquiryUrl, createCarouselPauseState, getHighlightWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.InventoryUtils = api;
}(globalThis));
