# The Spacerocks Cabinet

A dependency-free static website for a personal meteorite collection, meteorite specimens offered for sale, collectible and reference books, and connected research tools.

The visual system is an original storefront companion to [The Meteorite Cabinet](https://rayborg.github.io/Historical-meteorite-collections/), using a related archival palette and ledger structure.

The site is organized across six pages:

- `index.html` presents the official Spacerocks banner, inventory highlights, and connected research projects.
- `collection.html` contains the searchable personal-collection ledger.
- `specimens.html` contains the searchable and sortable sale inventory.
- `books.html` contains the searchable and sortable bookseller's list.
- `research.html` contains the historical catalog, market-search, and COA project links.
- `checkout.html` contains the persistent cart and checkout-request form.

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

See `inventory-template/README.md` for the exact column order, field rules, image-count requirements, and complete examples. Imported rows are upserted by stable `id`; nothing is deleted automatically. The first filename in `image_files` becomes the card image, and the remaining `|`-separated images are retained in the record.

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
  "catalogNumber": "SRS 001",
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
