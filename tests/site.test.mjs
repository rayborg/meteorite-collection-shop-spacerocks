import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { getSafeInquiryUrl } = require("../inventory-utils.js");
const CartStore = require("../cart.js");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
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
      if (relativePath !== "data/collection.json") {
        assert.ok(validStatuses.has(item.status), `${relativePath} has unsupported status ${item.status}`);
        assert.ok(item.priceUsd === undefined || (Number.isFinite(item.priceUsd) && item.priceUsd >= 0), `${relativePath} prices must be nonnegative numbers`);
        assert.ok(item.inquiryUrl === undefined || getSafeInquiryUrl(item.inquiryUrl), `${relativePath} contains an unsafe inquiry URL`);
      }
      if (item.image !== undefined) {
        assert.match(item.image, /^\.\/assets\/(?:collection|sale-specimens|books)\/[a-z0-9][a-z0-9._-]*$/u, `${relativePath} image path must be a safe relative asset path`);
      }
    }
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

test("the three related meteorite projects are linked safely", async () => {
  const pages = await Promise.all(["index.html", "collection.html", "specimens.html", "books.html", "research.html", "checkout.html"].map(read));
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
});

test("all catalog pages load shared assets and cross-link from the homepage", async () => {
  const html = await read("index.html");
  for (const asset of ["styles.css", "inventory-utils.js", "cart.js", "app.js", "favicon.svg"]) {
    assert.ok(html.includes(`./${asset}`));
    assert.ok((await read(asset)).length > 0, `${asset} must not be empty`);
  }
  for (const page of ["collection.html", "specimens.html", "books.html", "research.html", "checkout.html"]) {
    assert.ok(html.includes(`href="./${page}"`), `homepage must link to ${page}`);
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
  for (const page of ["index.html", "collection.html", "specimens.html", "books.html", "research.html", "checkout.html"]) {
    const pageHtml = await read(page);
    assert.match(pageHtml, /<nav id="site-navigation"[\s\S]*?<a href="\.\/index\.html"(?: aria-current="page")?>Home<\/a>/u, `${page} must have an explicit primary Home link`);
    assert.ok(pageHtml.includes('href="./research.html"'), `${page} must link to the dedicated Research Desk`);
    assert.ok(!pageHtml.includes('href="./index.html#research"'), `${page} must not route Research back to the homepage`);
  }
});

test("confirmed official branding is used and optimized for the web", async () => {
  const pages = await Promise.all(["index.html", "collection.html", "specimens.html", "books.html", "research.html", "checkout.html"].map(read));
  for (const html of pages) {
    assert.ok(html.includes("./assets/branding/spacerocks-logo.webp"));
    assert.ok(html.includes("Spacerocks"), "business name must use the one-word form");
    assert.ok(!html.includes("Space Rocks"), "business name must not be split into two words");
    assert.ok(!html.includes("SpaceRocks"), "business name must use the confirmed capitalization");
  }
  for (const html of pages) assert.ok(html.includes('<img class="hero-banner" src="./assets/branding/spacerocks-banner.webp"'), "every page must show the official banner");
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
  const logo = await stat(path.join(root, "assets/branding/spacerocks-logo.webp"));
  const banner = await stat(path.join(root, "assets/branding/spacerocks-banner.webp"));
  assert.ok(logo.size < 250_000, "web logo should remain below 250 KB");
  assert.ok(banner.size < 800_000, "web banner should remain below 800 KB");
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
