# Private Specimen Costs

The Spacerocks repository and GitHub Pages catalog are public. A field hidden by the interface would still be readable in JSON and Git history, so acquisition costs must never be added to `data/`, HTML, JavaScript, tracked fixtures, commit messages, or deployment artifacts.

## Private Record

Keep the authoritative cost ledger outside this repository in an access-controlled, backed-up location. Use stable keys in the form `record_type:id` and store USD as integer cents:

```json
{
  "schemaVersion": 1,
  "currency": "USD",
  "specimens": {
    "collection_specimen:example-id": {
      "costUsdCents": 12345
    }
  }
}
```

The local ledger should be readable and writable only by its owner. The repository ignores `/private/` as a second line of defense, but ignored files inside the checkout can still be exposed by a local web server and must not be used as the authoritative ledger.

## Import Field

`cost_usd` is the final optional column in `inventory.csv`.

- Use it only for `collection_specimen` and `sale_specimen` rows.
- Use nonnegative decimal USD with no currency symbol, comma, exponent, or more than two fractional digits.
- A blank value means unknown or unrecorded, not zero.
- The importer validates the value but intentionally does not copy or return it in public catalog data, summaries, or callbacks.
- Keep every cost-bearing import manifest outside the repository.
- Record or update the matching external private-ledger entry as part of the same inventory intake session.

Before committing, search the staged diff and public JSON for `cost_usd`, `costUsd`, `costUsdCents`, `acquisitionCost`, and the supplied cost value. Only blank schema/documentation references may be tracked.
