# The Spacerocks Cabinet

A dependency-free static website for a personal meteorite collection, meteorite specimens offered for sale, collectible and reference books, and connected research tools.

The visual system is an original storefront companion to [The Meteorite Cabinet](https://rayborg.github.io/Historical-meteorite-collections/), using a related archival palette and ledger structure.

The site is organized across seven pages:

- `index.html` presents the official Spacerocks banner, inventory highlights, and connected research projects.
- `collection.html` contains the searchable personal-collection ledger.
- `specimens.html` contains the searchable and sortable sale inventory.
- `specimen.html?meteorite=<slug>` contains one meteorite detail page with one card per physical collection or sale record.
- `books.html` contains the searchable and sortable permanent book collection and books offered for sale.
- `research.html` contains the historical catalog, market-search, and COA project links.
- `checkout.html` contains the persistent cart and checkout-request form.

Every page repeats the linked live inventory summary directly below the unobstructed official banner.
Homepage highlight groups rotate through eligible collection specimens, sale specimens, and books when more records exist than the visible slots. Rotation pauses for reduced-motion users and while a visitor interacts with that group.

## Local preview

```sh
npm install
npm run validate
npm run serve
```

Open `http://localhost:8000/`.

## Adding inventory

The recommended workflow is the folder importer. Start with `inventory-template/`, place a copy of `inventory.csv` beside your specimen and book photographs, and add one row per record. The CSV supports four destinations:

- `collection_specimen`
- `sale_specimen`
- `collection_book`
- `sale_book`

Validate a prepared folder without changing the website:

```sh
npm run import:inventory -- "/absolute/path/to/import-folder"
```

After reviewing a successful dry run, copy the images and update the catalogs:

```sh
npm run import:inventory -- "/absolute/path/to/import-folder" --write
```

See `inventory-template/README.md` for the exact column order, field rules, image-count requirements, and complete examples. Follow `docs/IMAGE_PREPARATION.md` for cropping, color, quality-review, and publication requirements, and `docs/PRIVATE_COSTS.md` for acquisition-cost handling. Imported rows are upserted by stable `id`; nothing is deleted automatically. The first filename in `image_files` becomes the card image, and the remaining `|`-separated images are retained in the record.

Every imported image must be at most 563,200 bytes and 1,600 pixels on its long edge. One record's complete carousel must total at most 1,677,722 bytes. The dependency-free importer performs bounded structural and dimension validation for still AVIF, GIF, JPEG, PNG, and WebP and rejects malformed or unparseable files. AVIS image sequences are rejected. The importer does not decode compressed AV1 or other image pixels, so prepared images still require visual review.

Each collection specimen requires 3 images. Each sale specimen and every book record require 5 images.

The generated inventory is separated into three public JSON files:

- `data/collection.json` for personal-collection records that are not for sale
- `data/sale-specimens.json` for meteorites offered for sale
- `data/books.json` for reference-library books and books offered for sale

Photographs belong in the corresponding directory under `assets/`. All paths must remain relative so the site works from its GitHub Pages project URL.

### Collection record

```json
{
  "id": "collection-001",
  "displayOrder": 10,
  "catalogNumber": "Specimen 001",
  "name": "Meteorite name",
  "classification": "Classification",
  "massGrams": 12.34,
  "dimensions": "25 × 18 × 9 mm",
  "locality": "Find locality",
  "foundYear": 1900,
  "acquiredYear": 2026,
  "provenance": "Public-safe provenance summary",
  "description": "A concise physical description.",
  "image": "./assets/collection/example.webp",
  "images": ["./assets/collection/example.webp"],
  "imageAlt": "Exact specimen on a neutral background"
}
```

### Sale specimen record

```json
{
  "id": "sale-001",
  "displayOrder": 10,
  "catalogNumber": "Specimen 001",
  "name": "Meteorite name",
  "classification": "Classification",
  "massGrams": 4.56,
  "dimensions": "18 × 12 × 5 mm",
  "locality": "Find locality",
  "foundYear": 2000,
  "provenance": "Public-safe provenance summary",
  "description": "Condition and preparation notes for the exact specimen.",
  "priceUsd": 125,
  "status": "available",
  "image": "./assets/sale-specimens/example.webp",
  "images": ["./assets/sale-specimens/example.webp"],
  "imageAlt": "Exact specimen offered for sale"
}
```

Supported sale statuses are `available`, `reserved`, and `sold`.
When `priceUsd` is omitted, sale cards and checkout display `TBD` rather than treating the item as free.
Collection and sale catalogs each use reader-facing `Specimen 001`, `Specimen 002`, and subsequent numbers. Stable `id` values, not the display number, identify physical records and cart items internally. An optional specimen-only `meteoriteId` groups multiple physical records on one detail page. When omitted, `id` also serves as the singleton meteorite page identity; existing JSON therefore needs no migration.

Every physical specimen offered for sale remains a separate record with its own stable ID, weight, photographs, price, status, and cart entry. Give related records the same `meteoriteId` to render them as separate cards on one meteorite page; grouping never combines availability or cart identity.

### Book record

```json
{
  "id": "book-001",
  "displayOrder": 10,
  "catalogNumber": "SRB 001",
  "listingType": "sale",
  "title": "Book title",
  "author": "Author name",
  "year": 1995,
  "edition": "First edition",
  "publisher": "Publisher",
  "format": "Hardcover",
  "condition": "Very good",
  "description": "Copy-specific condition and completeness notes.",
  "priceUsd": 45,
  "status": "available",
  "image": "./assets/books/example.webp",
  "images": ["./assets/books/example.webp"],
  "imageAlt": "The exact book offered for sale"
}
```

Book records use `listingType: "collection"` for the permanent private collection and `listingType: "sale"` for books offered for sale. The Books page can filter between those shelves.

## Publishing

The GitHub Actions workflow validates the static package and deploys it with GitHub Pages after every push to `main`. In the repository settings, configure Pages to use **GitHub Actions** as its source.

Do not publish private acquisition records, home addresses, precise storage locations, unredacted receipts, or photograph metadata that should remain private.

## Checkout delivery

The cart is stored locally in the visitor's browser. Checkout sends an order request rather than collecting payment: the seller confirms availability, calculates shipping, and replies with PayPal, Revolut, or bank-transfer instructions.

To enable checkout submission, create a Formspree form and set its HTTPS endpoint in `checkout-config.js`:

```js
globalThis.CheckoutConfig = Object.freeze({
  formspreeEndpoint: "https://formspree.io/f/your-form-id"
});
```

Until that endpoint is configured, the final submission button remains disabled. Cart contents can be altered by a visitor, so verify every item and price against the inventory before sending payment instructions.
