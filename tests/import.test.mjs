import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_RECORD_IMAGE_BYTES,
  detectImageType,
  getImageDimensions,
  headers,
  importInventory,
  isContained,
  legacyHeaders,
  optionalNumber,
  optionalUsdCents,
  parseCsv,
  parseManifest,
  validateImageBytes
} from "../scripts/import-inventory.mjs";

const imageFixtures = {
  ".jpg": makeJpeg(100, 80),
  ".jpeg": makeJpeg(100, 80),
  ".png": makePng(100, 80),
  ".gif": makeGif(100, 80),
  ".webp": makeWebp(100, 80),
  ".avif": makeAvif(100, 80)
};
const requiredImageCounts = { collection_specimen: 3, sale_specimen: 5, collection_book: 5, sale_book: 5 };

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function makeJpeg(width, height, entropy = [0x11, 0x22]) {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 0, 0, 0, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    ...entropy,
    0xff, 0xd9
  ]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function fixtureCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(fixtureCrc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function makePng(width, height, targetSize = null) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idatLength = targetSize === null ? 4 : targetSize - 57;
  if (idatLength < 1) throw new Error("PNG fixture target is too small");
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.alloc(idatLength, 0x5a)), pngChunk("IEND", Buffer.alloc(0))]);
}

function makeGif(width, height) {
  const bytes = Buffer.alloc(29);
  bytes.write("GIF89a", 0, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  bytes[13] = 0x2c;
  bytes.writeUInt16LE(width, 18);
  bytes.writeUInt16LE(height, 20);
  bytes[23] = 0x02;
  bytes[24] = 0x02;
  bytes[25] = 0x44;
  bytes[26] = 0x01;
  bytes[27] = 0x00;
  bytes[28] = 0x3b;
  return bytes;
}

function makeWebpBitstreamChunk(width, height, type = "VP8 ") {
  if (type === "VP8L") {
    const payload = Buffer.alloc(6);
    payload[0] = 0x2f;
    payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
    payload[5] = 0x5a;
    return webpChunk(type, payload);
  }
  const payload = Buffer.alloc(11);
  payload[0] = 0x10;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  payload[10] = 0x5a;
  return webpChunk(type, payload);
}

function makeWebp(width, height, type = "VP8 ") {
  return makeWebpContainer([makeWebpBitstreamChunk(width, height, type)]);
}

function webpChunk(type, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function makeWebpContainer(chunks) {
  const contents = Buffer.concat(chunks);
  const bytes = Buffer.alloc(12 + contents.length);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  contents.copy(bytes, 12);
  return bytes;
}

function makeExtendedWebp(canvasWidth, canvasHeight, encodedWidth = canvasWidth, encodedHeight = canvasHeight, type = "VP8 ") {
  const extended = Buffer.alloc(10);
  extended.writeUIntLE(canvasWidth - 1, 4, 3);
  extended.writeUIntLE(canvasHeight - 1, 7, 3);
  return makeWebpContainer([webpChunk("VP8X", extended), makeWebpBitstreamChunk(encodedWidth, encodedHeight, type)]);
}

function makeAnimatedWebp(width, height, { frameWidth = width, frameHeight = height, encodedWidth = frameWidth, encodedHeight = frameHeight } = {}) {
  const extended = Buffer.alloc(10);
  extended[0] = 0x02;
  extended.writeUIntLE(width - 1, 4, 3);
  extended.writeUIntLE(height - 1, 7, 3);
  const frameHeader = Buffer.alloc(16);
  frameHeader.writeUIntLE(frameWidth - 1, 6, 3);
  frameHeader.writeUIntLE(frameHeight - 1, 9, 3);
  const frameChunk = makeWebpBitstreamChunk(encodedWidth, encodedHeight);
  return makeWebpContainer([
    webpChunk("VP8X", extended),
    webpChunk("ANIM", Buffer.alloc(6)),
    webpChunk("ANMF", Buffer.concat([frameHeader, frameChunk]))
  ]);
}

function makeBox(type, data) {
  const box = Buffer.alloc(8 + data.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, "ascii");
  data.copy(box, 8);
  return box;
}

function makeFullBox(type, version, data, flags = 0) {
  const header = Buffer.alloc(4);
  header[0] = version;
  header.writeUIntBE(flags, 1, 3);
  return makeBox(type, Buffer.concat([header, data]));
}

function makeAvif(width, height, {
  brand = "avif",
  properties = [{ type: "ispe", width, height }, { type: "av1C" }],
  associatedIndices = null,
  includeMedia = true,
  includeTrack = false
} = {}) {
  const ftyp = makeBox("ftyp", Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from(brand)]));
  const propertyBoxes = properties.map((property) => {
    if (property.type === "av1C") return makeBox("av1C", Buffer.from([0x81, 0, 0, 0]));
    if (property.type !== "ispe") return makeBox(property.type, Buffer.from([0]));
    const data = Buffer.alloc(12);
    data.writeUInt32BE(property.width, 4);
    data.writeUInt32BE(property.height, 8);
    return makeBox("ispe", data);
  });
  const associations = associatedIndices || properties.map((_, index) => index + 1);
  const ipco = makeBox("ipco", Buffer.concat(propertyBoxes));
  const ipmaEntry = Buffer.from([0, 1, associations.length, ...associations.map((index) => 0x80 | index)]);
  const ipmaCount = Buffer.alloc(4);
  ipmaCount.writeUInt32BE(1);
  const ipma = makeFullBox("ipma", 0, Buffer.concat([ipmaCount, ipmaEntry]));
  const iprp = makeBox("iprp", Buffer.concat([ipco, ipma]));
  const pitm = makeFullBox("pitm", 0, Buffer.from([0, 1]));
  const infeData = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from("av01"), Buffer.from([0])]);
  const infe = makeFullBox("infe", 2, infeData);
  const iinf = makeFullBox("iinf", 0, Buffer.concat([Buffer.from([0, 1]), infe]));
  const hdlr = makeFullBox("hdlr", 0, Buffer.concat([Buffer.alloc(4), Buffer.from("pict"), Buffer.alloc(12), Buffer.from([0])]));
  const makeIloc = (mediaOffset) => {
    const data = Buffer.alloc(18);
    data[0] = 0x44;
    data.writeUInt16BE(1, 2);
    data.writeUInt16BE(1, 4);
    data.writeUInt16BE(0, 6);
    data.writeUInt16BE(1, 8);
    data.writeUInt32BE(mediaOffset, 10);
    data.writeUInt32BE(1, 14);
    return makeFullBox("iloc", 0, data);
  };
  const makeMeta = (mediaOffset) => makeFullBox("meta", 0, Buffer.concat([hdlr, pitm, makeIloc(mediaOffset), iinf, iprp]));
  const preliminaryMeta = makeMeta(0);
  const mediaOffset = ftyp.length + preliminaryMeta.length + 8;
  const meta = makeMeta(mediaOffset);
  const boxes = [ftyp, meta];
  if (includeMedia) boxes.push(makeBox("mdat", Buffer.from([0x5a])));
  if (includeTrack) {
    const trackHeader = Buffer.alloc(8);
    trackHeader.writeUInt32BE(width << 16, 0);
    trackHeader.writeUInt32BE(height << 16, 4);
    boxes.push(makeBox("moov", makeBox("trak", makeBox("tkhd", trackHeader))));
  }
  return Buffer.concat(boxes);
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

