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

- The live catalog contains 11 permanent-collection specimens and 2 individually purchasable specimens.
- The inventory references 43 optimized JPEGs: 3 per collection specimen and 5 per sale specimen.
- The two sale prices are intentionally unset and display as `TBD` in cards and checkout.
- Kaalijarv, Aguas Zarcas, and Bjurböle descriptions use verified official Meteoritical Bulletin records.
- Books use one catalog with `listingType: "collection"` or `listingType: "sale"` and can be filtered by shelf. No book records have been imported yet.
- Corrected image crops, carousel arrows, clickable homepage totals, specific descriptions, consistent specimen display numbers, documentation, and tests are published in commit `dfc9924`.
- The centering pass is published in commit `6352407`: every adjustable specimen is visually centered in both axes, very small specimens use combined specimen-and-cube balance, and source-limited large NWA views retain complete source framing.
- The linked inventory summary now appears below every subpage banner, and decorative rectangle overlays have been removed from banner artwork in published commit `cb80b63`.
- Every specimen carousel now opens with its strongest dramatic complete hero, with four improved opening views and updated primary alt text published in commit `da018e9`.
- Ksar Ghilane 022 is published as collection `Specimen 011`, bringing the live catalog to 11 collection records and 43 images in commit `ae21acb`.

## Durable Decisions

- Use reader-facing `Specimen 001`, `Specimen 002`, and subsequent numbers in both collection and sale catalogs. Stable IDs remain the internal identity.
- Every physical sale specimen is a separate record and cart item with its own ID, weight, photographs, price, and status.
- A future meteorite-group browse view may group many sale specimens under a shared name such as NWA 869, cycle specimen previews and weights, and open the individually purchasable records. Grouping must not merge cart identity or inventory state.
- Specimen carousels rotate every 3 seconds, respect reduced motion, pause on interaction, and expose manual controls. Manual previous/next navigation pauses only that carousel until Play is selected.
- Collection specimens require exactly 3 images. Sale specimens and all book records require exactly 5 images.
- Catalog descriptions should describe the physical specimen and verified meteorite facts, not the number or type of photographs.
- Wabar impact products are related terrestrial impact material and must not be represented as meteorites.
- Avoid automatic color normalization when it could alter genuine material color. Apply the quality gate in `docs/IMAGE_PREPARATION.md` after every image change.
- Acquisition cost is an optional, suggested specimen intake field. Because the repository is public, actual costs belong only in the owner-only external ledger documented in `docs/PRIVATE_COSTS.md`; importer validation must never publish or return them.

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
- Added the linked collection, sale-specimen, book, and research summary bar to every subpage and removed the two decorative banner overlay rectangles.
- Published and live-verified the complete subpage-summary and banner-cleanup update in commit `cb80b63`.
- Reviewed and ranked all 40 images for hero use, retaining 8 existing opening views and selecting stronger first images for the 367.3 g unclassified specimen, 63.2 g Wabar material, Kaalijarv, and the 47.4 g oriented NWA specimen.
- Published and live-verified the hero-image ordering update in commit `da018e9`.
- Confirmed that source folders 10-12 are one Aguas Zarcas specimen and that the former 12-photo folder 13 contains two stones: Ksar Ghilane 022 in `053441`-`053523` and Bjurböle in `053626`-`053851`.
- Added three centered, optimized Ksar Ghilane 022 images and verified official MetBull record 82150: ungrouped achondrite, Tatawin, Tunisia, find 2023.
- Added specimen-only private `cost_usd` intake validation, public-data denylist tests, external-ledger documentation, and a permission-restricted external ledger.
- Widened eight Wabar/impact-artifact frames that appeared oversized while preserving centered composition and required gallery counts.
- Published and live-verified Ksar Ghilane 022, private-cost intake safeguards, corrected source grouping, and widened Wabar framing in commit `ae21acb`.

## Active Work

- No implementation remains active from this session.

## Validation Evidence

- The initial inventory passed importer dry-run/write checks at 12 records and 40 images.
- Local validation currently passes 24 tests, including private-cost non-exposure and the prepared 11-record collection.
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
- Local and independent validation for the current summary-bar and banner-cleanup update pass with no functional or layout findings.
- GitHub Actions run `34452108226` passed tests and deployed commit `cb80b63` successfully.
- Live checks verified all five subpage summary bars, the `10 / 2 / 0 / 3` data values, link destinations, banner order, and overlay removal.
- Primary local validation for the hero-image ordering update passed all 23 tests.
- Independent validation passed all 12 hero choices with no findings.
- GitHub Actions run `34530392802` passed tests and deployed commit `da018e9` successfully.
- Live JSON checks verified all 12 opening images and all 40 unique gallery references.
- The current update passes importer dry-run at 13 total records and 43 images; all 11 new/reframed files decode at 1600 x 1200, and no acquisition-cost value appears in tracked/public data.
- Independent security/content validation passed Ksar metadata, source grouping, importer cost isolation, external-ledger permissions, and public leakage scans with no findings.
- Independent image validation passed the three Ksar images and all eight widened Wabar frames; focused revalidation confirmed the final G04 detail has complete moderate framing with no remaining findings.
- GitHub Actions run `34564372935` passed all 24 tests and deployed commit `ae21acb` successfully.
- Live checks verified 11 collection records, Ksar's public metadata and three images, `11 / 2 / 0 / 3` summary data, all 11 new/reframed image hashes, and absence of private cost fields.

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
- `cb80b63`: Added linked inventory summaries to every subpage and removed banner overlay rectangles.
- `da018e9`: Selected and published the strongest dramatic hero image for each specimen carousel.
- `ae21acb`: Added Ksar Ghilane 022, private specimen-cost intake safeguards, corrected grouping, and wider Wabar framing.
