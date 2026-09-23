import clearTestRmc from "./test-rmc";

// Empties the test-only RMC after the run (never the demo).
export default async function globalTeardown() {
  await clearTestRmc();
}
