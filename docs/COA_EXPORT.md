# COA Batch Export

The COA exporter produces a deterministic input document for the standalone certificate engine. It does not render certificates, add buyer or sale data, sign files, create archives, access the network, or modify shop data.

## Commands

Validate the complete export without writing a file:

```sh
npm run coa:export -- --check
```

Write outside the repository:

```sh
npm run coa:export -- --output "/absolute/path/outside-this-repository/coa-batch.json"
```

The CLI requires exactly one mode. Output paths must be absolute, must not contain traversal segments, and must resolve outside the repository. Existing symbolic links and non-files are rejected. An existing regular file is accepted only when its bytes are identical to the requested export; different bytes are never overwritten. A new output is prepared beside its destination and installed atomically.

`--check` reads and validates sources and images but never writes. The payload contains no current time, so unchanged inputs produce byte-identical JSON with two-space indentation, LF line endings, stable key order, and one final newline.

## Contract

The closed JSON Schema is `contracts/coa-batch-input-v1.schema.json`. The payload identifies:

- `contractName: "coa-batch-input-v1"`
- `schemaVersion: "1.0.0"`
- `issuer: "The Spacerocks Cabinet"`
- SHA-256 digests for the exact ledger, meteorite data, collection catalog, sale-specimen catalog, and reviewed assertions
- 13 specimens in contiguous global `specimenId` order
- 43 ordered, content-hashed prepared catalog photographs

Every specimen keeps its stable physical ID and catalog-local display number separate. Mass is copied lexically from `mass_grams`, preventing JSON number formatting from changing the recorded value. `description` comes only from the ledger's physical `specimen_description`; the exporter does not use the generated catalog description, which can include general meteorite prose.

Dimensions and public-safe provenance are explicitly `null` when absent. Occurrence kind/date precision and location precision come from reviewed structured assertions rather than prose inference. Official meteorite identity is bound to the local Meteoritical Bulletin code and URL. Unclassified meteorites and cataloged terrestrial impact material use distinct identity variants, and the latter is never represented as meteorite material.

Every photograph includes its repository-relative path, media type, byte length, SHA-256, primary flag, source catalog alt text, `representation: "prepared-catalog-image"`, and this fixed disclosure:

> Prepared catalog image; not an original camera file.

## Authoritative Inputs

The exporter reads only these metadata sources:

- `data/specimen-ledger.csv`
- `data/meteorites.json`
- `data/collection.json`
- `data/sale-specimens.json`
- `data/coa-assertions-v1.json`

The two generated catalogs must exactly match a fresh ledger build before export. Assertions contain only reviewed category, identity-kind, occurrence, evidence URL, and location-precision facts that cannot be safely derived from the other structured fields. Official identity and structured `foundYear` values are not repeated in the assertions. Historical dates that otherwise exist only in descriptive prose are asserted with the corresponding official Meteoritical Bulletin URL.

All source and image paths must be regular files. Symbolic links, path escape, wrong collection/sale asset roots, missing files, duplicate paths or image contents, wrong image counts, and missing or multiple primary photographs stop the export.

## Privacy Boundary

The contract intentionally excludes price, availability/status, buyer/contact/shipping data, acquisition year or cost, seller and receipt data, and storage location. Those values are neither required nor copied from public catalogs. Keep owner-only records outside this repository as documented in `docs/PRIVATE_COSTS.md`.
