import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, readFile, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildCatalogs, catalogsMatch, parseLedger } from "./sync-specimen-ledger.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const contractName = "coa-batch-input-v1";
const schemaVersion = "1.0.0";
const issuer = "The Spacerocks Cabinet";
const photographDisclosure = "Prepared catalog image; not an original camera file.";
const sourceRelativePaths = {
  ledger: "data/specimen-ledger.csv",
  meteorites: "data/meteorites.json",
  collection: "data/collection.json",
  saleSpecimens: "data/sale-specimens.json",
  assertions: "data/coa-assertions-v1.json"
};
const schemaRelativePath = "contracts/coa-batch-input-v1.schema.json";
const expectedOfficialCodes = new Map([
  ["Specimen 006", "12217"],
  ["Specimen 009", "5064"],
  ["Specimen 011", "82150"],
  ["Specimen 013", "69696"]
]);
const expectedAssertionFacts = [
  ["meteorite", "unclassified-meteorite", "unknown", null, "unknown", "unknown"],
  ["impact-material", "cataloged-impact-material", "impact-site-association", null, "unknown", "locality"],
  ["impact-material", "cataloged-impact-material", "impact-site-association", null, "unknown", "locality"],
  ["impact-material", "cataloged-impact-material", "impact-site-association", null, "unknown", "locality"],
  ["impact-material", "cataloged-impact-material", "impact-site-association", null, "unknown", "locality"],
  ["meteorite", "official-meteorite", "find", "1937", "year", "country", "12217"],
  ["meteorite", "unclassified-meteorite", "unknown", null, "unknown", "unknown"],
  ["meteorite", "unclassified-meteorite", "unknown", null, "unknown", "region"],
  ["meteorite", "official-meteorite", "fall", "1899", "year", "country", "5064"],
  ["meteorite", "unclassified-meteorite", "unknown", null, "unknown", "region"],
  ["meteorite", "official-meteorite", "find", "2023", "year", "locality", "82150"],
  ["impact-material", "cataloged-impact-material", "impact-site-association", null, "unknown", "locality"],
  ["meteorite", "official-meteorite", "fall", "2019-04-23", "day", "country", "69696"]
];
const privateKeys = new Set([
  "acquiredYear",
  "buyer",
  "buyerData",
  "cost",
  "costUsd",
  "email",
  "price",
  "priceUsd",
  "receipt",
  "saleStatus",
  "seller",
  "shippingAddress",
  "status",
  "storageLocation"
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

function sameFileState(first, second) {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mtimeNs === second.mtimeNs
    && first.ctimeNs === second.ctimeNs;
}

async function readSafeFile(filePath, label, withinDirectory) {
  const lexicalDirectory = path.resolve(withinDirectory);
  const lexicalPath = path.resolve(filePath);
  const relativePath = path.relative(lexicalDirectory, lexicalPath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} escapes ${withinDirectory}`);
  }
  const [before, canonicalDirectory] = await Promise.all([
    lstat(filePath, { bigint: true }),
    realpath(withinDirectory)
  ]);
  if (before.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  if (!before.isFile()) throw new Error(`${label} must be a regular file`);

  const canonicalPath = await realpath(filePath);
  const expectedCanonicalPath = path.resolve(canonicalDirectory, relativePath);
  if (canonicalPath !== expectedCanonicalPath || !isWithin(canonicalPath, canonicalDirectory)) {
    throw new Error(`${label} uses a symbolic-link parent or escapes ${withinDirectory}`);
  }

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`${label} changed while it was being opened`);
    }
    const bytes = await handle.readFile();
    const after = await lstat(filePath, { bigint: true });
    if (!sameFileState(before, after)) throw new Error(`${label} changed while it was being read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function expectedAssertions() {
  return {
    schemaVersion,
    specimens: expectedAssertionFacts.map((facts, index) => {
      const [objectCategory, identityKind, kind, date, datePrecision, locationPrecision, sourceCode] = facts;
      const assertion = {
        specimenId: `Specimen ${String(index + 1).padStart(3, "0")}`,
        locationPrecision
      };
      if (identityKind !== "official-meteorite") {
        assertion.objectCategory = objectCategory;
        assertion.identityKind = identityKind;
      }
      if (index !== 5 && index !== 10) {
        assertion.occurrence = { kind, date, datePrecision };
        if (sourceCode) assertion.occurrence.sourceUrl = `https://www.lpi.usra.edu/meteor/metbull.php?code=${sourceCode}`;
      }
      return assertion;
    })
  };
}

function validateAssertions(assertions) {
  try {
    assert.deepEqual(assertions, expectedAssertions());
  } catch {
    throw new Error("data/coa-assertions-v1.json does not exactly match the reviewed 13-specimen assertion set");
  }
  return assertions.specimens;
}

function schemaTypeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function resolveSchemaReference(schema, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Unsupported JSON Schema reference: ${reference}`);
  return reference.slice(2).split("/").reduce((current, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return current?.[key];
  }, schema);
}

function schemaErrors(value, rule, schema, location) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return [`${location}: invalid schema rule`];
  if (rule.$ref) {
    const referenced = resolveSchemaReference(schema, rule.$ref);
    return referenced ? schemaErrors(value, referenced, schema, location) : [`${location}: unresolved schema reference ${rule.$ref}`];
  }
  if (rule.oneOf) {
    const branchErrors = rule.oneOf.map((branch) => schemaErrors(value, branch, schema, location));
    return branchErrors.filter((errors) => errors.length === 0).length === 1
      ? []
      : [`${location}: must match exactly one schema branch`];
  }

  const errors = [];
  if (Object.hasOwn(rule, "const") && !Object.is(value, rule.const)) errors.push(`${location}: must equal ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.some((candidate) => Object.is(value, candidate))) errors.push(`${location}: is not an allowed value`);
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => schemaTypeMatches(value, type))) {
      errors.push(`${location}: must have type ${types.join(" or ")}`);
      return errors;
    }
  }
  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${location}: is too short`);
    if (rule.pattern !== undefined && !(new RegExp(rule.pattern, "u")).test(value)) errors.push(`${location}: does not match its required pattern`);
  }
  if (typeof value === "number" && rule.minimum !== undefined && value < rule.minimum) errors.push(`${location}: is below its minimum`);
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${location}: has too few items`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${location}: has too many items`);
    if (rule.items) value.forEach((item, index) => errors.push(...schemaErrors(item, rule.items, schema, `${location}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of rule.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}: missing required property ${required}`);
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(rule.properties || {}, key)) errors.push(`${location}: unexpected property ${key}`);
      }
    }
    for (const [key, propertyRule] of Object.entries(rule.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], propertyRule, schema, `${location}.${key}`));
    }
  }
  return errors;
}

function validateAgainstSchema(value, schema) {
  const errors = schemaErrors(value, schema, schema, "$" );
  if (errors.length) throw new Error(`COA batch fails ${contractName} schema: ${errors.slice(0, 8).join("; ")}`);
}

function rejectPrivateKeys(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateKeys(item, `${location}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (privateKeys.has(key)) throw new Error(`Private or sale-time field is forbidden in COA data: ${location}.${key}`);
      rejectPrivateKeys(child, `${location}.${key}`);
    }
  }
}

