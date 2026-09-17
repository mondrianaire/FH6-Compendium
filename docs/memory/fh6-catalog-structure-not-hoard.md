---
name: fh6-catalog-structure-not-hoard
description: "Jett's 2026-09-03 direction: catalog the structure (storage class, domain, enum source, join target) of every important field, don't just hoard data; use the ERD to find undeclared relationships"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6d15d4eb-00c1-4231-a1b4-d2b808667633
  modified: 2026-09-03T13:27:11.021Z
---

On 2026-09-03, after the first Eraser ERD of fh6.db, Jett said the ERD should be used to "identify undiscovered variables that may indicate a relationship between multiple charts and keys", and that the project must "begin concretely cataloging the datatypes of all important and relevant fields by their structure, not just hoarding the data".

**Why:** nine `data TEXT` JSON blobs (ref_car.data 151 keys, ref_part.data 163, ref_compound.data 122, ref_track.data 49 …) hold un-typed, un-joined game columns. The first structural profile (scratchpad `profile_fields.py`, value-set containment against every PK) immediately found: (a) tune_container/hw_package engine_id/drivetrain_id/carbody_id are copies of the ordinal on every row (import_containers `comp()` returns ref_part.key_id, which for those slots IS the ordinal; the real id is ref_part.data.EngineID etc.), a defect export_options.py works around instead of fixing; (b) ref_part.data.TorqueCurveFullThrottleID and TireCompoundID are real joins kept only in JSON; (c) ~12 enum keys in ref_car/ref_engine/ref_part data (MakeID, CountryID, CylinderID, EngineConfigID, AspirationTypeId, FamilyModelID, FamilyBodyID, TireBrandID, ShiftSystemID, BrakeTypeID, EnvironmentId) whose lookup tables exist in FH6_Database.sqlite (List_CarMake, List_Country, List_Cylinders, List_EngineConfig, List_Aspiration, List_FamilyModel, List_FamilyBody, Combo_TireBrandCompound, List_ShiftSystem, List_BrakeType, Environments) but were never imported.

**How to apply:** when adding or reviewing a table, record for each field its storage class, cardinality, range, enum source table and join target; promote JSON keys that are ids into typed columns with REFERENCES; treat "id-like key whose values sit inside another table's PK" as a relationship to declare or refute, never leave it in a blob. The Eraser ERD (file EV5zhW3hPU6v4Z7PiZoW) is the shared picture; keep it in step with db/schema.sql. Related: [[fh6-never-forget-a-store]], [[fh6-decode-the-whole-record]], [[fh6-judge-against-the-course]].
