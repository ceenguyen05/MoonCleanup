# Data layer, guest-first auth and observability: research report

**Date:** 2026-11-11 · **Author:** research subagent P2h · **Status:** planning research only (no code, schema or SQL) · **Budget constraint (added by the coordinator mid-task):** $0 forever (Render free web service of about 0.1 CPU / 512 MB, a free database tier, free observability tiers only).

**Conventions.** `[n]` points to the numbered **Sources** list. **Unverified** means I could not confirm it this session. **ref-only** marks a well-known reference I cited but did not re-fetch today. Statements marked **opinion** are judgement, not sourced fact.

---

## Executive summary

1. **Blocker: Aiven's free MySQL tier no longer exists for new services.** Since 6 Nov 2026 you can't create new free Aiven for MySQL services. Existing ones will be powered off on 21 Dec 2026, and their data and backups will be deleted [30][31]. The cheapest Aiven MySQL plan is now Developer at **$5/month** (1 CPU, 1 GB RAM, 8 GB storage) [32]. Under the $0 rule, the remaining Aiven option is the **Aiven for PostgreSQL free tier** (1 CPU, 1 GB RAM, 1 GB storage; powers off when idle) [32][33]. The owner has to choose: (A) switch to PostgreSQL and stay at $0, or (B) pay $5/month and keep MySQL. See §0.
2. **ORM recommendation: Drizzle ORM**, pinned to the stable 0.45.x line (drizzle-kit 0.31.x) [16][17]. Use it with `mysql2`, or with a Postgres driver under option A. It has a thin runtime with no engine. The schema lives in TypeScript and is the single source of truth. It generates SQL migration files you can review, and its MySQL migrations table has a primary key [19][23]. v1 is at RC5, dated 21 Oct 2026 [15]. If v1.0.0 final ships before implementation starts, start on v1 instead.
3. **Runner-up: Kysely** (0.29.8) [26]. It has the lightest footprint. Its built-in Migrator has a lock table, and by default it **fails loudly** when migrations are out of order [27]. The cost is hand-written migrations, types kept in sync separately, and less familiarity among AI agents (opinion).
4. **Don't use Prisma now.** `@prisma/client` 7.10.1 is the stable client [6], but the npm `latest` tag for the **`prisma` CLI is 8.0.0-rc.33** [5]. Prisma 8 replaces `schema.prisma` and `@prisma/client` with a new "contract" API [9]. MySQL support in Prisma 8 is an "early preview" [8]. GA was "expected in October 2026" and has slipped [7]. Prisma 7 also brings a shadow-database requirement for `migrate dev` [11], implicit many-to-many tables with no primary key [10], and TLS configured in two separate places (CLI and runtime) [12].
5. **Run migrations in the Render build command.** Render's pre-deploy command is for paid services only [36][38]. Render's own guidance for the free plan is to run migrations in the build command [37]. Recommended flow: one migration owner generates the SQL, a human reviews it in the PR, the build applies it, and every change follows expand/contract so the old code keeps working.
6. **World blobs.** Store each world snapshot as a single compressed row and overwrite it in place: MEDIUMBLOB on MySQL (up to 16 MiB) or bytea on PostgreSQL [54][55][58]. Write volume is the real constraint. About 300 KB every 30–60 s is roughly **0.4–0.9 GB/day of writes per continuously active room**. That drives binlog/WAL volume and table bloat against 1 GB of free storage. Save only when the world has changed, and measure.
7. **Auth for the MVP: build it yourself.** Issue an opaque refresh token, stored hashed on the server, and a short-lived JWT access token signed with `jose` [64, ref-only]. Send the access token as a **Bearer header**, and authenticate WebSockets with the **first message**. Don't use cookies: `*.vercel.app` and Render's domain are different sites, so the cookies would be third-party. Safari blocks third-party cookies [63, ref-only]. Chrome keeps them, but users can block them [44][45][46].
8. **Account linking later.** Model login methods as separate identities linked to the existing guest player row. If you'd rather use a library, Better Auth 1.7.21 has an anonymous plugin with an `onLinkAccount` hook [40][41]. Lucia is no longer maintained [43], and Auth.js is now maintained by the Better Auth team [42].
9. **Observability at $0:**
   - **Errors:** Sentry Developer plan for both the browser and Node. It includes 5k errors, 5M spans, 5 GB logs, 1 uptime monitor, 30-day lookback and 1 user [47].
   - **Logs:** pino JSON to stdout, read in Render's log viewer. The Hobby plan keeps logs **7 days** and caps them at **6,000 lines/min per instance** [35].
   - **Optional log shipping:** a log stream to Grafana Cloud free (50 GB logs, 10k metric series, 14-day retention) [48] or Better Stack free (3 GB logs, 3-day retention) [49].
10. **Metrics.** At about 0.1 CPU, skip a full OpenTelemetry SDK at first. Instead, write one structured "room stats" log line per room per minute (tick p50/p95/max, players, bytes out). Watch bandwidth closely: if a workspace uses up its included outbound bandwidth and has no payment method on file, Render suspends its free services for the rest of the month [34].
11. **Uptime and abuse controls.**
    - **Uptime monitors:** UptimeRobot free (50 monitors, 5-minute checks, commercial use allowed) [50] or Better Stack free (10 monitors) [49].
    - **Render free behaviour:** the service spins down after 15 minutes with no traffic and takes about a minute to start again. Each workspace gets 750 free instance hours a month, which is about one always-on service [34].
    - **Rate limiting:** `rate-limiter-flexible` with in-memory storage [53].
    - **CORS:** an exact list of allowed origins. Never allow by `.vercel.app` suffix, and don't trust a regex for preview URLs [52].
12. **Top risks:**
    - The database engine and host decision (§0).
    - Render free restarting or spinning down and losing rooms held in memory [34].
    - Major-version churn in the ORMs (Prisma 8, Drizzle v1).
    - Free tiers changing under you. This happened in 2025–26 with Aiven MySQL and with Highlight moving to LaunchDarkly [30][51].

---

## 0. Blocking finding: there's no free MySQL on Aiven any more

