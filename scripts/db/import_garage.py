"""SCAFFOLD (not wired into rebuild.py yet) — ingest the decrypted profile's Career_Garage into garage_* tables.

Status: PLANNED. The decode primitive already exists and is verified:
    scripts/telemetry/fh6_profile.read_garage(decrypted_bytes) -> [ {CarId, Guid, TuneFileName, PerformanceIndex,
        ClassID, every part column, every Tuning_* slider column, usage stats}, ... ]  (813 instances measured)

When built, this becomes a rebuild.py STAGE (after `containers`), following import_gamedb.py's wholesale-refill
+ single import_run pattern (fh6db.run_begin/run_end). It must:
  * read the DROPPED decrypted profile (out-of-band, user-approved decrypt — never decrypt/upload here),
  * populate NEW `garage_*` tables keyed by the per-instance Guid (see db/schema.sql scaffold), NEVER merge
    into tune_*/ref_* (would corrupt the container-identity / game-truth contracts),
  * append to `garage_revision` (change/revision history) so a build's evolution over time is queryable,
  * be registered in rebuild.py STAGES + DOWNSTREAM + an I<n> invariant, and documented in
    docs/DATA-INVENTORY.md in the SAME commit (standing rule [[fh6-never-forget-a-store]]).

See the plan: C:\\Users\\mondr\\.claude\\plans\\tender-swinging-storm.md  and  [[fh6-equipped-tune-in-profiledata]].
This file intentionally does nothing yet; it is a placeholder so the stage has a home and the intent is recorded.
"""
import sys


def main(argv=None):
    print("import_garage.py is a SCAFFOLD — not implemented yet. "
          "The garage-corpus + revision-history ingest (A/B testing infrastructure) is planned, not built. "
          "See .claude/plans/tender-swinging-storm.md (Layer 2/3).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
