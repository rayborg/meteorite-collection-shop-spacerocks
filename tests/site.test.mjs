import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const InventoryUtils = require("../inventory-utils.js");
const {
  createCarouselPauseState,
  getHighlightWindow,
  getMeteoriteId,
  getSafeInquiryUrl,
  isValidMeteoriteSlug,
  parseMeteoriteRequest,
  resolveMeteoriteGroup
} = InventoryUtils;
const CartStore = require("../cart.js");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

class FakeNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = {};
    this.isConnected = false;
    this._className = "";
    this._text = "";
    this.classList = {
      add: (...names) => this.setClasses([...this.classes(), ...names]),
      remove: (...names) => this.setClasses([...this.classes()].filter((name) => !names.includes(name))),
      toggle: (name, force) => {
        const names = this.classes();
        const active = force === undefined ? !names.has(name) : force;
        if (active) names.add(name);
        else names.delete(name);
        this.setClasses([...names]);
        return active;
      }
    };
  }

  get className() { return this._className; }
  set className(value) { this._className = String(value); }
  classes() { return new Set(this._className.split(/\s+/u).filter(Boolean)); }
  setClasses(names) { this._className = [...new Set(names)].join(" "); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; this._text = ""; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { this.listeners.click?.({}); }
  contains(candidate) { return this === candidate || this.children.some((child) => child.contains?.(candidate)); }
  closest() { return null; }
  focus() {}
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (!(node instanceof FakeNode)) return;
      const classMatch = selector.startsWith(".") && node.classes().has(selector.slice(1));
      const tagMatch = !selector.startsWith(".") && node.tagName === selector.toUpperCase();
      if (classMatch || tagMatch) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
  cloneNode(deep = false) {
    const clone = new FakeNode(this.tagName);
    clone.className = this.className;
    clone._text = this._text;
    if (deep) clone.children = this.children.map((child) => child.cloneNode?.(true) || child);
    return clone;
  }
}