| Fact | Detail | Source |
|---|---|---|
| Free MySQL retired | No new free Aiven for MySQL services from **6 Nov 2026**. On **21 Dec 2026**, the remaining free services are "powered off, and their data and backups will be deleted"; this "can't be undone". | [30][31] |
| Upgrade path that keeps MySQL | Upgrading to the MySQL **Developer** plan keeps the data, service name and connection details. It needs a payment method, and Basic support can take up to 3 hours to activate. | [31] |
| Price of keeping MySQL | MySQL Developer costs **$5/month** for 1 CPU, 1 GB RAM and 8 GB storage, running 24/7. | [32] |
| Remaining free database | The **Aiven for PostgreSQL free tier** gives 1 CPU, 1 GB RAM and 1 GB storage, and "powers off when idle". The Aiven services with free tiers are Kafka, OpenSearch, PostgreSQL and Valkey. | [32][33] |
| Free-tier caveats | Aiven may power off free services that see no initial use or no "continuative activity" (with a notification first), and you can power them back on. Aiven also reserves the right to change a free service's cloud, region or configuration. The connection limit isn't published. | [33] |
| Other free Postgres | Render also offers free Postgres instances. I did **not verify** their lifetime or expiry policy this session, so check before relying on them. | [34] (via search summary) |
| Other MySQL-compatible free services | Not researched (unverified). | — |

**What this means for the rest of this report:**

- All three tools (Prisma, Drizzle, Kysely) support PostgreSQL as well as MySQL.
- The ORM recommendation is the same for either engine.
- Three items only matter if you keep MySQL (option B): `sql_require_primary_key`, MEDIUMBLOB, and DDL that can't be rolled back.
- Under option A (PostgreSQL), the TLS-with-CA requirement still applies. Whether Aiven's PostgreSQL free tier requires a CA certificate exactly the way MySQL does is **unverified**.
- That `sql_require_primary_key` is on by default on Aiven MySQL comes from the project brief. I didn't re-verify it.

---

## 1. Prisma (current major as of Nov 2026)

### 1.1 Release status (important for the decision)

- **Prisma 7.0.0** (19 Nov 2025):
  - The **Rust-free client** is now the default, with vendor claims of "~90% smaller bundle sizes" and "up to 3x faster queries".
  - Database drivers are no longer embedded, so you install a **driver adapter** and pass it to the client.
  - MySQL and MariaDB use **`@prisma/adapter-mariadb`** (`PrismaMariaDb`).
  - The new `prisma-client` generator needs an explicit `output` path.
  - `prisma.config.ts` now holds `datasource.url` and `datasource.shadowDatabaseUrl`.
  - The CLI **no longer loads environment variables automatically**.
  - The post-install hook was removed, so you have to run `prisma generate` explicitly.
  - The `metrics` preview was removed; read pool metrics from the driver instead.

  Source: [1].
- **Current stable is 7.10.1** (`@prisma/client` npm `latest` = 7.10.1; GitHub release dated 19 Oct) [3][6]. It fixed two things:
  - Migrate now refuses with error **P3025** when the shadow database URL points at the main database. Before the fix, `prisma migrate diff --from-migrations` could drop the real schema.
  - The MariaDB adapter now uses `mariadb` 3.5.4, which addresses security advisories.

  Source: [3].
- **Prisma 8 is a release candidate with a new API:**
  - The `prisma` CLI's npm `latest` tag is **8.0.0-rc.33**, and `prev` is 7.10.1 [5]. The Prisma docs say "it's what `npm install prisma` installs today" [9].
  - A "contract" file replaces `schema.prisma`. There is no `@prisma/client`. `prisma migration plan` plus `prisma db migrate` replace `prisma migrate dev` [9].
  - The release-status page says Prisma 8 **GA was "expected in October 2026"**, yet on 6 Nov it was still an RC [7][4].
  - Prisma 7 gets bug fixes and security updates for **18 months after Prisma 8 GA** [7].
- **MySQL in Prisma 8 is an "early preview"** (`@prisma/orm-mysql`) [8]. Its limits:
  - No `RETURNING`.
  - Row locks such as `FOR UPDATE` are refused.
  - Migrations only support creating and dropping tables, columns, indexes, unique constraints and foreign keys.
  - Binary logging must be row-based (`binlog_format=ROW`).
  - Sessions run at READ COMMITTED.

  MariaDB is listed as "coming soon" [8]. Another Prisma docs page says MySQL is "not yet supported in 8. Prisma 7 covers them" [9] (see Contradictions).

### 1.2 Evaluation for this project

| Criterion | Finding |
|---|---|
| MySQL support quality | Prisma 7 supports MySQL 5.6+ and MariaDB 10.0+ through the `mysql` provider, using the `mariadb` driver adapter [12]. Prisma 8's MySQL support is behind its PostgreSQL support [8]. |
| Migrations and shadow database | `prisma migrate dev` creates and deletes a **shadow database** on every run. That needs the right to create databases, or a dedicated database configured with `shadowDatabaseUrl`. Production commands (`migrate deploy`, `migrate resolve`) **don't** use it [11]. On a single small cloud service, don't run `migrate dev` against the cloud at all. Use a local Docker database for development, where the shadow is created automatically, and `migrate deploy` in production. Wildcard `GRANT`s for shadow databases are deprecated as of MySQL 8.0.35 [11]. Pointing the shadow URL at the main database risks wiping data, which is why 7.10.1 now blocks it [3][11]. |
| TLS/CA | **Configured in two places.** The CLI (Migrate) reads the URL from `prisma.config.ts`. MySQL URL arguments are `sslcert`, `sslidentity` and `sslaccept`. The **default `sslaccept` is `accept_invalid_certs`**, so you must set `sslaccept=strict` [12]. At runtime the adapter passes options to the `mariadb` driver, which takes a CA certificate through its `ssl` option [13]. The Prisma page doesn't say whether the URL TLS parameters also reach the adapter (unverified) [12]. |
| Pooling | The pool belongs to the driver. The Prisma example sets `connectionLimit: 5` [12]. The `mariadb` driver's default `connectionLimit` is 10 [14]. |
| Footprint on Render free | Prisma 7 no longer ships an engine binary; the vendor claims ~90% smaller bundles [1]. You still need the CLI and generated client at build time, plus an explicit `prisma generate` step [1]. I found no verified memory figures. |
| Type safety | Strong: the client is generated from the schema (opinion). |
| Agent familiarity | Historically the highest (opinion). The 7→8 split is a trap: an agent that runs a plain install gets the **v8 RC CLI** [5][9], and its training data covers the v5–v7 API. |
| `sql_require_primary_key` | Implicit many-to-many join tables "do not have primary keys". Prisma's fix is an **explicit join model with a primary key** [10]. Whether the `_prisma_migrations` table has a primary key is **unverified** this session; I believe its `id` column is one. |
| Verdict | Not recommended now. The timing is the problem: a major API change is in flight and MySQL lags behind in it. Revisit after Prisma 8 GA if the project moves to PostgreSQL. |

