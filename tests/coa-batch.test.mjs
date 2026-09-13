import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseLedger } from "../scripts/sync-specimen-ledger.mjs";
import {
  buildCoaBatch,
  canonicalJson,
  normalizeImageReference,
  parseArguments,
  readSafeFile,
  validateAgainstSchema,
  validateAssertions,
  validateBatchContract,
  writeOutputSafely
} from "../scripts/export-coa-batch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSchema() {
  return JSON.parse(await readFile(path.join(root, "contracts/coa-batch-input-v1.schema.json"), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("current COA batch is deterministic, complete, and source-bound", async () => {
  const [first, second, schema, ledgerSource] = await Promise.all([
    buildCoaBatch(),
    buildCoaBatch(),
    loadSchema(),
    readFile(path.join(root, "data/specimen-ledger.csv"), "utf8")
  ]);
  assert.equal(canonicalJson(first), canonicalJson(second));
  validateBatchContract(first, schema);
  assert.equal(first.contractName, "coa-batch-input-v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.issuer, "The Spacerocks Cabinet");
  assert.deepEqual(Object.keys(first), ["contractName", "schemaVersion", "issuer", "sourceSha256", "specimens"]);
  const sourcePaths = {
    ledger: "data/specimen-ledger.csv",
    meteorites: "data/meteorites.json",
    collection: "data/collection.json",
    saleSpecimens: "data/sale-specimens.json",
    assertions: "data/coa-assertions-v1.json"
  };
  for (const [name, relativePath] of Object.entries(sourcePaths)) {
    const sourceBytes = await readFile(path.join(root, relativePath));
    assert.equal(first.sourceSha256[name], createHash("sha256").update(sourceBytes).digest("hex"));
  }
  assert.deepEqual(first.specimens.map((specimen) => specimen.specimenId), Array.from({ length: 13 }, (_, index) => `Specimen ${String(index + 1).padStart(3, "0")}`));
  assert.equal(first.specimens.flatMap((specimen) => specimen.photographs).length, 43);
  assert.equal(new Set(first.specimens.flatMap((specimen) => specimen.photographs.map((photo) => photo.sha256))).size, 43);
  assert.deepEqual(first.specimens.reduce((counts, specimen) => {
    counts[specimen.identity.kind] = (counts[specimen.identity.kind] || 0) + 1;
    return counts;
  }, {}), { "unclassified-meteorite": 4, "cataloged-impact-material": 5, "official-meteorite": 4 });

  const rows = parseLedger(ledgerSource);
  first.specimens.forEach((specimen, index) => {
    assert.equal(specimen.mass.asRecordedGrams, rows[index].mass_grams);
    assert.equal(specimen.description, rows[index].specimen_description);
    assert.equal(specimen.dimensions, rows[index].dimensions || null);
    assert.equal(specimen.provenance, rows[index].provenance || null);
    assert.equal(specimen.photographs.filter((photo) => photo.primary).length, 1);
    for (const photo of specimen.photographs) {
      assert.equal(photo.representation, "prepared-catalog-image");
      assert.equal(photo.disclosure, "Prepared catalog image; not an original camera file.");
    }
  });
  assert.equal(canonicalJson(first).endsWith("\n"), true);
  assert.equal(canonicalJson(first).includes("\r"), false);
});

test("schema and contract validation reject malformed, false, and private records", async () => {
  const [batch, schema] = await Promise.all([buildCoaBatch(), loadSchema()]);
  const cases = [
    ["closed schema", (value) => { value.extra = true; }, /unexpected property extra/u],
    ["prepared representation", (value) => { value.specimens[0].photographs[0].representation = "original"; }, /must equal/u],
    ["contiguous records", (value) => { value.specimens[1].specimenId = "Specimen 099"; }, /contiguous global order/u],
    ["photo count", (value) => { value.specimens[0].photographs.pop(); }, /exactly 3 photographs/u],
    ["one primary", (value) => { value.specimens[0].photographs[1].primary = true; }, /exactly one primary/u],
    ["unique hashes", (value) => { value.specimens[0].photographs[1].sha256 = value.specimens[0].photographs[0].sha256; }, /Duplicate photograph SHA-256/u],
    ["identity mapping", (value) => { value.specimens[0].identity.kind = "cataloged-impact-material"; value.specimens[0].objectCategory = "impact-material"; }, /reviewed mapping/u],
    ["official code mapping", (value) => { value.specimens[5].identity.metbullCode = "999"; }, /official identity code/u],
    ["occurrence mapping", (value) => { value.specimens[8].occurrence.kind = "find"; }, /occurrence does not match/u],
    ["private fields", (value, testSchema) => {
      value.specimens[0].priceUsd = 10;
      testSchema.$defs.specimen.properties.priceUsd = { type: "number" };
    }, /Private or sale-time field/u]
  ];
  for (const [label, mutate, expected] of cases) {
    const candidate = clone(batch);
    const testSchema = clone(schema);
    mutate(candidate, testSchema);
    assert.throws(() => validateBatchContract(candidate, testSchema), expected, label);
  }

  const invalidDate = clone(batch);
  invalidDate.specimens[12].occurrence.date = "2019-02-31-extra";
  assert.throws(() => validateAgainstSchema(invalidDate, schema), /schema/u);
});

test("reviewed assertions are exact and reject additions or altered claims", async () => {
  const assertions = JSON.parse(await readFile(path.join(root, "data/coa-assertions-v1.json"), "utf8"));
  assert.equal(validateAssertions(assertions).length, 13);
  const altered = clone(assertions);
  altered.specimens[3].objectCategory = "meteorite";
  assert.throws(() => validateAssertions(altered), /does not exactly match/u);
  const extra = clone(assertions);
  extra.specimens[0].note = "inferred from prose";
  assert.throws(() => validateAssertions(extra), /does not exactly match/u);
});

test("catalog image references reject roots, traversal, and unsupported names", () => {
  assert.equal(normalizeImageReference("./assets/collection/example.jpg", "collection"), "assets/collection/example.jpg");
  assert.throws(() => normalizeImageReference("./assets/sale-specimens/example.jpg", "collection"), /wrong collection asset root/u);
  assert.throws(() => normalizeImageReference("./assets/collection/../sale-specimens/example.jpg", "collection"), /escapes/u);
  assert.throws(() => normalizeImageReference("/assets/collection/example.jpg", "collection"), /Invalid/u);
  assert.throws(() => normalizeImageReference("./assets/collection/example.png", "collection"), /lowercase JPEG/u);
});

test("safe source reads reject symbolic links, directories, and path escape", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "coa-safe-read-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const inside = path.join(temporaryRoot, "inside");
  const outside = path.join(temporaryRoot, "outside.txt");
  await mkdir(inside);
  await writeFile(outside, "outside");
  await writeFile(path.join(inside, "regular.txt"), "regular");
  await symlink(path.join(inside, "regular.txt"), path.join(inside, "linked.txt"));
  await symlink(inside, path.join(temporaryRoot, "linked-directory"));

  assert.equal((await readSafeFile(path.join(inside, "regular.txt"), "regular", inside)).toString(), "regular");
  await assert.rejects(() => readSafeFile(path.join(inside, "linked.txt"), "linked", inside), /symbolic link/u);
  await assert.rejects(() => readSafeFile(path.join(temporaryRoot, "linked-directory", "regular.txt"), "linked parent", temporaryRoot), /symbolic-link parent/u);
  await assert.rejects(() => readSafeFile(inside, "directory", inside), /regular file/u);
  await assert.rejects(() => readSafeFile(outside, "outside", inside), /escapes/u);
});

test("output is external, atomic, deterministic, idempotent, and no-overwrite", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "coa-output-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const bytes = Buffer.from(canonicalJson(await buildCoaBatch()));
  const firstPath = path.join(temporaryRoot, "first.json");
  const secondPath = path.join(temporaryRoot, "second.json");
  assert.deepEqual(await writeOutputSafely(firstPath, bytes), { written: true, byteIdentical: false });
  assert.deepEqual(await writeOutputSafely(firstPath, bytes), { written: false, byteIdentical: true });
  assert.deepEqual(await writeOutputSafely(secondPath, bytes), { written: true, byteIdentical: false });
  assert.deepEqual(await readFile(firstPath), await readFile(secondPath));
  await assert.rejects(() => writeOutputSafely(firstPath, Buffer.from("different\n")), /refusing to overwrite/u);
  await assert.rejects(() => writeOutputSafely(path.join(root, "forbidden-coa.json"), bytes), /outside the repository/u);
  const target = path.join(temporaryRoot, "target.json");
  const linked = path.join(temporaryRoot, "linked.json");
  await writeFile(target, bytes);
  await symlink(target, linked);
  await assert.rejects(() => writeOutputSafely(linked, bytes), /symbolic-link/u);
});

test("COA CLI accepts only explicit check, output, or help modes", () => {
  assert.deepEqual(parseArguments(["--check"]), { mode: "check", outputPath: null });
  assert.equal(parseArguments(["--output", path.join(os.tmpdir(), "batch.json")]).mode, "output");
  assert.throws(() => parseArguments([]), /Usage/u);
  assert.throws(() => parseArguments(["--output", "relative.json"]), /absolute/u);
  assert.throws(() => parseArguments(["--check", "extra"]), /Usage/u);
  assert.throws(() => parseArguments(["--output", `${path.sep}tmp${path.sep}..${path.sep}batch.json`]), /traversal/u);
});
