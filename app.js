"use strict";

const DATA_FILES = {
  collection: "./data/collection.json",
  specimens: "./data/sale-specimens.json",
  books: "./data/books.json"
};

const CAROUSEL_INTERVAL_MS = 3000;
const HIGHLIGHT_ROTATION_MS = 15000;

const state = {
  collection: [],
  specimens: [],
  books: []
};

const dataStatus = {
  collection: "pending",
  specimens: "pending",
  books: "pending"
};

const elements = {
  collectionHighlights: document.querySelector("#collection-highlights"),
  specimenHighlights: document.querySelector("#specimen-highlights"),
  bookHighlights: document.querySelector("#book-highlights"),
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
  collectionResultCount: document.querySelector("#collection-result-count"),
  collectionSearch: document.querySelector("#collection-search"),
  collectionClassification: document.querySelector("#collection-classification"),
  collectionSort: document.querySelector("#collection-sort"),
  clearCollectionFilters: document.querySelector("#clear-collection-filters"),
  bookResultCount: document.querySelector("#book-result-count"),
  bookSearch: document.querySelector("#book-search"),
  bookListingFilter: document.querySelector("#book-listing-filter"),
  bookSort: document.querySelector("#book-sort"),
  bookAvailableOnly: document.querySelector("#book-available-only"),
  clearBookFilters: document.querySelector("#clear-book-filters"),
  cartCounts: document.querySelectorAll(".cart-count"),
  menuButton: document.querySelector(".menu-button"),
  navigation: document.querySelector("#site-navigation"),
  wordmark: document.querySelector(".wordmark"),
  main: document.querySelector("main"),
  footer: document.querySelector(".site-footer"),
  emptyTemplate: document.querySelector("#empty-template"),
  specimenDetailGrid: document.querySelector("#specimen-detail-grid"),
  specimenDetailHeading: document.querySelector("#specimen-detail-heading"),
  specimenDetailSummary: document.querySelector("#specimen-detail-summary"),
  specimenDetailLinks: document.querySelector("#specimen-detail-links"),
  specimenCanonical: document.querySelector("#specimen-canonical"),
  pageDescription: document.querySelector('meta[name="description"]')
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

function getSpecimenDetailUrl(item) {
  const meteoriteId = InventoryUtils.getMeteoriteId(item);
  return meteoriteId ? `./specimen.html?meteorite=${encodeURIComponent(meteoriteId)}` : null;
}

function createImage(item, kind) {
  const figure = createElement("div", "card-image");
  const images = kind === "book"
    ? [item.image].filter(Boolean)
    : [...new Set([item.image, ...(Array.isArray(item.images) ? item.images : [])].filter(Boolean))];
  if (images.length) {
    const imageRegion = createElement("a", "card-image-link");
    imageRegion.target = "_blank";
    imageRegion.rel = "noopener noreferrer";
    figure.append(imageRegion);
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    imageRegion.append(image);

    const label = kind === "book" ? text(item.title, "Book") : text(item.name, "Specimen");
    const primaryAlt = text(item.imageAlt, `${label} primary view`);
    let activeIndex = 0;
    let counter;
    const showImage = (index) => {
      activeIndex = index;
      image.src = images[activeIndex];
      image.alt = activeIndex === 0 ? primaryAlt : `${label}, alternate view ${activeIndex + 1} of ${images.length}`;
      imageRegion.href = images[activeIndex];
      imageRegion.setAttribute("aria-label", `Open full-resolution image ${activeIndex + 1} of ${images.length} for ${label} in a new tab`);
      if (counter) counter.textContent = `${activeIndex + 1} / ${images.length}`;
    };
    showImage(0);

    if (images.length > 1) {
      figure.classList.add("card-carousel");
      figure.setAttribute("role", "group");
      figure.setAttribute("aria-roledescription", "carousel");
      figure.setAttribute("aria-label", `${label} image carousel`);

      counter = createElement("span", "carousel-count", `1 / ${images.length}`);
      counter.setAttribute("aria-hidden", "true");
      const previous = createElement("button", "carousel-arrow carousel-previous", "←");
      previous.type = "button";
      previous.setAttribute("aria-label", `Previous image for ${label}`);
      const next = createElement("button", "carousel-arrow carousel-next", "→");
      next.type = "button";
      next.setAttribute("aria-label", `Next image for ${label}`);
      const toggle = createElement("button", "carousel-toggle");
      toggle.type = "button";
      const pauseState = InventoryUtils.createCarouselPauseState(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      const updateToggle = () => {
        toggle.textContent = pauseState.userPaused ? "Play" : "Pause";
        toggle.setAttribute("aria-label", `${pauseState.userPaused ? "Play" : "Pause"} image rotation for ${label}`);
      };
      updateToggle();
      toggle.addEventListener("click", () => {
        pauseState.toggleUserPaused();
        updateToggle();
      });
      const showManualImage = (index) => {
        pauseState.pauseForManualNavigation();
        updateToggle();
        showImage(index);
      };
      previous.addEventListener("click", () => showManualImage((activeIndex - 1 + images.length) % images.length));
      next.addEventListener("click", () => showManualImage((activeIndex + 1) % images.length));
      figure.addEventListener("pointerenter", () => pauseState.setPointerActive(true));
      figure.addEventListener("pointerleave", () => pauseState.setPointerActive(false));
      figure.addEventListener("focusin", () => pauseState.setFocusActive(true));
      figure.addEventListener("focusout", (event) => {
        if (!figure.contains(event.relatedTarget)) pauseState.setFocusActive(false);
      });

      const cycle = () => {
        if (!figure.isConnected) return;
        if (pauseState.canAdvance(document.hidden)) showImage((activeIndex + 1) % images.length);
        window.setTimeout(cycle, CAROUSEL_INTERVAL_MS);
      };
      window.setTimeout(cycle, CAROUSEL_INTERVAL_MS);
      figure.append(previous, next, toggle, counter);
    }
  } else {
    figure.append(createElement("span", "image-placeholder"));
  }

  if (kind !== "collection") {
    const status = kind === "book" && item.listingType === "collection"
      ? "reference library"
      : text(item.status, "coming soon").toLowerCase();
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

function createCartItem(item, type) {
  return {
    type,
    id: item.id,
    catalogNumber: item.catalogNumber,
    name: type === "book" ? item.title : item.name,
    subtitle: type === "book" ? [item.author, item.year].filter(Boolean).join(" · ") : item.classification,
    priceUsd: item.priceUsd,
    image: item.image,
    imageAlt: item.imageAlt
  };
}

function createPriceFooter(item, type) {
  const footer = createElement("div", "card-footer");
  const price = createElement("div", "price");
  price.append(createElement("small", "", "Price"));
  price.append(document.createTextNode(Number.isFinite(item.priceUsd) ? currency.format(item.priceUsd) : "TBD"));
  footer.append(price);

  if (item.status === "available") {
    const cartItem = createCartItem(item, type);
    const button = createElement("button", "add-cart-button", "Add to cart");
    button.type = "button";
    button.dataset.cartKey = `${type}:${item.id}`;
    button.addEventListener("click", () => {
      CartStore.add(cartItem);
      updateCartUI();
    });
    footer.append(button);
  } else {
    footer.append(createElement("span", "inquiry-pending", "Not currently available"));
  }
  return footer;
}

function createSpecimenCard(item, kind = "sale", { detailPage = false } = {}) {
  const article = createElement("article", `catalog-card ${kind === "collection" ? "collection-card" : "sale-card"}`);
  const detailUrl = getSpecimenDetailUrl(item);
  article.append(createImage(item, kind));

  const body = createElement("div", "card-body");
  const information = createElement(detailPage || !detailUrl ? "div" : "a", "card-info-link");
  if (!detailPage && detailUrl) {
    information.href = detailUrl;
    information.setAttribute("aria-label", `Open the record for ${text(item.name, "this specimen")}`);
  }
  information.append(createElement("p", "card-catalog-number", text(item.catalogNumber, kind === "collection" ? "Cabinet record" : "Sale record")));
  information.append(createElement("h3", "", text(item.name, "Unnamed specimen")));
  information.append(createElement("p", "card-subtitle", text(item.classification, "Classification pending")));
  if (item.description) information.append(createElement("p", "card-description", item.description));

  const metadata = createElement("dl", "card-meta");
  appendMeta(metadata, "Mass", Number.isFinite(item.massGrams) ? `${number.format(item.massGrams)} g` : null);
  appendMeta(metadata, "Dimensions", item.dimensions);
  appendMeta(metadata, "Locality", item.locality);
  appendMeta(metadata, "Found", item.foundYear);
  appendMeta(metadata, "Acquired", item.acquiredYear);
  appendMeta(metadata, "Provenance", item.provenance);
  if (metadata.children.length) information.append(metadata);
  body.append(information);
  if (kind === "sale") body.append(createPriceFooter(item, "specimen"));
  if (kind === "collection" && detailPage) {
    const footer = createElement("div", "card-footer");
    footer.append(createElement("span", "retained-status", "Retained in the private collection · Not for sale"));
    body.append(footer);
  }
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
  if (item.listingType !== "collection") body.append(createPriceFooter(item, "book"));
  article.append(body);
  return article;
}

function renderCollection() {
  if (!elements.collectionGrid) return;
  const query = elements.collectionSearch.value.trim().toLocaleLowerCase();
  const classification = elements.collectionClassification.value;
  const sort = elements.collectionSort.value;
  const collection = state.collection.filter((item) => {
    const searchable = [item.name, item.classification, item.locality, item.provenance, item.catalogNumber]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return (!query || searchable.includes(query)) && (!classification || item.classification === classification);
  });
  collection.sort((a, b) => {
    if (sort === "catalog") return compareCatalogOrder(a, b, "name");
    if (sort === "mass-desc") return (b.massGrams ?? Number.NEGATIVE_INFINITY) - (a.massGrams ?? Number.NEGATIVE_INFINITY);
    if (sort === "acquired-desc") return (b.acquiredYear ?? Number.NEGATIVE_INFINITY) - (a.acquiredYear ?? Number.NEGATIVE_INFINITY);
    return text(a.name, "").localeCompare(text(b.name, ""), undefined, { sensitivity: "base", numeric: true });
  });

  elements.collectionGrid.replaceChildren();
  elements.collectionResultCount.textContent = String(collection.length);
  const filtersActive = query || classification || sort !== "catalog";
  elements.clearCollectionFilters.hidden = !filtersActive;
  if (!collection.length) {
    const hasInventory = state.collection.length > 0;
    elements.collectionGrid.append(createEmptyState(
      hasInventory ? "No collection records answer that description" : "The collection ledger is being prepared",
      hasInventory ? "Try a broader search or clear the current filters." : "Photographs and catalog records will appear here as the personal collection folders are reviewed."
    ));
  } else {
    collection.forEach((item) => elements.collectionGrid.append(createSpecimenCard(item, "collection")));
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
    if (sort === "catalog") return compareCatalogOrder(a, b, "name");
    if (sort === "price-asc") return (a.priceUsd ?? Number.POSITIVE_INFINITY) - (b.priceUsd ?? Number.POSITIVE_INFINITY);
    if (sort === "price-desc") return (b.priceUsd ?? Number.NEGATIVE_INFINITY) - (a.priceUsd ?? Number.NEGATIVE_INFINITY);
    if (sort === "mass-desc") return (b.massGrams ?? Number.NEGATIVE_INFINITY) - (a.massGrams ?? Number.NEGATIVE_INFINITY);
    return text(a.name, "").localeCompare(text(b.name, ""), undefined, { sensitivity: "base", numeric: true });
  });
  return filtered;
}

function renderSpecimens() {
  if (!elements.specimenGrid) return;
  const specimens = getFilteredSpecimens();
  elements.specimenGrid.replaceChildren();
  elements.specimenResultCount.textContent = String(specimens.length);
  const filtersActive = elements.specimenSearch.value.trim() || elements.classificationFilter.value || !elements.availableOnly.checked || elements.specimenSort.value !== "catalog";
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
  if (!elements.bookGrid) return;
  const query = elements.bookSearch.value.trim().toLocaleLowerCase();
  const listingFilter = elements.bookListingFilter.value;
  const sort = elements.bookSort.value;
  const hideSold = elements.bookAvailableOnly.checked;
  const books = state.books.filter((item) => {
    const listingType = item.listingType === "collection" ? "collection" : "sale";
    const searchable = [item.title, item.author, item.publisher, item.catalogNumber, item.description]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return (!query || searchable.includes(query)) &&
      (!listingFilter || listingType === listingFilter) &&
      (!hideSold || listingType === "collection" || item.status !== "sold");
  });
  books.sort((a, b) => {
    if (sort === "catalog") return compareCatalogOrder(a, b, "title");
    if (sort === "price-asc") return (a.priceUsd ?? Number.POSITIVE_INFINITY) - (b.priceUsd ?? Number.POSITIVE_INFINITY);
    if (sort === "price-desc") return (b.priceUsd ?? Number.NEGATIVE_INFINITY) - (a.priceUsd ?? Number.NEGATIVE_INFINITY);
    if (sort === "year-desc") return (b.year ?? Number.NEGATIVE_INFINITY) - (a.year ?? Number.NEGATIVE_INFINITY);
    return text(a.title, "").localeCompare(text(b.title, ""), undefined, { sensitivity: "base", numeric: true });
  });

  elements.bookGrid.replaceChildren();
  elements.bookResultCount.textContent = String(books.length);
  const filtersActive = query || listingFilter || sort !== "catalog" || !hideSold;
  elements.clearBookFilters.hidden = !filtersActive;
  if (!books.length) {
    const hasInventory = state.books.length > 0;
    elements.bookGrid.append(createEmptyState(
      hasInventory ? "No books answer that description" : "The bookseller's list is forthcoming",
      hasInventory ? "Try a broader search or clear the current filters." : "Reference books, catalogs, and collectible volumes will be added after the library inventory is supplied."
    ));
  } else {
    books.forEach((item) => elements.bookGrid.append(createBookCard(item)));
  }
  elements.bookGrid.setAttribute("aria-busy", "false");
}

function renderRotatingHighlights(container, records, { limit, createCard, emptyTitle, emptyDescription, label }) {
  if (!container) return;
  let offset = 0;
  const render = () => {
    container.setAttribute("aria-busy", "true");
    container.replaceChildren();
    if (records.length) {
      InventoryUtils.getHighlightWindow(records, offset, limit).forEach((item) => container.append(createCard(item)));
    } else {
      container.append(createEmptyState(emptyTitle, emptyDescription));
    }
    container.setAttribute("aria-busy", "false");
  };
  render();

  if (records.length <= limit) return;
  const summary = container.closest("section")?.querySelector(".section-summary");
  if (!summary) return;
  const pauseState = InventoryUtils.createCarouselPauseState(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const toggle = createElement("button", "highlight-toggle");
  toggle.type = "button";
  const updateToggle = () => {
    toggle.textContent = `${pauseState.userPaused ? "Play" : "Pause"} ${label}`;
    toggle.setAttribute("aria-label", `${pauseState.userPaused ? "Play" : "Pause"} rotating ${label}`);
  };
  updateToggle();
  toggle.addEventListener("click", () => {
    pauseState.toggleUserPaused();
    updateToggle();
  });
  container.addEventListener("pointerenter", () => pauseState.setPointerActive(true));
  container.addEventListener("pointerleave", () => pauseState.setPointerActive(false));
  container.addEventListener("focusin", () => pauseState.setFocusActive(true));
  container.addEventListener("focusout", (event) => {
    if (!container.contains(event.relatedTarget)) pauseState.setFocusActive(false);
  });
  summary.append(toggle);

  const cycle = () => {
    if (!container.isConnected) return;
    if (pauseState.canAdvance(document.hidden)) {
      offset = (offset + limit) % records.length;
      render();
    }
    window.setTimeout(cycle, HIGHLIGHT_ROTATION_MS);
  };
  window.setTimeout(cycle, HIGHLIGHT_ROTATION_MS);
}

function renderHighlights() {
  const collectionRecords = [...state.collection].sort((a, b) => compareCatalogOrder(a, b, "name"));
  renderRotatingHighlights(elements.collectionHighlights, collectionRecords, {
    limit: 3,
    createCard: (item) => createSpecimenCard(item, "collection"),
    emptyTitle: "Collection highlights are being prepared",
    emptyDescription: "The first selected records will appear here when the collection folders are reviewed.",
    label: "collection highlights"
  });

  const specimenRecords = state.specimens.filter((item) => item.status === "available")
    .sort((a, b) => compareCatalogOrder(a, b, "name"));
  renderRotatingHighlights(elements.specimenHighlights, specimenRecords, {
    limit: 2,
    createCard: (item) => createSpecimenCard(item),
    emptyTitle: "The first sale highlights are being assembled",
    emptyDescription: "Documented specimens will appear here after the incoming folders and photographs are reviewed.",
    label: "sale highlights"
  });

  const bookRecords = state.books.filter((item) => item.listingType !== "collection" && item.status === "available")
    .sort((a, b) => compareCatalogOrder(a, b, "title"));
  renderRotatingHighlights(elements.bookHighlights, bookRecords, {
    limit: 2,
    createCard: (item) => createBookCard(item),
    emptyTitle: "Book highlights are forthcoming",
    emptyDescription: "Selected reference and collectible volumes will appear here when the library inventory is supplied.",
    label: "book highlights"
  });
}

function populateClassifications() {
  const populate = (select, items) => {
    if (!select) return;
    const values = [...new Set(items.map((item) => item.classification).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
  };
  populate(elements.classificationFilter, state.specimens);
  populate(elements.collectionClassification, state.collection);
}

function updateCounts() {
  if (elements.collectionCount) elements.collectionCount.textContent = dataStatus.collection === "loaded" ? number.format(state.collection.length) : "—";
  if (elements.specimenCount) elements.specimenCount.textContent = dataStatus.specimens === "loaded" ? number.format(state.specimens.filter((item) => item.status === "available").length) : "—";
  if (elements.bookCount) elements.bookCount.textContent = dataStatus.books === "loaded" ? number.format(state.books.filter((item) => item.status === "available").length) : "—";
}

function appendSpecimenDetailLink(href, label) {
  const link = createElement("a", "button", label);
  link.href = href;
  elements.specimenDetailLinks.append(link);
}

function showSpecimenDetailState(title, description) {
  elements.specimenDetailHeading.textContent = title;
  elements.specimenDetailSummary.textContent = description;
  elements.specimenDetailLinks.replaceChildren();
  appendSpecimenDetailLink("./collection.html", "Browse the collection");
  appendSpecimenDetailLink("./specimens.html", "Browse specimens for sale");
  elements.specimenDetailGrid.replaceChildren(createEmptyState(title, description));
  elements.specimenDetailGrid.setAttribute("aria-busy", "false");
  document.title = `${title} | The Spacerocks Cabinet`;
  elements.pageDescription.content = description;
}

function renderSpecimenDetail() {
  if (!elements.specimenDetailGrid) return;
  if (dataStatus.collection !== "loaded" || dataStatus.specimens !== "loaded") {
    showSpecimenDetailState(
      "Specimen records unavailable",
      "The collection and sale ledgers could not both be loaded, so a complete meteorite group cannot be shown."
    );
    return;
  }

  const request = InventoryUtils.parseMeteoriteRequest(window.location.search);
  if (!request.ok) {
    const descriptions = {
      missing: "No meteorite was specified. Open a specimen from the collection or sale catalog.",
      blank: "The meteorite parameter is blank. Open a specimen from the collection or sale catalog.",
      duplicate: "Only one meteorite parameter is permitted.",
      malformed: "The meteorite parameter is malformed. Open a trusted catalog link instead."
    };
    showSpecimenDetailState("Invalid specimen request", descriptions[request.reason] || descriptions.malformed);
    return;
  }

  const records = [
    ...state.collection.map((item) => ({ ...item, catalogSource: "collection" })),
    ...state.specimens.map((item) => ({ ...item, catalogSource: "sale" }))
  ];
  const group = InventoryUtils.resolveMeteoriteGroup(records, request.slug);
  if (!group) {
    showSpecimenDetailState(
      "Specimen not found",
      "No collection or sale record matches this meteorite address."
    );
    return;
  }

  const name = text(group.members[0].name, "Unnamed meteorite");
  const count = group.members.length;
  const description = `${count} physical ${count === 1 ? "specimen is" : "specimens are"} documented on this meteorite page.`;
  elements.specimenDetailHeading.textContent = name;
  elements.specimenDetailSummary.textContent = description;
  document.title = `${name} | The Spacerocks Cabinet`;
  elements.pageDescription.content = `${name}: ${description}`;
  const canonicalUrl = new URL("./specimen.html", window.location.href);
  canonicalUrl.searchParams.set("meteorite", group.meteoriteId);
  elements.specimenCanonical.href = canonicalUrl.href;

  elements.specimenDetailLinks.replaceChildren();
  if (group.members.some((item) => item.catalogSource === "collection")) {
    appendSpecimenDetailLink("./collection.html", "Back to collection");
  }
  if (group.members.some((item) => item.catalogSource === "sale")) {
    appendSpecimenDetailLink("./specimens.html", "Back to specimens for sale");
  }

  elements.specimenDetailGrid.replaceChildren();
  group.members.forEach((item) => {
    const kind = item.catalogSource === "collection" ? "collection" : "sale";
    elements.specimenDetailGrid.append(createSpecimenCard(item, kind, { detailPage: true }));
  });
  elements.specimenDetailGrid.classList.toggle("singleton-detail", count === 1);
  elements.specimenDetailGrid.setAttribute("aria-busy", "false");
}

function compareCatalogOrder(a, b, labelKey) {
  const orderDifference = (a.displayOrder ?? Number.POSITIVE_INFINITY) - (b.displayOrder ?? Number.POSITIVE_INFINITY);
  if (orderDifference) return orderDifference;
  return text(a[labelKey], "").localeCompare(text(b[labelKey], ""), undefined, { sensitivity: "base", numeric: true });
}

function handleFilterChange() {
  renderSpecimens();
}

function clearFilters() {
  elements.specimenSearch.value = "";
  elements.classificationFilter.value = "";
  elements.specimenSort.value = "catalog";
  elements.availableOnly.checked = true;
  renderSpecimens();
  elements.specimenSearch.focus();
}

function clearCollectionFilters() {
  elements.collectionSearch.value = "";
  elements.collectionClassification.value = "";
  elements.collectionSort.value = "catalog";
  renderCollection();
  elements.collectionSearch.focus();
}

function clearBookFilters() {
  elements.bookSearch.value = "";
  elements.bookListingFilter.value = "";
  elements.bookSort.value = "catalog";
  elements.bookAvailableOnly.checked = true;
  renderBooks();
  elements.bookSearch.focus();
}

function updateCartUI() {
  const items = CartStore.readItems();
  elements.cartCounts.forEach((count) => {
    count.textContent = String(items.length);
    count.setAttribute("aria-label", `${items.length} ${items.length === 1 ? "item" : "items"} in cart`);
  });
  document.querySelectorAll(".add-cart-button").forEach((button) => {
    const inCart = items.some((item) => item.key === button.dataset.cartKey);
    button.disabled = inCart;
    button.textContent = inCart ? "In cart" : "Add to cart";
  });
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
  if (elements.specimenSearch) {
    elements.specimenSearch.addEventListener("input", handleFilterChange);
    elements.classificationFilter.addEventListener("change", handleFilterChange);
    elements.specimenSort.addEventListener("change", handleFilterChange);
    elements.availableOnly.addEventListener("change", handleFilterChange);
    elements.clearFilters.addEventListener("click", clearFilters);
  }
  if (elements.collectionSearch) {
    elements.collectionSearch.addEventListener("input", renderCollection);
    elements.collectionClassification.addEventListener("change", renderCollection);
    elements.collectionSort.addEventListener("change", renderCollection);
    elements.clearCollectionFilters.addEventListener("click", clearCollectionFilters);
  }
  if (elements.bookSearch) {
    elements.bookSearch.addEventListener("input", renderBooks);
    elements.bookListingFilter.addEventListener("change", renderBooks);
    elements.bookSort.addEventListener("change", renderBooks);
    elements.bookAvailableOnly.addEventListener("change", renderBooks);
    elements.clearBookFilters.addEventListener("click", clearBookFilters);
  }

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
  window.addEventListener("cart:change", updateCartUI);
}

async function loadData() {
  const entries = Object.entries(DATA_FILES);
  const results = await Promise.allSettled(entries.map(async ([, file]) => {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Inventory request failed with status ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.items)) throw new Error("Inventory response does not contain an items array");
    return data.items;
  }));
  results.forEach((result, index) => {
    const key = entries[index][0];
    if (result.status === "fulfilled") {
      state[key] = result.value;
      dataStatus[key] = "loaded";
    } else {
      dataStatus[key] = "error";
      console.error(`The ${key} inventory file could not be loaded.`, result.reason);
    }
  });

  populateClassifications();
  updateCounts();
  renderSpecimenDetail();
  renderHighlights();
  renderCollection();
  renderSpecimens();
  renderBooks();
  updateCartUI();
}

setupInteractions();
loadData();
