import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const headers = [
  "record_type",
  "id",
  "display_order",
  "catalog_number",
  "name",
  "title",
  "classification",
  "author",
  "year",
  "mass_grams",
  "dimensions",
  "locality",
  "found_year",
  "acquired_year",
  "provenance",
  "edition",
  "publisher",
  "format",
  "condition",
  "description",
  "price_usd",
  "status",
  "image_files",
  "image_alt"
];

const typeConfig = {
  collection_specimen: { dataFile: "data/collection.json", assetDirectory: "assets/collection", kind: "specimen", listingType: "collection" },
  sale_specimen: { dataFile: "data/sale-specimens.json", assetDirectory: "assets/sale-specimens", kind: "specimen", listingType: "sale" },
  collection_book: { dataFile: "data/books.json", assetDirectory: "assets/books", kind: "book", listingType: "collection" },
  sale_book: { dataFile: "data/books.json", assetDirectory: "assets/books", kind: "book", listingType: "sale" }
};

const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const saleStatuses = new Set(["available", "reserved", "sold"]);

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        field += character;
      }
    } else if (quoteClosed) {
      if (character === ",") {
        row.push(field.trim());
        field = "";
        quoteClosed = false;
      } else if (character === "\n") {
        row.push(field.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        field = "";
        quoteClosed = false;
      } else if (character !== "\r" && character !== " " && character !== "\t") {
        throw new Error(`Unexpected character after a closing quote near character ${index + 1}`);
      }
    } else if (character === '"') {
      if (field) throw new Error(`Unexpected quote near character ${index + 1}`);
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("The CSV ends inside a quoted field");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseManifest(source) {
  const rows = parseCsv(source.replace(/^\uFEFF/u, ""));
  if (!rows.length) throw new Error("inventory.csv is empty");
  const actualHeaders = rows[0];
  if (actualHeaders.join(",") !== headers.join(",")) {
    throw new Error(`inventory.csv must use this exact column order:\n${headers.join(",")}`);
  }
  return rows.slice(1).map((values, index) => {
    if (values.length > headers.length && values.slice(headers.length).some(Boolean)) {
      throw new Error(`Row ${index + 2} has more values than the header`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column] || ""]));
  });
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function optionalNumber(value, label, rowNumber, { integer = false } = {}) {
  if (!value) return null;
  const pattern = integer ? /^\d+$/u : /^(?:\d+(?:\.\d+)?|\.\d+)$/u;
  if (!pattern.test(value)) {
    throw new Error(`Row ${rowNumber}: ${label} must use ${integer ? "integer" : "decimal"} digits`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Row ${rowNumber}: ${label} must be a nonnegative ${integer ? "integer" : "number"}`);
  }
  return parsed;
}

function addValue(target, key, value) {
  if (value !== null && value !== undefined && value !== "") target[key] = value;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isContained(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function assertNoSymlinkPath(rootDirectory, candidate) {
  if (!isContained(rootDirectory, candidate)) throw new Error(`Destination escapes the project root: ${candidate}`);
  const parts = path.relative(rootDirectory, candidate).split(path.sep).filter(Boolean);
  let current = rootDirectory;
  for (const part of parts) {
    current = path.join(current, part);
    const details = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!details) break;
    if (details.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in import destinations: ${current}`);
  }
}

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis", "mif1"].includes(bytes.subarray(8, 12).toString("ascii"))) return "avif";
  return null;
}

function extensionType(extension) {
  return extension === ".jpg" || extension === ".jpeg" ? "jpeg" : extension.slice(1);
}

function sameFileIdentity(actual, expected) {
  return actual.dev === expected.dev && actual.ino === expected.ino && actual.size === expected.size && actual.mtimeMs === expected.mtimeMs;
}

async function openSourceNoFollow(source) {
  return open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
}