function validateBatchContract(batch, schema) {
  validateAgainstSchema(batch, schema);
  rejectPrivateKeys(batch);
  const expectedIds = Array.from({ length: 13 }, (_, index) => `Specimen ${String(index + 1).padStart(3, "0")}`);
  assert.deepEqual(batch.specimens.map((specimen) => specimen.specimenId), expectedIds, "COA specimens must use the contiguous global order");

  const identityCounts = { "official-meteorite": 0, "unclassified-meteorite": 0, "cataloged-impact-material": 0 };
  const paths = new Set();
  const hashes = new Set();
  let photographCount = 0;
  for (const [index, specimen] of batch.specimens.entries()) {
    const [reviewedCategory, reviewedIdentityKind, reviewedOccurrenceKind, reviewedDate, reviewedDatePrecision, reviewedLocationPrecision] = expectedAssertionFacts[index];
    if (specimen.objectCategory !== reviewedCategory || specimen.identity.kind !== reviewedIdentityKind) {
      throw new Error(`${specimen.specimenId}: identity does not match the reviewed mapping`);
    }
    assert.deepEqual(specimen.occurrence, {
      kind: reviewedOccurrenceKind,
      date: reviewedDate,
      datePrecision: reviewedDatePrecision
    }, `${specimen.specimenId}: occurrence does not match the reviewed mapping`);
    if (specimen.location.precision !== reviewedLocationPrecision) {
      throw new Error(`${specimen.specimenId}: location precision does not match the reviewed mapping`);
    }
    const expectedCode = expectedOfficialCodes.get(specimen.specimenId);
    if ((specimen.identity.metbullCode || undefined) !== expectedCode) {
      throw new Error(`${specimen.specimenId}: official identity code does not match the reviewed mapping`);
    }
    identityCounts[specimen.identity.kind] += 1;
    const expectedCategory = specimen.identity.kind === "cataloged-impact-material" ? "impact-material" : "meteorite";
    if (specimen.objectCategory !== expectedCategory) throw new Error(`${specimen.specimenId}: objectCategory conflicts with identity kind`);
    const primaryCount = specimen.photographs.filter((photograph) => photograph.primary).length;
    if (primaryCount !== 1) throw new Error(`${specimen.specimenId}: expected exactly one primary photograph`);
    const expectedPhotographCount = specimen.listingType === "collection" ? 3 : 5;
    if (specimen.photographs.length !== expectedPhotographCount) {
      throw new Error(`${specimen.specimenId}: expected exactly ${expectedPhotographCount} photographs for a ${specimen.listingType} listing`);
    }
    for (const photograph of specimen.photographs) {
      photographCount += 1;
      if (normalizeImageReference(`./${photograph.relativePath}`, specimen.listingType) !== photograph.relativePath) {
        throw new Error(`${specimen.specimenId}: invalid photograph path`);
      }
      if (paths.has(photograph.relativePath)) throw new Error(`Duplicate photograph path: ${photograph.relativePath}`);
      if (hashes.has(photograph.sha256)) throw new Error(`Duplicate photograph SHA-256: ${photograph.sha256}`);
      paths.add(photograph.relativePath);
      hashes.add(photograph.sha256);
    }
  }
  assert.deepEqual(identityCounts, {
    "official-meteorite": 4,
    "unclassified-meteorite": 4,
    "cataloged-impact-material": 5
  }, "COA identity counts do not match the reviewed mapping");
  if (photographCount !== 43 || hashes.size !== 43) throw new Error("COA batch must contain exactly 43 unique photographs");
}

