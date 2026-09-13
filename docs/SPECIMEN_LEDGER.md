# Specimen Ledger

`data/specimen-ledger.csv` is the Excel-compatible master sheet for facts about each physical specimen. It uses one permanent global sequence, currently `Specimen 001` through `Specimen 013`, across the collection and sale catalogs.

The global `specimen_id` is different from `catalog_number`. `catalog_number` preserves the reader-facing numbering within the collection or sale catalog, while `specimen_id` never restarts and identifies the physical specimen in the master ledger.

## Field Authority

The ledger contains specimen-specific and site-operational facts that the Meteoritical Bulletin does not provide:

- Stable physical record ID and collection/sale destination
- Global specimen ID, display order, and catalog label
- Exact specimen mass and dimensions
- Public-safe acquisition year and provenance
- Description and image description for the exact physical specimen
- Sale status and public price when applicable
- Optional `meteorite_id` used to group multiple physical specimens on one product page

`metbull_code` associates a physical specimen with an official meteorite in `data/meteorites.json`. When it is present, leave `name`, `classification`, `locality`, and `found_year` blank in the spreadsheet. The sync script obtains those meteorite-level facts from the curated MetBull-derived record and combines its summary with the specimen-specific description.

Rows without a MetBull association, including unclassified material and Wabar impact artifacts, use the spreadsheet's `name`, `classification`, `locality`, and `found_year` fields as applicable.

Image paths are not duplicated in the spreadsheet. The image importer owns those paths, and the ledger sync preserves the existing imported gallery byte-for-byte.

Never place acquisition cost, seller contact details, receipts, home or storage locations, or other private information in this public ledger. Continue to use the external private cost ledger described in `PRIVATE_COSTS.md`.

## Columns

| Column | Purpose |
| --- | --- |
| `specimen_id` | Required contiguous global ID in `Specimen NNN` format. Add the next number for each new physical specimen. |
| `record_type` | `collection_specimen` or `sale_specimen`. |
| `id` | Stable lowercase physical-record slug. It must already exist in the image-backed JSON catalog. |
| `display_order` | Positive integer unique within the destination catalog. |
| `catalog_number` | Reader-facing number within the collection or sale catalog. |
| `metbull_code` | Official Meteoritical Bulletin code, or blank when there is no official association. |
| `meteorite_id` | Optional shared product-page slug for multiple physical specimens from one meteorite. |
| `name` | Required only when `metbull_code` is blank. |
| `classification` | Non-MetBull classification or material category; blank for associated official meteorites. |
| `mass_grams` | Required positive mass of this exact physical specimen, not total known weight. |
| `dimensions` | Optional dimensions of this exact physical specimen. |
| `locality` | Non-MetBull locality; blank for associated official meteorites. |
| `found_year` | Non-MetBull find year; blank for associated official meteorites. |
| `acquired_year` | Optional acquisition year for this exact specimen. |
| `provenance` | Optional public-safe provenance summary. |
| `specimen_description` | Required physical description, preparation, markings, and condition of this exact specimen. Do not repeat MetBull history. |
| `image_alt` | Required description of the selected primary image. |
| `price_usd` | Optional public sale price from `0.00` through `1000000.00`, with at most two decimal places; blank displays `TBD`. The practical ceiling preserves exact adjacent cents through JSON and browser currency formatting. |
| `status` | Required for sale specimens: `available`, `reserved`, or `sold`; blank for collection specimens. |

## Workflow

Open `data/specimen-ledger.csv` directly in Excel, Numbers, LibreOffice, or another CSV editor. Preserve the header names and order and save as UTF-8 comma-separated values.

Validate the spreadsheet and preview which catalogs would change:

```sh
npm run ledger:sync
```

Apply validated spreadsheet metadata to the public JSON catalogs:

```sh
npm run ledger:sync -- --write
```

Confirm that the spreadsheet, curated meteorite records, and generated catalogs agree:

```sh
npm run ledger:check
```

The check owns and compares the generated specimen item arrays. Catalog envelope fields remain separately controlled: `schemaVersion` and the items array are validated, `currency` remains the sale catalog's existing `USD`, and `updated` is set to the write date only when specimen items change. The check does not treat an existing valid `updated` timestamp as specimen-ledger drift.

For a new physical specimen, first use the image importer so the stable `id` and image gallery exist. Then append exactly one ledger row with the next global `specimen_id`, run the write command, inspect the JSON diff, and run `npm run validate`. Omitting a current specimen, reusing an ID, skipping a global number, using an unknown MetBull code, or placing official fields in an associated row fails closed.

`data/meteorites.json` is a reviewed offline source, not a live scrape. Verify changes against each record's official `sourceUrl` before editing it.