function imagePaths(recordType, stem, extension = "jpg") {
  return Array.from({ length: requiredImageCounts[recordType] }, (_, index) => `images/${stem}-${index + 1}.${extension}`);
}

async function writeRecordImages(importFolder, records) {
  const references = new Set(records.flatMap((record) => record.image_files.split("|")));
  for (const reference of references) await writeImage(path.join(importFolder, reference));
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
  assert.equal(optionalUsdCents("123", "cost_usd", 2), 12300);
  assert.equal(optionalUsdCents("123.45", "cost_usd", 2), 12345);
  assert.throws(() => optionalUsdCents("123.456", "cost_usd", 2), /at most two fractional digits/u);
  assert.throws(() => optionalUsdCents("$123", "cost_usd", 2), /nonnegative decimal USD/u);
  assert.equal(isContained(path.join(path.sep, "catalog"), path.join(path.sep, "catalog", "..photos", "image.jpg")), true);
  assert.throws(() => parseManifest("id,name\nitem,Example\n"), /exact column order/u);
  const documentation = await readFile(new URL("../inventory-template/README.md", import.meta.url), "utf8");
  const documentedCsv = documentation.match(/```csv\n([\s\S]*?)\n```/u)?.[1];
  assert.ok(documentedCsv, "inventory documentation must contain a CSV example");
  const documentedRows = parseManifest(documentedCsv);
  assert.deepEqual(documentedRows.map((row) => row.record_type), [
    "collection_specimen",
    "sale_specimen",
    "collection_book",
    "sale_book"
  ]);
  for (const row of documentedRows) {
    assert.equal(row.image_files.split("|").length, requiredImageCounts[row.record_type], `${row.record_type} documentation image count`);
  }
});

