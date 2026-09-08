# The Space Rocks Cabinet

A dependency-free static website for a personal meteorite collection, meteorite specimens offered for sale, collectible and reference books, and connected research tools.

The visual system is an original storefront companion to [The Meteorite Cabinet](https://rayborg.github.io/Historical-meteorite-collections/), using a related archival palette and ledger structure.

## Local preview

```sh
npm install
npm run validate
npm run serve
```

Open `http://localhost:8000/`.

## Adding inventory

Inventory is separated into three public JSON files:

- `data/collection.json` for personal-collection records that are not for sale
- `data/sale-specimens.json` for meteorites offered for sale
- `data/books.json` for books offered for sale

Photographs belong in the corresponding directory under `assets/`. All paths must remain relative so the site works from its GitHub Pages project URL.

### Collection record

```json
{
  "id": "collection-001",
  "catalogNumber": "SRC 001",
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
  "imageAlt": "Exact specimen on a neutral background"
}
```

### Sale specimen record

```json
{
  "id": "sale-001",
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
  "inquiryUrl": "mailto:replace-with-contact-address@example.com?subject=Inquiry%20SRS%20001",
  "image": "./assets/sale-specimens/example.webp",
  "imageAlt": "Exact specimen offered for sale"
}
```

Supported sale statuses are `available`, `reserved`, and `sold`.

### Book record

```json
{
  "id": "book-001",
  "catalogNumber": "SRB 001",
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
  "inquiryUrl": "mailto:replace-with-contact-address@example.com?subject=Inquiry%20SRB%20001",
  "image": "./assets/books/example.webp",
  "imageAlt": "The exact book offered for sale"
}
```

## Publishing

The GitHub Actions workflow validates the static package and deploys it with GitHub Pages after every push to `main`. In the repository settings, configure Pages to use **GitHub Actions** as its source.

Do not publish private acquisition records, home addresses, precise storage locations, unredacted receipts, or photograph metadata that should remain private.
