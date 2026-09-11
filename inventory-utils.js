"use strict";

(function initializeInventoryUtils(globalScope) {
  const MAX_METEORITE_SLUG_LENGTH = 80;

  function isValidMeteoriteSlug(value) {
    return typeof value === "string" && value.length <= MAX_METEORITE_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
  }

  function parseMeteoriteRequest(search) {
    if (typeof search !== "string") return { ok: false, reason: "malformed" };
    const query = search.startsWith("?") ? search.slice(1) : search;
    if (!query) return { ok: false, reason: "missing" };

    const values = [];
    for (const part of query.split("&")) {
      const separator = part.indexOf("=");
      if (separator < 0) return { ok: false, reason: "malformed" };
      let key;
      let value;
      try {
        key = decodeURIComponent(part.slice(0, separator).replaceAll("+", " "));
        value = decodeURIComponent(part.slice(separator + 1).replaceAll("+", " "));
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (key !== "meteorite") return { ok: false, reason: "malformed" };
      values.push(value);
    }
    if (values.length > 1) return { ok: false, reason: "duplicate" };
    if (!values[0]) return { ok: false, reason: "blank" };
    if (!isValidMeteoriteSlug(values[0])) return { ok: false, reason: "malformed" };
    return { ok: true, slug: values[0] };
  }

  function getMeteoriteId(item) {
    if (!item || typeof item !== "object") return null;
    const value = item.meteoriteId === undefined ? item.id : item.meteoriteId;
    return isValidMeteoriteSlug(value) ? value : null;
  }

  function resolveMeteoriteGroup(records, requestedSlug) {
    if (!Array.isArray(records) || !isValidMeteoriteSlug(requestedSlug)) return null;
    const requestedRecord = records.find((item) => item?.id === requestedSlug);
    const groupId = requestedRecord ? getMeteoriteId(requestedRecord) : requestedSlug;
    if (!groupId) return null;
    const members = records.filter((item) => getMeteoriteId(item) === groupId);
    if (!members.length) return null;
    members.sort((a, b) => {
      const order = (a.displayOrder ?? Number.POSITIVE_INFINITY) - (b.displayOrder ?? Number.POSITIVE_INFINITY);
      if (order) return order;
      const catalog = String(a.catalogNumber || "").localeCompare(String(b.catalogNumber || ""), undefined, { numeric: true, sensitivity: "base" });
      return catalog || String(a.id).localeCompare(String(b.id));
    });
    return { meteoriteId: groupId, members };
  }

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

  const api = {
    MAX_METEORITE_SLUG_LENGTH,
    isValidMeteoriteSlug,
    parseMeteoriteRequest,
    getMeteoriteId,
    resolveMeteoriteGroup,
    getSafeInquiryUrl,
    createCarouselPauseState,
    getHighlightWindow
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.InventoryUtils = api;
}(globalThis));
