// Prints the demo seed SQL with DEMO_PASSWORD filled in, e.g.
//   DEMO_PASSWORD=... node scripts/render-seed.mjs | psql "$DATABASE_URL"
import { readFileSync } from "node:fs";

const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 10 || password.includes("'")) {
  console.error("Set DEMO_PASSWORD (10+ characters, no single quotes).");
  process.exit(1);
}
const sql = readFileSync(new URL("../supabase/seed/demo_seed.sql", import.meta.url), "utf8");
process.stdout.write(sql.replaceAll("{{DEMO_PASSWORD}}", password));
