// Prints the golden numbers (paste into test/golden.ts when the model changes on purpose).
import { runGolden } from "../test/golden";
console.log(JSON.stringify(runGolden(), null, 2));