async function runDetailPage({ search = "?meteorite=allende", collection = [], specimens = [], fail = [] } = {}) {
  const nodes = new Map();
  const register = (selector, node = new FakeNode()) => { nodes.set(selector, node); return node; };
  const detailGrid = register("#specimen-detail-grid");
  const heading = register("#specimen-detail-heading");
  const summary = register("#specimen-detail-summary");
  const links = register("#specimen-detail-links", new FakeNode("nav"));
  const canonical = register("#specimen-canonical", new FakeNode("link"));
  const description = register('meta[name="description"]', new FakeNode("meta"));
  register("#collection-count");
  register("#specimen-count");
  register("#book-count");
  register(".wordmark", new FakeNode("a"));
  const menuButton = register(".menu-button", new FakeNode("button"));
  menuButton.setAttribute("aria-expanded", "false");
  const navigation = register("#site-navigation", new FakeNode("nav"));
  navigation.append(new FakeNode("a"));
  register("main", new FakeNode("main"));
  register(".site-footer", new FakeNode("footer"));
  const template = register("#empty-template", new FakeNode("template"));
  template.content = new FakeNode("fragment");
  template.content.append(new FakeNode("h3"), new FakeNode("p"));
  const cartCount = new FakeNode("span");
  const body = new FakeNode("body");
  const document = {
    body,
    hidden: false,
    title: "",
    activeElement: null,
    querySelector: (selector) => nodes.get(selector) || null,
    querySelectorAll: (selector) => selector === ".cart-count" ? [cartCount] : detailGrid.querySelectorAll(selector),
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (value) => { const node = new FakeNode("#text"); node.textContent = value; return node; }
  };
  const cartItems = [];
  const datasets = {
    "./data/collection.json": { items: collection },
    "./data/sale-specimens.json": { items: specimens },
    "./data/books.json": { items: [] }
  };
  const context = {
    document,
    InventoryUtils,
    CartStore: {
      add(item) { cartItems.push(CartStore.normalizeItem(item)); },
      readItems() { return cartItems; }
    },
    fetch: async (file) => {
      if (fail.includes(file)) return { ok: false, status: 500 };
      return { ok: true, async json() { return datasets[file]; } };
    },
    URL,
    Intl,
    console: { error() {} },
    window: {
      location: { search, href: `https://example.test/specimen.html${search}` },
      matchMedia: () => ({ matches: false }),
      setTimeout() {},
      addEventListener() {},
      innerWidth: 1200
    }
  };
  vm.runInNewContext(await read("app.js"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { cartItems, canonical, description, detailGrid, document, heading, links, summary };
}

test("inventory files use the supported empty-or-populated schema", async () => {
  const validStatuses = new Set(["available", "reserved", "sold"]);
  for (const relativePath of ["data/collection.json", "data/sale-specimens.json", "data/books.json"]) {
    const data = JSON.parse(await read(relativePath));
    assert.equal(data.schemaVersion, 1, `${relativePath} schema version`);
    assert.ok(Array.isArray(data.items), `${relativePath} items must be an array`);
    const ids = data.items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${relativePath} IDs must be unique`);
    for (const item of data.items) {
      assert.equal(typeof item.id, "string", `${relativePath} item IDs must be strings`);
      assert.ok(item.id.trim(), `${relativePath} item IDs must not be blank`);
      if (relativePath !== "data/books.json") {
        assert.ok(isValidMeteoriteSlug(item.id), `${relativePath} IDs must be safe detail slugs`);
        assert.ok(item.meteoriteId === undefined || isValidMeteoriteSlug(item.meteoriteId), `${relativePath} meteoriteId must be a safe optional slug`);
      }
      for (const privateKey of ["cost_usd", "costUsd", "costUsdCents", "acquisitionCost"]) {
        assert.equal(privateKey in item, false, `${relativePath} must not publish ${privateKey}`);
      }
      assert.ok(item.displayOrder === undefined || (Number.isInteger(item.displayOrder) && item.displayOrder > 0), `${relativePath} display orders must be positive integers`);
      const isBooks = relativePath === "data/books.json";
      if (isBooks) assert.ok(item.listingType === "collection" || item.listingType === "sale", `${relativePath} books need a collection or sale listingType`);
      const isSale = relativePath === "data/sale-specimens.json" || (isBooks && item.listingType === "sale");
      if (isSale) {
        assert.ok(validStatuses.has(item.status), `${relativePath} has unsupported status ${item.status}`);
        assert.ok(item.priceUsd === undefined || (Number.isFinite(item.priceUsd) && item.priceUsd >= 0), `${relativePath} prices must be nonnegative numbers`);
        assert.ok(item.inquiryUrl === undefined || getSafeInquiryUrl(item.inquiryUrl), `${relativePath} contains an unsafe inquiry URL`);
      }
      if (item.image !== undefined) {
        assert.match(item.image, /^\.\/assets\/(?:collection|sale-specimens|books)\/[a-z0-9][a-z0-9._-]*$/u, `${relativePath} image path must be a safe relative asset path`);
      }
      for (const image of item.images || []) {
        assert.match(image, /^\.\/assets\/(?:collection|sale-specimens|books)\/[a-z0-9][a-z0-9._-]*$/u, `${relativePath} image gallery paths must be safe relative assets`);
      }
    }
  }
});

test("specimen requests are strict and physical aliases expand their meteorite group", () => {
  assert.deepEqual(parseMeteoriteRequest("?meteorite=allende"), { ok: true, slug: "allende" });
  for (const [query, reason] of [
    ["", "missing"], ["?meteorite=", "blank"], ["?meteorite=a&meteorite=b", "duplicate"],
    ["?meteorite=Mixed-Case", "malformed"], ["?meteorite=%E0%A4%A", "malformed"],
    ["?meteorite=%3Cscript%3E", "malformed"], [`?meteorite=${"a".repeat(81)}`, "malformed"],
    ["?other=allende", "malformed"], ["?meteorite=allende&other=x", "malformed"]
  ]) assert.equal(parseMeteoriteRequest(query).reason, reason, query);

  const records = [
    { id: "stone-b", meteoriteId: "allende", name: "Allende", displayOrder: 2 },
    { id: "stone-a", meteoriteId: "allende", name: "Allende", displayOrder: 1 },
    { id: "singleton", name: "Singleton", displayOrder: 3 }
  ];
  assert.equal(getMeteoriteId(records[2]), "singleton");
  assert.deepEqual(resolveMeteoriteGroup(records, "allende").members.map((item) => item.id), ["stone-a", "stone-b"]);
  assert.deepEqual(resolveMeteoriteGroup(records, "stone-b").members.map((item) => item.id), ["stone-a", "stone-b"]);
  assert.deepEqual(resolveMeteoriteGroup(records, "singleton").members.map((item) => item.id), ["singleton"]);
  assert.equal(resolveMeteoriteGroup(records, "unknown"), null);
});

test("every current specimen has a singleton-safe detail address", async () => {
  const collection = JSON.parse(await read("data/collection.json")).items;
  const sale = JSON.parse(await read("data/sale-specimens.json")).items;
  const records = [...collection, ...sale];
  for (const item of records) {
    const group = resolveMeteoriteGroup(records, item.id);
    assert.equal(group.meteoriteId, item.id);
    assert.deepEqual(group.members.map((member) => member.id), [item.id]);
  }
});

test("inventory inquiry links reject active and insecure schemes", () => {
  assert.equal(getSafeInquiryUrl("javascript:alert(1)"), null);
  assert.equal(getSafeInquiryUrl("data:text/html,unsafe"), null);
  assert.equal(getSafeInquiryUrl("http://example.com/inquiry"), null);
  assert.equal(getSafeInquiryUrl("/relative-inquiry"), null);
  assert.equal(getSafeInquiryUrl("https://example.com/inquiry"), "https://example.com/inquiry");
  assert.equal(getSafeInquiryUrl("mailto:collector@example.com?subject=Inquiry"), "mailto:collector@example.com?subject=Inquiry");
});

test("cart items are normalized and unsafe persisted fields are discarded", () => {
  const item = CartStore.normalizeItem({
    type: "specimen",
    id: "sale-001",
    name: "Test specimen",
    subtitle: "H5",
    priceUsd: 125,
    image: "javascript:alert(1)",
    imageAlt: "Test"
  });
  assert.equal(item.key, "specimen:sale-001");
  assert.equal(item.priceUsd, 125);
  assert.equal(item.image, null);
  assert.equal(CartStore.normalizeItem({ type: "collection", id: "private-001", name: "Private" }), null);
  assert.equal(CartStore.subtotal([item, { priceUsd: null }]), 125);
});

test("unpriced sale records display TBD throughout checkout", async () => {
  const app = await read("app.js");
  const checkout = await read("checkout.js");
  assert.ok(app.includes(': "TBD"'), "sale cards must label an omitted price as TBD");
  assert.ok(checkout.includes('return items.some((item) => !Number.isFinite(item.priceUsd)) ? "TBD"'), "unknown prices must keep the checkout subtotal TBD");
  assert.doesNotMatch(`${app}\n${checkout}`, /(?:Price )?[Oo]n request/u);
});

test("catalog specimen links and controls use separate interactive regions", async () => {
  const app = await read("app.js");
  const css = await read("styles.css");
  assert.ok(app.includes('`./specimen.html?meteorite=${encodeURIComponent(meteoriteId)}`'));
  assert.ok(app.includes('createElement("a", "card-image-link")'));
  assert.ok(app.includes('createElement(detailPage || !detailUrl ? "div" : "a", "card-info-link")'));
  assert.match(app, /figure\.append\(previous, next, toggle, counter\)/u, "carousel controls remain direct figure children");
  assert.match(app, /body\.append\(information\);\n  if \(kind === "sale"\) body\.append\(createPriceFooter/u, "cart footer remains a sibling of the information link");
  assert.ok(css.includes(".card-image-link:focus-visible"));
  assert.ok(css.includes(".card-info-link:focus-visible"));
  assert.equal(CartStore.normalizeItem({ type: "specimen", id: "group-a", name: "A" }).key, "specimen:group-a");
  assert.equal(CartStore.normalizeItem({ type: "specimen", id: "group-b", name: "B" }).key, "specimen:group-b");
});

test("detail page groups physical records and isolates required catalog failures from books", async () => {
  const html = await read("specimen.html");
  const app = await read("app.js");
  assert.ok(html.includes('id="specimen-detail-grid"'));
  assert.ok(html.includes('id="specimen-canonical"'));
  assert.ok(html.includes('id="specimen-detail-heading"'));
  assert.ok(html.includes('id="specimen-detail-summary"'));
  assert.ok(app.includes('...state.collection.map((item) => ({ ...item, catalogSource: "collection" }))'));
  assert.ok(app.includes('...state.specimens.map((item) => ({ ...item, catalogSource: "sale" }))'));
  assert.ok(app.includes('dataStatus.collection !== "loaded" || dataStatus.specimens !== "loaded"'));
  assert.ok(app.includes("const results = await Promise.allSettled"), "catalog requests must settle independently");
  assert.doesNotMatch(app, /dataStatus\.books !== "loaded"/u, "book failure must not gate specimen detail");
  assert.ok(app.includes('"Retained in the private collection · Not for sale"'));
  assert.ok(app.includes('item.status === "available"'));
  assert.ok(app.includes("canonicalUrl.searchParams.set(\"meteorite\", group.meteoriteId)"));
  assert.ok(app.includes("elements.specimenDetailHeading.textContent = name"));
  assert.ok(app.includes('appendSpecimenDetailLink("./collection.html"'));
  assert.ok(app.includes('appendSpecimenDetailLink("./specimens.html"'));
});

test("detail runtime keeps grouped physical cards and cart actions independent", async () => {
  const common = { meteoriteId: "allende", name: "Allende", classification: "CV3", description: "Fixture specimen." };
  const result = await runDetailPage({
    collection: [{ ...common, id: "private-a", displayOrder: 1, catalogNumber: "Specimen 001" }],
    specimens: [
      { ...common, id: "sale-a", displayOrder: 2, catalogNumber: "Specimen 002", status: "available" },
      { ...common, id: "sale-b", displayOrder: 3, catalogNumber: "Specimen 003", status: "available", priceUsd: 25 },
      { ...common, id: "sale-c", displayOrder: 4, catalogNumber: "Specimen 004", status: "reserved", priceUsd: 30 },
      { ...common, id: "sale-d", displayOrder: 5, catalogNumber: "Specimen 005", status: "sold", priceUsd: 35 }
    ],
    fail: ["./data/books.json"]
  });
  assert.equal(result.heading.textContent, "Allende");
  assert.equal(result.document.title, "Allende | The Spacerocks Cabinet");
  assert.match(result.summary.textContent, /^5 physical specimens are documented/u);
  assert.match(result.description.content, /^Allende: 5 physical specimens/u);
  assert.equal(result.detailGrid.children.length, 5, "each physical record renders as its own card");
  assert.equal(result.links.querySelectorAll("a").length, 2, "both trusted source catalogs are linked");
  assert.equal(result.canonical.href, "https://example.test/specimen.html?meteorite=allende");
  assert.match(result.detailGrid.textContent, /Retained in the private collection · Not for sale/u);
  assert.match(result.detailGrid.textContent, /TBD/u, "unpriced available records remain TBD");
  const addButtons = result.detailGrid.querySelectorAll(".add-cart-button");
  assert.equal(addButtons.length, 2, "every available record, and no private, reserved, or sold record, has a cart action");
  assert.deepEqual(addButtons.map((button) => button.dataset.cartKey), ["specimen:sale-a", "specimen:sale-b"]);
  addButtons.forEach((button) => button.click());
  assert.deepEqual(result.cartItems.map((item) => item.key), ["specimen:sale-a", "specimen:sale-b"]);
});

test("detail runtime exposes safe invalid, unknown, and partial-load states", async () => {
  const invalid = await runDetailPage({ search: "?meteorite=%3Cscript%3E" });
  assert.equal(invalid.heading.textContent, "Invalid specimen request");
  assert.doesNotMatch(invalid.detailGrid.textContent, /script/u, "query text must never be reflected");
  assert.equal(invalid.links.querySelectorAll("a").length, 2, "invalid requests must retain catalog navigation");

  const unknown = await runDetailPage({ search: "?meteorite=unknown" });
  assert.equal(unknown.heading.textContent, "Specimen not found");
  assert.equal(unknown.links.querySelectorAll("a").length, 2, "unknown records must retain catalog navigation");

  const partial = await runDetailPage({ fail: ["./data/collection.json"] });
  assert.equal(partial.heading.textContent, "Specimen records unavailable");
  assert.match(partial.summary.textContent, /could not both be loaded/u);
  assert.equal(partial.links.querySelectorAll("a").length, 2, "load failures must retain catalog navigation");
});

test("specimen cards rotate their image galleries every three seconds", async () => {
  const app = await read("app.js");
  const css = await read("styles.css");
  assert.ok(app.includes("const CAROUSEL_INTERVAL_MS = 3000;"));
  assert.ok(app.includes('window.matchMedia?.("(prefers-reduced-motion: reduce)")'), "carousel must respect reduced-motion preferences");
  assert.ok(app.includes('toggle.textContent = pauseState.userPaused ? "Play" : "Pause"'), "carousel must provide a pause control");
  assert.ok(app.includes('"carousel-arrow carousel-previous"'), "carousel must provide previous-image navigation");
  assert.ok(app.includes('"carousel-arrow carousel-next"'), "carousel must provide next-image navigation");
  assert.ok(app.includes("pauseState.pauseForManualNavigation();"), "manual image navigation must stop automatic rotation");
  assert.ok(app.includes('figure.addEventListener("pointerenter"'), "carousel must pause during pointer interaction");
  assert.ok(app.includes('figure.addEventListener("focusin"'), "carousel must pause during keyboard interaction");
  assert.ok(app.includes("pauseState.canAdvance(document.hidden)"), "carousel must check all pause conditions before advancing");
  assert.ok(css.includes(".carousel-toggle:focus-visible"), "carousel control must expose keyboard focus");
  assert.ok(css.includes(".carousel-arrow:focus-visible"), "carousel arrows must expose keyboard focus");
  assert.match(css, /\.card-image img \{[^}]*object-fit: contain; object-position: center center;/u, "catalog images must remain centered and fully visible");
  assert.match(css, /\.checkout-item-image img \{[^}]*object-fit: contain; object-position: center center;/u, "checkout images must remain centered and fully visible");
});

test("carousel pause state keeps overlapping pointer and focus interactions isolated", () => {
  const state = createCarouselPauseState();
  assert.equal(state.canAdvance(), true);
  state.setPointerActive(true);
  state.setFocusActive(true);
  state.setPointerActive(false);
  assert.equal(state.canAdvance(), false, "focus must keep rotation paused after the pointer leaves");
  state.setPointerActive(true);
  state.setFocusActive(false);
  assert.equal(state.canAdvance(), false, "pointer must keep rotation paused after focus leaves");
  state.setPointerActive(false);
  assert.equal(state.canAdvance(), true);
  assert.equal(state.canAdvance(true), false, "hidden pages must not advance");
  state.pauseForManualNavigation();
  assert.equal(state.canAdvance(), false, "manual navigation must pause rotation");
  assert.equal(state.toggleUserPaused(), false);
  assert.equal(state.canAdvance(), true, "Play must resume an inactive carousel");
  assert.equal(createCarouselPauseState(true).canAdvance(), false, "reduced motion must start paused");
});

test("homepage highlight windows rotate through complete inventories", async () => {
  const records = ["A", "B", "C", "D", "E"];
  assert.deepEqual(getHighlightWindow(records, 0, 3), ["A", "B", "C"]);
  assert.deepEqual(getHighlightWindow(records, 3, 3), ["D", "E", "A"]);
  assert.deepEqual(getHighlightWindow(records, -1, 2), ["E", "A"]);
  assert.deepEqual(getHighlightWindow([], 0, 3), []);
  const app = await read("app.js");
  const home = await read("index.html");
  assert.ok(app.includes("const HIGHLIGHT_ROTATION_MS = 15000;"));
  assert.ok(app.includes("limit: 3") && (app.match(/limit: 2/gu) || []).length === 2);
  assert.ok(app.includes("pauseState.canAdvance(document.hidden)"));
  assert.ok(app.includes('container.addEventListener("pointerenter"'));
  assert.ok(app.includes('container.addEventListener("focusin"'));
  assert.equal((home.match(/aria-live="off"/gu) || []).length, 3, "rotating highlights must not trigger repeated live announcements");
});

test("homepage gives newcomers a compact factual meteorite introduction", async () => {
  const home = await read("index.html");
  const css = await read("styles.css");
  assert.ok(home.includes("Most meteorites are fragments of asteroids"));
  assert.ok(home.includes("the Moon or Mars"));
  assert.doesNotMatch(home, /A field collection with a paper trail|The first catalog release is being prepared/u);
  assert.match(css, /\.introduction \{[^}]*padding-block: 3rem 2\.75rem;/u);
});

test("all specimen records use reader-facing specimen numbers", async () => {
  const collection = JSON.parse(await read("data/collection.json"));
  const sale = JSON.parse(await read("data/sale-specimens.json"));
  assert.deepEqual(
    collection.items.map((item) => item.catalogNumber),
    Array.from({ length: 11 }, (_, index) => `Specimen ${String(index + 1).padStart(3, "0")}`)
  );
  assert.deepEqual(sale.items.map((item) => item.catalogNumber), ["Specimen 001", "Specimen 002"]);
  for (const item of [...collection.items, ...sale.items]) {
    assert.doesNotMatch(item.description, /documented in \w+ views|including broad faces, edge profile, and end texture/iu);
  }
});

test("each specimen carousel opens with its selected dramatic hero", async () => {
  const collection = JSON.parse(await read("data/collection.json"));
  const sale = JSON.parse(await read("data/sale-specimens.json"));
  const expectedHeroes = new Map([
    ["unclassified-meteorite-367-3g", "unclassified-meteorite-367-3g-3-g01-03-detail.jpg"],
    ["wabar-impact-material-63-2g", "wabar-impact-material-63-2g-2-g02-02-reverse.jpg"],
    ["wabar-fused-sand-30-4g", "wabar-fused-sand-30-4g-1-g03-01-hero.jpg"],
    ["wabar-impact-glass-7-2g", "wabar-impact-glass-7-2g-1-g04-01-hero.jpg"],
    ["wabar-relic-iron-7-9g", "wabar-relic-iron-7-9g-1-g05-01-hero.jpg"],
    ["wabar-pearl-0-7g", "wabar-pearl-0-7g-1-g06-01-hero.jpg"],
    ["kaalijarv-36-4g", "kaalijarv-36-4g-3-g07-03-profile.jpg"],
    ["unclassified-oc-57-6g", "unclassified-oc-57-6g-1-g08-01-hero.jpg"],
    ["unclassified-nwa-oriented-47-4g", "unclassified-nwa-oriented-47-4g-2-g09-02-reverse.jpg"],
    ["aguas-zarcas-4-97g", "aguas-zarcas-4-97g-1-g10-01-hero.jpg"],
    ["bjurbole-14g", "bjurbole-14g-1-g13-01-marked.jpg"],
    ["unclassified-nwa-oc-13-8kg", "unclassified-nwa-oc-13-8kg-1-g14-01-hero.jpg"],
    ["ksar-ghilane-022-31-35g", "ksar-ghilane-022-31-35g-1-g15-01-polished-face.jpg"]
  ]);
  for (const item of [...collection.items, ...sale.items]) {
    assert.equal(item.image, item.images[0], `${item.id} card image must match its first carousel image`);
    assert.equal(path.basename(item.image), expectedHeroes.get(item.id), `${item.id} must use its selected hero`);
  }
});

test("the three related meteorite projects are linked safely", async () => {
  const pages = await Promise.all(["index.html", "collection.html", "specimens.html", "specimen.html", "books.html", "research.html", "checkout.html"].map(read));
  const html = pages.join("\n");
  const links = [
    "https://rayborg.github.io/Historical-meteorite-collections/",
    "https://rayborg.github.io/meteorite-meta-search/",
    "https://coa-sandbox.meteoriteresearch.org/"
  ];
  for (const link of links) {
    assert.ok(html.includes(`href="${link}"`), `missing ${link}`);
  }
  for (const page of pages) assert.doesNotMatch(page, /target="_blank"(?! rel="noopener noreferrer")/u);
  assert.ok(pages[5].includes("searching historical catalogs, comparing current meteorite listings"));
  assert.doesNotMatch(pages[5], /Connected projects|Choose a project to search archival catalogs/u);
});

test("all catalog pages load shared assets and cross-link from the homepage", async () => {
  const html = await read("index.html");
  for (const asset of ["styles.css", "inventory-utils.js", "cart.js", "app.js", "favicon.svg"]) {
    assert.ok(html.includes(`./${asset}`));
    assert.ok((await read(asset)).length > 0, `${asset} must not be empty`);
  }
  for (const page of ["collection.html", "specimens.html", "specimen.html", "books.html", "research.html", "checkout.html"]) {
    if (page === "specimen.html") {
      assert.ok((await read("app.js")).includes("./specimen.html?meteorite="), "catalog cards must link to specimen.html");
    } else {
      assert.ok(html.includes(`href="./${page}"`), `homepage must link to ${page}`);
    }
    const pageHtml = await read(page);
    assert.ok(pageHtml.includes("./styles.css"), `${page} must load shared styles`);
    assert.ok(pageHtml.includes("./app.js"), `${page} must load shared application code`);
  }
  assert.ok(html.includes('id="collection-highlights"'));
  assert.ok(html.includes('id="specimen-highlights"'));
  assert.ok(html.includes('id="book-highlights"'));
  assert.ok((await read("collection.html")).includes('id="collection-grid"'));
  assert.ok((await read("specimens.html")).includes('id="specimen-grid"'));
  assert.ok((await read("books.html")).includes('id="book-grid"'));
  const researchHtml = await read("research.html");
  for (const catalogId of ["collection-grid", "specimen-grid", "book-grid"]) {
    assert.ok(!researchHtml.includes(`id="${catalogId}"`), `Research Desk must not include ${catalogId}`);
  }
  assert.ok(html.includes('href="./checkout.html"'), "homepage must link to the cart");
  for (const [id, destination] of [["collection-count", "collection.html"], ["specimen-count", "specimens.html"], ["book-count", "books.html"]]) {
    assert.match(html, new RegExp(`<a href="\\./${destination}"><strong id="${id}">`, "u"), `${id} summary must link to ${destination}`);
  }
  assert.match(html, /<a href="\.\/research\.html"><strong>3<\/strong><span>connected resources<\/span><\/a>/u);
  for (const page of ["index.html", "collection.html", "specimens.html", "specimen.html", "books.html", "research.html", "checkout.html"]) {
    const pageHtml = await read(page);
    assert.match(pageHtml, /<nav id="site-navigation"[\s\S]*?<a href="\.\/index\.html"(?: aria-current="page")?>Home<\/a>/u, `${page} must have an explicit primary Home link`);
    assert.ok(pageHtml.includes('href="./research.html"'), `${page} must link to the dedicated Research Desk`);
    assert.ok(!pageHtml.includes('href="./index.html#research"'), `${page} must not route Research back to the homepage`);
  }
});

test("every page shows the linked inventory summary below an unobstructed banner", async () => {
  const pageNames = ["index.html", "collection.html", "specimens.html", "specimen.html", "books.html", "research.html", "checkout.html"];
  for (const pageName of pageNames) {
    const html = await read(pageName);
    assert.equal((html.match(/class="ledger-strip"/gu) || []).length, 1, `${pageName} must contain one summary bar`);
    for (const [id, destination] of [["collection-count", "collection.html"], ["specimen-count", "specimens.html"], ["book-count", "books.html"]]) {
      assert.match(html, new RegExp(`<a href="\\./${destination}"><strong id="${id}">`, "u"), `${pageName} summary must link to ${destination}`);
    }
    assert.match(html, /<a href="\.\/research\.html"><strong>3<\/strong><span>connected resources<\/span><\/a>/u);
    assert.ok(html.indexOf("hero-banner") < html.indexOf("ledger-strip"), `${pageName} summary must follow its banner`);
  }
  const css = await read("styles.css");
  assert.doesNotMatch(css, /\.(?:hero|interior)-brand::(?:before|after)/u, "banner overlay rectangles must not return");
});

test("books can be filtered between the permanent collection and sale inventory", async () => {
  const html = await read("books.html");
  const app = await read("app.js");
  const importer = await read("scripts/import-inventory.mjs");
  assert.ok(html.includes('<option value="collection">Permanent private collection</option>'));
  assert.ok(html.includes('<option value="sale">Books for sale</option>'));
  assert.ok(app.includes('item.listingType === "collection" ? "collection" : "sale"'));
  assert.ok(importer.includes("collection_book") && importer.includes("sale_book"));
});

test("confirmed official branding is used and optimized for the web", async () => {
  const pages = await Promise.all(["index.html", "collection.html", "specimens.html", "specimen.html", "books.html", "research.html", "checkout.html"].map(read));
  for (const html of pages) {
    assert.ok(html.includes("./assets/branding/spacerocks-logo.webp"));
    assert.ok(html.includes("Spacerocks"), "business name must use the one-word form");
    assert.ok(!html.includes("Space Rocks"), "business name must not be split into two words");
    assert.ok(!html.includes("SpaceRocks"), "business name must use the confirmed capitalization");
  }
  for (const html of pages) {
    assert.ok(html.includes('<img class="hero-banner" src="./assets/branding/spacerocks-banner.webp"'), "every page must show the official banner");
    assert.match(html, /spacerocks-banner\.webp"[^>]*width="2025" height="777"/u, "banner dimensions must match the replacement asset");
  }
  assert.ok(!pages[0].includes("Meteorites with a paper trail."), "removed banner headline must not return");
  assert.ok(pages[0].includes("A personal meteorite collection, selected specimens, and books."));
  const bannerIndex = pages[0].indexOf('class="hero-brand"');
  const ledgerIndex = pages[0].indexOf('class="ledger-strip"');
  const introIndex = pages[0].indexOf('class="hero-intro"');
  assert.ok(bannerIndex < ledgerIndex && ledgerIndex < introIndex, "homepage must order the banner, inventory bar, then compact introduction");
  for (const html of pages.slice(1)) {
    const brandStart = html.indexOf('<section class="interior-brand"');
    const brandEnd = html.indexOf("</section>", brandStart);
    const titleBand = html.indexOf('<section class="interior-title-band"');
    assert.ok(brandEnd < titleBand, "subpage title band must follow its unobstructed banner");
    assert.ok(html.slice(titleBand).includes("interior-title-panel"), "subpage title band must contain its title panel");
    assert.equal((html.match(/<h1\b/gu) || []).length, 1, "subpage must have one primary title");
  }
  for (const [pageIndex, resultId] of [[1, "collection-result-count"], [2, "specimen-result-count"], [4, "book-result-count"]]) {
    const titleBand = pages[pageIndex].indexOf('<section class="interior-title-band"');
    const catalog = pages[pageIndex].indexOf('<section class="catalog-page');
    const result = pages[pageIndex].indexOf(`id="${resultId}"`);
    assert.ok(titleBand < result && result < catalog, `${resultId} must share its title pane`);
  }
  const logo = await stat(path.join(root, "assets/branding/spacerocks-logo.webp"));
  const banner = await stat(path.join(root, "assets/branding/spacerocks-banner.webp"));
  assert.ok(logo.size < 250_000, "web logo should remain below 250 KB");
  assert.ok(banner.size < 800_000, "web banner should remain below 800 KB");
});

test("the interface uses the dark archival color system", async () => {
  const css = await read("styles.css");
  assert.ok(css.includes("color-scheme: dark"));
  assert.ok(css.includes("--paper: #151514"));
  assert.ok(css.includes("background: rgba(39, 35, 30, .92)"), "catalog and checkout panels must use dark raised surfaces");
  assert.ok(css.includes("background: #1e1c19"), "checkout fields must use dark controls");
  assert.ok(css.includes("--sage: #59664b"), "available badges need an AA-compliant dark background");
  assert.ok(css.includes("background: #984a44"), "cart hover state needs AA-compliant contrast");
  assert.ok(css.includes("textarea:focus-visible"), "textarea must share the visible keyboard focus treatment");
  assert.ok(css.includes("textarea::placeholder { color: #988b75; }"), "checkout placeholder must remain readable");
  assert.ok(css.includes("border: 1px solid #806e4d"), "checkout control boundaries need non-text contrast");
  assert.ok(!css.includes("background: rgba(246, 237, 217"), "light parchment panels must not return");
  assert.ok(!css.includes("background: rgba(248, 241, 225"), "light filter controls must not return");
});

test("checkout collects delivery details and payment preference without taking payment", async () => {
  const html = await read("checkout.html");
  for (const field of ["name", "email", "address_line_1", "city", "region", "postal_code", "country", "payment_preference"]) {
    assert.ok(html.includes(`name="${field}"`), `checkout is missing ${field}`);
  }
  assert.match(html, /name="phone"[^>]*autocomplete="tel"/u);
  for (const method of ["PayPal", "Revolut", "Bank transfer"]) assert.ok(html.includes(`value="${method}"`));
  assert.ok(html.includes("No payment is collected on this website."));
  assert.ok(html.includes("formspree.io/legal/privacy-policy/"), "checkout must disclose the form processor");
  const config = await read("checkout-config.js");
  assert.ok(config.includes('formspreeEndpoint: ""'), "placeholder endpoint must remain explicit until configured");
});
