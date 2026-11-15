// Prints the ledger golden vectors V1 as JSON (see test/golden/ledger-lane.ts for when and how to re-record).
import { computeLedgerVectors } from "../test/golden/ledger-lane";

console.log(JSON.stringify(computeLedgerVectors(), null, 2));
