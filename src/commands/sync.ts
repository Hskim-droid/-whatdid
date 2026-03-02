import { syncAll } from "../sync.js";

export async function runSync(force: boolean): Promise<void> {
  console.log(force ? "Force syncing all data..." : "Syncing data...");
  const result = await syncAll({ force, silent: false });

  console.log(`\nSync complete:`);
  console.log(`  Projects scanned:  ${result.projectsScanned}`);
  console.log(`  Sessions scanned:  ${result.sessionsScanned}`);
  console.log(`  Sessions updated:  ${result.sessionsUpdated}`);
  console.log(`  API calls synced:  ${result.apiCallsInserted}`);
  console.log(`  Elapsed:           ${result.elapsed}ms`);
}