test("legacy and appended meteorite_id headers are both exact", () => {
  const base = { record_type: "collection_specimen", id: "allende-001" };
  const legacySource = `${legacyHeaders.join(",")}\n${legacyHeaders.map((key) => csvValue(base[key])).join(",")}\n`;
  assert.equal(parseManifest(legacySource)[0].meteorite_id, "");
  assert.equal(parseManifest(`${headers.join(",")}\n${csvRow({ ...base, meteorite_id: "allende" })}\n`)[0].meteorite_id, "allende");
  assert.throws(() => parseManifest(`${legacyHeaders.join(",")},unexpected\n`), /exact column order/u);
});

test("structural parsers accept bounded fixtures and reject demonstrated header-only files", () => {
  for (const [extension, bytes] of Object.entries(imageFixtures)) {
    const type = extension === ".jpg" || extension === ".jpeg" ? "jpeg" : extension.slice(1);
    assert.equal(detectImageType(bytes), type, extension);
    assert.deepEqual(getImageDimensions(bytes, type), { width: 100, height: 80 }, extension);
    assert.deepEqual(validateImageBytes(bytes, type, extension), { width: 100, height: 80 });
  }
  assert.deepEqual(validateImageBytes(makeAnimatedWebp(100, 80), "webp", "animated.webp"), { width: 100, height: 80 });
  const malformed = {
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    png: (() => { const bytes = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12, "ascii"); return bytes; })(),
    gif: (() => { const bytes = Buffer.alloc(10); bytes.write("GIF89a", 0, "ascii"); bytes.writeUInt16LE(10, 6); bytes.writeUInt16LE(10, 8); return bytes; })(),
    webp: (() => { const bytes = Buffer.alloc(30); bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(100, 4); bytes.write("WEBPVP8X", 8, "ascii"); bytes.writeUInt32LE(10, 16); return bytes; })(),
    avif: (() => {
      const ftyp = makeBox("ftyp", Buffer.concat([Buffer.from("avif"), Buffer.alloc(4), Buffer.from("avif")]));
      const ispe = Buffer.alloc(12);
      ispe.writeUInt32BE(10, 4);
      ispe.writeUInt32BE(10, 8);
      return Buffer.concat([ftyp, makeBox("ipco", makeBox("ispe", ispe))]);
    })()
  };
  for (const [type, bytes] of Object.entries(malformed)) {
    assert.equal(getImageDimensions(bytes, type), null, `${type} malformed structure`);
    assert.throws(() => validateImageBytes(bytes, type, `broken.${type}`), /structure and dimensions could not be validated/u);
  }
  const badCrc = Buffer.from(makePng(10, 10));
  badCrc[45] ^= 0xff;
  assert.throws(() => validateImageBytes(badCrc, "png", "bad-crc.png"), /structure and dimensions could not be validated/u);
  for (const [type, bytes] of [
    ["jpeg", makeJpeg(0, 1)], ["png", makePng(0, 1)], ["gif", makeGif(0, 1)],
    ["webp", makeWebp(0, 1)], ["avif", makeAvif(0, 1)]
  ]) assert.throws(() => validateImageBytes(bytes, type, `zero.${type}`), /structure and dimensions could not be validated/u);

  assert.deepEqual(validateImageBytes(makePng(MAX_IMAGE_LONG_EDGE, 1), "png", "edge.png"), { width: MAX_IMAGE_LONG_EDGE, height: 1 });
  assert.throws(() => validateImageBytes(makePng(MAX_IMAGE_LONG_EDGE + 1, 1), "png", "wide.png"), /long-edge limit/u);
  assert.deepEqual(validateImageBytes(makePng(1, 1, MAX_IMAGE_BYTES), "png", "limit.png"), { width: 1, height: 1 });
  assert.throws(() => validateImageBytes(makePng(1, 1, MAX_IMAGE_BYTES + 1), "png", "large.png"), /byte image limit/u);
  assert.throws(() => validateImageBytes(Buffer.from([0xff, 0xd8, 0xff]), "jpeg", "broken.jpg"), /structure and dimensions could not be validated/u);
  assert.throws(() => validateImageBytes(makeGif(10, 10), "png", "wrong.png"), /content does not match/u);
});

