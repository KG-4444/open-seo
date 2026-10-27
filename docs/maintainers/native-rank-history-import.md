# Importing existing rank history

`import_rank_tracking_history` writes already-collected DataForSEO observations
through the normal project authorization, service and dual-dialect repository.
It does not fetch metrics, submit provider jobs, or schedule checks.

Create a manual tracker first. Domain, national market, language, search depth
and device must match the source. Pass the original `checkedAt`, an immutable
`sourceRunId`, and either a found position/URL or a verified not-in-window
observation with null position/URL. Missing or failed checks are not observations.
Optional `keywords` can populate tracking without creating a check or history.

The importer atomically inserts a completed subset run and its observations.
Run identity is a SHA-256 binding of tracker and source-run identity. Identical
replays do nothing; a different payload for the same source run is rejected.
Preserve the returned run ID with the original source IDs and evidence hashes
in the operator's private import receipt. Do not overwrite historical data to
make it appear current. Imported subset runs remain available in per-keyword
history and latest results, but are deliberately excluded from full-run
distribution charts: a partial historical sample is not whole-tracker coverage.

Adding saved keywords is separate (`save_keywords`). Do not use the ordinary
add-keywords MCP tool for a historical migration: that tool also fetches paid
keyword metrics. Keep any existing external paid collector as the only
scheduler instead of enabling a second native schedule.
