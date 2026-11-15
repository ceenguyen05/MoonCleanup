import {
  ApiErrorBodySchema,
  CreateContractResponseSchema,
  GetContractResponseSchema,
  GuestCreateResponseSchema,
  InviteRotateResponseSchema,
  JoinCodeResponseSchema,
  ListContractsResponseSchema,
  ListMembersResponseSchema,
  ContractSummarySchema,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test-harness";

let ipCounter = 10;
async function player(h: Harness, name: string) {
  const res = await h.call("POST", "/v1/auth/guest", { body: { displayName: name }, ip: `198.51.100.${ipCounter++}` });
  expect(res.status).toBe(201);
  return GuestCreateResponseSchema.parse(res.body);
}

describe("contracts", () => {
  it("requires authentication on every contract route", async () => {
    const h = createHarness();
    const id = "0190a000-0000-7000-8000-000000000009";
    for (const [method, path] of [
      ["GET", "/v1/contracts"],
      ["POST", "/v1/contracts"],
      ["GET", `/v1/contracts/${id}`],
      ["PATCH", `/v1/contracts/${id}`],
      ["POST", "/v1/contracts/join-code"],
      ["POST", `/v1/contracts/${id}/invite-code`],
      ["GET", `/v1/contracts/${id}/members`],
    ] as const) {
      expect((await h.call(method, path, { body: {} })).status, `${method} ${path}`).toBe(401);
    }
  });

  it("creates a Solo Contract (default shift type), lists it with the quota, and returns schema-valid DTOs", async () => {
    const h = createHarness();
    const me = await player(h, "Solo Player");
    const created = await h.call("POST", "/v1/contracts", { token: me.accessToken, body: { name: "My Moon" } });
    expect(created.status).toBe(201);
    const body = CreateContractResponseSchema.parse(created.body);
    expect(body.inviteCode).toBeNull();
    expect(body.contract).toMatchObject({
      name: "My Moon",
      shiftType: "solo",
      role: "holder",
      maxPlayers: 1,
      gridM: 128,
      plotCount: 163842,
      online: 0,
    });
    const list = ListContractsResponseSchema.parse(
      (await h.call("GET", "/v1/contracts", { token: me.accessToken })).body,
    );
    expect(list).toMatchObject({ ownedCount: 1, ownedQuota: 3 });
    expect(list.contracts.map((c) => c.id)).toEqual([body.contract.id]);
    const one = await h.call("GET", `/v1/contracts/${body.contract.id}`, { token: me.accessToken });
    expect(ContractSummarySchema.parse(one.body).id).toBe(body.contract.id);
  });

  it("validates names (blocked, bad characters), seeds and unknown shift types", async () => {
    const h = createHarness();
    const me = await player(h, "Validator One");
    for (const body of [
      { name: "ab" },
      { name: "x".repeat(33) },
      { name: "staff" },
      { name: "Bad<Name>" },
      { name: "Fine Name", shiftType: "open" },
      { name: "Fine Name", seed: "18446744073709551616" },
      { name: "Fine Name", seed: "-1" },
      { name: "Fine Name", clientContractId: "not-a-uuid" },
      {},
    ]) {
      const res = await h.call("POST", "/v1/contracts", { token: me.accessToken, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
    }
  });

  it("registers a locally created Contract idempotently by clientContractId with its seed", async () => {
    const h = createHarness();
    const me = await player(h, "Offline First");
    const other = await player(h, "Other Person");
    const clientContractId = "0190a000-1111-7000-8000-000000000001";
    const request = { name: "Offline Moon", clientContractId, seed: "12345678901234567890" };
    const first = await h.call("POST", "/v1/contracts", { token: me.accessToken, body: request });
    expect(first.status).toBe(201);
    const again = await h.call("POST", "/v1/contracts", { token: me.accessToken, body: request });
    expect(again.status).toBe(200);
    expect(CreateContractResponseSchema.parse(again.body).contract.id).toBe(clientContractId);
    expect((await h.call("GET", "/v1/contracts", { token: me.accessToken })).body).toMatchObject({ ownedCount: 1 });
    // Another player cannot claim or probe the id.
    expect((await h.call("POST", "/v1/contracts", { token: other.accessToken, body: request })).status).toBe(400);
  });

  it("enforces the 3-owned quota with 409 QUOTA_EXCEEDED", async () => {
    const h = createHarness();
    const me = await player(h, "Quota Person");
    for (const name of ["Moon One", "Moon Two", "Moon Three"]) {
      expect((await h.call("POST", "/v1/contracts", { token: me.accessToken, body: { name } })).status).toBe(201);
    }
    const res = await h.call("POST", "/v1/contracts", { token: me.accessToken, body: { name: "Moon Four" } });
    expect(res.status).toBe(409);
    expect(ApiErrorBodySchema.parse(res.body).error).toBe("QUOTA_EXCEEDED");
  });

  it("refuses new Contracts with 507 STORAGE_FULL when the database is over its cap, but still lists", async () => {
    const h = createHarness({ storage: () => "full" });
    const me = await player(h, "Storage Test");
    const res = await h.call("POST", "/v1/contracts", { token: me.accessToken, body: { name: "No Room" } });
    expect(res.status).toBe(507);
    expect(ApiErrorBodySchema.parse(res.body).error).toBe("STORAGE_FULL");
    expect((await h.call("GET", "/v1/contracts", { token: me.accessToken })).status).toBe(200);
  });

  it("limits Contract creation to 10 per day per player (429)", async () => {
    const h = createHarness();
    const me = await player(h, "Spammer One");
    // Idempotent replays are cheap for the repository but still consume the daily allowance.
    const id = "0190a000-2222-7000-8000-000000000001";
    for (let i = 0; i < 10; i += 1) {
      const res = await h.call("POST", "/v1/contracts", {
        token: me.accessToken,
        body: { name: "Replay", clientContractId: id },
      });
      expect(res.status).toBeLessThan(300);
    }
    const res = await h.call("POST", "/v1/contracts", {
      token: me.accessToken,
      body: { name: "Replay", clientContractId: id },
    });
    expect(res.status).toBe(429);
  });

  it("Private Contract: invite code, join by code as Staff, members list, uniform not_found, full", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Alpha");
    const mate = await player(h, "Mate Alpha");
    const outsider = await player(h, "Outsider Alpha");
    const created = CreateContractResponseSchema.parse(
      (
        await h.call("POST", "/v1/contracts", {
          token: holder.accessToken,
          body: { name: "Shared Moon", shiftType: "private" },
        })
      ).body,
    );
    expect(created.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(created.contract).toMatchObject({ shiftType: "private", maxPlayers: 6 });

    // Lower-case input is accepted; the wrong code and a malformed code are both client errors that leak nothing.
    const joined = await h.call("POST", "/v1/contracts/join-code", {
      token: mate.accessToken,
      body: { code: created.inviteCode!.toLowerCase() },
    });
    expect(joined.status).toBe(200);
    expect(JoinCodeResponseSchema.parse(joined.body).contract).toMatchObject({
      id: created.contract.id,
      role: "staff",
    });
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: mate.accessToken, body: { code: created.inviteCode } }))
        .status,
    ).toBe(
      200, // already a member: idempotent
    );
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: outsider.accessToken, body: { code: "ZZZZ9999" } }))
        .status,
    ).toBe(404);
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: outsider.accessToken, body: { code: "short" } }))
        .status,
    ).toBe(400);

    const members = ListMembersResponseSchema.parse(
      (await h.call("GET", `/v1/contracts/${created.contract.id}/members`, { token: mate.accessToken })).body,
    );
    expect(members.members.map((m) => [m.displayName, m.role])).toEqual([
      ["Holder Alpha", "holder"],
      ["Mate Alpha", "staff"],
    ]);
    // Non-members see 404 (no existence oracle).
    expect(
      (await h.call("GET", `/v1/contracts/${created.contract.id}/members`, { token: outsider.accessToken })).status,
    ).toBe(404);
    expect((await h.call("GET", `/v1/contracts/${created.contract.id}`, { token: outsider.accessToken })).status).toBe(
      404,
    );

    // Joined Contracts are listed for the joiner and do not use the owned quota.
    const list = ListContractsResponseSchema.parse(
      (await h.call("GET", "/v1/contracts", { token: mate.accessToken })).body,
    );
    expect(list.ownedCount).toBe(0);
    expect(list.contracts[0]?.role).toBe("staff");
  });

  it("fills a private room to 6 members, then answers 409 ROOM_FULL", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Beta");
    const created = CreateContractResponseSchema.parse(
      (
        await h.call("POST", "/v1/contracts", {
          token: holder.accessToken,
          body: { name: "Crowded Moon", shiftType: "private" },
        })
      ).body,
    );
    for (let i = 1; i <= 5; i += 1) {
      const p = await player(h, `Crew Number ${i}`);
      expect(
        (await h.call("POST", "/v1/contracts/join-code", { token: p.accessToken, body: { code: created.inviteCode } }))
          .status,
      ).toBe(200);
    }
    const late = await player(h, "Late Arrival");
    const res = await h.call("POST", "/v1/contracts/join-code", {
      token: late.accessToken,
      body: { code: created.inviteCode },
    });
    expect(res.status).toBe(409);
    expect(ApiErrorBodySchema.parse(res.body).error).toBe("ROOM_FULL");
  });

  it("limits join-by-code guessing per IP (10 per minute)", async () => {
    const h = createHarness();
    const me = await player(h, "Guesser One");
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await h.call("POST", "/v1/contracts/join-code", { token: me.accessToken, body: { code: "ZZZZ9999" } })).status,
      ).toBe(404);
    }
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: me.accessToken, body: { code: "ZZZZ9999" } })).status,
    ).toBe(429);
    h.advance(61_000);
  });

  it("rotates invite codes (Holder only, Private only); the old code stops working", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Gamma");
    const mate = await player(h, "Mate Gamma");
    const solo = CreateContractResponseSchema.parse(
      (await h.call("POST", "/v1/contracts", { token: holder.accessToken, body: { name: "Solo Gamma" } })).body,
    );
    const priv = CreateContractResponseSchema.parse(
      (
        await h.call("POST", "/v1/contracts", {
          token: holder.accessToken,
          body: { name: "Private Gamma", shiftType: "private" },
        })
      ).body,
    );
    await h.call("POST", "/v1/contracts/join-code", { token: mate.accessToken, body: { code: priv.inviteCode } });

    expect(
      (await h.call("POST", `/v1/contracts/${solo.contract.id}/invite-code`, { token: holder.accessToken })).status,
    ).toBe(400);
    expect(
      (await h.call("POST", `/v1/contracts/${priv.contract.id}/invite-code`, { token: mate.accessToken })).status,
    ).toBe(403);
    const rotated = InviteRotateResponseSchema.parse(
      (await h.call("POST", `/v1/contracts/${priv.contract.id}/invite-code`, { token: holder.accessToken })).body,
    );
    expect(rotated.inviteCode).not.toBe(priv.inviteCode);
    const late = await player(h, "Late Gamma");
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: late.accessToken, body: { code: priv.inviteCode } }))
        .status,
    ).toBe(404);
    expect(
      (await h.call("POST", "/v1/contracts/join-code", { token: late.accessToken, body: { code: rotated.inviteCode } }))
        .status,
    ).toBe(200);
  });

  it("PATCH: Holder renames and switches shift type; Staff gets 403; bad id and empty body are rejected", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Delta");
    const mate = await player(h, "Mate Delta");
    const created = CreateContractResponseSchema.parse(
      (await h.call("POST", "/v1/contracts", { token: holder.accessToken, body: { name: "Delta Moon" } })).body,
    );
    const id = created.contract.id;
    const renamed = await h.call("PATCH", `/v1/contracts/${id}`, {
      token: holder.accessToken,
      body: { name: "Delta Prime" },
    });
    expect(ContractSummarySchema.parse(renamed.body).name).toBe("Delta Prime");

    const priv = await h.call("PATCH", `/v1/contracts/${id}`, {
      token: holder.accessToken,
      body: { shiftType: "private" },
    });
    expect(ContractSummarySchema.parse(priv.body)).toMatchObject({ shiftType: "private", maxPlayers: 6 });
    // Join with the freshly minted code: rotate to read it (the summary never carries the code).
    const code = InviteRotateResponseSchema.parse(
      (await h.call("POST", `/v1/contracts/${id}/invite-code`, { token: holder.accessToken })).body,
    ).inviteCode;
    await h.call("POST", "/v1/contracts/join-code", { token: mate.accessToken, body: { code } });
    expect(
      (await h.call("PATCH", `/v1/contracts/${id}`, { token: mate.accessToken, body: { name: "Hijack" } })).status,
    ).toBe(403);

    expect((await h.call("PATCH", `/v1/contracts/${id}`, { token: holder.accessToken, body: {} })).status).toBe(400);
    expect(
      (await h.call("PATCH", "/v1/contracts/not-a-uuid", { token: holder.accessToken, body: { name: "Whatever" } }))
        .status,
    ).toBe(404);
    const back = await h.call("PATCH", `/v1/contracts/${id}`, {
      token: holder.accessToken,
      body: { shiftType: "solo" },
    });
    expect(ContractSummarySchema.parse(back.body)).toMatchObject({ shiftType: "solo", maxPlayers: 1 });
  });

  it("GET /v1/contracts/:id returns the invite code to the Holder of a Private Shift only (REST v0.3.0)", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Epsilon");
    const mate = await player(h, "Mate Epsilon");
    const solo = CreateContractResponseSchema.parse(
      (await h.call("POST", "/v1/contracts", { token: holder.accessToken, body: { name: "Solo Epsilon" } })).body,
    );
    const priv = CreateContractResponseSchema.parse(
      (
        await h.call("POST", "/v1/contracts", {
          token: holder.accessToken,
          body: { name: "Private Epsilon", shiftType: "private" },
        })
      ).body,
    );
    await h.call("POST", "/v1/contracts/join-code", { token: mate.accessToken, body: { code: priv.inviteCode } });

    const asHolder = GetContractResponseSchema.parse(
      (await h.call("GET", `/v1/contracts/${priv.contract.id}`, { token: holder.accessToken })).body,
    );
    expect(asHolder.inviteCode).toBe(priv.inviteCode);

    // After a rotation the GET reflects the current code.
    const rotated = InviteRotateResponseSchema.parse(
      (await h.call("POST", `/v1/contracts/${priv.contract.id}/invite-code`, { token: holder.accessToken })).body,
    );
    expect(
      GetContractResponseSchema.parse(
        (await h.call("GET", `/v1/contracts/${priv.contract.id}`, { token: holder.accessToken })).body,
      ).inviteCode,
    ).toBe(rotated.inviteCode);

    // Staff never receive it: not as a value, and the key itself is null.
    const staffRes = await h.call("GET", `/v1/contracts/${priv.contract.id}`, { token: mate.accessToken });
    expect(GetContractResponseSchema.parse(staffRes.body).inviteCode).toBeNull();
    expect(JSON.stringify(staffRes.body)).not.toContain(rotated.inviteCode);
    expect(JSON.stringify(staffRes.body)).not.toContain(priv.inviteCode!);

    // Solo Contract: null.
    expect(
      GetContractResponseSchema.parse(
        (await h.call("GET", `/v1/contracts/${solo.contract.id}`, { token: holder.accessToken })).body,
      ).inviteCode,
    ).toBeNull();

    // The list never carries invite codes.
    const listText = JSON.stringify((await h.call("GET", "/v1/contracts", { token: holder.accessToken })).body);
    expect(listText).not.toContain("inviteCode");
    expect(listText).not.toContain(rotated.inviteCode);
  });

  it("PATCH to Private returns the new invite code to the Holder, and nothing for Solo", async () => {
    const h = createHarness();
    const holder = await player(h, "Holder Zeta");
    const created = CreateContractResponseSchema.parse(
      (await h.call("POST", "/v1/contracts", { token: holder.accessToken, body: { name: "Zeta Moon" } })).body,
    );
    const id = created.contract.id;
    const toPrivate = GetContractResponseSchema.parse(
      (await h.call("PATCH", `/v1/contracts/${id}`, { token: holder.accessToken, body: { shiftType: "private" } }))
        .body,
    );
    expect(toPrivate.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const viaGet = GetContractResponseSchema.parse(
      (await h.call("GET", `/v1/contracts/${id}`, { token: holder.accessToken })).body,
    );
    expect(viaGet.inviteCode).toBe(toPrivate.inviteCode);
    const toSolo = GetContractResponseSchema.parse(
      (await h.call("PATCH", `/v1/contracts/${id}`, { token: holder.accessToken, body: { shiftType: "solo" } })).body,
    );
    expect(toSolo.inviteCode).toBeNull();
  });

  it("reports live player counts through the injected presence source, capped at 6", async () => {
    const h = createHarness({ online: () => 99 });
    const me = await player(h, "Presence One");
    const created = CreateContractResponseSchema.parse(
      (await h.call("POST", "/v1/contracts", { token: me.accessToken, body: { name: "Busy Moon" } })).body,
    );
    expect(created.contract.online).toBe(6);
  });
});