---

## 2. Drizzle ORM (v1 status as of Nov 2026)

| Criterion | Finding |
|---|---|
| Versions | `drizzle-orm` npm `latest` = **0.45.4**; `drizzle-kit` `latest` = **0.31.11**; `rc` tag = **1.0.0-rc.5** [16][17]. Release history: v1.0.0-rc.5 on 21 Oct 2026, rc.4 on 27 Jun 2026, beta.2 on 12 Feb 2025 [15]. The Drizzle team posted that the "next release is v1" but gave no date [18]. |
| Schema and workflow | The schema is written in TypeScript. `drizzle-kit generate` writes SQL migration files, `migrate` applies them, and `push` syncs the schema directly for prototyping. In v1, `push` asks for confirmation before statements that lose data (`--force` skips the prompt), and `push --explain` prints the SQL [21]. |
| Migration table and primary keys (MySQL) | `__drizzle_migrations` (name configurable) has columns `id` (serial, **primary key**), `hash` and `created_at`. It is therefore **compatible with `sql_require_primary_key`** [19]. v1 adds `name` and `applied_at` columns and upgrades the table automatically through `drizzle-kit up` [21]. |
| Atomicity and locking | Migrations run inside a transaction. The table is created before that transaction, and the visible code has **no lock** [19]. On MySQL, DDL statements cause implicit commits, so a failed migration can be left partly applied [56, ref-only]. PostgreSQL supports transactional DDL (well known; not re-verified). |
| Parallel-branch hazard (0.x) | The v0 migrator "only looked for local migrations with a creation date later than the last applied one". v1 applies every missing migration, adds **commutativity checks** for conflicts between branches, and removes `journal.json` to avoid Git conflicts [20][21]. With AI agents working on parallel branches, 0.x needs a process rule (see §4.3). |
| TLS/CA | Drizzle accepts "any property from the mysql2 connection options" or an existing `mysql2` pool [23]. `mysql2` supports `ssl` with a CA certificate [69, ref-only]. Unlike Prisma, there is one TLS configuration used by both the app and the migrator. |
| Pooling | Pass a `mysql2` pool in for queries. Drizzle "strongly recommends" a single client connection for `migrate` [23]. |
| Blob types | v1 adds MySQL `blob`, `tinyblob`, `mediumblob` and `longblob` [21][22]. On 0.45.x, define them as a **custom type**, which is documented [24]. That 0.45.x lacks them is inferred from the v1 change list (see Contradictions). |
| Performance and footprint | A thin layer over the driver with no engine and no generated runtime client (architectural fact; I verified no benchmark). It suits 512 MB. |
| Type safety | Types are inferred from the TypeScript schema. v1 removes relational queries v1 in favour of `defineRelations()` [21]. |
| Agent familiarity | High (opinion). Drizzle Kit rc.4 added "tools for scripts and AI agents" [15]. **Risk:** the docs site shows v1-style APIs [22] while npm `latest` is 0.45.4 [16], so agents may mix the two APIs. |
| Maturity concerns | Stable is still 0.x after a long beta and RC period (Feb 2025 to Oct 2026) [15]. rc.5 still contains "breaking changes and fixes across drivers and dialects" [15]. |

---

## 3. Kysely + mysql2

| Criterion | Finding |
|---|---|
| Versions | npm `latest` = **0.29.8**, `next` = 0.30.0-beta.2, `release-0.28` = 0.28.19 [26]. In 0.29, the migration utilities moved to `kysely/migration` (from the kysely-ctl 0.21.0 notes) [28]. The 0.30 beta adds a `transactionMode` option for the Migrator and a `defineMigration` helper [29]. |
| Ergonomics | A type-safe query builder whose queries read like SQL. It has no ORM relation layer, and there are few surprises (opinion). |
| Migrations | Built-in `Migrator`. The `kysely_migration` table has `name` (varchar(255), **primary key**) and `timestamp`. The `kysely_migration_lock` table has `id` (**primary key**) and `is_locked`. Both are **compatible with `sql_require_primary_key`** [27]. Locking is handled by the dialect adapter. Migrations run in a transaction only when the dialect supports transactional DDL (not MySQL) [27]. `allowUnorderedMigrations` defaults to **false**, so it throws on out-of-order history, which is the safer behaviour when agents work on parallel branches [27]. Migrations are hand-written in TypeScript, and there is no schema-diff generator. `kysely-ctl` provides a CLI [28]. |
| Type generation | `kysely-codegen` generates types by reading a live database's structure (ref-only [70]; details unverified). The alternative is hand-maintained types. Either way, the schema and the types are two artefacts that can drift apart. |
| TLS and pooling | Through the `mysql2` pool, the same as Drizzle [69, ref-only]. The 0.30 beta adds support for both `mysql2` and `mysql2/promise` in `MysqlDialect` [29]. |
| Agent familiarity | Moderate, lower than Prisma or Drizzle (opinion). |

---

## 4. Comparison, recommendation, migration strategy and blobs

### 4.1 Comparison table

| | Prisma 7.10.x (stable) / 8 RC | Drizzle 0.45.x (stable) / v1 RC | Kysely 0.29.x |
|---|---|---|---|
| Runtime footprint | Medium: generated client, query compiler and driver adapter [1] | Small: thin layer over `mysql2`/`pg` | Smallest: query builder only |
| MySQL maturity | Good in 7; **early preview** in 8 [8] | Good; MySQL is one of its supported dialects [23] | Good |
| PostgreSQL (option A) | Good in 7; 8 is RC [7] | Good | Good |
| Migration authoring | Generated (`migrate dev`) | Generated from the TS schema (`generate`) | Hand-written |
| Shadow database | **Needed** for `migrate dev` [11] | No | No |
| `sql_require_primary_key` | Implicit many-to-many tables fail; needs explicit join models [10] | Migration table has a primary key [19] | Both migrator tables have primary keys [27] |
| TLS with CA | Two configurations (CLI URL and driver) [12][13] | One `mysql2` configuration [23] | One `mysql2` configuration |
| Out-of-order migrations | n/a (not researched) | 0.x: **silently skipped**; v1: checked [21] | **Throws** by default [27] |
| Major-version churn | **High** (8 rewrites the API) [9] | Medium (v1: `drizzle-kit up` and relations v2) [20][21] | Low to medium (0.29/0.30 changes) [28][29] |
| Agent familiarity (opinion) | Highest, but split across 7 and 8 | High, but split across 0.x and v1 | Moderate |
| Fit for $0 / 512 MB (opinion) | Worst of the three | Good | Best |

