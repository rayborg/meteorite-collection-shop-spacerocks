import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const defaultLedgerPath = path.join(root, "data/specimen-ledger.csv");
const meteoritesPath = path.join(root, "data/meteorites.json");
const catalogPaths = {
  collection_specimen: path.join(root, "data/collection.json"),
  sale_specimen: path.join(root, "data/sale-specimens.json")
};
const headers = [
  "specimen_id",
  "record_type",
  "id",
  "display_order",
  "catalog_number",
  "metbull_code",
  "meteorite_id",
  "name",
  "classification",
  "mass_grams",
  "dimensions",
  "locality",
  "found_year",
  "acquired_year",
  "provenance",
  "specimen_description",
  "image_alt",
  "price_usd",
  "status"
];
const validStatuses = new Set(["available", "reserved", "sold"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const maxPublicPriceCents = 100_000_000n;

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

function parseLedger(source) {
  const rows = parseCsv(source.replace(/^\uFEFF/u, ""));
  if (!rows.length) throw new Error("The specimen ledger is empty");
  if (rows[0].join(",") !== headers.join(",")) {
    throw new Error(`The specimen ledger must use this exact column order:\n${headers.join(",")}`);
  }
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`Row ${index + 2}: expected ${headers.length} columns but found ${values.length}`);
    }
    return { rowNumber: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, values[column]])) };
  });
}

function requiredText(row, field) {
  if (!row[field]) throw new Error(`Row ${row.rowNumber}: ${field} is required`);
  return row[field];
}

function optionalNumber(value, label, rowNumber, { integer = false, required = false, positive = false } = {}) {
  if (!value) {
    if (required) throw new Error(`Row ${rowNumber}: ${label} is required`);
    return null;
  }
  const pattern = integer ? /^\d+$/u : /^(?:\d+(?:\.\d+)?|\.\d+)$/u;
  if (!pattern.test(value)) throw new Error(`Row ${rowNumber}: ${label} has an invalid numeric format`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (positive && parsed <= 0) || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Row ${rowNumber}: ${label} must be ${positive ? "positive" : "nonnegative"}${integer ? " and integral" : ""}`);
  }
  return parsed;
}

function optionalUsd(value, label, rowNumber) {
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error(`Row ${rowNumber}: ${label} must use nonnegative USD with at most two fractional digits`);
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > maxPublicPriceCents) throw new Error(`Row ${rowNumber}: ${label} exceeds the maximum supported public price of 1000000.00 USD`);
  return Number(cents) / 100;
}

function addOptional(target, key, value) {
  if (value !== null && value !== undefined && value !== "") target[key] = value;
}

function validateMeteorites(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.items)) throw new Error("data/meteorites.json must use schemaVersion 1 with an items array");
  const byCode = new Map();
  for (const [index, item] of data.items.entries()) {
    const label = `data/meteorites.json item ${index + 1}`;
    if (!/^\d+$/u.test(item.metbullCode || "")) throw new Error(`${label}: metbullCode must contain digits`);
    if (byCode.has(item.metbullCode)) throw new Error(`${label}: duplicate metbullCode ${item.metbullCode}`);
    for (const field of ["name", "classification", "summary", "sourceUrl"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`${label}: ${field} is required`);
    }
    const expectedUrl = `https://www.lpi.usra.edu/meteor/metbull.php?code=${item.metbullCode}`;
    if (item.sourceUrl !== expectedUrl) throw new Error(`${label}: sourceUrl must be ${expectedUrl}`);
    if (item.foundYear !== undefined && (!Number.isInteger(item.foundYear) || item.foundYear < 0)) {
      throw new Error(`${label}: foundYear must be a nonnegative integer`);
    }
    byCode.set(item.metbullCode, item);
  }
  return byCode;
}

