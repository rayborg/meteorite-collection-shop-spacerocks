import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { headers, importInventory, isContained, optionalNumber, parseCsv, parseManifest } from "../scripts/import-inventory.mjs";

const imageFixtures = {
  ".jpg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  ".jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  ".png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".webp": Buffer.from("RIFF0000WEBP", "ascii")
};

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return headers.map((header) => csvValue(values[header])).join(",");
}

async function createProject(temporaryRoot) {
  const projectRoot = path.join(temporaryRoot, "project");
  const importFolder = path.join(temporaryRoot, "incoming");
  await mkdir(path.join(projectRoot, "data"), { recursive: true });
  await mkdir(path.join(importFolder, "images"), { recursive: true });
  const emptyCatalog = `${JSON.stringify({ schemaVersion: 1, updated: null, currency: "USD", items: [] }, null, 2)}\n`;
  await writeFile(path.join(projectRoot, "data/collection.json"), emptyCatalog);
  await writeFile(path.join(projectRoot, "data/sale-specimens.json"), emptyCatalog);
  await writeFile(path.join(projectRoot, "data/books.json"), emptyCatalog);
  return { projectRoot, importFolder };
}

async function writeImage(filePath) {
  const fixture = imageFixtures[path.extname(filePath).toLowerCase()];
  assert.ok(fixture, `missing image fixture for ${filePath}`);
  await writeFile(filePath, fixture);
}

async function writeManifest(importFolder, records) {
  await writeFile(path.join(importFolder, "inventory.csv"), `${headers.join(",")}\n${records.map(csvRow).join("\n")}\n`);
}

test("CSV parser preserves quoted descriptions and documentation examples stay valid", async () => {
  assert.deepEqual(parseCsv('a,b\n"one, two","said ""hello"""\n'), [
    ["a", "b"],
    ["one, two", 'said "hello"']
  ]);
  assert.throws(() => parseCsv('a,b\n"quoted"trailing,value\n'), /after a closing quote/u);
  assert.throws(() => optionalNumber("0x10", "display_order", 2, { integer: true }), /integer digits/u);
  assert.throws(() => optionalNumber("1e3", "mass_grams", 2), /decimal digits/u);
  assert.equal(isContained(path.join(path.sep, "catalog"), path.join(path.sep, "catalog", "..photos", "image.jpg")), true);
  assert.throws(() => parseManifest("id,name\nitem,Example\n"), /exact column order/u);
  const documentation = await readFile(new URL("../inventory-template/README.md", import.meta.url), "utf8");
  const documentedCsv = documentation.match(/```csv\n([\s\S]*?)\n```/u)?.[1];
  assert.ok(documentedCsv, "inventory documentation must contain a CSV example");
  assert.deepEqual(parseManifest(documentedCsv).map((row) => row.record_type), [
    "collection_specimen",
    "sale_specimen",
    "collection_book",
    "sale_book"
  ]);
});

test("folder importer validates, copies images, and routes all four record types", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-import-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);

  const records = [
    {
      record_type: "collection_specimen", id: "allende-001", display_order: 10, catalog_number: "SRC 001",
      name: "Allende", classification: "CV3", mass_grams: 24.6, description: "Collection specimen, with fusion crust.",
      image_files: "images/allende.JPG", image_alt: "Allende specimen"
    },
    {
      record_type: "sale_specimen", id: "campo-001", display_order: 20, catalog_number: "SRS 001",
      name: "Campo del Cielo", classification: "Iron, IAB-MG", mass_grams: 42.1, description: "Individual for sale.",
      price_usd: 85, status: "available", image_files: "images/campo.png", image_alt: "Campo del Cielo specimen"
    },
    {
      record_type: "collection_book", id: "burke-001", display_order: 10, catalog_number: "SRL 001",
      title: "Cosmic Debris", author: "John G. Burke", year: 1986, description: "Reference copy.",
      image_files: "images/burke.webp", image_alt: "Cosmic Debris cover"
    },
    {
      record_type: "sale_book", id: "nininger-001", display_order: 20, catalog_number: "SRB 001",
      title: "Find a Falling Star", author: "H. H. Nininger", year: 1972, description: "Copy offered for sale.",
      price_usd: 45, status: "available", image_files: "images/nininger.jpeg", image_alt: "Find a Falling Star cover"
    }
  ];
  for (const filename of ["allende.JPG", "campo.png", "burke.webp", "nininger.jpeg"]) {
    await writeImage(path.join(importFolder, "images", filename));
  }
  await writeManifest(importFolder, records);

  const dryRun = await importInventory(importFolder, { projectRoot });
  assert.deepEqual(dryRun, {
    mode: "dry-run",
    records: 4,
    images: 4,
    byType: { collection_specimen: 1, sale_specimen: 1, collection_book: 1, sale_book: 1 },
    targets: ["data/collection.json", "data/sale-specimens.json", "data/books.json"]
  });
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);

  const result = await importInventory(importFolder, { write: true, projectRoot });
  assert.equal(result.mode, "write");
  const collection = JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8"));
  const specimens = JSON.parse(await readFile(path.join(projectRoot, "data/sale-specimens.json"), "utf8"));
  const books = JSON.parse(await readFile(path.join(projectRoot, "data/books.json"), "utf8"));
  assert.equal(collection.items[0].name, "Allende");
  assert.equal(specimens.items[0].priceUsd, 85);
  assert.deepEqual(books.items.map((book) => book.listingType), ["collection", "sale"]);
  assert.equal(books.items[1].status, "available");
  await access(path.join(projectRoot, "assets/collection/allende-001-1-allende.jpg"));
  await access(path.join(projectRoot, "assets/sale-specimens/campo-001-1-campo.png"));
  await access(path.join(projectRoot, "assets/books/burke-001-1-burke.webp"));
});

