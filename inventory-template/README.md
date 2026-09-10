# Inventory import folder

Copy `inventory.csv` into a new folder containing the photographs you want to import. Keep the columns in the exact supplied order and add one row per specimen or book.

## Record types

- `collection_specimen`: a meteorite retained in the personal collection
- `sale_specimen`: a meteorite offered for sale
- `collection_book`: a book retained in the permanent private collection
- `sale_book`: a book offered for sale

## Required values

Every row requires `record_type`, a stable lowercase `id`, a unique positive `display_order` within its destination catalog, `catalog_number`, `description`, `image_files`, and `image_alt`.

Specimens also require `name`. Books require `title`. Sale records require `status`, using `available`, `reserved`, or `sold`. `price_usd` can remain blank while the price is `TBD`.

Use `|` between image filenames. The first image is the listing card image; all named images are copied and retained in the record.

The importer enforces these exact image counts:

- `collection_specimen`: 3 images
- `sale_specimen`: 5 images
- `collection_book`: 5 images
- `sale_book`: 5 images

Supported image formats are AVIF, GIF, JPEG, PNG, and WebP. The importer verifies that each file's signature matches its extension, rejects symbolic links, and will not follow image paths outside the import folder.

## Examples

Each record occupies one CSV row. Quote text containing commas.

```csv
record_type,id,display_order,catalog_number,name,title,classification,author,year,mass_grams,dimensions,locality,found_year,acquired_year,provenance,edition,publisher,format,condition,description,price_usd,status,image_files,image_alt
collection_specimen,allende-001,10,Specimen 001,Allende,,CV3,,,24.6,31 x 22 x 8 mm,Chihuahua Mexico,1969,2024,Ex. Example Collection,,,,,Complete individual with dark fusion crust.,,,allende-front.jpg|allende-back.jpg|allende-profile.jpg,Allende individual showing dark fusion crust
sale_specimen,campo-001,20,Specimen 001,Campo del Cielo,,Iron IAB-MG,,,42.1,34 x 21 x 14 mm,Chaco Argentina,1576,,Dealer provenance,,,,,Clean individual with natural regmaglypts.,85,available,campo-front.jpg|campo-back.jpg|campo-profile.jpg|campo-detail.jpg|campo-scale.jpg,Campo del Cielo individual offered for sale
collection_book,burke-001,10,SRL 001,,Cosmic Debris,,John G. Burke,1986,,,,,,Private library,,University of California Press,Hardcover,Very good,Reference copy retained in the working library.,,,cosmic-debris-cover.jpg|cosmic-debris-back.jpg|cosmic-debris-spine.jpg|cosmic-debris-title.jpg|cosmic-debris-condition.jpg,Cover of Cosmic Debris by John G. Burke
sale_book,nininger-001,20,SRB 001,,Find a Falling Star,,H. H. Nininger,1972,,,,,,,,Paul S. Eriksson,Hardcover,Good,Clean copy with light jacket wear.,45,available,nininger-cover.jpg|nininger-back.jpg|nininger-spine.jpg|nininger-title.jpg|nininger-condition.jpg,Front cover of Find a Falling Star
```

## Commands

Validate the folder without changing the website:

```sh
npm run import:inventory -- "/absolute/path/to/import-folder"
```

After the dry run succeeds, apply the import:

```sh
npm run import:inventory -- "/absolute/path/to/import-folder" --write
```

The importer copies images into the correct `assets/` folder and updates the matching JSON catalog. Existing IDs are updated; new IDs are appended and then sorted by `display_order`. Nothing is deleted automatically.