test("WebP canvas and frame declarations cannot hide encoded dimensions", () => {
  for (const type of ["VP8 ", "VP8L"]) {
    assert.deepEqual(validateImageBytes(makeExtendedWebp(100, 80, 100, 80, type), "webp", `matching-${type}.webp`), { width: 100, height: 80 });
    const mismatch = makeExtendedWebp(100, 80, 1601, 1, type);
    assert.equal(getImageDimensions(mismatch, "webp"), null);
    assert.throws(() => validateImageBytes(mismatch, "webp", `mismatch-${type}.webp`), /structure and dimensions could not be validated/u);
  }
  const animatedMismatch = makeAnimatedWebp(100, 80, { frameWidth: 100, frameHeight: 80, encodedWidth: 1601, encodedHeight: 1 });
  assert.equal(getImageDimensions(animatedMismatch, "webp"), null);
  assert.throws(() => validateImageBytes(animatedMismatch, "webp", "animated-mismatch.webp"), /structure and dimensions could not be validated/u);
});

test("still AVIF dimensions require primary-item property and media associations", () => {
  const associated = makeAvif(100, 80);
  assert.deepEqual(validateImageBytes(associated, "avif", "associated.avif"), { width: 100, height: 80 });

  const unassociated = makeAvif(100, 80, {
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "pixi" }, { type: "av1C" }],
    associatedIndices: [2, 3]
  });
  assert.equal(getImageDimensions(unassociated, "avif"), null);

  const decoyAndOversized = makeAvif(100, 80, {
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "ispe", width: 1601, height: 16 }, { type: "av1C" }],
    associatedIndices: [2, 3]
  });
  assert.deepEqual(getImageDimensions(decoyAndOversized, "avif"), { width: 1601, height: 16 });
  assert.throws(() => validateImageBytes(decoyAndOversized, "avif", "associated-oversized.avif"), /long-edge limit/u);

  const conflicting = makeAvif(100, 80, {
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "ispe", width: 1601, height: 16 }, { type: "av1C" }],
    associatedIndices: [1, 2, 3]
  });
  assert.equal(getImageDimensions(conflicting, "avif"), null);
  assert.equal(getImageDimensions(makeAvif(100, 80, { includeMedia: false }), "avif"), null);

  const sequenceWithDecoy = makeAvif(1601, 16, {
    brand: "avis",
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "av1C" }],
    includeTrack: true
  });
  assert.equal(detectImageType(sequenceWithDecoy), "avif");
  assert.equal(getImageDimensions(sequenceWithDecoy, "avif"), null);
  assert.throws(() => validateImageBytes(sequenceWithDecoy, "avif", "sequence.avif"), /structure and dimensions could not be validated/u);
});

test("WebP dimension mismatches reject through import without publishing", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-webp-bypass-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const references = imagePaths("collection_specimen", "webp-bypass", "webp");
  const record = {
    record_type: "collection_specimen", id: "webp-bypass", display_order: 1, catalog_number: "Specimen 001",
    name: "WebP bypass", description: "Dimension mismatch test.", image_files: references.join("|"), image_alt: "WebP bypass"
  };
  await writeRecordImages(importFolder, [record]);
  await writeManifest(importFolder, [record]);
  const source = path.join(importFolder, references[0]);
  for (const malformed of [
    makeExtendedWebp(100, 80, 1601, 1),
    makeAnimatedWebp(100, 80, { frameWidth: 100, frameHeight: 80, encodedWidth: 1601, encodedHeight: 1 })
  ]) {
    await writeFile(source, malformed);
    await assert.rejects(importInventory(importFolder, { write: true, projectRoot }), /structure and dimensions could not be validated/u);
    assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
    await assert.rejects(access(path.join(projectRoot, "assets/collection/webp-bypass-1-webp-bypass-1.webp")));
  }
});

