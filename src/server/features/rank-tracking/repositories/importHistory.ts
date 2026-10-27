import { rankCheckRuns, rankSnapshots } from "@/db/schema";
import { runBatch } from "@/db/runBatch";

/** The completed run and its historical rows must become visible together. */
export async function insertImportedHistory(
  run: typeof rankCheckRuns.$inferInsert,
  snapshots: Array<Omit<typeof rankSnapshots.$inferInsert, "id">>,
) {
  await runBatch((tx) => [
    tx.insert(rankCheckRuns).values(run),
    ...snapshots.map((snapshot) => tx.insert(rankSnapshots).values(snapshot)),
  ]);
}
