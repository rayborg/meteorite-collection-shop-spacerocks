import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCatalogs,
  catalogsMatch,
  headers,
  parseArguments,
  parseLedger,
  validateMeteorites
} from "../scripts/sync-specimen-ledger.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function loadFixture() {
  const [ledgerSource, meteorites, collection, sale] = await Promise.all([
    readFile(path.join(root, "data/specimen-ledger.csv"), "utf8"),
    readJson("data/meteorites.json"),
    readJson("data/collection.json"),
    readJson("data/sale-specimens.json")
  ]);
  return { ledgerSource, meteorites, collection, sale };
}

test("current specimen ledger is complete, contiguous, and synchronized", async () => {
  const fixture = await loadFixture();
  const rows = parseLedger(fixture.ledgerSource);
  const generated = buildCatalogs(fixture);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.map((row) => row.specimen_id), Array.from({ length: 13 }, (_, index) => `Specimen ${String(index + 1).padStart(3, "0")}`));
  assert.equal(generated.specimenCount, 13);
  assert.equal(generated.metbullAssociationCount, 4);
  assert.deepEqual(catalogsMatch(generated, fixture.collection, fixture.sale), { collection: true, sale: true });
  assert.deepEqual(
    [...fixture.collection.items, ...fixture.sale.items].filter((item) => item.metbullCode).map((item) => [item.specimenId, item.metbullCode]),
    [["Specimen 006", "12217"], ["Specimen 009", "5064"], ["Specimen 011", "82150"], ["Specimen 013", "69696"]]
  );
});

test("MetBull-associated ledger rows do not duplicate official fields", async () => {
  const fixture = await loadFixture();
  const rows = parseLedger(fixture.ledgerSource);
  for (const row of rows.filter((candidate) => candidate.metbull_code)) {
    for (const field of ["name", "classification", "locality", "found_year"]) {
      assert.equal(row[field], "", `${row.specimen_id} must obtain ${field} from its MetBull association`);
    }
  }
  assert.deepEqual([...validateMeteorites(fixture.meteorites).keys()], ["5064", "12217", "69696", "82150"]);
  for (const field of ["cost_usd", "seller", "storage_location", "receipt"]) assert.equal(headers.includes(field), false);
});

test("ledger validation rejects gaps, unknown associations, duplicates, and omissions", async () => {
  const fixture = await loadFixture();
  const withPrice = (value) => fixture.ledgerSource.replace(",,available", `,${value},available`);
  assert.throws(
    () => buildCatalogs({ ...fixture, ledgerSource: fixture.ledgerSource.replace("Specimen 013,sale_specimen", "Specimen 014,sale_specimen") }),
    /specimen_id must be Specimen 013/u
  );
  assert.throws(
    () => buildCatalogs({ ...fixture, ledgerSource: fixture.ledgerSource.replace(",12217,,,,36.4,", ",999999,,,,36.4,") }),
    /unknown metbull_code 999999/u
  );
  assert.throws(
    () => buildCatalogs({ ...fixture, ledgerSource: fixture.ledgerSource.replace("aguas-zarcas-4-97g", "wabar-impact-glass-7-2g") }),
    /duplicate physical ID/u
  );
  assert.throws(
    () => buildCatalogs({ ...fixture, ledgerSource: fixture.ledgerSource.split("\n").slice(0, -2).join("\n") }),
    /missing current physical IDs/u
  );
  assert.throws(
    () => buildCatalogs({ ...fixture, ledgerSource: withPrice("1000000.01") }),
    /maximum supported public price/u
  );
  for (const unsafe of ["90071992547409.90", "90071992547409.91", "9007199254740991.99"]) {
    assert.throws(() => buildCatalogs({ ...fixture, ledgerSource: withPrice(unsafe) }), /maximum supported public price/u);
  }
  const maximum = buildCatalogs({ ...fixture, ledgerSource: withPrice("1000000.00") }).saleItems[0].priceUsd;
  assert.equal(maximum, 1_000_000);
  assert.equal(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(maximum), "$1,000,000.00");
});

test("ledger CLI modes are strict and default to a dry run", () => {
  assert.equal(parseArguments([]).mode, "dry-run");
  assert.equal(parseArguments(["--check"]).mode, "check");
  assert.equal(parseArguments(["custom.csv", "--write"]).ledgerPath, path.resolve("custom.csv"));
  assert.throws(() => parseArguments(["--check", "--write"]), /only one/u);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown option/u);
});
