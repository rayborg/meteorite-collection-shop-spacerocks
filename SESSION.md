# Spacerocks Cabinet Session Memory

Last updated: 2026-09-10

## Project Goal

Maintain and publish the Spacerocks Cabinet as a dark archival catalog for a permanent meteorite collection, individually purchasable specimens, books, and connected research resources.

## Repository

- Local: `/Users/rbj/Desktop/OpenCode_projects/meteorite-collection-shop-spacerocks`
- GitHub: `https://github.com/rayborg/meteorite-collection-shop-spacerocks`
- Live: `https://rayborg.github.io/meteorite-collection-shop-spacerocks/`
- Branch: `main`

## Current State

- The live catalog contains 10 permanent-collection specimens and 2 individually purchasable specimens.
- The inventory references 40 optimized JPEGs: 3 per collection specimen and 5 per sale specimen.
- The two sale prices are intentionally unset and display as `TBD` in cards and checkout.
- Kaalijarv, Aguas Zarcas, and Bjurböle descriptions use verified official Meteoritical Bulletin records.
- Books use one catalog with `listingType: "collection"` or `listingType: "sale"` and can be filtered by shelf. No book records have been imported yet.
- Corrected image crops, carousel arrows, clickable homepage totals, specific descriptions, consistent specimen display numbers, documentation, and tests are published in commit `dfc9924`.
- The centering pass is published in commit `6352407`: every adjustable specimen is visually centered in both axes, very small specimens use combined specimen-and-cube balance, and source-limited large NWA views retain complete source framing.

## Durable Decisions

- Use reader-facing `Specimen 001`, `Specimen 002`, and subsequent numbers in both collection and sale catalogs. Stable IDs remain the internal identity.
- Every physical sale specimen is a separate record and cart item with its own ID, weight, photographs, price, and status.
- A future meteorite-group browse view may group many sale specimens under a shared name such as NWA 869, cycle specimen previews and weights, and open the individually purchasable records. Grouping must not merge cart identity or inventory state.
- Specimen carousels rotate every 3 seconds, respect reduced motion, pause on interaction, and expose manual controls. Manual previous/next navigation pauses only that carousel until Play is selected.
- Collection specimens require exactly 3 images. Sale specimens and all book records require exactly 5 images.
- Catalog descriptions should describe the physical specimen and verified meteorite facts, not the number or type of photographs.
- Wabar impact products are related terrestrial impact material and must not be represented as meteorites.
- Avoid automatic color normalization when it could alter genuine material color. Apply the quality gate in `docs/IMAGE_PREPARATION.md` after every image change.

## Completed Work

- Built the static multi-page catalog, cart, checkout request flow, research page, dark archival theme, and official branding.
- Added and secured the folder importer with exact image-count enforcement.
- Imported the initial 12 specimen records and 40 web images in commit `0dbe11e`.
- Added 3-second automatic specimen carousels and collection `Specimen NNN` labels in commit `2f7dd88`.
- Verified the published Pages deployment and all live inventory/image endpoints after both commits.
- Prepared and quality-reviewed corrected crops for Kaalijarv, Aguas Zarcas, Bjurböle, and the large unclassified NWA specimen.
- Added Previous and Next carousel controls, with manual navigation pausing only the selected carousel until Play is selected.
- Made all four homepage totals link to collection specimens, sale specimens, books, and research resources.
- Replaced generic photo-process prose with physical descriptions and supported official Meteoritical Bulletin details.
- Changed both collection and sale display labels to `Specimen NNN` and clarified book shelf filtering.
- Added the durable image workflow in `docs/IMAGE_PREPARATION.md`.
- Published and live-verified the complete gallery and catalog refinement in commit `dfc9924`.
- Audited all 40 images specifically for horizontal and vertical centering and prepared 31 corrected crops; 7 views were already acceptably centered or intentionally documentary/detail views, and 2 source-limited large NWA views retained their complete original framing.
- Changed catalog and checkout image presentation to centered `object-fit: contain` so non-landscape images remain fully visible.
- Published and live-verified the complete image-centering update in commit `6352407`.

## Active Work

- No implementation remains active from this session.

## Validation Evidence

- The initial inventory passed importer dry-run/write checks at 12 records and 40 images.
- Local validation currently passes 21 tests, including overlapping pointer/focus carousel pause state.
- Independent carousel validation exercised all 12 specimen galleries with a fake clock.
- Independent image audits inspected every final crop and all source comparisons.
- The current image audit concluded that automatic gray-world or normalization would risk altering genuine specimen colors.
- All 40 repository specimen JPEGs decode successfully and byte-match the final quality-reviewed batch.
- Two independent final validators passed the corrected image and functional/content work with no remaining findings.
- GitHub Actions run `34439704818` passed tests and deployed commit `dfc9924` successfully.
- Live checks verified carousel arrows/pause integration, all four summary links, specimen labels, descriptions, book filters, and representative corrected image hashes.
- The centering update passes all 21 local tests; all 40 repository images decode, retain required web dimensions, and byte-match the newly reviewed batch.
- Independent final visual and functional validators passed all centered images and presentation behavior with no remaining findings.
- GitHub Actions run `34442380530` passed tests and deployed commit `6352407` successfully.
- Live checks verified centered catalog/checkout containment and representative image hashes across every affected specimen group.

## Immediate Next Actions

1. Supply sale prices when known.
2. Configure a valid Formspree endpoint when checkout requests should be enabled.
3. Import permanent-collection and sale book records when their data and photographs are ready.
4. Design grouped browsing when multiple individually purchasable specimens share one meteorite identity.

## Unresolved Items

- Sale prices remain `TBD` until supplied.
- Checkout submission remains disabled until a valid Formspree endpoint is configured.
- The books catalog is empty pending book records and photographs.
- Grouped browsing for multiple sale specimens of one meteorite is a future feature; the individual inventory model already supports those specimens safely.

## Session Log

- `84d385a`: Added the secure inventory folder importer.
- `18a1e17`: Switched to the dark archival theme.
- `2f157b1`: Enforced exact inventory image counts.
- `0dbe11e`: Published the initial specimen inventory and optimized images.
- `2f7dd88`: Added automatic specimen image carousels and collection specimen labels.
- `dfc9924`: Refined specimen galleries, catalog navigation, descriptions, labels, book filtering, image workflow, and corrected crops.
- `6352407`: Centered specimen imagery, preserved source-limited framing, and centered contained image presentation.
