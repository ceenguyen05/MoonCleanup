import { describe, expect, expectTypeOf, it } from "vitest";
import { CHECKPOINT_REJECT_REASONS, SOLO_BACKUP_RETENTION_DAYS } from "../api";
import {
  SAVE_CONFLICT_CHOICES,
  SAVE_RESTORE_SOURCES,
  SAVE_STORAGE_WARNINGS,
  SAVE_SYNC_STATES,
  SAVE_UPLOAD_FAILURE_KINDS,
  SaveConflictChoiceSchema,
  SaveRestoreSourceSchema,
  SaveStorageWarningSchema,
  SaveSyncStateSchema,
  SaveUploadFailureKindSchema,
  type SaveConflictChoice,
} from "./sync-rules";

describe("save/sync-rules v1", () => {
  it("keeps the sync states of ADR-0031", () => {
    expect(SAVE_SYNC_STATES).toEqual(["local_only", "synced", "pending", "uploading", "offline", "conflict", "error"]);
    for (const s of SAVE_SYNC_STATES) expect(SaveSyncStateSchema.parse(s)).toBe(s);
    expect(SaveSyncStateSchema.safeParse("syncing").success).toBe(false);
  });

  it("offers exactly two conflict choices and no default", () => {
    expect(SAVE_CONFLICT_CHOICES).toEqual(["keep_local", "use_server"]);
    expectTypeOf<SaveConflictChoice>().toEqualTypeOf<"keep_local" | "use_server">();
    expect(SaveConflictChoiceSchema.safeParse(undefined).success).toBe(false);
    expect(SaveConflictChoiceSchema.safeParse("later").success).toBe(false);
    expect(SaveConflictChoiceSchema.safeParse(null).success).toBe(false);
  });

  it("round-trips every vocabulary value and rejects strangers", () => {
    for (const v of SAVE_RESTORE_SOURCES) expect(SaveRestoreSourceSchema.parse(v)).toBe(v);
    for (const v of SAVE_UPLOAD_FAILURE_KINDS) expect(SaveUploadFailureKindSchema.parse(v)).toBe(v);
    for (const v of SAVE_STORAGE_WARNINGS) expect(SaveStorageWarningSchema.parse(v)).toBe(v);
    expect(SAVE_RESTORE_SOURCES).toEqual(["local", "server", "backup"]);
    expect(SaveRestoreSourceSchema.safeParse("cloud").success).toBe(false);
    expect(SaveUploadFailureKindSchema.safeParse("rejected").success).toBe(true);
    expect(SaveStorageWarningSchema.safeParse("disk_full").success).toBe(false);
  });

  it("keeps the facts the prompt rule refers to", () => {
    expect(SOLO_BACKUP_RETENTION_DAYS).toBe(7);
    expect(CHECKPOINT_REJECT_REASONS).toContain("generation_not_increasing");
  });
});