test("importer rejects source and destination symlinks", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-symlink-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const outsideImage = path.join(temporaryRoot, "outside.jpg");
  await writeImage(outsideImage);
  await symlink(outsideImage, path.join(importFolder, "images/link.jpg"));
  const record = {
    record_type: "collection_specimen", id: "linked-001", display_order: 1, catalog_number: "SRC 001",
    name: "Linked", description: "Symlink source test.", image_files: "images/link.jpg", image_alt: "Linked specimen"
  };
  await writeManifest(importFolder, [record]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /symbolic link/u);

  await rm(path.join(importFolder, "images/link.jpg"));
  await writeImage(path.join(importFolder, "images/photo.jpg"));
  record.image_files = "images/photo.jpg";
  await writeManifest(importFolder, [record]);
  const destinationDirectory = path.join(projectRoot, "assets/collection");
  await mkdir(destinationDirectory, { recursive: true });
  const victim = path.join(temporaryRoot, "victim.txt");
  await writeFile(victim, "ORIGINAL-VICTIM");
  await symlink(victim, path.join(destinationDirectory, "linked-001-1-photo.jpg"));
  await assert.rejects(importInventory(importFolder, { write: true, projectRoot }), /Symbolic links are not allowed/u);
  assert.equal(await readFile(victim, "utf8"), "ORIGINAL-VICTIM");
});

test("failed destination preflight leaves existing assets unchanged", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-rollback-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  await writeImage(path.join(importFolder, "images/first.jpg"));
  await writeImage(path.join(importFolder, "images/second.jpg"));
  const records = [
    { record_type: "collection_specimen", id: "first-001", display_order: 1, catalog_number: "SRC 001", name: "First", description: "First.", image_files: "images/first.jpg", image_alt: "First" },
    { record_type: "collection_specimen", id: "second-001", display_order: 2, catalog_number: "SRC 002", name: "Second", description: "Second.", image_files: "images/second.jpg", image_alt: "Second" }
  ];
  await writeManifest(importFolder, records);
  const destinationDirectory = path.join(projectRoot, "assets/collection");
  await mkdir(path.join(destinationDirectory, "second-001-1-second.jpg"), { recursive: true });
  const firstDestination = path.join(destinationDirectory, "first-001-1-first.jpg");
  await writeFile(firstDestination, "ORIGINAL-FIRST");
  await assert.rejects(importInventory(importFolder, { write: true, projectRoot }), /regular file/u);
  assert.equal(await readFile(firstDestination, "utf8"), "ORIGINAL-FIRST");
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
});

test("importer rejects image content that does not match its extension", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-signature-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  await writeFile(path.join(importFolder, "images/fake.jpg"), "not an image");
  await writeManifest(importFolder, [{
    record_type: "collection_specimen", id: "fake-001", display_order: 1, catalog_number: "SRC 001",
    name: "Fake", description: "Invalid image test.", image_files: "images/fake.jpg", image_alt: "Fake"
  }]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /content does not match/u);
});

test("source replacement after validation cannot change staged bytes", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-source-race-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const source = path.join(importFolder, "images/source.jpg");
  const outside = path.join(temporaryRoot, "outside.jpg");
  await writeImage(source);
  await writeImage(outside);
  await writeManifest(importFolder, [{
    record_type: "collection_specimen", id: "race-001", display_order: 1, catalog_number: "SRC 001",
    name: "Race", description: "Race test.", image_files: "images/source.jpg", image_alt: "Race"
  }]);
  await assert.rejects(importInventory(importFolder, {
    write: true,
    projectRoot,
    testHooks: {
      async afterValidation() {
        await rm(source);
        await symlink(outside, source);
      }
    }
  }), /symbolic link before staging/u);
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
});

test("destination parent replacement during commit cannot escape the project", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-destination-race-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  await writeImage(path.join(importFolder, "images/specimen.jpg"));
  await writeImage(path.join(importFolder, "images/book.jpg"));
  await writeManifest(importFolder, [
    { record_type: "collection_specimen", id: "safe-001", display_order: 1, catalog_number: "SRC 001", name: "Safe", description: "Safe.", image_files: "images/specimen.jpg", image_alt: "Safe" },
    { record_type: "collection_book", id: "book-001", display_order: 1, catalog_number: "SRL 001", title: "Book", description: "Book.", image_files: "images/book.jpg", image_alt: "Book" }
  ]);
  const outsideDirectory = path.join(temporaryRoot, "outside-assets");
  await mkdir(outsideDirectory);
  await assert.rejects(importInventory(importFolder, {
    write: true,
    projectRoot,
    testHooks: {
      async afterCommit({ index }) {
        if (index !== 0) return;
        await rename(path.join(projectRoot, "assets/books"), path.join(projectRoot, "assets/books-moved"));
        await symlink(outsideDirectory, path.join(projectRoot, "assets/books"));
      }
    }
  }), /Symbolic links are not allowed/u);
  assert.deepEqual(await readdir(outsideDirectory), []);
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/books.json"), "utf8")).items.length, 0);
});
