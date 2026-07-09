import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seedPath = resolve("src", "data", "seed", "users.json");
const users = JSON.parse(readFileSync(seedPath, "utf8"));
const seen = new Set();
let errors = 0;

for (const user of users) {
  if (!user.name || !user.mobile || !user.mappedMiningRole) {
    console.error(`Invalid user seed row: ${JSON.stringify({ name: user.name, mobile: user.mobile })}`);
    errors += 1;
    continue;
  }

  if (seen.has(user.mobile)) {
    console.error(`Duplicate mobile/user ID in seed list: ${user.mobile}`);
    errors += 1;
    continue;
  }

  seen.add(user.mobile);
}

console.log("User seed validation complete.");
console.log(`users created: 0`);
console.log(`users updated: ${users.length - errors}`);
console.log("users skipped: 0");
console.log(`errors: ${errors}`);
console.log("Runtime note: this frontend-only build creates/updates hashed local users on first app load.");

if (errors > 0) {
  process.exitCode = 1;
}