test("unbound AVIF dimensions reject through import without publishing", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-avif-bypass-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const references = imagePaths("collection_specimen", "avif-bypass", "avif");
  const record = {
    record_type: "collection_specimen", id: "avif-bypass", display_order: 1, catalog_number: "Specimen 001",
    name: "AVIF bypass", description: "Association bypass test.", image_files: references.join("|"), image_alt: "AVIF bypass"
  };
  await writeRecordImages(importFolder, [record]);
  await writeManifest(importFolder, [record]);
  const unassociated = makeAvif(100, 80, {
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "pixi" }, { type: "av1C" }],
    associatedIndices: [2, 3]
  });
  const sequenceWithDecoy = makeAvif(1601, 16, {
    brand: "avis",
    properties: [{ type: "ispe", width: 100, height: 80 }, { type: "av1C" }],
    includeTrack: true
  });
  const oversizedAssociated = makeAvif(1601, 16);
  for (const [malformed, expectedError] of [
    [unassociated, /structure and dimensions could not be validated/u],
    [sequenceWithDecoy, /structure and dimensions could not be validated/u],
    [oversizedAssociated, /long-edge limit/u]
  ]) {
    await writeFile(path.join(importFolder, references[0]), malformed);
    await assert.rejects(importInventory(importFolder, { write: true, projectRoot }), expectedError);
    assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
    await assert.rejects(access(path.join(projectRoot, "assets/collection/avif-bypass-1-avif-bypass-1.avif")));
  }
});

test("folder importer enforces exact image counts by record type", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-image-count-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  await writeManifest(importFolder, [{
    record_type: "collection_specimen", id: "short-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Short set", description: "Incomplete image set.", image_files: "images/front.jpg|images/back.jpg", image_alt: "Short set"
  }]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /requires exactly 3 image filenames/u);
});

test("folder importer validates, copies images, and routes all four record types", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-import-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);

  const records = [
    {
      record_type: "collection_specimen", id: "allende-001", display_order: 10, catalog_number: "Specimen 001",
      name: "Allende", classification: "CV3", mass_grams: 24.6, description: "Collection specimen, with fusion crust.",
      image_files: imagePaths("collection_specimen", "allende", "JPG").join("|"), image_alt: "Allende specimen", cost_usd: "12.34"
    },
    {
      record_type: "sale_specimen", id: "campo-001", display_order: 20, catalog_number: "Specimen 001",
      name: "Campo del Cielo", classification: "Iron, IAB-MG", mass_grams: 42.1, description: "Individual for sale.",
      price_usd: 85, status: "available", image_files: imagePaths("sale_specimen", "campo", "png").join("|"), image_alt: "Campo del Cielo specimen"
    },
    {
      record_type: "collection_book", id: "burke-001", display_order: 10, catalog_number: "SRL 001",
      title: "Cosmic Debris", author: "John G. Burke", year: 1986, description: "Reference copy.",
      image_files: imagePaths("collection_book", "burke", "webp").join("|"), image_alt: "Cosmic Debris cover"
    },
    {
      record_type: "sale_book", id: "nininger-001", display_order: 20, catalog_number: "SRB 001",
      title: "Find a Falling Star", author: "H. H. Nininger", year: 1972, description: "Copy offered for sale.",
      price_usd: 45, status: "available", image_files: imagePaths("sale_book", "nininger", "jpeg").join("|"), image_alt: "Find a Falling Star cover"
    }
  ];
  await writeRecordImages(importFolder, records);
  await writeManifest(importFolder, records);

  const dryRun = await importInventory(importFolder, { projectRoot });
  assert.deepEqual(dryRun, {
    mode: "dry-run",
    records: 4,
    images: 18,
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
  assert.doesNotMatch(JSON.stringify(collection), /cost_usd|costUsd|acquisitionCost/u);
  assert.equal(specimens.items[0].priceUsd, 85);
  assert.deepEqual(books.items.map((book) => book.listingType), ["collection", "sale"]);
  assert.equal(books.items[1].status, "available");
  await access(path.join(projectRoot, "assets/collection/allende-001-1-allende-1.jpg"));
  await access(path.join(projectRoot, "assets/sale-specimens/campo-001-1-campo-1.png"));
  await access(path.join(projectRoot, "assets/books/burke-001-1-burke-1.webp"));
});