function normalizeImageReference(reference, listingType) {
  if (typeof reference !== "string" || reference.includes("\\") || !reference.startsWith("./")) {
    throw new Error(`Invalid catalog image path: ${reference}`);
  }
  const relativePath = reference.slice(2);
  if (path.posix.normalize(relativePath) !== relativePath || path.posix.isAbsolute(relativePath)) {
    throw new Error(`Catalog image path escapes its asset root: ${reference}`);
  }
  const expectedRoot = listingType === "collection" ? "assets/collection/" : "assets/sale-specimens/";
  if (!relativePath.startsWith(expectedRoot)) throw new Error(`Catalog image uses the wrong ${listingType} asset root: ${reference}`);
  if (!/^[a-z0-9][a-z0-9.-]*\.jpg$/u.test(path.posix.basename(relativePath))) {
    throw new Error(`Catalog photograph must be a lowercase JPEG filename: ${reference}`);
  }
  return relativePath;
}

async function buildPhotographs(item, listingType, rootDirectory, seenPaths, seenHashes) {
  const requiredCount = listingType === "collection" ? 3 : 5;
  if (!Array.isArray(item.images) || item.images.length !== requiredCount) {
    throw new Error(`${item.specimenId}: expected exactly ${requiredCount} catalog photographs`);
  }
  if (item.images.filter((image) => image === item.image).length !== 1) {
    throw new Error(`${item.specimenId}: catalog must identify exactly one primary photograph`);
  }

  return Promise.all(item.images.map(async (reference) => {
    const relativePath = normalizeImageReference(reference, listingType);
    if (seenPaths.has(relativePath)) throw new Error(`Duplicate catalog photograph path: ${relativePath}`);
    seenPaths.add(relativePath);
    const bytes = await readSafeFile(path.join(rootDirectory, ...relativePath.split("/")), relativePath, rootDirectory);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new Error(`${relativePath} is not a complete JPEG file`);
    }
    const digest = sha256(bytes);
    if (seenHashes.has(digest)) throw new Error(`Duplicate catalog photograph content: ${relativePath}`);
    seenHashes.add(digest);
    return {
      relativePath,
      mediaType: "image/jpeg",
      bytes: bytes.length,
      sha256: digest,
      primary: reference === item.image,
      sourceAltText: item.imageAlt,
      representation: "prepared-catalog-image",
      disclosure: photographDisclosure
    };
  }));
}

