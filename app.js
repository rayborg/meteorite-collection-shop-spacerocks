"use strict";

const DATA_FILES = {
  collection: "./data/collection.json",
  specimens: "./data/sale-specimens.json",
  books: "./data/books.json"
};

const state = {
  collection: [],
  specimens: [],
  books: []
};

const elements = {
  collectionGrid: document.querySelector("#collection-grid"),
  specimenGrid: document.querySelector("#specimen-grid"),
  bookGrid: document.querySelector("#book-grid"),
  collectionCount: document.querySelector("#collection-count"),
  specimenCount: document.querySelector("#specimen-count"),
  bookCount: document.querySelector("#book-count"),
  specimenResultCount: document.querySelector("#specimen-result-count"),
  specimenSearch: document.querySelector("#specimen-search"),
  classificationFilter: document.querySelector("#classification-filter"),
  specimenSort: document.querySelector("#specimen-sort"),
  availableOnly: document.querySelector("#available-only"),
  clearFilters: document.querySelector("#clear-specimen-filters"),
  menuButton: document.querySelector(".menu-button"),
  navigation: document.querySelector("#site-navigation"),
  wordmark: document.querySelector(".wordmark"),
  main: document.querySelector("main"),
  footer: document.querySelector(".site-footer"),
  emptyTemplate: document.querySelector("#empty-template")
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function text(value, fallback = "Not yet recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function createElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function createEmptyState(title, description) {
  const fragment = elements.emptyTemplate.content.cloneNode(true);
  fragment.querySelector("h3").textContent = title;
  fragment.querySelector("p").textContent = description;
  return fragment;
}

function createImage(item, kind) {
  const figure = createElement("div", "card-image");
  if (item.image) {
    const image = document.createElement("img");
    image.src = item.image;
    image.alt = text(item.imageAlt, "");
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);
  } else {
    figure.append(createElement("span", "image-placeholder"));
  }

  if (kind !== "collection") {
    const status = text(item.status, "coming soon").toLowerCase();
    const badge = createElement("span", `card-badge ${status.replace(/\s+/gu, "-")}`, status);
    figure.append(badge);
  }
  return figure;
}

function appendMeta(list, label, value) {
  if (value === null || value === undefined || value === "") return;
  const row = document.createElement("div");
  row.append(createElement("dt", "", label), createElement("dd", "", String(value)));
  list.append(row);
}

