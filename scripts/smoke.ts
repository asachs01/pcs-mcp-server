#!/usr/bin/env node
/**
 * Smoke test — verify PCO API connectivity with real credentials.
 * Run: npm run smoke
 */
import { readFileSync } from "fs";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { PcoClient } from "../src/pco/client.js";

async function main() {
  try {
    // Load .env if present (simple parser, no deps)
    try {
      const envFile = readFileSync(".env", "utf-8");
      for (const line of envFile.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length) {
          process.env[key] = valueParts.join("=");
        }
      }
    } catch {
      // .env not present or unreadable — that's OK, rely on existing env
    }

    const config = loadConfig();
    const logger = createLogger("info");
    const pco = new PcoClient(config, logger);

    console.log("🚀 Planning Center API smoke test");
    console.log(`   Auth: ${config.auth.mode}`);

    // 1. Get authenticated user
    console.log("\n1️⃣  Fetching current user...");
    const me = await pco.get<{ data: { attributes: { name: string; email?: string } } }>(
      "/people/v2/me"
    );
    console.log(`   ✅ Authenticated as: ${me.data.attributes.name}`);
    if (me.data.attributes.email) {
      console.log(`      Email: ${me.data.attributes.email}`);
    }

    // 2. Get service types
    console.log("\n2️⃣  Fetching service types...");
    const serviceTypes = await pco.get<{
      data: Array<{ id: string; attributes: { name: string } }>;
    }>("/services/v2/service_types?per_page=10");

    if (!serviceTypes.data.length) {
      console.log("   ⚠️  No service types found");
      return;
    }

    console.log(`   ✅ Found ${serviceTypes.data.length} service type(s):`);
    for (const st of serviceTypes.data) {
      console.log(`      - ${st.attributes.name} (ID: ${st.id})`);
    }

    // 3. Get recent plans for default or first service type
    const targetServiceTypeId = config.defaults.serviceTypeId || serviceTypes.data[0]?.id;
    if (!targetServiceTypeId) {
      console.log("   ⚠️  No service type ID available for plans test");
      return;
    }

    console.log("\n3️⃣  Fetching recent plans...");
    const plans = await pco.get<{
      data: Array<{ id: string; attributes: { sort_date: string; series_title?: string } }>;
    }>(`/services/v2/service_types/${targetServiceTypeId}/plans?per_page=5&order=sort_date`);

    if (!plans.data.length) {
      console.log("   ⚠️  No plans found");
    } else {
      console.log(`   ✅ Found ${plans.data.length} plan(s):`);
      for (const plan of plans.data) {
        const title = plan.attributes.series_title || "Untitled";
        console.log(`      - ${title} (${plan.attributes.sort_date})`);
      }
    }

    console.log("\n✅ Smoke test completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Smoke test failed:");
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if ("status" in error) {
        console.error(`   HTTP ${error.status}`);
      }
    } else {
      console.error(`   ${String(error)}`);
    }
    process.exit(1);
  }
}

main();