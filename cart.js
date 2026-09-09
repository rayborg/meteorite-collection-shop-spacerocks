"use strict";

(function initializeCart(globalScope) {
  const STORAGE_KEY = "spacerocks-cart-v1";
  const ITEM_TYPES = new Set(["specimen", "book"]);

  function normalizeItem(item) {
    if (!item || !ITEM_TYPES.has(item.type) || typeof item.id !== "string" || !item.id.trim()) return null;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return null;
    const image = typeof item.image === "string" && /^\.\/assets\/(?:sale-specimens|books)\/[a-z0-9][a-z0-9._-]*$/u.test(item.image)
      ? item.image
      : null;
    return {
      key: `${item.type}:${item.id.trim()}`,
      type: item.type,
      id: item.id.trim(),
      catalogNumber: typeof item.catalogNumber === "string" ? item.catalogNumber.trim() : "",
      name,
      subtitle: typeof item.subtitle === "string" ? item.subtitle.trim() : "",
      priceUsd: Number.isFinite(item.priceUsd) && item.priceUsd >= 0 ? item.priceUsd : null,
      image,
      imageAlt: image && typeof item.imageAlt === "string" ? item.imageAlt.trim() : ""
    };
  }

  function readItems() {
    try {
      const parsed = JSON.parse(globalScope.localStorage?.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const unique = new Map();
      parsed.forEach((item) => {
        const normalized = normalizeItem(item);
        if (normalized) unique.set(normalized.key, normalized);
      });
      return [...unique.values()];
    } catch {
      return [];
    }
  }

  function notify(items) {
    if (typeof globalScope.dispatchEvent === "function" && typeof globalScope.CustomEvent === "function") {
      globalScope.dispatchEvent(new globalScope.CustomEvent("cart:change", { detail: { items } }));
    }
  }

  function writeItems(items) {
    const normalized = items.map(normalizeItem).filter(Boolean);
    try {
      globalScope.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
      notify(normalized);
      return normalized;
    } catch {
      return readItems();
    }
  }

  function add(item) {
    const normalized = normalizeItem(item);
    if (!normalized) return readItems();
    const items = readItems();
    if (!items.some((existing) => existing.key === normalized.key)) items.push(normalized);
    return writeItems(items);
  }

  function remove(key) {
    return writeItems(readItems().filter((item) => item.key !== key));
  }

  function clear() {
    return writeItems([]);
  }

  function has(key) {
    return readItems().some((item) => item.key === key);
  }

  function subtotal(items = readItems()) {
    return items.reduce((sum, item) => sum + (Number.isFinite(item.priceUsd) ? item.priceUsd : 0), 0);
  }

  const api = { STORAGE_KEY, normalizeItem, readItems, add, remove, clear, has, subtotal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.CartStore = api;

  if (typeof globalScope.addEventListener === "function") {
    globalScope.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) notify(readItems());
    });
  }
}(globalThis));