### 4.2 Recommendation

Use **Drizzle ORM 0.45.x, pinned exactly, with drizzle-kit 0.31.x** [16][17]. The driver depends on the §0 decision: `mysql2` if you pay for MySQL Developer, or a Postgres driver if you move to the Aiven PostgreSQL free tier. Why:

- One TypeScript schema produces both the types and reviewable SQL migrations.
- The runtime is light enough for 0.1 CPU and 512 MB.
- There is one TLS configuration.
- The migration table already satisfies the primary-key rule [19][23].

If `drizzle-orm` 1.0.0 final is published before the first schema is written, start on v1. It brings commutativity checks and native MySQL blob types [21]. Choose **Kysely** if you value the smallest runtime and loud failures over generated migrations and agent familiarity. Defer **Prisma** until Prisma 8 is GA and its MySQL support is mature (or PostgreSQL is chosen) [7][8].

### 4.3 Migration strategy

1. **Who generates migrations.** One "migration owner" at a time, either the human or one designated agent, runs `drizzle-kit generate` on an up-to-date `main`. Other agents may edit the TypeScript schema in their branches but must not commit generated migrations. This avoids the 0.x out-of-order skip [21] and conflicting snapshots.
2. **Review.** The human reviews the generated SQL in the PR. Checklist:
   - Every new table has a primary key.
   - Nothing destructive happens without an expand/contract plan.
   - On MySQL, keep each migration small, because DDL can't be rolled back [56, ref-only].
   - Never run `drizzle-kit push` against the hosted database; use it only on local Docker [21].
3. **How migrations run on deploy:**
   - **Render free:** there is no pre-deploy command, because it's for paid services only [36][38]. Use Render's documented free-plan workaround and run migrations in the **build command** [37]. A failed migration then fails the build, and the old version keeps serving.
   - **Paid Render later:** move the step to `preDeployCommand`, which runs on a separate instance [36].
   - **On boot:** acceptable only as a fallback on a single free instance. It can crash-loop, and it adds time to a cold start that already takes about a minute [34].
4. **Expand/contract.** Migrations are applied before the new code goes live, so every migration must be compatible with the previous release.
5. **Safety net.** Take a manual logical dump before risky migrations (Aiven documents `mysqldump`/`mydumper` export [31]). I didn't verify the free tier's backup policy.

### 4.4 Storing compressed world state as a blob

- **Column type, MySQL:** the four BLOB types differ only in maximum length [54]. BLOB holds up to 64 KiB, which is too small. **MEDIUMBLOB holds up to 16 MiB**, which suits a few-hundred-KB snapshot. LONGBLOB (up to 4 GiB) is unnecessary [55, ref-only].
- **Column type, PostgreSQL:** use `bytea` [58, ref-only].
- **`max_allowed_packet`:** MySQL 8.4 defaults it to 64 MiB [57, ref-only]. **Aiven's value is unverified**; check the service's advanced configuration. A packet of about 300 KB is far below any typical setting.
- **Shape:** keep the blob in its own table with one row per world. Store metadata alongside it: format/codec version, uncompressed size, checksum, a save sequence number for optimistic concurrency, and `updated_at`. Then lists and profile queries never read the blob. Overwrite the row in place (opinion).
- **Write-volume arithmetic:** 300 KB × 1,440–2,880 saves/day is about **0.43–0.86 GB/day per continuously active room**. Every overwrite generates log volume (binlog on MySQL, WAL on PostgreSQL) and dead row versions or undo that the database must clean up. Against 1 GB of free storage this is the binding constraint, but its exact effect on Aiven disk use is **unverified**. Mitigations (opinion):
  - Save only when the world has changed (a "dirty" flag).
  - Take full snapshots every 2–5 minutes, with event-driven saves for important events.
  - Watch disk usage from day one.
- **Render restarts:** Render "might restart a Free web service at any time", and local files are lost [34]. The database is therefore the only durable store. Flush on shutdown signals; Render's exact shutdown behaviour is unverified.

---

## 5. Guest-first auth with optional account linking later

### 5.1 The cross-origin situation

- The client lives at Vercel URLs such as `<project>-<unique-hash>-<scope-slug>.vercel.app` [52]. The API lives on Render's domain; the default `onrender.com` hostnames are not re-verified. These are different registrable domains, so they are **different sites**. A cookie the API sets is a **third-party cookie** inside the game page.
- **Safari** blocks third-party cookies by default [63, ref-only][46].
- **Chrome:** in April 2025, Google kept its existing approach to third-party-cookie choice and dropped the standalone prompt [45]. In October 2025 it retired most Privacy Sandbox APIs but **kept CHIPS (partitioned cookies) and FedCM** [44]. Chrome users can still block third-party cookies, and Incognito blocks them by default [46].
- **Firefox** keeps each site's cookies separate (Total Cookie Protection) [46].
- **SameSite and cookies:** cross-site cookies need `SameSite=None; Secure`, plus optionally `Partitioned` (CHIPS). Safari's behaviour makes that path unreliable (opinion). A shared custom domain such as `game.example` and `api.example` would make the cookies same-site, but a domain costs money, which conflicts with the $0 budget.
- **Conclusion:** use **Bearer tokens in the `Authorization` header**, not cookies. With no cookies sent automatically, classic **CSRF doesn't apply**. The trade-off is **XSS exposure** of tokens that JavaScript can read. Mitigate with a strict CSP, no third-party scripts, a short access-token lifetime, and refresh-token rotation with reuse detection (opinion).

### 5.2 Options