async function buildRecord(row, rowNumber, inputDirectory, canonicalInput, projectRoot) {
  const config = typeConfig[row.record_type];
  if (!config) throw new Error(`Row ${rowNumber}: record_type must be one of ${Object.keys(typeConfig).join(", ")}`);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(row.id)) throw new Error(`Row ${rowNumber}: id must use lowercase letters, numbers, and hyphens`);
  const displayOrder = optionalNumber(row.display_order, "display_order", rowNumber, { integer: true });
  if (!displayOrder || displayOrder < 1) throw new Error(`Row ${rowNumber}: display_order must be an integer of 1 or greater`);
  if (!row.catalog_number) throw new Error(`Row ${rowNumber}: catalog_number is required`);
  if (!row.description) throw new Error(`Row ${rowNumber}: description is required`);
  if (config.kind === "specimen" && !row.name) throw new Error(`Row ${rowNumber}: name is required for specimens`);
  if (config.kind === "book" && !row.title) throw new Error(`Row ${rowNumber}: title is required for books`);
  if (config.listingType === "sale" && !saleStatuses.has(row.status)) {
    throw new Error(`Row ${rowNumber}: sale status must be available, reserved, or sold`);
  }

  const imageReferences = row.image_files.split("|").map((value) => value.trim()).filter(Boolean);
  if (!imageReferences.length) throw new Error(`Row ${rowNumber}: image_files must contain at least one image filename`);
  if (!row.image_alt) throw new Error(`Row ${rowNumber}: image_alt is required`);

  const imagePlans = [];
  for (const [index, reference] of imageReferences.entries()) {
    const source = path.resolve(inputDirectory, reference);
    if (!isContained(inputDirectory, source)) throw new Error(`Row ${rowNumber}: image path escapes the import folder`);
    const sourceLink = await lstat(source).catch(() => null);
    if (sourceLink?.isSymbolicLink()) throw new Error(`Row ${rowNumber}: image cannot be a symbolic link: ${reference}`);
    if (!sourceLink?.isFile()) throw new Error(`Row ${rowNumber}: image not found: ${reference}`);
    const canonicalSource = await realpath(source);
    if (!isContained(canonicalInput, canonicalSource)) throw new Error(`Row ${rowNumber}: image resolves outside the import folder`);
    const canonicalStats = await stat(canonicalSource);
    const originalExtension = path.extname(source);
    const extension = originalExtension.toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error(`Row ${rowNumber}: unsupported image type for ${reference}`);
    const handle = await openSourceNoFollow(source).catch(() => null);
    if (!handle) throw new Error(`Row ${rowNumber}: image could not be opened without following links: ${reference}`);
    let sourceIdentity;
    try {
      sourceIdentity = await handle.stat();
      if (!sameFileIdentity(sourceIdentity, canonicalStats)) throw new Error(`Row ${rowNumber}: image changed during validation: ${reference}`);
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (detectImageType(header.subarray(0, bytesRead)) !== extensionType(extension)) {
        throw new Error(`Row ${rowNumber}: image content does not match its extension: ${reference}`);
      }
    } finally {
      await handle.close();
    }
    const base = safeSlug(path.basename(source, originalExtension)) || "image";
    const filename = `${row.id}-${index + 1}-${base}${extension}`;
    imagePlans.push({
      source,
      sourceIdentity: { dev: sourceIdentity.dev, ino: sourceIdentity.ino, size: sourceIdentity.size, mtimeMs: sourceIdentity.mtimeMs },
      expectedType: extensionType(extension),
      destination: path.join(projectRoot, config.assetDirectory, filename),
      publicPath: `./${config.assetDirectory}/${filename}`
    });
  }

  const item = {
    id: row.id,
    displayOrder,
    catalogNumber: row.catalog_number,
    description: row.description,
    image: imagePlans[0].publicPath,
    images: imagePlans.map((image) => image.publicPath),
    imageAlt: row.image_alt
  };

  if (config.kind === "specimen") {
    item.name = row.name;
    addValue(item, "classification", row.classification);
    addValue(item, "massGrams", optionalNumber(row.mass_grams, "mass_grams", rowNumber));
    addValue(item, "dimensions", row.dimensions);
    addValue(item, "locality", row.locality);
    addValue(item, "foundYear", optionalNumber(row.found_year, "found_year", rowNumber, { integer: true }));
    addValue(item, "acquiredYear", optionalNumber(row.acquired_year, "acquired_year", rowNumber, { integer: true }));
    addValue(item, "provenance", row.provenance);
  } else {
    item.title = row.title;
    item.listingType = config.listingType;
    addValue(item, "author", row.author);
    addValue(item, "year", optionalNumber(row.year, "year", rowNumber, { integer: true }));
    addValue(item, "edition", row.edition);
    addValue(item, "publisher", row.publisher);
    addValue(item, "format", row.format);
    addValue(item, "condition", row.condition);
    addValue(item, "provenance", row.provenance);
  }

  if (config.listingType === "sale") {
    item.status = row.status;
    addValue(item, "priceUsd", optionalNumber(row.price_usd, "price_usd", rowNumber));
  }

  return { config, item, imagePlans, rowNumber };
}

