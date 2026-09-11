import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const legacyHeaders = [
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
  "image_alt",
  "cost_usd"
];
const headers = [...legacyHeaders, "meteorite_id"];

const MAX_SLUG_LENGTH = 80;
const MAX_IMAGE_BYTES = 563_200;
const MAX_IMAGE_LONG_EDGE = 1_600;
const MAX_RECORD_IMAGE_BYTES = 1_677_722;

const typeConfig = {
  collection_specimen: { dataFile: "data/collection.json", assetDirectory: "assets/collection", kind: "specimen", listingType: "collection", imageCount: 3 },
  sale_specimen: { dataFile: "data/sale-specimens.json", assetDirectory: "assets/sale-specimens", kind: "specimen", listingType: "sale", imageCount: 5 },
  collection_book: { dataFile: "data/books.json", assetDirectory: "assets/books", kind: "book", listingType: "collection", imageCount: 5 },
  sale_book: { dataFile: "data/books.json", assetDirectory: "assets/books", kind: "book", listingType: "sale", imageCount: 5 }
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
  const selectedHeaders = [headers, legacyHeaders].find((candidate) => actualHeaders.join(",") === candidate.join(","));
  if (!selectedHeaders) throw new Error(`inventory.csv must use this exact column order (the legacy header is also accepted):\n${headers.join(",")}`);
  return rows.slice(1).map((values, index) => {
    if (values.length > selectedHeaders.length && values.slice(selectedHeaders.length).some(Boolean)) {
      throw new Error(`Row ${index + 2} has more values than the header`);
    }
    return Object.fromEntries(headers.map((header) => [header, ""]).concat(selectedHeaders.map((header, column) => [header, values[column] || ""])));
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

function optionalUsdCents(value, label, rowNumber) {
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) {
    throw new Error(`Row ${rowNumber}: ${label} must use nonnegative decimal USD with at most two fractional digits`);
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Row ${rowNumber}: ${label} exceeds the supported range`);
  return cents;
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
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize >= 16 && boxSize <= bytes.length) {
      const brands = [];
      for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
        if (offset !== 12) brands.push(bytes.subarray(offset, offset + 4).toString("ascii"));
      }
      if (brands.some((brand) => brand === "avif" || brand === "avis")) return "avif";
    }
  }
  return null;
}

function parseJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let inScan = false;
  let scanPayload = false;
  let dimensions = null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (inScan) {
      if (bytes[offset] !== 0xff) {
        scanPayload = true;
        offset += 1;
        continue;
      }
    } else if (bytes[offset] !== 0xff) {
      return null;
    }
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (inScan && marker === 0x00) {
      scanPayload = true;
      continue;
    }
    if (inScan && marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9) return dimensions && scanPayload && offset === bytes.length ? dimensions : null;
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    inScan = false;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (dimensions || length < 11) return null;
      const components = bytes[offset + 7];
      if (!components || length !== 8 + (3 * components)) return null;
      dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      if (!dimensions.width || !dimensions.height) return null;
    } else if (marker === 0xda) {
      if (!dimensions || length < 8) return null;
      const components = bytes[offset + 2];
      if (!components || length !== 6 + (2 * components)) return null;
      inScan = true;
    }
    offset += length;
  }
  return null;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function parsePng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  let offset = 8;
  let dimensions = null;
  let idatBytes = 0;
  let idatEnded = false;
  let hasPalette = false;
  let colorType;
  let chunkIndex = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (!Number.isSafeInteger(end) || end + 4 > bytes.length) return null;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type) || crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) return null;
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = bytes.readUInt32BE(dataOffset);
      const height = bytes.readUInt32BE(dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (!validDepths[colorType]?.includes(bitDepth) || bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || bytes[dataOffset + 12] > 1) return null;
      if (!width || !height) return null;
      dimensions = { width, height };
    } else if (type === "IHDR") {
      return null;
    } else if (type === "PLTE") {
      if (hasPalette || idatBytes || colorType === 0 || colorType === 4 || length === 0 || length > 768 || length % 3 !== 0) return null;
      hasPalette = true;
    } else if (type === "IDAT") {
      if (idatEnded || length === 0 || (colorType === 3 && !hasPalette)) return null;
      idatBytes += length;
    } else {
      if (idatBytes) idatEnded = true;
      if (type === "IEND") return length === 0 && idatBytes > 0 && end + 4 === bytes.length ? dimensions : null;
      if (type[0] === type[0].toUpperCase()) return null;
    }
    offset = end + 4;
    chunkIndex += 1;
  }
  return null;
}

function skipGifSubBlocks(bytes, start, requireData = false) {
  let offset = start;
  let dataBytes = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    offset += 1;
    if (length === 0) return !requireData || dataBytes > 0 ? offset : null;
    if (offset + length > bytes.length) return null;
    dataBytes += length;
    offset += length;
  }
  return null;
}

function parseGif(bytes) {
  if (bytes.length < 13 || !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return null;
  const dimensions = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (!dimensions.width || !dimensions.height) return null;
  let offset = 13;
  const globalPacked = bytes[10];
  if (globalPacked & 0x80) offset += 3 * (2 ** ((globalPacked & 0x07) + 1));
  if (offset > bytes.length) return null;
  let hasImage = false;
  while (offset < bytes.length) {
    const introducer = bytes[offset];
    offset += 1;
    if (introducer === 0x3b) return hasImage && offset === bytes.length ? dimensions : null;
    if (introducer === 0x21) {
      if (offset >= bytes.length) return null;
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      if (offset === null) return null;
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) return null;
    const imageWidth = bytes.readUInt16LE(offset + 4);
    const imageHeight = bytes.readUInt16LE(offset + 6);
    const imageLeft = bytes.readUInt16LE(offset);
    const imageTop = bytes.readUInt16LE(offset + 2);
    if (!imageWidth || !imageHeight || imageLeft + imageWidth > dimensions.width || imageTop + imageHeight > dimensions.height) return null;
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
    if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return null;
    offset += 1;
    offset = skipGifSubBlocks(bytes, offset, true);
    if (offset === null) return null;
    hasImage = true;
  }
  return null;
}

function parseWebpBitstream(bytes, type, dataOffset, size) {
  if (type === "VP8 " && size > 10) {
    const frameTag = bytes.readUIntLE(dataOffset, 3);
    const width = bytes.readUInt16LE(dataOffset + 6) & 0x3fff;
    const height = bytes.readUInt16LE(dataOffset + 8) & 0x3fff;
    if ((frameTag & 1) === 0 && (frameTag & 0x0e) <= 6 && (frameTag & 0x10) && (frameTag >>> 5) <= size - 10 && width && height && bytes.subarray(dataOffset + 3, dataOffset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { width, height };
    }
  }
  if (type === "VP8L" && size > 5 && bytes[dataOffset] === 0x2f && (bytes[dataOffset + 4] & 0xe0) === 0) {
    return {
      width: 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8),
      height: 1 + (bytes[dataOffset + 2] >> 6) + (bytes[dataOffset + 3] << 2) + ((bytes[dataOffset + 4] & 0x0f) << 10)
    };
  }
  return null;
}

function parseWebpChunks(bytes, start, end, allowAnimationFrames = false) {
  let offset = 12;
  if (start !== undefined) offset = start;
  let canvas = null;
  let canvasAnimated = false;
  let bitstream = null;
  let hasAnimationHeader = false;
  let hasAnimationFrame = false;
  let chunkIndex = 0;
  while (offset + 8 <= end) {
    const chunk = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataEnd + (size % 2);
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > end) return null;
    if (size % 2 && bytes[dataEnd] !== 0) return null;
    if (!allowAnimationFrames && chunk !== "ALPH" && chunk !== "VP8 " && chunk !== "VP8L") return null;
    if (chunk === "VP8X") {
      if (chunkIndex !== 0 || size !== 10 || canvas || (bytes[dataOffset] & 0xc1) || bytes[dataOffset + 1] || bytes[dataOffset + 2] || bytes[dataOffset + 3]) return null;
      canvas = {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1
      };
      canvasAnimated = Boolean(bytes[dataOffset] & 0x02);
    } else if (chunk === "VP8 " || chunk === "VP8L") {
      if (bitstream) return null;
      bitstream = parseWebpBitstream(bytes, chunk, dataOffset, size);
      if (!bitstream) return null;
    } else if (chunk === "ANIM") {
      if (!canvasAnimated || size !== 6 || hasAnimationHeader) return null;
      hasAnimationHeader = true;
    } else if (chunk === "ANMF" && allowAnimationFrames) {
      if (!canvasAnimated || !hasAnimationHeader || size <= 16 || (bytes[dataOffset + 15] & 0xfc)) return null;
      const frameX = bytes.readUIntLE(dataOffset, 3) * 2;
      const frameY = bytes.readUIntLE(dataOffset + 3, 3) * 2;
      const frameWidth = bytes.readUIntLE(dataOffset + 6, 3) + 1;
      const frameHeight = bytes.readUIntLE(dataOffset + 9, 3) + 1;
      if (frameX + frameWidth > canvas.width || frameY + frameHeight > canvas.height) return null;
      const frame = parseWebpChunks(bytes, dataOffset + 16, dataEnd);
      if (!frame || frame.width !== frameWidth || frame.height !== frameHeight) return null;
      hasAnimationFrame = true;
    }
    offset = paddedEnd;
    chunkIndex += 1;
  }
  if (offset !== end) return null;
  if (canvasAnimated) return !bitstream && hasAnimationHeader && hasAnimationFrame ? canvas : null;
  if (hasAnimationHeader || hasAnimationFrame) return null;
  if (bitstream) return canvas && (canvas.width !== bitstream.width || canvas.height !== bitstream.height) ? null : canvas || bitstream;
  return null;
}

function parseWebp(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return null;
  return parseWebpChunks(bytes, 12, bytes.length, true);
}

function parseBmffBoxes(bytes, start, end, work) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    work.count += 1;
    if (work.count > 10_000) return null;
    let size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const largeSize = bytes.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    const boxEnd = offset + size;
    if (!/^[\x20-\x7e]{4}$/u.test(type) || size < headerSize || !Number.isSafeInteger(boxEnd) || boxEnd > end) return null;
    boxes.push({ type, dataStart: offset + headerSize, end: boxEnd });
    offset = boxEnd;
  }
  return offset === end ? boxes : null;
}

function readBmffInteger(bytes, offset, size, end) {
  if (size < 0 || size > 8 || offset + size > end) return null;
  let value = 0n;
  for (let index = 0; index < size; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { value: Number(value), next: offset + size };
}

function parsePrimaryItemId(bytes, pitm) {
  if (pitm.end - pitm.dataStart < 6) return null;
  const version = bytes[pitm.dataStart];
  if (bytes.readUIntBE(pitm.dataStart + 1, 3) !== 0) return null;
  const size = version === 0 ? 2 : version === 1 ? 4 : 0;
  if (!size || pitm.end !== pitm.dataStart + 4 + size) return null;
  return readBmffInteger(bytes, pitm.dataStart + 4, size, pitm.end)?.value ?? null;
}

function primaryItemIsAv1(bytes, iinf, primaryItemId, work) {
  if (iinf.end - iinf.dataStart < 6) return false;
  const version = bytes[iinf.dataStart];
  if (bytes.readUIntBE(iinf.dataStart + 1, 3) !== 0) return false;
  const countSize = version === 0 ? 2 : version === 1 ? 4 : 0;
  if (!countSize) return false;
  const countResult = readBmffInteger(bytes, iinf.dataStart + 4, countSize, iinf.end);
  if (!countResult || countResult.value > 10_000) return false;
  const entries = parseBmffBoxes(bytes, countResult.next, iinf.end, work);
  if (!entries || entries.length !== countResult.value) return false;
  let matches = 0;
  for (const entry of entries) {
    if (entry.type !== "infe" || entry.end - entry.dataStart < 12) return false;
    const entryVersion = bytes[entry.dataStart];
    if (bytes.readUIntBE(entry.dataStart + 1, 3) !== 0) return false;
    const idSize = entryVersion === 2 ? 2 : entryVersion === 3 ? 4 : 0;
    if (!idSize) return false;
    const idResult = readBmffInteger(bytes, entry.dataStart + 4, idSize, entry.end);
    if (!idResult || idResult.next + 6 > entry.end) return false;
    const protectionIndex = bytes.readUInt16BE(idResult.next);
    const itemType = bytes.subarray(idResult.next + 2, idResult.next + 6).toString("ascii");
    if (idResult.value === primaryItemId) {
      if (protectionIndex !== 0 || itemType !== "av01") return false;
      matches += 1;
    }
  }
  return matches === 1;
}

function parseIpmaAssociations(bytes, ipma, primaryItemId) {
  if (ipma.end - ipma.dataStart < 8) return null;
  const version = bytes[ipma.dataStart];
  const flags = bytes.readUIntBE(ipma.dataStart + 1, 3);
  if (version > 1 || (flags & ~1) !== 0) return null;
  let offset = ipma.dataStart + 4;
  const entryCount = bytes.readUInt32BE(offset);
  offset += 4;
  if (entryCount > 10_000) return null;
  const primaryProperties = [];
  let primaryEntries = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const itemResult = readBmffInteger(bytes, offset, version < 1 ? 2 : 4, ipma.end);
    if (!itemResult || itemResult.next >= ipma.end) return null;
    offset = itemResult.next;
    const associationCount = bytes[offset];
    offset += 1;
    if (itemResult.value === primaryItemId) primaryEntries += 1;
    for (let association = 0; association < associationCount; association += 1) {
      const propertyResult = readBmffInteger(bytes, offset, flags & 1 ? 2 : 1, ipma.end);
      if (!propertyResult) return null;
      offset = propertyResult.next;
      const propertyMask = flags & 1 ? 0x7fff : 0x7f;
      const propertyIndex = propertyResult.value & propertyMask;
      if (!propertyIndex) return null;
      if (itemResult.value === primaryItemId) primaryProperties.push(propertyIndex);
    }
  }
  return offset === ipma.end && primaryEntries === 1 ? primaryProperties : null;
}

function ilocHasPrimaryExtent(bytes, iloc, primaryItemId, mdatRanges, idatRanges) {
  if (iloc.end - iloc.dataStart < 8) return false;
  const version = bytes[iloc.dataStart];
  if (version > 2 || bytes.readUIntBE(iloc.dataStart + 1, 3) !== 0) return false;
  let offset = iloc.dataStart + 4;
  const offsetSize = bytes[offset] >> 4;
  const lengthSize = bytes[offset] & 0x0f;
  const baseOffsetSize = bytes[offset + 1] >> 4;
  const indexSize = version > 0 ? bytes[offset + 1] & 0x0f : 0;
  if ([offsetSize, lengthSize, baseOffsetSize, indexSize].some((size) => size > 8) || lengthSize === 0 || (version === 0 && (bytes[offset + 1] & 0x0f))) return false;
  offset += 2;
  const countResult = readBmffInteger(bytes, offset, version < 2 ? 2 : 4, iloc.end);
  if (!countResult || countResult.value > 10_000) return false;
  offset = countResult.next;
  let primaryEntries = 0;
  let primaryHasExtent = false;
  for (let itemIndex = 0; itemIndex < countResult.value; itemIndex += 1) {
    const itemResult = readBmffInteger(bytes, offset, version < 2 ? 2 : 4, iloc.end);
    if (!itemResult) return false;
    offset = itemResult.next;
    let constructionMethod = 0;
    if (version > 0) {
      const methodResult = readBmffInteger(bytes, offset, 2, iloc.end);
      if (!methodResult) return false;
      if (methodResult.value & 0xfff0) return false;
      constructionMethod = methodResult.value & 0x0f;
      offset = methodResult.next;
    }
    const referenceResult = readBmffInteger(bytes, offset, 2, iloc.end);
    if (!referenceResult) return false;
    offset = referenceResult.next;
    const baseResult = readBmffInteger(bytes, offset, baseOffsetSize, iloc.end);
    if (!baseResult) return false;
    offset = baseResult.next;
    const extentCountResult = readBmffInteger(bytes, offset, 2, iloc.end);
    if (!extentCountResult || extentCountResult.value > 10_000) return false;
    offset = extentCountResult.next;
    const isPrimary = itemResult.value === primaryItemId;
    if (isPrimary) primaryEntries += 1;
    for (let extentIndex = 0; extentIndex < extentCountResult.value; extentIndex += 1) {
      if (version > 0 && indexSize > 0) {
        const indexResult = readBmffInteger(bytes, offset, indexSize, iloc.end);
        if (!indexResult) return false;
        offset = indexResult.next;
      }
      const extentOffsetResult = readBmffInteger(bytes, offset, offsetSize, iloc.end);
      if (!extentOffsetResult) return false;
      offset = extentOffsetResult.next;
      const extentLengthResult = readBmffInteger(bytes, offset, lengthSize, iloc.end);
      if (!extentLengthResult) return false;
      offset = extentLengthResult.next;
      if (!isPrimary) continue;
      const start = baseResult.value + extentOffsetResult.value;
      const extentEnd = start + extentLengthResult.value;
      if (referenceResult.value !== 0 || constructionMethod > 1 || !extentLengthResult.value || !Number.isSafeInteger(extentEnd)) return false;
      const ranges = constructionMethod === 1 ? idatRanges.map((range) => ({ start: 0, end: range.end - range.start })) : mdatRanges;
      if (!ranges.some((range) => start >= range.start && extentEnd <= range.end)) return false;
      primaryHasExtent = true;
    }
  }
  return offset === iloc.end && primaryEntries === 1 && primaryHasExtent;
}

function parseAvif(bytes) {
  const work = { count: 0 };
  const topLevel = parseBmffBoxes(bytes, 0, bytes.length, work);
  if (!topLevel?.length || topLevel[0].type !== "ftyp") return null;
  const ftyp = topLevel[0];
  if (ftyp.end - ftyp.dataStart < 8 || (ftyp.end - ftyp.dataStart) % 4 !== 0) return null;
  const brands = [];
  for (let offset = ftyp.dataStart; offset + 4 <= ftyp.end; offset += 4) {
    if (offset !== ftyp.dataStart + 4) brands.push(bytes.subarray(offset, offset + 4).toString("ascii"));
  }
  if (!brands.includes("avif") || brands.includes("avis") || topLevel.some((box) => box.type === "moov" || box.type === "trak")) return null;

  const metaBoxes = topLevel.filter((box) => box.type === "meta");
  const mdatRanges = topLevel.filter((box) => box.type === "mdat" && box.end > box.dataStart)
    .map((box) => ({ start: box.dataStart, end: box.end }));
  if (metaBoxes.length !== 1) return null;
  const meta = metaBoxes[0];
  if (meta.dataStart + 4 > meta.end || bytes.readUInt32BE(meta.dataStart) !== 0) return null;
  const metaChildren = parseBmffBoxes(bytes, meta.dataStart + 4, meta.end, work);
  if (!metaChildren) return null;
  const pitmBoxes = metaChildren.filter((box) => box.type === "pitm");
  const ilocBoxes = metaChildren.filter((box) => box.type === "iloc");
  const iinfBoxes = metaChildren.filter((box) => box.type === "iinf");
  const iprpBoxes = metaChildren.filter((box) => box.type === "iprp");
  if (pitmBoxes.length !== 1 || ilocBoxes.length !== 1 || iinfBoxes.length !== 1 || iprpBoxes.length !== 1) return null;
  const primaryItemId = parsePrimaryItemId(bytes, pitmBoxes[0]);
  if (!primaryItemId || !primaryItemIsAv1(bytes, iinfBoxes[0], primaryItemId, work)) return null;

  const propertyChildren = parseBmffBoxes(bytes, iprpBoxes[0].dataStart, iprpBoxes[0].end, work);
  if (!propertyChildren) return null;
  const ipcoBoxes = propertyChildren.filter((box) => box.type === "ipco");
  const ipmaBoxes = propertyChildren.filter((box) => box.type === "ipma");
  if (ipcoBoxes.length !== 1 || ipmaBoxes.length !== 1) return null;
  const properties = parseBmffBoxes(bytes, ipcoBoxes[0].dataStart, ipcoBoxes[0].end, work);
  const associatedIndices = parseIpmaAssociations(bytes, ipmaBoxes[0], primaryItemId);
  if (!properties || !associatedIndices?.length || associatedIndices.some((index) => index > properties.length)) return null;

  const associatedDimensions = [];
  let associatedAv1Configs = 0;
  for (const index of new Set(associatedIndices)) {
    const property = properties[index - 1];
    if (property.type === "ispe") {
      if (property.end - property.dataStart !== 12 || bytes.readUInt32BE(property.dataStart) !== 0) return null;
      const dimension = { width: bytes.readUInt32BE(property.dataStart + 4), height: bytes.readUInt32BE(property.dataStart + 8) };
      if (!dimension.width || !dimension.height) return null;
      associatedDimensions.push(dimension);
    } else if (property.type === "av1C") {
      if (property.end - property.dataStart < 4 || bytes[property.dataStart] !== 0x81) return null;
      associatedAv1Configs += 1;
    }
  }
  if (!associatedDimensions.length || associatedAv1Configs !== 1 || associatedDimensions.some((dimension) => dimension.width !== associatedDimensions[0].width || dimension.height !== associatedDimensions[0].height)) return null;

  const idatRanges = metaChildren.filter((box) => box.type === "idat" && box.end > box.dataStart)
    .map((box) => ({ start: box.dataStart, end: box.end }));
  if (!ilocHasPrimaryExtent(bytes, ilocBoxes[0], primaryItemId, mdatRanges, idatRanges)) return null;
  return associatedDimensions[0];
}

function getImageDimensions(bytes, type = detectImageType(bytes)) {
  if (type === "jpeg") return parseJpeg(bytes);
  if (type === "png") return parsePng(bytes);
  if (type === "gif") return parseGif(bytes);
  if (type === "webp") return parseWebp(bytes);
  if (type === "avif") return parseAvif(bytes);
  return null;
}

function validateImageBytes(bytes, expectedType, label) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${label} exceeds the ${MAX_IMAGE_BYTES}-byte image limit`);
  if (detectImageType(bytes) !== expectedType) throw new Error(`${label} content does not match its extension`);
  const dimensions = getImageDimensions(bytes, expectedType);
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error(`${label} structure and dimensions could not be validated safely`);
  }
  if (Math.max(dimensions.width, dimensions.height) > MAX_IMAGE_LONG_EDGE) {
    throw new Error(`${label} exceeds the ${MAX_IMAGE_LONG_EDGE}-pixel long-edge limit`);
  }
  return dimensions;
}

function extensionType(extension) {
  return extension === ".jpg" || extension === ".jpeg" ? "jpeg" : extension.slice(1);
}

function sameFileIdentity(actual, expected) {
  return actual.dev === expected.dev && actual.ino === expected.ino && actual.size === expected.size && Math.trunc(actual.mtimeMs) === Math.trunc(expected.mtimeMs);
}

async function openSourceNoFollow(source) {
  return open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
}

async function buildRecord(row, rowNumber, inputDirectory, canonicalInput, projectRoot) {
  const config = typeConfig[row.record_type];
  if (!config) throw new Error(`Row ${rowNumber}: record_type must be one of ${Object.keys(typeConfig).join(", ")}`);
  if (row.id.length > MAX_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.id)) {
    throw new Error(`Row ${rowNumber}: id must be at most ${MAX_SLUG_LENGTH} characters and use lowercase letters, numbers, and single hyphens`);
  }
  const displayOrder = optionalNumber(row.display_order, "display_order", rowNumber, { integer: true });
  if (!displayOrder || displayOrder < 1) throw new Error(`Row ${rowNumber}: display_order must be an integer of 1 or greater`);
  if (!row.catalog_number) throw new Error(`Row ${rowNumber}: catalog_number is required`);
  if (!row.description) throw new Error(`Row ${rowNumber}: description is required`);
  if (config.kind === "specimen" && !row.name) throw new Error(`Row ${rowNumber}: name is required for specimens`);
  if (config.kind === "book" && !row.title) throw new Error(`Row ${rowNumber}: title is required for books`);
  if (config.listingType === "sale" && !saleStatuses.has(row.status)) {
    throw new Error(`Row ${rowNumber}: sale status must be available, reserved, or sold`);
  }
  if (row.cost_usd) {
    if (config.kind !== "specimen") throw new Error(`Row ${rowNumber}: cost_usd is supported only for specimen records`);
    optionalUsdCents(row.cost_usd, "cost_usd", rowNumber);
  }
  if (row.meteorite_id) {
    if (config.kind !== "specimen") throw new Error(`Row ${rowNumber}: meteorite_id is supported only for specimen records`);
    if (row.meteorite_id.length > MAX_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.meteorite_id)) {
      throw new Error(`Row ${rowNumber}: meteorite_id must be at most ${MAX_SLUG_LENGTH} characters and use lowercase letters, numbers, and single hyphens`);
    }
  }

  const imageReferences = row.image_files.split("|").map((value) => value.trim()).filter(Boolean);
  if (imageReferences.length !== config.imageCount) {
    throw new Error(`Row ${rowNumber}: ${row.record_type} requires exactly ${config.imageCount} image filenames in image_files`);
  }
  if (!row.image_alt) throw new Error(`Row ${rowNumber}: image_alt is required`);

  const imagePlans = [];
  let imageBytesTotal = 0;
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
    let sourceDigest;
    try {
      sourceIdentity = await handle.stat();
      if (!sameFileIdentity(sourceIdentity, canonicalStats)) throw new Error(`Row ${rowNumber}: image changed during validation: ${reference}`);
      if (sourceIdentity.size > MAX_IMAGE_BYTES) throw new Error(`Row ${rowNumber}: ${reference} exceeds the ${MAX_IMAGE_BYTES}-byte image limit`);
      const contents = await handle.readFile();
      validateImageBytes(contents, extensionType(extension), `Row ${rowNumber}: ${reference}`);
      sourceDigest = createHash("sha256").update(contents).digest("hex");
      imageBytesTotal += contents.length;
    } finally {
      await handle.close();
    }
    const base = safeSlug(path.basename(source, originalExtension)) || "image";
    const filename = `${row.id}-${index + 1}-${base}${extension}`;
    imagePlans.push({
      source,
      sourceIdentity: { dev: sourceIdentity.dev, ino: sourceIdentity.ino, size: sourceIdentity.size, mtimeMs: sourceIdentity.mtimeMs },
      sourceDigest,
      expectedType: extensionType(extension),
      destination: path.join(projectRoot, config.assetDirectory, filename),
      publicPath: `./${config.assetDirectory}/${filename}`
    });
  }
  if (imageBytesTotal > MAX_RECORD_IMAGE_BYTES) {
    throw new Error(`Row ${rowNumber}: image_files exceed the ${MAX_RECORD_IMAGE_BYTES}-byte per-record carousel limit`);
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
    addValue(item, "meteoriteId", row.meteorite_id);
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

function validatePhysicalCatalogs(collectionItems, saleItems) {
  const items = [...collectionItems, ...saleItems];
  const ids = new Map();
  const groups = new Map();
  for (const item of items) {
    if (typeof item.id !== "string" || item.id.length > MAX_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.id)) {
      throw new Error(`Invalid physical specimen id in prospective catalogs: ${item.id}`);
    }
    if (ids.has(item.id)) throw new Error(`Physical specimen id is shared across collection and sale catalogs: ${item.id}`);
    ids.set(item.id, item);
    const meteoriteId = item.meteoriteId === undefined ? item.id : item.meteoriteId;
    if (typeof meteoriteId !== "string" || meteoriteId.length > MAX_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(meteoriteId)) {
      throw new Error(`Invalid meteoriteId in prospective physical catalogs: ${meteoriteId}`);
    }
    if (!groups.has(meteoriteId)) groups.set(meteoriteId, []);
    groups.get(meteoriteId).push(item);
  }
  for (const [meteoriteId, members] of groups) {
    if (members.length > 1) {
      const expectedName = String(members[0].name || "").trim();
      if (!expectedName || members.some((item) => String(item.name || "").trim() !== expectedName)) {
        throw new Error(`Shared meteorite_id ${meteoriteId} must use one consistent specimen name`);
      }
    }
    const aliasRecord = ids.get(meteoriteId);
    if (aliasRecord && (aliasRecord.meteoriteId || aliasRecord.id) !== meteoriteId) {
      throw new Error(`meteorite_id ${meteoriteId} conflicts with the physical id alias for ${aliasRecord.id}`);
    }
  }
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
          validateImageBytes(contents, image.expectedType, `Image changed before staging: ${image.source}`);
          const digest = createHash("sha256").update(contents).digest("hex");
          if (digest !== image.sourceDigest) throw new Error(`Image bytes changed before staging: ${image.source}`);
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

  const prospectivePhysicalCatalogs = {};
  for (const dataFile of ["data/collection.json", "data/sale-specimens.json"]) {
    const update = updates.find((candidate) => path.relative(canonicalProjectRoot, candidate.destination) === dataFile);
    prospectivePhysicalCatalogs[dataFile] = update?.data || JSON.parse(await readFile(path.join(canonicalProjectRoot, dataFile), "utf8"));
  }
  validatePhysicalCatalogs(
    prospectivePhysicalCatalogs["data/collection.json"].items || [],
    prospectivePhysicalCatalogs["data/sale-specimens.json"].items || []
  );

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

export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_RECORD_IMAGE_BYTES,
  detectImageType,
  getImageDimensions,
  headers,
  importInventory,
  isContained,
  legacyHeaders,
  mergeItems,
  optionalNumber,
  optionalUsdCents,
  parseCsv,
  parseManifest,
  validateImageBytes
};