async function buildCoaBatch({ rootDirectory = root } = {}) {
  const canonicalRoot = await realpath(rootDirectory);
  const entries = await Promise.all(Object.entries(sourceRelativePaths).map(async ([name, relativePath]) => {
    const bytes = await readSafeFile(path.join(rootDirectory, ...relativePath.split("/")), relativePath, canonicalRoot);
    return [name, { bytes, digest: sha256(bytes) }];
  }));
  const sources = Object.fromEntries(entries);
  const schemaBytes = await readSafeFile(path.join(rootDirectory, ...schemaRelativePath.split("/")), schemaRelativePath, canonicalRoot);
  const schema = parseJson(schemaBytes, schemaRelativePath);
  if (schema.title !== contractName || schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`${schemaRelativePath} is not the locked ${contractName} Draft 2020-12 schema`);
  }

  const ledgerSource = sources.ledger.bytes.toString("utf8");
  const meteorites = parseJson(sources.meteorites.bytes, sourceRelativePaths.meteorites);
  const collection = parseJson(sources.collection.bytes, sourceRelativePaths.collection);
  const sale = parseJson(sources.saleSpecimens.bytes, sourceRelativePaths.saleSpecimens);
  const assertions = parseJson(sources.assertions.bytes, sourceRelativePaths.assertions);
  const reviewedAssertions = validateAssertions(assertions);
  const rows = parseLedger(ledgerSource);
  const generated = buildCatalogs({ ledgerSource, meteorites, collection, sale });
  const matches = catalogsMatch(generated, collection, sale);
  if (!matches.collection || !matches.sale) {
    throw new Error("Current catalogs are not synchronized with data/specimen-ledger.csv; run npm run ledger:check");
  }
  if (rows.length !== 13) throw new Error(`Expected exactly 13 ledger specimens, found ${rows.length}`);

  const meteoritesByCode = new Map(meteorites.items.map((meteorite) => [meteorite.metbullCode, meteorite]));
  const catalogByStableId = new Map([
    ...collection.items.map((item) => [item.id, { item, listingType: "collection" }]),
    ...sale.items.map((item) => [item.id, { item, listingType: "sale" }])
  ]);
  const seenPaths = new Set();
  const seenHashes = new Set();
  const specimens = [];

  for (const [index, row] of rows.entries()) {
    const assertion = reviewedAssertions[index];
    const catalogEntry = catalogByStableId.get(row.id);
    if (!catalogEntry || catalogEntry.item.specimenId !== row.specimen_id || catalogEntry.item.catalogNumber !== row.catalog_number) {
      throw new Error(`${row.specimen_id}: ledger/catalog identity mismatch`);
    }
    const expectedCode = expectedOfficialCodes.get(row.specimen_id);
    if ((row.metbull_code || undefined) !== expectedCode) throw new Error(`${row.specimen_id}: unexpected Meteoritical Bulletin mapping`);
    const officialMeteorite = row.metbull_code ? meteoritesByCode.get(row.metbull_code) : null;
    const classification = officialMeteorite?.classification || row.classification;
    if (!classification) throw new Error(`${row.specimen_id}: classification is required`);

    let identity;
    const identityKind = officialMeteorite ? "official-meteorite" : assertion.identityKind;
    const objectCategory = officialMeteorite ? "meteorite" : assertion.objectCategory;
    if (identityKind === "official-meteorite") {
      identity = {
        kind: identityKind,
        classification,
        metbullCode: officialMeteorite.metbullCode,
        sourceUrl: officialMeteorite.sourceUrl
      };
    } else {
      identity = { kind: identityKind, classification };
    }
    const locationName = officialMeteorite?.locality || row.locality || null;
    if ((assertion.locationPrecision === "unknown") !== (locationName === null)) {
      throw new Error(`${row.specimen_id}: location value conflicts with reviewed location precision`);
    }
    if (assertion.occurrence?.sourceUrl && assertion.occurrence.sourceUrl !== officialMeteorite?.sourceUrl) {
      throw new Error(`${row.specimen_id}: occurrence evidence does not match its official meteorite source`);
    }
    const occurrence = assertion.occurrence || {
      kind: "find",
      date: String(officialMeteorite.foundYear),
      datePrecision: "year"
    };

    specimens.push({
      specimenId: row.specimen_id,
      stableId: row.id,
      catalogNumber: row.catalog_number,
      listingType: catalogEntry.listingType,
      name: officialMeteorite?.name || row.name,
      objectCategory,
      identity,
      mass: { asRecordedGrams: row.mass_grams },
      dimensions: row.dimensions || null,
      provenance: row.provenance || null,
      description: row.specimen_description,
      occurrence: {
        kind: occurrence.kind,
        date: occurrence.date,
        datePrecision: occurrence.datePrecision
      },
      location: {
        name: locationName,
        precision: assertion.locationPrecision
      },
      photographs: await buildPhotographs(catalogEntry.item, catalogEntry.listingType, rootDirectory, seenPaths, seenHashes)
    });
  }

  const batch = {
    contractName,
    schemaVersion,
    issuer,
    sourceSha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.digest])),
    specimens
  };
  validateBatchContract(batch, schema);
  return batch;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "--check") return { mode: "check", outputPath: null };
  if (arguments_.length === 1 && arguments_[0] === "--help") return { mode: "help", outputPath: null };
  if (arguments_.length === 2 && arguments_[0] === "--output") {
    if (!path.isAbsolute(arguments_[1])) throw new Error("--output must be an absolute path outside the repository");
    if (arguments_[1].split(path.sep).includes("..")) throw new Error("--output must not contain path traversal segments");
    return { mode: "output", outputPath: path.normalize(arguments_[1]) };
  }
  throw new Error("Usage: node scripts/export-coa-batch.mjs --check | --output <absolute-path> | --help");
}