test("specimen meteorite_id groups persist without changing physical cart identity", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-groups-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const records = [
    {
      record_type: "collection_specimen", id: "allende-private", meteorite_id: "allende", display_order: 1,
      catalog_number: "Specimen 001", name: "Allende", description: "Private member.",
      image_files: imagePaths("collection_specimen", "private").join("|"), image_alt: "Private Allende"
    },
    {
      record_type: "sale_specimen", id: "allende-sale", meteorite_id: "allende", display_order: 1,
      catalog_number: "Specimen 001", name: "Allende", description: "Sale member.", status: "available",
      image_files: imagePaths("sale_specimen", "sale").join("|"), image_alt: "Sale Allende"
    }
  ];
  await writeRecordImages(importFolder, records);
  await writeManifest(importFolder, records);
  await importInventory(importFolder, { write: true, projectRoot });
  const collection = JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8"));
  const sale = JSON.parse(await readFile(path.join(projectRoot, "data/sale-specimens.json"), "utf8"));
  assert.equal(collection.items[0].id, "allende-private");
  assert.equal(collection.items[0].meteoriteId, "allende");
  assert.equal(sale.items[0].id, "allende-sale");
  assert.equal(sale.items[0].meteoriteId, "allende");

  records[1].name = "Different name";
  await writeManifest(importFolder, records);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /consistent specimen name/u);

  const book = {
    record_type: "collection_book", id: "grouped-book", meteorite_id: "not-allowed", display_order: 1,
    catalog_number: "Book 001", title: "Grouped Book", description: "Invalid grouping.",
    image_files: imagePaths("collection_book", "grouped-book").join("|"), image_alt: "Grouped book"
  };
  await writeRecordImages(importFolder, [book]);
  await writeManifest(importFolder, [book]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /meteorite_id is supported only for specimen/u);
});

test("prospective collection and sale catalogs require globally unique physical IDs", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-global-ids-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  await writeFile(path.join(projectRoot, "data/collection.json"), `${JSON.stringify({
    schemaVersion: 1,
    items: [{ id: "same-id", displayOrder: 1, name: "Existing" }]
  })}\n`);
  const incoming = {
    record_type: "sale_specimen", id: "same-id", display_order: 1, catalog_number: "Specimen 001",
    name: "Existing", description: "Duplicate physical identity.", status: "available",
    image_files: imagePaths("sale_specimen", "duplicate").join("|"), image_alt: "Duplicate"
  };
  await writeRecordImages(importFolder, [incoming]);
  await writeManifest(importFolder, [incoming]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /Physical specimen id is shared across collection and sale catalogs/u);
});

test("importer rejects malformed IDs and image byte, dimension, and carousel limits", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-limits-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const record = {
    record_type: "collection_specimen", id: "limit-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Limit", description: "Limit test.", image_files: imagePaths("collection_specimen", "limit", "png").join("|"), image_alt: "Limit"
  };
  await writeRecordImages(importFolder, [record]);

  record.meteorite_id = "Mixed-Case";
  await writeManifest(importFolder, [record]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /meteorite_id must be/u);
  record.meteorite_id = "";
  record.id = `a${"b".repeat(80)}`;
  await writeManifest(importFolder, [record]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /id must be at most 80/u);
  record.id = "limit-001";

  const firstImage = path.join(importFolder, record.image_files.split("|")[0]);
  await writeFile(firstImage, makePng(1601, 1));
  await writeManifest(importFolder, [record]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /long-edge limit/u);

  await writeFile(firstImage, makePng(1, 1, MAX_IMAGE_BYTES + 1));
  await assert.rejects(importInventory(importFolder, { projectRoot }), /byte image limit/u);

  const exactSizes = [559_240, 559_241, 559_241];
  for (const [index, reference] of record.image_files.split("|").entries()) {
    await writeFile(path.join(importFolder, reference), makePng(1, 1, exactSizes[index]));
  }
  assert.equal(exactSizes.reduce((total, size) => total + size, 0), MAX_RECORD_IMAGE_BYTES);
  await importInventory(importFolder, { projectRoot });
  const lastImage = path.join(importFolder, record.image_files.split("|")[2]);
  await writeFile(lastImage, makePng(1, 1, exactSizes[2] + 1));
  await assert.rejects(importInventory(importFolder, { projectRoot }), /per-record carousel limit/u);

  await writeFile(firstImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await assert.rejects(importInventory(importFolder, { projectRoot }), /structure and dimensions could not be validated/u);
});

