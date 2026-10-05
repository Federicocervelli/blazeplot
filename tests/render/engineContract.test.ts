import { defineEngineContract } from "./engineContract.ts";
import { engineFixtures } from "./engineHarness.ts";

for (const fixture of engineFixtures) defineEngineContract(fixture);