| Option | Status and facts | Fit |
|---|---|---|
| **Custom:** opaque refresh token stored hashed, plus a short-lived JWT via `jose` | `jose` is a widely used JWT library (ref-only [64]). You own the security details. | **Recommended for the MVP.** Simplest, works the same over REST and WebSocket, and needs no cookies. |
| **Better Auth** (npm `latest` 1.7.21; 1.8.0-beta.7) [41] | The anonymous plugin creates users without personal data. `onLinkAccount(anonymousUser, newUser)` runs when the user signs in with another method. By default the anonymous user is **deleted** after linking (`disableDeleteAnonymousUser` keeps it). A pending second factor blocks linking. Its CLI adds schema [40]. Sessions are cookie-first; for our cross-site setup you'd need its bearer plugin (ref-only, unverified) or a shared domain. Its MySQL and Postgres adapters are unverified this session. There are several release lines (1.4, 1.6, 1.7, 1.8) [41]. | Good candidate **when adding account linking**. Re-verify the bearer plugin and database adapters first. |
| **Auth.js** | Now "maintained and overseen" by the Better Auth team [42]. A secondary source says it only receives security patches (unverified). | Poor fit: built around frameworks, not a standalone Node game server (opinion). |
| **Lucia** | Its README says it's no longer maintained and suggests Better Auth. Lucia v3 was deprecated in early or March 2025, per secondary sources [43]. | **Don't adopt.** |
| **Hosted:** Firebase anonymous auth, Supabase anonymous sign-ins, Clerk | Docs exist for Firebase [77, ref-only] and Supabase [76, ref-only] anonymous sign-in. **I didn't verify free quotas or pricing** for any of them, Clerk included [78, ref-only]. | Viable fallback. Adds a vendor SDK, JWKS verification on the server, and lock-in. |

### 5.3 Recommended MVP design (prose; no code)

1. **First visit.** The client calls a "create guest" endpoint. The server creates a player row with a random ID and returns two tokens:
   - **Refresh token:** at least 256 bits of randomness. The server stores only a hash, plus player ID, expiry, last-used time and rotation lineage.
   - **Access token:** a JWT valid for 5–15 minutes, with standard claims (`sub`, `exp`, `iat`, `iss`, `aud`). The signing key lives in a Render environment variable and is never committed.
2. **Storage.** The client keeps the refresh token in `localStorage`. For a guest, **the token is the account**, so offer a "recovery code" export and later account linking.
3. **Refresh.** The client posts the refresh token in the request body. The server rotates it. If an already-used token is presented again, revoke the whole token family.
4. **REST calls** send the access token as a Bearer token.
5. **WebSocket:**
   - Check the `Origin` header against the allowlist at upgrade [60, ref-only][62, ref-only].
   - Require an **auth message as the first frame** within a few seconds, verify the JWT, and bind the connection to the player.
   - **Avoid tokens in the query string.** RFC 6750 advises against putting bearer tokens in page URLs, and they leak into logs [59, ref-only].
   - Avoid smuggling the token through `Sec-WebSocket-Protocol`. It is the only header the browser API lets you set [61, ref-only], but this misuses subprotocol negotiation.
   - Acceptable middle ground: a single-use ticket with a 30-second lifetime, fetched over REST and passed in the URL.
6. **Cold starts.** The first HTTP request or WebSocket connection to a spun-down free service waits about a minute while it starts [34]. Show a "waking server" state and retry with backoff.

### 5.4 Path to account linking (Discord, Google or GitHub)

