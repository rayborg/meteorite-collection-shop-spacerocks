# Specimen Image Preparation

This workflow applies to every collection and sale specimen image published by the Spacerocks Cabinet.

## Selection

1. Inspect every source photograph at useful resolution before selecting views.
2. Use exactly 3 distinct images for each collection specimen and exactly 5 for each sale specimen.
3. Place the strongest dramatic complete view first. The hero should be sharp, centered, visually distinctive, and immediately communicate the specimen's form or material; do not default to the source filename labeled `hero` when another approved view is stronger.
4. Prefer a primary face, reverse, profile, scale, and useful material detail where those views exist.
5. Keep each physical sale specimen in its own record, with its own stable ID and photographs.

## Cropping

1. Compare the proposed crop with the complete source image.
2. Keep the entire specimen visible for normal face, reverse, profile, edge, and scale views. Intentional details may show only part of a specimen when the feature is unambiguous.
3. Center the specimen visually in both axes while leaving practical breathing room around fragile projections and frame edges. Approximate visual balance is more important than a mathematically exact pixel center.
4. When a specimen is very small relative to its scale cube, center the combined specimen-and-cube composition rather than isolating the specimen at the frame center.
5. Keep the specimen at roughly the same apparent size across images in one listing. Perspective and intentional details may vary, but ordinary views should not jump between distant and extreme close-up framing.
6. Prefer a 4:3 crop for catalog images. Retain a different orientation when it is necessary to show documentary information such as a scale reading, and present it with centered `object-fit: contain` rather than cropping it to the card ratio.

Crop and resize in separate operations. `sips` accepts crop arguments as height, width, then offset Y and X:

```sh
sips --cropToHeightWidth 2400 3200 --cropOffset 200 100 source.jpg --out cropped.jpg
sips --resampleHeightWidthMax 1600 --setProperty format jpeg --setProperty formatOptions 84 cropped.jpg --out web.jpg
```

Do not combine the crop and resize into one `sips` invocation. Operation ordering can produce an incorrect or empty frame.

## Color And Exposure

1. Compare every image with the other views of the same specimen.
2. Use the neutral backdrop as a reference when one is present.
3. Correct only a clear image-specific cast or exposure mismatch.
4. Do not use automatic gray-world, normalization, saturation, or sharpening across a batch without visual review. Genuine oxidation, inclusions, cut faces, reflective surroundings, and different specimen orientations can make automatic corrections scientifically misleading.
5. If no clear correction is justified, preserve the source color.

## Quality Gate

Run this gate after every crop, color, exposure, compression, or orientation change:

1. Open every changed final image at full delivered resolution.
2. Compare it with its source to confirm that the intended specimen or detail is present.
3. Compare all images in the listing side by side for horizontal and vertical centering, apparent size, framing, exposure, white balance, and orientation.
4. Check for clipped specimen edges, excessive empty background, blur, halos, compression artifacts, and accidental duplicate views.
5. Confirm ordinary landscape images are 1600 x 1200 pixels when the source permits. Documentary portrait images may be 1200 x 1600 pixels.
6. Confirm every image is no more than 563,200 bytes and no more than 1,600 pixels on its long edge. Confirm the complete image list for one record is no more than 1,677,722 bytes.
7. Treat the 1,600-pixel delivered file as the full-resolution web image: visitors can open the current carousel view directly, so inspect the entire frame at that size.
8. Confirm the file contains no location metadata intended to remain private.
9. Regenerate and inspect a contact sheet for every listing affected by an image change.
10. Do not import or publish until every changed image passes this gate. The importer enforces the byte and dimension ceilings and performs bounded structural validation for still AVIF, GIF, JPEG, PNG, and WebP. AVIS image sequences are rejected. It fails closed on malformed structure or dimensions but does not decode compressed AV1 or other image pixels, so manual visual inspection remains required.

## Inventory And Publication

1. Update the manifest with a stable physical `id`, reader-facing `Specimen NNN` number, exact weight, listing type, description, and ordered image list. Use the optional `meteorite_id` only when multiple physical records should share one meteorite page; `id` remains the cart identity.
2. Keep descriptions specimen-specific. Do not describe the photography process or image count in catalog prose.
3. Add Meteoritical Bulletin facts only when the identity is confirmed and each claim is supported by the official entry. Keep meteorite-level history separate from provenance claims about the physical specimen.
4. Run the importer without `--write` and confirm record, type, and image totals.
5. Run the importer with `--write` only after a successful dry run and completed image quality gate.
6. Run `npm run validate` and `git diff --check`.
7. Inspect the final diff, commit the intended files, push `main`, wait for the Pages workflow, and verify the live JSON, controls, labels, and representative images.