test("all 43 referenced specimen images satisfy the enforced optimization limits", async () => {
  const catalogs = await Promise.all([
    readFile(new URL("../data/collection.json", import.meta.url), "utf8"),
    readFile(new URL("../data/sale-specimens.json", import.meta.url), "utf8")
  ]);
  const items = catalogs.flatMap((source) => JSON.parse(source).items);
  const references = items.flatMap((item) => item.images);
  assert.equal(references.length, 43);
  assert.equal(new Set(references).size, 43);
  for (const item of items) {
    let total = 0;
    for (const reference of item.images) {
      const bytes = await readFile(new URL(`../${reference.slice(2)}`, import.meta.url));
      total += bytes.length;
      assert.ok(bytes.length <= MAX_IMAGE_BYTES, `${reference} byte ceiling`);
      const type = detectImageType(bytes);
      assert.equal(type, "jpeg", `${reference} format`);
      const dimensions = validateImageBytes(bytes, type, reference);
      assert.ok(dimensions, `${reference} dimensions parse`);
      assert.ok(Math.max(dimensions.width, dimensions.height) <= MAX_IMAGE_LONG_EDGE, `${reference} long edge`);
    }
    assert.ok(total <= MAX_RECORD_IMAGE_BYTES, `${item.id} aggregate byte ceiling`);
  }
});

test("private specimen costs are validated but never published", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-private-cost-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const specimen = {
    record_type: "collection_specimen", id: "private-cost-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Private cost specimen", description: "Cost privacy test.", cost_usd: "12.34",
    image_files: imagePaths("collection_specimen", "private-cost").join("|"), image_alt: "Private cost specimen"
  };
  await writeRecordImages(importFolder, [specimen]);
  await writeManifest(importFolder, [specimen]);
  const summary = await importInventory(importFolder, { write: true, projectRoot });
  const publicData = await readFile(path.join(projectRoot, "data/collection.json"), "utf8");
  assert.doesNotMatch(JSON.stringify(summary), /cost|1234/u);
  assert.doesNotMatch(publicData, /cost_usd|costUsd|costUsdCents|acquisitionCost|12\.34/u);

  const book = {
    record_type: "collection_book", id: "private-cost-book", display_order: 1, catalog_number: "Book 001",
    title: "Private Cost Book", description: "Cost rejection test.", cost_usd: "12.34",
    image_files: imagePaths("collection_book", "private-cost-book").join("|"), image_alt: "Private Cost Book"
  };
  await writeRecordImages(importFolder, [book]);
  await writeManifest(importFolder, [book]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /cost_usd is supported only for specimen records/u);
  const documentation = await readFile(new URL("../docs/PRIVATE_COSTS.md", import.meta.url), "utf8");
  assert.match(documentation, /penultimate optional column.*followed by optional `meteorite_id`/u);
  assert.match(documentation, /final column only in the accepted legacy header/u);
});

test("importer rejects source and destination symlinks", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-symlink-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const outsideImage = path.join(temporaryRoot, "outside.jpg");
  await writeImage(outsideImage);
  await symlink(outsideImage, path.join(importFolder, "images/link.jpg"));
  const sourceReferences = ["images/link.jpg", ...imagePaths("collection_specimen", "source").slice(1)];
  for (const reference of sourceReferences.slice(1)) await writeImage(path.join(importFolder, reference));
  const record = {
    record_type: "collection_specimen", id: "linked-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Linked", description: "Symlink source test.", image_files: sourceReferences.join("|"), image_alt: "Linked specimen"
  };
  await writeManifest(importFolder, [record]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /symbolic link/u);

  await rm(path.join(importFolder, "images/link.jpg"));
  const photoReferences = imagePaths("collection_specimen", "photo");
  record.image_files = photoReferences.join("|");
  await writeRecordImages(importFolder, [record]);
  await writeManifest(importFolder, [record]);
  const destinationDirectory = path.join(projectRoot, "assets/collection");
  await mkdir(destinationDirectory, { recursive: true });
  const victim = path.join(temporaryRoot, "victim.txt");
  await writeFile(victim, "ORIGINAL-VICTIM");
  await symlink(victim, path.join(destinationDirectory, "linked-001-1-photo-1.jpg"));
  await assert.rejects(importInventory(importFolder, { write: true, projectRoot }), /Symbolic links are not allowed/u);
  assert.equal(await readFile(victim, "utf8"), "ORIGINAL-VICTIM");
});