async function compareExistingOutput(outputPath, bytes) {
  let details;
  try {
    details = await lstat(outputPath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (details.isSymbolicLink()) throw new Error("Refusing symbolic-link COA output");
  if (!details.isFile()) throw new Error("COA output path already exists and is not a regular file");
  const existing = await readFile(outputPath);
  if (!existing.equals(bytes)) throw new Error("COA output already exists with different bytes; refusing to overwrite it");
  return true;
}

async function writeOutputSafely(outputPath, bytes, rootDirectory = root) {
  if (!path.isAbsolute(outputPath)) throw new Error("COA output path must be absolute");
  const [canonicalRoot, canonicalParent] = await Promise.all([
    realpath(rootDirectory),
    realpath(path.dirname(outputPath))
  ]);
  const canonicalOutput = path.join(canonicalParent, path.basename(outputPath));
  if (isWithin(path.resolve(outputPath), canonicalRoot) || isWithin(canonicalOutput, canonicalRoot)) {
    throw new Error("COA output must be outside the repository");
  }
  if (await compareExistingOutput(outputPath, bytes)) return { written: false, byteIdentical: true };

  const temporaryPath = path.join(canonicalParent, `.${path.basename(outputPath)}.coa-${process.pid}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporaryPath, canonicalOutput);
    } catch (error) {
      if (error.code !== "EEXIST" || !(await compareExistingOutput(canonicalOutput, bytes))) throw error;
      return { written: false, byteIdentical: true };
    }
    return { written: true, byteIdentical: false };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function main() {
  const { mode, outputPath } = parseArguments(process.argv.slice(2));
  if (mode === "help") {
    console.log("Usage: node scripts/export-coa-batch.mjs --check | --output <absolute-path>");
    return;
  }
  const batch = await buildCoaBatch();
  const bytes = Buffer.from(canonicalJson(batch), "utf8");
  const result = mode === "output" ? await writeOutputSafely(outputPath, bytes) : { written: false, byteIdentical: false };
  console.log(JSON.stringify({
    mode,
    specimens: batch.specimens.length,
    photographs: batch.specimens.reduce((count, specimen) => count + specimen.photographs.length, 0),
    sha256: sha256(bytes),
    output: outputPath,
    ...result
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  buildCoaBatch,
  canonicalJson,
  normalizeImageReference,
  parseArguments,
  readSafeFile,
  validateAgainstSchema,
  validateAssertions,
  validateBatchContract,
  writeOutputSafely
};
