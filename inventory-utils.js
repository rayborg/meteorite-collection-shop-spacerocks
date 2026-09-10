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

  const api = { getSafeInquiryUrl, createCarouselPauseState };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.InventoryUtils = api;
}(globalThis));