function buildCatalogs({ ledgerSource, meteorites, collection, sale }) {
  const rows = parseLedger(ledgerSource);
  const meteoritesByCode = validateMeteorites(meteorites);
  const existingById = new Map();
  for (const [recordType, catalog] of [["collection_specimen", collection], ["sale_specimen", sale]]) {
    if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error(`${path.basename(catalogPaths[recordType])} has an invalid schema`);
    for (const item of catalog.items) {
      if (existingById.has(item.id)) throw new Error(`Duplicate physical ID in current catalogs: ${item.id}`);
      existingById.set(item.id, { recordType, item });
    }
  }

  if (!rows.length) throw new Error("The specimen ledger must contain at least one specimen");
  const seenIds = new Set();
  const displayOrders = { collection_specimen: new Set(), sale_specimen: new Set() };
  const generated = { collection_specimen: [], sale_specimen: [] };

  rows.forEach((row, index) => {
    const expectedSpecimenId = `Specimen ${String(index + 1).padStart(3, "0")}`;
    if (row.specimen_id !== expectedSpecimenId) {
      throw new Error(`Row ${row.rowNumber}: specimen_id must be ${expectedSpecimenId} to keep one contiguous global sequence`);
    }
    if (!(row.record_type in catalogPaths)) throw new Error(`Row ${row.rowNumber}: unsupported record_type ${row.record_type}`);
    const id = requiredText(row, "id");
    if (!slugPattern.test(id) || id.length > 80) throw new Error(`Row ${row.rowNumber}: id must be a lowercase hyphenated slug of at most 80 characters`);
    if (seenIds.has(id)) throw new Error(`Row ${row.rowNumber}: duplicate physical ID ${id}`);
    seenIds.add(id);
    const existing = existingById.get(id);
    if (!existing) throw new Error(`Row ${row.rowNumber}: ${id} must first be added with the image importer`);
    if (existing.recordType !== row.record_type) throw new Error(`Row ${row.rowNumber}: ${id} belongs to ${existing.recordType}`);

    const displayOrder = optionalNumber(row.display_order, "display_order", row.rowNumber, { integer: true, required: true, positive: true });
    if (displayOrders[row.record_type].has(displayOrder)) throw new Error(`Row ${row.rowNumber}: duplicate display_order ${displayOrder} in ${row.record_type}`);
    displayOrders[row.record_type].add(displayOrder);
    const catalogNumber = requiredText(row, "catalog_number");
    if (!/^Specimen \d{3,}$/u.test(catalogNumber)) throw new Error(`Row ${row.rowNumber}: catalog_number must use Specimen NNN format`);

    if (row.meteorite_id && (!slugPattern.test(row.meteorite_id) || row.meteorite_id.length > 80)) {
      throw new Error(`Row ${row.rowNumber}: meteorite_id must be a lowercase hyphenated slug of at most 80 characters`);
    }
    const meteorite = row.metbull_code ? meteoritesByCode.get(row.metbull_code) : null;
    if (row.metbull_code && !meteorite) throw new Error(`Row ${row.rowNumber}: unknown metbull_code ${row.metbull_code}`);
    if (meteorite) {
      for (const field of ["name", "classification", "locality", "found_year"]) {
        if (row[field]) throw new Error(`Row ${row.rowNumber}: ${field} must be blank because metbull_code ${row.metbull_code} supplies it`);
      }
    } else {
      requiredText(row, "name");
    }

    const massGrams = optionalNumber(row.mass_grams, "mass_grams", row.rowNumber, { required: true, positive: true });
    const foundYear = meteorite?.foundYear ?? optionalNumber(row.found_year, "found_year", row.rowNumber, { integer: true });
    const acquiredYear = optionalNumber(row.acquired_year, "acquired_year", row.rowNumber, { integer: true });
    const priceUsd = optionalUsd(row.price_usd, "price_usd", row.rowNumber);
    const specimenDescription = requiredText(row, "specimen_description");
    const imageAlt = requiredText(row, "image_alt");
    if (!existing.item.image || !Array.isArray(existing.item.images) || !existing.item.images.length) {
      throw new Error(`Row ${row.rowNumber}: ${id} has no existing imported image gallery`);
    }

    if (row.record_type === "collection_specimen" && (row.price_usd || row.status)) {
      throw new Error(`Row ${row.rowNumber}: collection specimens cannot use price_usd or status`);
    }
    if (row.record_type === "sale_specimen" && !validStatuses.has(row.status)) {
      throw new Error(`Row ${row.rowNumber}: sale status must be available, reserved, or sold`);
    }

    const item = {
      id,
      specimenId: row.specimen_id,
      displayOrder,
      catalogNumber,
      description: [specimenDescription, meteorite?.summary].filter(Boolean).join(" "),
      image: existing.item.image,
      images: existing.item.images,
      imageAlt,
      name: meteorite?.name || row.name
    };
    addOptional(item, "meteoriteId", row.meteorite_id);
    addOptional(item, "metbullCode", meteorite?.metbullCode);
    addOptional(item, "classification", meteorite?.classification || row.classification);
    item.massGrams = massGrams;
    addOptional(item, "dimensions", row.dimensions);
    addOptional(item, "locality", meteorite?.locality || row.locality);
    addOptional(item, "foundYear", foundYear);
    addOptional(item, "acquiredYear", acquiredYear);
    addOptional(item, "provenance", row.provenance);
    if (row.record_type === "sale_specimen") {
      addOptional(item, "priceUsd", priceUsd);
      item.status = row.status;
    }
    generated[row.record_type].push(item);
  });

  const missing = [...existingById.keys()].filter((id) => !seenIds.has(id));
  if (missing.length) throw new Error(`The specimen ledger is missing current physical IDs: ${missing.join(", ")}`);
  for (const items of Object.values(generated)) items.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  return {
    collectionItems: generated.collection_specimen,
    saleItems: generated.sale_specimen,
    specimenCount: rows.length,
    metbullAssociationCount: rows.filter((row) => row.metbull_code).length
  };
}