function mergeItems(existingItems, incomingItems) {
  const merged = [...existingItems];
  for (const item of incomingItems) {
    const existingIndex = merged.findIndex((existing) => existing.id === item.id);
    if (existingIndex >= 0) merged[existingIndex] = item;
    else merged.push(item);
  }
  return merged.sort((a, b) => {
    const order = (a.displayOrder ?? Number.POSITIVE_INFINITY) - (b.displayOrder ?? Number.POSITIVE_INFINITY);
    return order || String(a.catalogNumber || a.id).localeCompare(String(b.catalogNumber || b.id), undefined, { numeric: true });
  });
}

async function commitUpdates(records, updates, projectRoot, testHooks = {}) {
  const stagingDirectory = await mkdtemp(path.join(projectRoot, ".inventory-import-"));
  const operations = [];
  const committed = [];
  try {
    let operationIndex = 0;
    for (const record of records) {
      for (const image of record.imagePlans) {
        const staged = path.join(stagingDirectory, `staged-${operationIndex}`);
        const handle = await openSourceNoFollow(image.source).catch(() => null);
        if (!handle) throw new Error(`Image changed or became a symbolic link before staging: ${image.source}`);
        try {
          const sourceIdentity = await handle.stat();
          if (!sameFileIdentity(sourceIdentity, image.sourceIdentity)) throw new Error(`Image changed before staging: ${image.source}`);
          const contents = await handle.readFile();
          if (detectImageType(contents.subarray(0, 16)) !== image.expectedType) throw new Error(`Image content changed before staging: ${image.source}`);
          await writeFile(staged, contents, { flag: "wx" });
        } finally {
          await handle.close();
        }
        operations.push({ staged, destination: image.destination });
        operationIndex += 1;
      }
    }
    for (const update of updates) {
      const staged = path.join(stagingDirectory, `staged-${operationIndex}`);
      await writeFile(staged, `${JSON.stringify(update.data, null, 2)}\n`, "utf8");
      operations.push({ staged, destination: update.destination });
      operationIndex += 1;
    }

    for (const operation of operations) {
      await assertNoSymlinkPath(projectRoot, operation.destination);
      const existing = await lstat(operation.destination).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing && !existing.isFile()) throw new Error(`Import destination must be a regular file: ${operation.destination}`);
      await mkdir(path.dirname(operation.destination), { recursive: true });
      const canonicalParent = await realpath(path.dirname(operation.destination));
      if (!isContained(projectRoot, canonicalParent)) throw new Error(`Import destination resolves outside the project root: ${operation.destination}`);
      await assertNoSymlinkPath(projectRoot, operation.destination);
    }

    for (const [index, operation] of operations.entries()) {
      await assertNoSymlinkPath(projectRoot, operation.destination);
      const canonicalParent = await realpath(path.dirname(operation.destination));
      if (!isContained(projectRoot, canonicalParent)) throw new Error(`Import destination changed before commit: ${operation.destination}`);
      const existing = await lstat(operation.destination).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const backup = existing ? path.join(stagingDirectory, `backup-${index}`) : null;
      if (backup) await rename(operation.destination, backup);
      try {
        await rename(operation.staged, operation.destination);
      } catch (error) {
        if (backup) await rename(backup, operation.destination);
        throw error;
      }
      committed.push({ destination: operation.destination, backup });
      await testHooks.afterCommit?.({ index, destination: operation.destination });
    }
  } catch (error) {
    for (const operation of committed.reverse()) {
      await rm(operation.destination, { force: true });
      if (operation.backup) await rename(operation.backup, operation.destination);
    }
    throw error;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function importInventory(inputDirectory, { write = false, projectRoot = root, testHooks = {} } = {}) {
  const directory = path.resolve(inputDirectory);
  const directoryStats = await stat(directory).catch(() => null);
  if (!directoryStats?.isDirectory()) throw new Error(`Import folder not found: ${directory}`);
  const canonicalInput = await realpath(directory);
  const canonicalProjectRoot = await realpath(path.resolve(projectRoot)).catch(() => null);
  if (!canonicalProjectRoot) throw new Error(`Project root not found: ${path.resolve(projectRoot)}`);
  const manifestPath = path.join(directory, "inventory.csv");
  if (!await fileExists(manifestPath)) throw new Error(`Missing ${manifestPath}`);
  const manifestDetails = await lstat(manifestPath);
  if (manifestDetails.isSymbolicLink()) throw new Error("inventory.csv cannot be a symbolic link");

  const rows = parseManifest(await readFile(manifestPath, "utf8"));
  if (!rows.length) throw new Error("inventory.csv contains no inventory rows");
  const records = [];
  const errors = [];
  for (const [index, row] of rows.entries()) {
    try {
      records.push(await buildRecord(row, index + 2, directory, canonicalInput, canonicalProjectRoot));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));

  const identityKeys = new Set();
  const orderKeys = new Set();
  for (const record of records) {
    const identityKey = `${record.config.dataFile}:${record.item.id}`;
    const orderKey = `${record.config.dataFile}:${record.item.displayOrder}`;
    if (identityKeys.has(identityKey)) throw new Error(`Duplicate id for ${record.config.dataFile}: ${record.item.id}`);
    if (orderKeys.has(orderKey)) throw new Error(`Duplicate display_order for ${record.config.dataFile}: ${record.item.displayOrder}`);
    identityKeys.add(identityKey);
    orderKeys.add(orderKey);
  }

  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.config.dataFile)) groups.set(record.config.dataFile, []);
    groups.get(record.config.dataFile).push(record);
  }

  const updates = [];
  for (const [dataFile, group] of groups) {
    const destination = path.join(canonicalProjectRoot, dataFile);
    await assertNoSymlinkPath(canonicalProjectRoot, destination);
    const data = JSON.parse(await readFile(destination, "utf8"));
    const items = mergeItems(data.items || [], group.map((record) => record.item));
    const usedOrders = new Map();
    for (const item of items) {
      if (!Number.isInteger(item.displayOrder)) continue;
      if (usedOrders.has(item.displayOrder)) {
        throw new Error(`display_order ${item.displayOrder} is shared by ${usedOrders.get(item.displayOrder)} and ${item.id} in ${dataFile}`);
      }
      usedOrders.set(item.displayOrder, item.id);
    }
    updates.push({
      destination,
      data: {
        ...data,
        updated: new Date().toISOString().slice(0, 10),
        items
      },
      records: group
    });
  }

  const summary = {
    mode: write ? "write" : "dry-run",
    records: records.length,
    images: records.reduce((total, record) => total + record.imagePlans.length, 0),
    byType: Object.fromEntries(Object.keys(typeConfig).map((type) => [type, rows.filter((row) => row.record_type === type).length])),
    targets: updates.map((update) => path.relative(canonicalProjectRoot, update.destination))
  };

  if (!write) return summary;
  await testHooks.afterValidation?.({ records });
  await commitUpdates(records, updates, canonicalProjectRoot, testHooks);
  return summary;
}

function printUsage() {
  console.log("Usage: npm run import:inventory -- \"/path/to/folder\" [--write]");
  console.log("Dry-run validation is the default. Add --write only after reviewing the summary.");
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    printUsage();
    process.exitCode = args.includes("--help") ? 0 : 1;
    return;
  }
  const inputDirectory = args.find((argument) => !argument.startsWith("--"));
  if (!inputDirectory) throw new Error("An import folder path is required");
  const unknownFlags = args.filter((argument) => argument.startsWith("--") && argument !== "--write");
  if (unknownFlags.length) throw new Error(`Unknown option: ${unknownFlags.join(", ")}`);

  const summary = await importInventory(inputDirectory, { write: args.includes("--write") });
  console.log(`${summary.mode === "write" ? "Imported" : "Dry run validated"}: ${summary.records} records and ${summary.images} images`);
  console.log(`Types: ${Object.entries(summary.byType).map(([type, count]) => `${type}=${count}`).join(", ")}`);
  console.log(`Targets: ${summary.targets.join(", ")}`);
  if (summary.mode === "dry-run") console.log("No files were changed. Run again with --write to apply this import.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { headers, importInventory, isContained, mergeItems, optionalNumber, parseCsv, parseManifest };