function createPriceFooter(item) {
  const footer = createElement("div", "card-footer");
  const price = createElement("div", "price");
  price.append(createElement("small", "", "Price"));
  price.append(document.createTextNode(Number.isFinite(item.priceUsd) ? currency.format(item.priceUsd) : "On request"));
  footer.append(price);

  const inquiryUrl = InventoryUtils.getSafeInquiryUrl(item.inquiryUrl);
  if (inquiryUrl && item.status === "available") {
    const link = createElement("a", "inquiry-link", "Make an inquiry ↗");
    link.href = inquiryUrl;
    if (inquiryUrl.startsWith("https:")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    footer.append(link);
  } else {
    footer.append(createElement("span", "inquiry-pending", "Inquiry details forthcoming"));
  }
  return footer;
}

function createSpecimenCard(item, kind = "sale") {
  const article = createElement("article", `catalog-card ${kind === "collection" ? "collection-card" : "sale-card"}`);
  article.append(createImage(item, kind));

  const body = createElement("div", "card-body");
  body.append(createElement("p", "card-catalog-number", text(item.catalogNumber, kind === "collection" ? "Cabinet record" : "Sale record")));
  body.append(createElement("h3", "", text(item.name, "Unnamed specimen")));
  body.append(createElement("p", "card-subtitle", text(item.classification, "Classification pending")));
  if (item.description) body.append(createElement("p", "card-description", item.description));

  const metadata = createElement("dl", "card-meta");
  appendMeta(metadata, "Mass", Number.isFinite(item.massGrams) ? `${number.format(item.massGrams)} g` : null);
  appendMeta(metadata, "Dimensions", item.dimensions);
  appendMeta(metadata, "Locality", item.locality);
  appendMeta(metadata, "Found", item.foundYear);
  appendMeta(metadata, "Acquired", item.acquiredYear);
  appendMeta(metadata, "Provenance", item.provenance);
  if (metadata.children.length) body.append(metadata);
  if (kind === "sale") body.append(createPriceFooter(item));
  article.append(body);
  return article;
}

function createBookCard(item) {
  const article = createElement("article", "catalog-card book-card");
  article.append(createImage(item, "book"));
  const body = createElement("div", "card-body");
  body.append(createElement("p", "card-catalog-number", text(item.catalogNumber, "Library record")));
  body.append(createElement("h3", "", text(item.title, "Untitled volume")));
  body.append(createElement("p", "card-subtitle", [item.author, item.year].filter(Boolean).join(" · ") || "Bibliographic details pending"));
  if (item.description) body.append(createElement("p", "card-description", item.description));

  const metadata = createElement("dl", "card-meta");
  appendMeta(metadata, "Edition", item.edition);
  appendMeta(metadata, "Condition", item.condition);
  appendMeta(metadata, "Publisher", item.publisher);
  appendMeta(metadata, "Format", item.format);
  if (metadata.children.length) body.append(metadata);
  body.append(createPriceFooter(item));
  article.append(body);
  return article;
}

function renderCollection() {
  elements.collectionGrid.replaceChildren();
  if (!state.collection.length) {
    elements.collectionGrid.append(createEmptyState(
      "The collection ledger is being prepared",
      "Photographs and catalog records will appear here as the personal collection folders are reviewed."
    ));
  } else {
    state.collection.forEach((item) => elements.collectionGrid.append(createSpecimenCard(item, "collection")));
  }
  elements.collectionGrid.setAttribute("aria-busy", "false");
}

function getFilteredSpecimens() {
  const query = elements.specimenSearch.value.trim().toLocaleLowerCase();
  const classification = elements.classificationFilter.value;
  const availableOnly = elements.availableOnly.checked;
  const filtered = state.specimens.filter((item) => {
    const searchable = [item.name, item.classification, item.locality, item.catalogNumber].filter(Boolean).join(" ").toLocaleLowerCase();
    return (!query || searchable.includes(query)) &&
      (!classification || item.classification === classification) &&
      (!availableOnly || item.status === "available");
  });

  const sort = elements.specimenSort.value;
  filtered.sort((a, b) => {
    if (sort === "price-asc") return (a.priceUsd ?? Number.POSITIVE_INFINITY) - (b.priceUsd ?? Number.POSITIVE_INFINITY);
    if (sort === "price-desc") return (b.priceUsd ?? Number.NEGATIVE_INFINITY) - (a.priceUsd ?? Number.NEGATIVE_INFINITY);
    if (sort === "mass-desc") return (b.massGrams ?? Number.NEGATIVE_INFINITY) - (a.massGrams ?? Number.NEGATIVE_INFINITY);
    return text(a.name, "").localeCompare(text(b.name, ""), undefined, { sensitivity: "base", numeric: true });
  });
  return filtered;
}

function renderSpecimens() {
  const specimens = getFilteredSpecimens();
  elements.specimenGrid.replaceChildren();
  elements.specimenResultCount.textContent = String(specimens.length);
  const filtersActive = elements.specimenSearch.value.trim() || elements.classificationFilter.value || !elements.availableOnly.checked || elements.specimenSort.value !== "name";
  elements.clearFilters.hidden = !filtersActive;

  if (!specimens.length) {
    const hasInventory = state.specimens.length > 0;
    elements.specimenGrid.append(createEmptyState(
      hasInventory ? "No specimens answer that description" : "The first sale list is being assembled",
      hasInventory ? "Try a broader search or clear the current filters." : "Documented specimens will be published here after the incoming folders and photographs are reviewed."
    ));
  } else {
    specimens.forEach((item) => elements.specimenGrid.append(createSpecimenCard(item)));
  }
  elements.specimenGrid.setAttribute("aria-busy", "false");
}

function renderBooks() {
  elements.bookGrid.replaceChildren();
  const availableBooks = state.books.filter((item) => item.status !== "sold");
  if (!availableBooks.length) {
    elements.bookGrid.append(createEmptyState(
      "The bookseller's list is forthcoming",
      "Reference books, catalogs, and collectible volumes will be added after the library inventory is supplied."
    ));
  } else {
    availableBooks.forEach((item) => elements.bookGrid.append(createBookCard(item)));
  }
  elements.bookGrid.setAttribute("aria-busy", "false");
}

function populateClassifications() {
  const values = [...new Set(state.specimens.map((item) => item.classification).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    elements.classificationFilter.append(option);
  });
}

function updateCounts() {
  elements.collectionCount.textContent = number.format(state.collection.length);
  elements.specimenCount.textContent = number.format(state.specimens.filter((item) => item.status === "available").length);
  elements.bookCount.textContent = number.format(state.books.filter((item) => item.status === "available").length);
}

function handleFilterChange() {
  renderSpecimens();
}

function clearFilters() {
  elements.specimenSearch.value = "";
  elements.classificationFilter.value = "";
  elements.specimenSort.value = "name";
  elements.availableOnly.checked = true;
  renderSpecimens();
  elements.specimenSearch.focus();
}

function setPageInert(inert) {
  elements.wordmark.inert = inert;
  elements.main.inert = inert;
  elements.footer.inert = inert;
}

function getMenuFocusableElements() {
  return [elements.menuButton, ...elements.navigation.querySelectorAll("a")];
}

function openMenu() {
  elements.menuButton.setAttribute("aria-expanded", "true");
  elements.navigation.classList.add("open");
  document.body.classList.add("menu-open");
  setPageInert(true);
  elements.navigation.querySelector("a").focus();
}

function closeMenu(restoreFocus = false) {
  const wasOpen = elements.menuButton.getAttribute("aria-expanded") === "true";
  elements.menuButton.setAttribute("aria-expanded", "false");
  elements.navigation.classList.remove("open");
  document.body.classList.remove("menu-open");
  setPageInert(false);
  if (restoreFocus && wasOpen) elements.menuButton.focus();
}

function handleMenuKeydown(event) {
  if (elements.menuButton.getAttribute("aria-expanded") !== "true") return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = getMenuFocusableElements();
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function setupInteractions() {
  elements.specimenSearch.addEventListener("input", handleFilterChange);
  elements.classificationFilter.addEventListener("change", handleFilterChange);
  elements.specimenSort.addEventListener("change", handleFilterChange);
  elements.availableOnly.addEventListener("change", handleFilterChange);
  elements.clearFilters.addEventListener("click", clearFilters);

  elements.menuButton.addEventListener("click", () => {
    const expanded = elements.menuButton.getAttribute("aria-expanded") === "true";
    if (expanded) closeMenu();
    else openMenu();
  });
  elements.navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu()));
  window.addEventListener("keydown", handleMenuKeydown);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 820) closeMenu();
  });
}

async function loadData() {
  try {
    const responses = await Promise.all(Object.values(DATA_FILES).map((path) => fetch(path)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`Inventory request failed with status ${failed.status}`);
    const datasets = await Promise.all(responses.map((response) => response.json()));
    const [collection, specimens, books] = datasets;
    state.collection = Array.isArray(collection.items) ? collection.items : [];
    state.specimens = Array.isArray(specimens.items) ? specimens.items : [];
    state.books = Array.isArray(books.items) ? books.items : [];
  } catch (error) {
    console.error("The inventory files could not be loaded.", error);
  }

  populateClassifications();
  updateCounts();
  renderCollection();
  renderSpecimens();
  renderBooks();
}

setupInteractions();
loadData();