function catalogsMatch(generated, collection, sale) {
  return {
    collection: JSON.stringify(generated.collectionItems) === JSON.stringify(collection.items),
    sale: JSON.stringify(generated.saleItems) === JSON.stringify(sale.items)
  };
}

async function writeCatalogUpdates(updates) {
  const suffix = `.specimen-ledger-${process.pid}-${Date.now()}`;
  const prepared = [];
  const applied = [];
  let complete = false;
  try {
    for (const update of updates) {
      const details = await lstat(update.filePath);
      if (details.isSymbolicLink()) throw new Error(`Refusing to replace symbolic-link catalog: ${update.filePath}`);
      const temporaryPath = `${update.filePath}${suffix}`;
      const backupPath = `${update.filePath}${suffix}.backup`;
      await writeFile(temporaryPath, `${JSON.stringify(update.data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      prepared.push({ ...update, temporaryPath, backupPath });
    }
    for (const update of prepared) {
      await rename(update.filePath, update.backupPath);
      try {
        await rename(update.temporaryPath, update.filePath);
      } catch (error) {
        await rename(update.backupPath, update.filePath);
        throw error;
      }
      applied.push(update);
    }
    complete = true;
  } catch (error) {
    for (const update of applied.reverse()) {
      await rm(update.filePath, { force: true });
      await rename(update.backupPath, update.filePath);
    }
    throw error;
  } finally {
    await Promise.all(prepared.map((update) => rm(update.temporaryPath, { force: true }).catch(() => {})));
    if (complete) await Promise.all(prepared.map((update) => rm(update.backupPath, { force: true }).catch(() => {})));
  }
}

function parseArguments(arguments_) {
  let mode = "dry-run";
  let ledgerPath = defaultLedgerPath;
  let pathSeen = false;
  for (const argument of arguments_) {
    if (argument === "--check" || argument === "--write") {
      if (mode !== "dry-run") throw new Error("Use only one of --check or --write");
      mode = argument.slice(2);
    } else if (argument === "--help") {
      mode = "help";
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (pathSeen) {
      throw new Error("Provide at most one specimen-ledger CSV path");
    } else {
      ledgerPath = path.resolve(argument);
      pathSeen = true;
    }
  }
  return { mode, ledgerPath };
}

async function main() {
  const { mode, ledgerPath } = parseArguments(process.argv.slice(2));
  if (mode === "help") {
    console.log("Usage: node scripts/sync-specimen-ledger.mjs [ledger.csv] [--check|--write]");
    return;
  }
  const [ledgerSource, meteoritesSource, collectionSource, saleSource] = await Promise.all([
    readFile(ledgerPath, "utf8"),
    readFile(meteoritesPath, "utf8"),
    readFile(catalogPaths.collection_specimen, "utf8"),
    readFile(catalogPaths.sale_specimen, "utf8")
  ]);
  const meteorites = JSON.parse(meteoritesSource);
  const collection = JSON.parse(collectionSource);
  const sale = JSON.parse(saleSource);
  const generated = buildCatalogs({ ledgerSource, meteorites, collection, sale });
  const matches = catalogsMatch(generated, collection, sale);
  const changedCatalogs = Object.entries(matches).filter(([, matchesCatalog]) => !matchesCatalog).map(([name]) => name);

  if (mode === "check" && changedCatalogs.length) {
    throw new Error(`Generated specimen metadata is out of sync in: ${changedCatalogs.join(", ")}. Run npm run ledger:sync -- --write.`);
  }
  if (mode === "write" && changedCatalogs.length) {
    const updated = new Date().toISOString().slice(0, 10);
    const updates = [];
    if (!matches.collection) updates.push({ filePath: catalogPaths.collection_specimen, data: { ...collection, updated, items: generated.collectionItems } });
    if (!matches.sale) updates.push({ filePath: catalogPaths.sale_specimen, data: { ...sale, updated, items: generated.saleItems } });
    await writeCatalogUpdates(updates);
  }

  console.log(JSON.stringify({
    mode,
    ledger: ledgerPath,
    specimens: generated.specimenCount,
    metbullAssociations: generated.metbullAssociationCount,
    changedCatalogs,
    written: mode === "write" ? changedCatalogs : []
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { buildCatalogs, catalogsMatch, headers, parseArguments, parseCsv, parseLedger, validateMeteorites };