test("failed destination preflight leaves existing assets unchanged", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-rollback-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const records = [
    { record_type: "collection_specimen", id: "first-001", display_order: 1, catalog_number: "Specimen 001", name: "First", description: "First.", image_files: imagePaths("collection_specimen", "first").join("|"), image_alt: "First" },
    { record_type: "collection_specimen", id: "second-001", display_order: 2, catalog_number: "Specimen 002", name: "Second", description: "Second.", image_files: imagePaths("collection_specimen", "second").join("|"), image_alt: "Second" }
  ];
  await writeRecordImages(importFolder, records);
  await writeManifest(importFolder, records);
  const destinationDirectory = path.join(projectRoot, "assets/collection");
  await mkdir(path.join(destinationDirectory, "second-001-1-second-1.jpg"), { recursive: true });
  const firstDestination = path.join(destinationDirectory, "first-001-1-first-1.jpg");
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
  const fakeReferences = ["images/fake.jpg", ...imagePaths("collection_specimen", "valid").slice(1)];
  for (const reference of fakeReferences.slice(1)) await writeImage(path.join(importFolder, reference));
  await writeManifest(importFolder, [{
    record_type: "collection_specimen", id: "fake-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Fake", description: "Invalid image test.", image_files: fakeReferences.join("|"), image_alt: "Fake"
  }]);
  await assert.rejects(importInventory(importFolder, { projectRoot }), /content does not match/u);
});

test("source replacement after validation cannot change staged bytes", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-source-race-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const sourceReferences = imagePaths("collection_specimen", "source");
  const source = path.join(importFolder, sourceReferences[0]);
  const outside = path.join(temporaryRoot, "outside.jpg");
  const record = {
    record_type: "collection_specimen", id: "race-001", display_order: 1, catalog_number: "Specimen 001",
    name: "Race", description: "Race test.", image_files: sourceReferences.join("|"), image_alt: "Race"
  };
  await writeRecordImages(importFolder, [record]);
  await writeImage(outside);
  await writeManifest(importFolder, [record]);
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

test("same-inode same-size source mutation with restored mtime is rejected by digest", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-source-digest-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const references = imagePaths("collection_specimen", "digest");
  const source = path.join(importFolder, references[0]);
  const record = {
    record_type: "collection_specimen", id: "race-digest", display_order: 1, catalog_number: "Specimen 001",
    name: "Digest race", description: "Digest binding test.", image_files: references.join("|"), image_alt: "Digest race"
  };
  await writeRecordImages(importFolder, [record]);
  await writeManifest(importFolder, [record]);
  const original = await readFile(source);
  const changed = makeJpeg(100, 80, [0x33, 0x44]);
  assert.equal(changed.length, original.length);
  await assert.rejects(importInventory(importFolder, {
    write: true,
    projectRoot,
    testHooks: {
      async afterValidation() {
        const before = await stat(source);
        await writeFile(source, changed);
        await utimes(source, before.atimeMs / 1000, before.mtimeMs / 1000);
        const after = await stat(source);
        assert.equal(after.ino, before.ino);
        assert.equal(after.size, before.size);
        assert.equal(Math.trunc(after.mtimeMs), Math.trunc(before.mtimeMs));
      }
    }
  }), /Image bytes changed before staging/u);
  await assert.rejects(access(path.join(projectRoot, "assets/collection/race-digest-1-digest-1.jpg")));
  assert.equal(JSON.parse(await readFile(path.join(projectRoot, "data/collection.json"), "utf8")).items.length, 0);
});

test("destination parent replacement during commit cannot escape the project", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spacerocks-destination-race-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const { projectRoot, importFolder } = await createProject(temporaryRoot);
  const records = [
    { record_type: "collection_specimen", id: "safe-001", display_order: 1, catalog_number: "Specimen 001", name: "Safe", description: "Safe.", image_files: imagePaths("collection_specimen", "specimen").join("|"), image_alt: "Safe" },
    { record_type: "collection_book", id: "book-001", display_order: 1, catalog_number: "SRL 001", title: "Book", description: "Book.", image_files: imagePaths("collection_book", "book").join("|"), image_alt: "Book" }
  ];
  await writeRecordImages(importFolder, records);
  await writeManifest(importFolder, records);
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