- Keep three concepts separate: **players** (the game identity), **auth identities** (provider plus the provider's user ID, pointing at a player), and **refresh tokens**. A guest is simply a player with no identities (design opinion).
- **Linking flow:** a signed-in guest starts an OAuth authorization-code flow with PKCE, handled by the API. On callback:
  - **Unknown identity:** attach it to the current player.
  - **Identity already belongs to another player:** apply a merge or switch policy, decided at design time.
- **Library:** at that point either implement OAuth with a small client library or adopt Better Auth's anonymous and linking features [40]. Re-verify then.
- OAuth redirect URIs must match exactly, and Vercel preview URLs change on every commit [52]. Test linking against production or a fixed branch URL.

---

## 6. Observability on free tiers (quotas as of 2026-11-11)

### 6.1 Free-tier quotas

| Service | Free tier (verified today unless marked) | Source |
|---|---|---|
| **Sentry Developer** | 1 user, 5k errors, 5M spans, 50 replays, 1 GB attachments, 1 cron monitor, 1 uptime monitor, 5 GB logs, 5 GB application metrics, 30-day lookback. Spend notifications and a spending cap are listed only for Team and above, which starts at $29/month (or $26/month billed annually). The page doesn't state the period for errors or what happens when you exceed quota. | [47] |
| **Grafana Cloud Free** | 10k active metric series a month; 50 GB each of logs, traces and profiles ingested a month; 14-day retention; 3 active users; 500 k6 virtual-user hours; 100k API and 10k browser synthetic test runs; no credit card. | [48] |
| **Better Stack Free** | 10 monitors and heartbeats combined, 1 status page, 3 GB logs a month kept 3 days, 30 GB metrics, 100,000 exceptions a month, Slack and email alerts. The check frequency on the free tier isn't stated. | [49] |
| **UptimeRobot Free** | 50 monitors, 5-minute interval, basic status pages, 5 integrations, 3-month data retention, "personal and commercial projects". The page contradicts itself on SSL monitoring. | [50] |
| **Render logs** | Hobby keeps logs 7 days (Pro 14, Scale/Enterprise 30). Each instance can send at most 6,000 log lines a minute; extra lines are dropped. Logs older than your retention aren't recovered if you upgrade. The free page lists log streams as supported. | [35][34] |
| **Highlight.io** | Shut down on 28 Feb 2026; users were told to move to LaunchDarkly Observability by 1 Mar 2026. LaunchDarkly's free quotas are **unverified**. | [51] |
| **Axiom** | Not verified this session. | — |

### 6.2 Recommended setup (all $0)

1. **Errors:** Sentry Developer, using the browser SDK on Vercel and the Node SDK on Render [47].
   - **Source maps:** upload them during the Vercel build with Sentry's bundler plugin (ref-only [79]). Store the Sentry auth token only as a Vercel environment variable.
   - **Tracing:** sample REST requests at a low rate and **never trace per tick**, to stay within 5M spans and 0.1 CPU.
   - **Error budget:** filter noisy errors so you stay under 5k.
2. **Logs:** pino (ref-only [65]) writing JSON to stdout, read in Render's log viewer [35].
   - Never log per tick, because of the 6,000 lines/min cap [35].
   - Redact `Authorization` headers and tokens.
   - **Optional shipping:** send a Render log stream to Grafana Cloud (14 days) [48] or Better Stack (3 days) [49]. Whether each destination accepts Render's stream format is unverified.
3. **Metrics:**
   - **Now:** one structured stats line per room every 60 seconds. Include tick time p50/p95/max, tick overruns, players, WebSocket messages in and out, **bytes out**, snapshot save time, size and failures, database pool waits, event-loop lag, and memory (RSS and heap against 512 MB).
   - **Later:** a token-protected `/metrics` endpoint in Prometheus format (for example prom-client, ref-only [80]), scraped or pushed to Grafana Cloud. Keep labels bounded to stay under 10k series [48]; whether Grafana's hosted scraping works on the free tier is unverified.
   - **Not yet:** a full OpenTelemetry SDK (ref-only [81]). Its overhead matters on 0.1 CPU (opinion).
4. **Uptime:** UptimeRobot free hitting a cheap `/healthz` [50]. Use Sentry's single uptime monitor or Better Stack as a backup [47][49]. Because HTTP requests count as traffic on Render free [34], a 5-minute ping keeps the service from spinning down, which has two consequences:
   - **Hours:** it uses about 720–744 of the workspace's 750 free hours a month, so only one service can stay up [34].
   - **Terms:** Render's free page offers no keep-awake method and recommends paid plans. Whether keep-alive pings are acceptable under Render's terms is **unverified**.
5. **Bandwidth alert:** track bytes out per room. Free services count against the workspace's included outbound bandwidth; once it's used up with no payment method, all free services are suspended for the rest of the month [34]. The amount of included bandwidth is unverified.

---

## 7. Abuse-control basics for the API

### 7.1 Rate limiting

- **Library:** `rate-limiter-flexible`. Facts from its README:
  - No production dependencies and atomic increments.
  - Memory, Redis/Valkey, MySQL, PostgreSQL, Prisma, Drizzle and other stores.
  - An "insurance" limiter for when the store is down, and in-memory blocking that the README says helps against floods like "100k requests per sec".

  Source: [53].
- **Store:** on one free instance, use the **memory** limiter. Counters reset when the instance restarts, which is acceptable for an MVP (opinion).
- **Limits to set** (opinion):
  - Guest creation, keyed by IP, against account farming.
  - Writes, keyed by player.
  - Messages per WebSocket connection.
  - Concurrent sockets per IP.
- **Client IP:** behind Render's proxy, set up client-IP extraction from the forwarding headers correctly (the header details are unverified).

### 7.2 Input validation

- **Library options:**
  - **zod**, for the highest agent familiarity (opinion; ref-only [66]).
  - **valibot**, for a smaller modular bundle (ref-only [67]).
  - **TypeBox**, which uses JSON Schema and compiled validators (ref-only [68]).

  Versions are unverified this session.
- **Placement:** put one schema set in a shared workspace package, used by both client and server, and validate **every** client message at the boundary.
- **Hot WebSocket path:** set a maximum message size. Prefer compiled validators or bounds-checked binary decoding (opinion).

### 7.3 CORS for Vercel preview URLs

- **Production:** allow the exact production origin only. Deployment URLs are public by default; Deployment Protection can make them private [52].
- **Pitfall 1, suffix matching.** Allowing anything ending in `.vercel.app` admits pages any Vercel user can deploy.
- **Pitfall 2, preview patterns are ambiguous.** Vercel's documented formats are:
  - Commit URLs: `<project-name>-<unique-hash>-<scope-slug>.vercel.app`, where the hash is 9 characters.
  - Branch URLs: `<project-name>-git-<branch-name>-<scope-slug>.vercel.app`.

  Both branch names and account slugs can contain hyphens. A pattern ending in "-git-*anything*-*your-scope*.vercel.app" could therefore match another account whose slug ends in "-*your-scope*" (my reasoning; untested). Vercel also **truncates** labels longer than 63 characters and may **shorten** project names that look like domains [52].
- **Safer options for previews** (opinion):
  - An explicit list of allowed origins, held in an environment variable.
  - Allow only one fixed branch URL.
  - Point previews at a separate non-production API. This costs instance hours, and only about one free service fits in 750 hours a month [34].
- **CORS is not your auth layer.** With Bearer tokens and no cookies, a foreign origin can't use a player's credentials, so CORS mainly limits who can read responses (opinion). If you ever add cookies, a wildcard origin can't be combined with credentials, and the allowlist becomes security-critical.
- **WebSockets aren't covered by CORS.** Validate `Origin` at upgrade [60, ref-only][62, ref-only].

---

## Contradictions & uncertainty

1. **Aiven MySQL free tier.** The project brief assumes it exists. Aiven's official changelog and docs say it is retired: new services blocked from 6 Nov 2026, existing ones powered off on 21 Dec 2026 [30][31]. Aggregator pages still list a permanent free MySQL tier [74]. **Trust Aiven.**
2. **Prisma 8:**
   - The GA was "expected in October 2026" [7], but it was still at RC on 6 Nov 2026 [4].
   - One docs page calls MySQL an "early preview" [8]; another says MySQL is "not yet supported in 8" [9].
   - The npm `next` tag (8.0.0-rc.10) is older than `latest` (8.0.0-rc.33) [5].
   - Links point to both `prisma/prisma` and `prisma/orm` on GitHub [2].
3. **Prisma TLS.** The docs don't say whether the URL parameters `sslcert` and `sslaccept` apply to the runtime adapter or only to the CLI [12]. The primary key on `_prisma_migrations` is unverified.
4. **Drizzle v1 status.** A third-party guide (PkgPulse) says Drizzle reached 1.0 in mid-2025 [73]. The official releases page and npm show 1.0 still at RC (rc.5) and `latest` = 0.45.4 [15][16]. The docs site shows v1 APIs by default [22]. That 0.45.x lacks native MySQL blob types is **inferred** from the v1 change list [21].
5. **Kysely version.** A search summary said the GitHub Releases page marks 0.29.6 as "Latest" [25]; npm `latest` is 0.29.8 [26].
6. **Render free specs.** The official free page doesn't state CPU or RAM [34]. The "512 MB / 0.1 CPU" figure comes from the coordinator and a community thread title [39]. That the pre-deploy command is paid-only comes from search summaries of Render docs [36][38], not a direct fetch. Free Render Postgres lifetime limits are unverified.
7. **Sentry.** The pricing table doesn't state the period for errors or the behaviour when quota is exceeded [47].
8. **UptimeRobot.** The same page lists SSL monitoring in the free plan and also says it's "included only in paid plans" [50].
9. **Better Stack.** The free-tier check frequency isn't stated [49].
10. **Lucia and Auth.js dates.** Lucia's deprecation date (early or March 2025) and the date Auth.js moved to Better Auth come from secondary sources [42][43].
11. **Chrome.** Secondary sources disagree on when Privacy Sandbox APIs are removed (Chrome 144 vs 150) [46]. The official posts confirm the direction but not milestone-level dates [44][45].
12. **Not verified at all this session:**
    - Aiven PostgreSQL free-tier connection limit and TLS details.
    - Aiven's `max_allowed_packet` default.
    - Better Auth's bearer plugin and database adapters.
    - Firebase, Supabase and Clerk quotas.
    - LaunchDarkly free quotas.
    - Axiom's free plan.
    - Whether Render's terms allow keep-alive pings.
    - Render's included bandwidth.
13. **Opinions.** The agent-familiarity and footprint rankings are judgement, not measurements.

---

## Sources

All accessed 2026-11-11. "(search)" means the content was seen in search results from that page rather than fetched directly. "ref-only" means not fetched this session.

1. Prisma ORM v7.0.0: Rust-free Prisma Client becomes the default (Prisma changelog) — https://www.prisma.io/changelog/2025-11-19 — accessed 2026-11-11
2. Prisma GitHub Releases — https://github.com/prisma/prisma/releases — accessed 2026-11-11
3. Prisma 7.10.1 release notes — https://github.com/prisma/prisma/releases/tag/7.10.1 — accessed 2026-11-11
4. Prisma v8.0.0-rc.23 release notes — https://github.com/prisma/prisma/releases/tag/v8.0.0-rc.23 — accessed 2026-11-11
5. npm registry dist-tags: prisma — https://registry.npmjs.org/-/package/prisma/dist-tags — accessed 2026-11-11
6. npm registry dist-tags: @prisma/client — https://registry.npmjs.org/-/package/@prisma/client/dist-tags — accessed 2026-11-11
7. Prisma ORM release status — https://www.prisma.io/docs/orm/release-status — accessed 2026-11-11
8. Databases supported by Prisma ORM 8 — https://www.prisma.io/docs/orm/supported-databases — accessed 2026-11-11
9. What is Prisma 8? — https://www.prisma.io/docs/orm/v8 — accessed 2026-11-11
10. Prisma ORM v7: Troubleshooting relations — https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/troubleshooting-relations — accessed 2026-11-11
11. Prisma ORM v7: About the shadow database — https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database — accessed 2026-11-11
12. Prisma ORM v7: MySQL (supported databases) — https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql — accessed 2026-11-11
13. MariaDB Connector/Node.js connection options (search) — https://www.mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options — accessed 2026-11-11
14. Connection Pools with MariaDB Connector/Node.js, Promise API (search) — https://www.mariadb.com/docs/xpand/connect/programming-languages/nodejs/promise/connection-pools — accessed 2026-11-11
15. Drizzle ORM: Latest releases — https://orm.drizzle.team/docs/latest-releases — accessed 2026-11-11
16. npm registry dist-tags: drizzle-orm — https://registry.npmjs.org/-/package/drizzle-orm/dist-tags — accessed 2026-11-11
17. npm registry dist-tags: drizzle-kit — https://registry.npmjs.org/-/package/drizzle-kit/dist-tags — accessed 2026-11-11
18. Drizzle ORM on X: "next release is v1…" (search) — https://x.com/DrizzleORM/status/2112977597529276469 — accessed 2026-11-11
19. drizzle-orm source, mysql-core/dialect.ts (migrate) — https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/mysql-core/dialect.ts — accessed 2026-11-11
20. Upgrading to Drizzle v1 — https://orm.drizzle.team/docs/upgrade-v1 — accessed 2026-11-11
21. Drizzle: MySQL v0 → v1 changes — https://orm.drizzle.team/docs/mysql/v0-v1-changes — accessed 2026-11-11
22. Drizzle: MySQL column types — https://orm.drizzle.team/docs/column-types/mysql — accessed 2026-11-11
23. Drizzle: Get started with MySQL — https://orm.drizzle.team/docs/get-started-mysql — accessed 2026-11-11
24. Drizzle: MySQL custom types (search) — https://orm.drizzle.team/docs/mysql/custom-types — accessed 2026-11-11
25. Kysely GitHub Releases (search) — https://github.com/kysely-org/kysely/releases — accessed 2026-11-11
26. npm registry dist-tags: kysely — https://registry.npmjs.org/-/package/kysely/dist-tags — accessed 2026-11-11
27. Kysely source, src/migration/migrator.ts — https://github.com/kysely-org/kysely/blob/master/src/migration/migrator.ts — accessed 2026-11-11
28. kysely-ctl Releases (search) — https://github.com/kysely-org/kysely-ctl/releases — accessed 2026-11-11
29. kysely v0.30.0-beta.1 release notes (newreleases.io, search) — https://newreleases.io/project/github/kysely-org/kysely/release/v0.30.0-beta.1 — accessed 2026-11-11
30. Aiven changelog: Aiven for MySQL free tier is being retired on 21 December 2026 — https://aiven.io/changelog/507f8b1b-dd8f-4841-ac4a-940ac492b688 — accessed 2026-11-11
31. Aiven docs: Aiven for MySQL free tier, migration options — https://aiven.io/docs/products/mysql/concepts/mysql-free-tier — accessed 2026-11-11
32. Aiven: Free MySQL database (the MySQL free tier is retired) — https://aiven.io/free-mysql-database — accessed 2026-11-11
33. Aiven docs: Free plan / service pricing — https://aiven.io/docs/platform/concepts/free-plan — accessed 2026-11-11
34. Render docs: Deploy for Free — https://render.com/docs/free — accessed 2026-11-11
35. Render docs: Logs — https://render.com/docs/logging — accessed 2026-11-11
36. Render docs: Deploying on Render, pre-deploy command (search) — https://render.com/docs/deploys — accessed 2026-11-11
37. Render docs: Deploy a Rails 6 or 7 App, free-plan migrations in the build command (search) — https://render.com/docs/deploy-rails-6-7 — accessed 2026-11-11
38. Render docs: Blueprint YAML Reference (search) — https://render.com/docs/blueprint-spec — accessed 2026-11-11
39. Render community: "The free instance type (e.g., 512MB RAM / 0.1 CPU)" (search, title only) — https://community.render.com/t/the-free-instance-type-e-g-512mb-ram-0-1-cpu/39044 — accessed 2026-11-11
40. Better Auth docs: Anonymous plugin — https://www.better-auth.com/docs/plugins/anonymous — accessed 2026-11-11
41. npm registry dist-tags: better-auth — https://registry.npmjs.org/-/package/better-auth/dist-tags — accessed 2026-11-11
42. Better Auth blog: Auth.js is now part of Better Auth (search) — https://better-auth.com/blog/authjs-joins-better-auth — accessed 2026-11-11
43. Lucia deprecation, secondary sources (search): DEV Community, "Lucia auth is getting deprecated" — https://dev.to/gaundergod/lucia-auth-is-getting-deprected-4g7 — and Wisp, "Lucia Auth is Dead" — https://wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth — accessed 2026-11-11
44. Privacy Sandbox blog: Update on Plans for Privacy Sandbox Technologies (Oct 2025; search, official domain) — https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies — accessed 2026-11-11
45. Privacy Sandbox blog: Next steps for Privacy Sandbox and tracking protections in Chrome (Apr 2025; search, official domain) — https://privacysandbox.google.com/blog/privacy-sandbox-next-steps — accessed 2026-11-11
46. Usercentrics: Google Privacy Sandbox officially shuts down (secondary; search) — https://usercentrics.com/knowledge-hub/what-is-google-privacy-sandbox/ — accessed 2026-11-11
47. Sentry Pricing — https://sentry.io/pricing/ — accessed 2026-11-11
48. Grafana Cloud Pricing — https://grafana.com/pricing/ — accessed 2026-11-11
49. Better Stack Pricing — https://betterstack.com/pricing — accessed 2026-11-11
50. UptimeRobot Pricing — https://uptimerobot.com/pricing/ — accessed 2026-11-11
51. Highlight.io blog: Migrating to LaunchDarkly (search) — https://www.highlight.io/blog/launchdarkly-migration — accessed 2026-11-11
52. Vercel docs: Accessing Deployments through Generated URLs — https://vercel.com/docs/deployments/generated-urls — accessed 2026-11-11
53. rate-limiter-flexible (GitHub README) — https://github.com/animir/node-rate-limiter-flexible — accessed 2026-11-11
54. MySQL Reference Manual: The BLOB and TEXT Types (search) — https://dev.mysql.com/doc/en/blob.html — accessed 2026-11-11
55. MySQL 8.4 Reference Manual: Data Type Storage Requirements (ref-only) — https://dev.mysql.com/doc/refman/8.4/en/storage-requirements.html — accessed 2026-11-11 (not fetched)
56. MySQL 8.4 Reference Manual: Statements That Cause an Implicit Commit (ref-only) — https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html — accessed 2026-11-11 (not fetched)
57. MySQL 8.4 Reference Manual: Server System Variables, max_allowed_packet (ref-only) — https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html — accessed 2026-11-11 (not fetched)
58. PostgreSQL docs: Binary Data Types (ref-only) — https://www.postgresql.org/docs/current/datatype-binary.html — accessed 2026-11-11 (not fetched)
59. RFC 6750: OAuth 2.0 Bearer Token Usage, §5.3 (ref-only) — https://datatracker.ietf.org/doc/html/rfc6750 — accessed 2026-11-11 (not fetched)
60. RFC 6455: The WebSocket Protocol, Origin considerations (ref-only) — https://datatracker.ietf.org/doc/html/rfc6455 — accessed 2026-11-11 (not fetched)
61. MDN: WebSocket() constructor (ref-only) — https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket — accessed 2026-11-11 (not fetched)
62. OWASP HTML5 Security Cheat Sheet, WebSockets (ref-only) — https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html — accessed 2026-11-11 (not fetched)
63. WebKit blog: Full Third-Party Cookie Blocking and More (ref-only) — https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ — accessed 2026-11-11 (not fetched)
64. jose (GitHub; ref-only) — https://github.com/panva/jose — accessed 2026-11-11 (not fetched)
65. pino (GitHub; ref-only) — https://github.com/pinojs/pino — accessed 2026-11-11 (not fetched)
66. Zod (ref-only) — https://zod.dev — accessed 2026-11-11 (not fetched)
67. Valibot (ref-only) — https://valibot.dev — accessed 2026-11-11 (not fetched)
68. TypeBox (GitHub; ref-only) — https://github.com/sinclairzx81/typebox — accessed 2026-11-11 (not fetched)
69. node-mysql2 (GitHub; ref-only) — https://github.com/sidorares/node-mysql2 — accessed 2026-11-11 (not fetched)
70. kysely-codegen (GitHub; ref-only) — https://github.com/RobinBlomberg/kysely-codegen — accessed 2026-11-11 (not fetched)
71. Prisma changelog: Let your coding agent set up Prisma (2026-10-02; search, title only) — https://www.prisma.io/changelog/2026-10-02 — accessed 2026-11-11
72. Prisma blog: Prisma 8 Roadmap (search, title only) — https://www.prisma.io/blog/prisma-next-roadmap — accessed 2026-11-11
73. PkgPulse: Drizzle ORM v1 vs Prisma 6 vs Kysely 2026 (conflicting third-party claim; search) — https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026 — accessed 2026-11-11
74. freetier.co: Aiven free tier listing (outdated aggregator; search) — https://freetier.co/directory/products/aiven — accessed 2026-11-11
75. Better Auth docs: Bearer plugin (ref-only; not verified) — https://www.better-auth.com/docs/plugins/bearer — accessed 2026-11-11 (not fetched)
76. Supabase docs: Anonymous Sign-Ins (ref-only) — https://supabase.com/docs/guides/auth/auth-anonymous — accessed 2026-11-11 (not fetched)
77. Firebase docs: Authenticate with Firebase Anonymously, web (ref-only) — https://firebase.google.com/docs/auth/web/anonymous-auth — accessed 2026-11-11 (not fetched)
78. Clerk Pricing (ref-only; not researched) — https://clerk.com/pricing — accessed 2026-11-11 (not fetched)
79. Sentry JavaScript bundler plugins, source-map upload (GitHub; ref-only) — https://github.com/getsentry/sentry-javascript-bundler-plugins — accessed 2026-11-11 (not fetched)
80. prom-client (GitHub; ref-only) — https://github.com/siimon/prom-client — accessed 2026-11-11 (not fetched)
81. OpenTelemetry JavaScript docs (ref-only) — https://opentelemetry.io/docs/languages/js/ — accessed 2026-11-11 (not fetched)
