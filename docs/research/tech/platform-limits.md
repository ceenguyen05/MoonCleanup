# Platform limits & configuration facts: Vercel, Render, Aiven for MySQL, GitHub Actions

**Date:** 2026-11-11 · **Author:** platform verifier subagent P2g · **Owner budget constraint:** $0-forever (free tiers only) · **Method:** official docs/pricing pages only; every source accessed 2026-11-11 · **Citations:** `[n]` refers to the numbered **Sources** list at the end.

Labels used in this report:
- **(Unverified)**: could not be confirmed on an official page in this session.
- **(summary)**: seen only in a search-engine summary of an official page, not in a direct page fetch.
- **(calc)**: my arithmetic from cited figures.
- **(rec)**: my recommendation, not a platform statement.

---

## Executive summary

1. **BLOCKER: Aiven no longer offers free MySQL.** Aiven's own page says: "The MySQL Free tier is retired. You can no longer create new MySQL services on the free plan." The cheapest managed MySQL is the **Developer tier at $5/month** (1 CPU, 1 GB RAM, 8 GB storage, always on) [43][42]. The only $0 Aiven database is **free PostgreSQL** (1 CPU, 1 GB RAM, 1 GB storage, powers off when idle) [43]. A strict $0 plan needs an owner decision:
   - pay $5/month for MySQL Developer;
   - switch the engine to PostgreSQL; or
   - keep a free MySQL service created before the retirement, if one exists (its future is undocumented).
2. **Vercel hosts the static client only.** Vercel Functions now serve WebSockets: a changelog dated 2026-10-20 says "generally available" [3], while the KB still says public beta [2]. But "WebSocket connections close when a Vercel Function reaches its maximum duration", which is **300 s on Hobby** [1][4]. Connections are pinned to whichever instance accepted them, with no shared memory between instances [1]. That rules out authoritative 30 Hz rooms.
3. **Vercel Hobby is non-commercial.** The docs say "Hobby teams are restricted to non-commercial personal use only". Ads, payments and paid contributors all count as commercial; donations do not [6]. Pro costs $20/month [8].
4. **Vercel Hobby allotments:**
   - per month: 100 GB Fast Data Transfer, 1M CDN requests, 10 GB Fast Origin Transfer [9];
   - builds: 45 min per build, 1 concurrent build, 100 deployments/day [5];
   - runtime logs are kept 1 hour [5];
   - Hobby cannot connect to repos owned by a Git organization [5];
   - after exceeding a limit you "wait until 30 days have passed" [9].
5. **Render supports WebSockets with no maximum duration** [25]. Sockets close whenever the instance is replaced (every deploy or restart). The old instance gets SIGTERM and 30 s by default, configurable from 1 to 300 s with `maxShutdownDelaySeconds` [25][36][37].
6. **Render Free web service:**
   - 0.1 CPU / 512 MB [31];
   - spins down after **15 min without inbound traffic, and "HTTP requests and WebSocket messages from existing connections" count as traffic**;
   - waking takes about 1 minute;
   - 750 free instance hours per workspace per month;
   - "Render might restart a Free web service at any time" [29];
   - no `preDeployCommand`, persistent disk, scaling, SSH, or inbound private-network traffic [29][36].
7. **Two free Render services (staging + prod) do not fit if both stay awake.** 750 h covers one 24/7 service, which uses 720–744 h a month [29] (calc). When the hours run out, Render suspends **all** free web services until next month [29].
8. **Bandwidth is the real $0 limiter.** The Render Hobby workspace includes 5 GB of outbound traffic a month, then $0.15/GB [30]. Without a payment method, free services are suspended for the rest of the month instead [29]. One full 16-player room at 30 Hz sends roughly 170–350 MB per hour (calc; assumptions in B7).
9. **Outbound IPs.** Render's are **ranges shared by every service in the region** [33]. Dedicated IPs cost $100/month per IP set and are not available on Hobby [30]. Aiven's IP allowlist defaults to 0.0.0.0/0 (open to all) [45].
10. **render.yaml essentials** [37][38][34]:
    - set `runtime: node` and `plan: free` (**omitting `plan` creates a paid `0.5c-512mb` service**);
    - `region` slugs: `oregon` (default), `ohio`, `virginia`, `frankfurt`, `singapore`; region cannot be changed later;
    - `autoDeployTrigger` replaces the deprecated `autoDeploy`;
    - other key fields: `buildFilter.paths`/`ignoredPaths`, `envVars` with `sync: false` / `generateValue` / `fromGroup`, `healthCheckPath`;
    - schema: https://render.com/schema/render.yaml.json.
11. **Node versions.** Vercel offers 26.x (default), 24.x and 22.x [16]; Node 20 was deprecated on 2026-10-01 [17]. Render's default for new services is 24.22.1, with precedence NODE_VERSION > .node-version > .nvmrc > engines.node [39]. **Pin 24.x on both** (rec).
12. **pnpm.** Vercel picks the pnpm version from `pnpm-lock.yaml`'s `lockfileVersion`. Corepack needs `ENABLE_EXPERIMENTAL_COREPACK=1` plus a `packageManager` field [15][18]. A Render article says Node 25 and later no longer bundle Corepack [41] (summary).
13. **Render `rootDir` hides everything outside it at build and runtime** [40]. For pnpm workspaces, keep `rootDir` at the repo root and use `buildFilter` (rec).
14. **Aiven MySQL facts:**
    - `max_connections = 75 × RAM(GiB) + 1` below 4 GiB, so about 76 on 1 GB (calc); it is not configurable, and Aiven documents no MySQL connection pooler [47];
    - the CA certificate is per project: Overview → Connection information → CA Certificate [46];
    - defaults are a strict `sql_mode` and `utf8mb4_0900_ai_ci` collation [48];
    - the `sql_require_primary_key` default is not stated (Unverified) [48].
15. **GitHub Actions.** Standard hosted runners are free for public repos. Private repos on GitHub Free get **$12/month** of included compute (about 2,000 Linux 2-core minutes, calc) and 500 MB of artifact storage. Usage is blocked when that runs out without a card [52]. `ubuntu-latest` is Ubuntu 24.04 [53] (summary).

---

## A. Vercel

### A1. Can Vercel host long-lived WebSocket servers?

Official statements:

- **Docs page "WebSockets"** [1] (page metadata: last updated 2026-08-10). Banner: "WebSockets are available on all plans". Quotes:
  - "Vercel Functions can serve WebSocket connections, keeping a bidirectional connection open between a client and your server-side code."
  - "A single WebSocket connection is pinned to one Vercel Function instance."
  - "WebSocket connections close when a Vercel Function reaches its maximum duration."
  - "New WebSocket connections are not guaranteed to reach the same Vercel Function instance."
  - "WebSockets require Fluid compute to be enabled."
  - Connections follow the normal Functions limits and pricing, plus Fast Data Transfer and Fast Origin Transfer.
- **KB "Do Vercel Functions support WebSocket connections?"** [2] (updated 2026-10-01): "Vercel Functions serve WebSocket connections natively". It describes WebSockets as public beta on all plans. It recommends Redis for shared state; Provisioned Memory is billed for the whole time a connection is open.
- **Changelog** [3] (2026-10-20): "WebSocket support in Vercel Functions is now generally available."
- **Maximum duration** [4]:
  - Hobby: 300 s default and maximum.
  - Pro/Enterprise: 300 s default, 800 s maximum, 1800 s "extended maximum" (beta).
  - Edge runtime must begin a response within 25 s and can stream for up to 300 s.

**Conclusion for us (rec):** an authoritative game server needs one long-lived process per room that holds all 16 sockets and runs a 30 Hz loop. On Vercel, every socket is force-closed after at most 300 s on Hobby, and players in the same room can land on different instances [1][4]. **Use Vercel only for the static Vite client.** Run the game server and REST API on Render.

### A2. Hobby vs Pro: limits relevant to a static game

| Item | Hobby | Pro | Source |
|---|---|---|---|
| Price | $0 | $20/month platform fee, which includes 1 deploying seat and $20 of usage credit; extra deploying seats $20/month each; viewer seats free | [7][8] |
| Commercial use | Not allowed (quote below) | Allowed | [6] |
| Fast Data Transfer (bandwidth) | First 100 GB/month | "Flat Rate CDN" lowest tier: 1 TB data transfer and 1M CDN requests/month included. Pricing page: "1TB/month included, then starting at $0.15 per GB" | [9][8][7] |
| CDN requests | First 1,000,000/month | See Flat Rate CDN | [9][8] |
| Fast Origin Transfer | First 10 GB/month | Usage-based | [9][6] |
| Deployment storage | 10 GB | Not captured | [7] |
| Build time per deployment | 45 min | 45 min | [5] |
| Concurrent builds | 1 | Up to 500 (on-demand) | [5] |
| Deployments per day | 100 (also 100 builds per hour) | 6,000 | [5] |
| Build machine | 2 vCPU, 8 GB RAM, 64 GB disk | 4 vCPU and 8 GB by default; up to 30 vCPU and 60 GB | [9] |
| Build cache | 1.5 GB on Basic/Standard machines; retained one month | Up to 4.75 GB (Turbo machine) | [5] |
| CLI source upload size | 100 MB | 1 GB | [5] |
| Files per CLI deployment | 15,000 source files (`--archive=tgz` lifts this); "no upper limit" for build output files | Same | [5] |
| Routes per deployment (each rewrite, redirect or header counts) | 2048 | 2048 | [5] |
| Projects / projects per Git repo | 200 / 25 | Unlimited / 150 | [5] |
| Domains per project | 50 | Unlimited (soft limit 100,000) | [5] |
| Runtime logs | 1 hour | 1 day | [5][9] |
| Password-protected previews | Not available | $20/month per project | [24] |
| Git organization repos | Hobby projects cannot connect to repos owned by Git organizations | Allowed | [5] |
| When a limit is exceeded | "In most cases … you will have to wait until 30 days have passed before you can use the feature again" | On-demand billing; spend notification at $200 by default | [9][8] |

More detail:
- **Vercel CI.** The pricing page lists "200 CPU minutes/month of Vercel CI" on Hobby [7]. How this relates to ordinary builds is not stated (Unverified).
- **Edge caching.**
  - CDN caching is on for every plan.
  - "Static files are **automatically cached on Vercel's global network** for the lifetime of the deployment after the first request." [13]
  - "Vercel **doesn't allow bypassing the cache for static files** by design." [13]
- **Per-file size limit for static output.** Not stated in the pages I fetched (Unverified). The 10 MB "max cacheable response size" in [13] applies to Function responses, not static files.
- **Image Optimization** is not needed. If it were used, Hobby includes 5,000 transformations [9].

**Hobby non-commercial clause (verbatim [6]):**
- "**Hobby teams** are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan."
- "Commercial usage is defined as any Deployment that is used for the purpose of financial gain of **anyone** involved in **any part of the production** of the project, including a paid employee or consultant writing the code."
- Examples it lists:
  - any way of requesting or processing payment from visitors;
  - advertising the sale of a product or service;
  - receiving payment to create, update or host the site;
  - affiliate linking as the primary purpose of the site;
  - "The inclusion of advertisements, including but not limited to online advertising platforms like Google AdSense."
- "Asking for Donations **does not** fall under commercial usage."
- The pricing FAQ adds: "Our Hobby plan is for personal, non-commercial use." [7]

### A3. vercel.json

- **Schema:** set `$schema` to https://openapi.vercel.sh/vercel.json [10].
- A typed alternative, `vercel.ts`, also exists [10]. We don't need it.

| Field | Type / values | Behaviour per docs | Our use (rec) | Source |
|---|---|---|---|---|
| `buildCommand` | string or null | Overrides the Build Command in Project Settings and the `build` script in package.json | A workspace-filtered build of the client package | [10] |
| `installCommand` | string or null; an empty string skips install | Overrides the Install Command | pnpm install, optionally filtered | [10][14] |
| `outputDirectory` | string | Overrides the Output Directory; "Only the contents of this Output Directory will be served statically" | The client's Vite output folder, relative to the Root Directory | [10][15] |
| `framework` | Framework slug string, or null for "Other" | Overrides the Framework Preset. A "Vite" preset exists | The Vite preset. Check the exact slug string against the schema (Unverified) | [10][15] |
| `headers` | Array of objects with `source`, `headers` (a list of `key`/`value` pairs), and optional `has`/`missing` | Custom response headers; `source` matches the pathname | Immutable Cache-Control for hashed assets; optional COOP/COEP | [10] |
| `rewrites` | Array of objects with `source`, `destination`, and optional `has`/`missing` | Docs SPA example: source `/(.*)` → destination `/index.html`. "The `source` property should **NOT** be a file because precedence is given to the filesystem prior to rewrites being applied." | SPA fallback; real asset files are still served first | [10][19] |
| `cleanUrls` | boolean, default `false` | When true, removes `.html` extensions and 308-redirects to the extensionless path | Optional | [10] |
| `trailingSlash` | `true`, `false`, or unset | true/false send a 308 redirect to the path with/without the slash; unset means no redirect | Leave unset or `false` | [10] |
| `ignoreCommand` | string or null | Exit code 1 means the build continues; exit code 0 means the build is skipped | Optional (on GitHub, unaffected monorepo projects are skipped automatically) | [10][14] |

**Caching:**
- The default header is `cache-control: public, max-age=0, must-revalidate`, which "instructs both the CDN and the browser not to cache" [12]. Static files are still cached at the CDN automatically, as noted in A2 [13].
- For immutable static assets, Vercel recommends `max-age=31536000, immutable` [12]. The vercel.json docs example uses `public, max-age=31556952, immutable` on source `/assets/(.*)` [10]. Both are roughly one year.
- (rec) Apply immutable caching only to content-hashed files. Leave `index.html` on the default so new deployments are picked up immediately.

**Compression** [11]:
- Vercel supports "both Gzip and Brotli compression". Brotli takes precedence when the client supports it.
- Compression happens automatically when the request has an `Accept-Encoding` header and the response MIME type is on an allowlist. The allowlist includes javascript, json, wasm, css, plain text, svg+xml, ttf/otf and others.
- Already-compressed formats such as JPEG, PNG and WebP are not compressed again.
- Whether pre-compressed `.br`/`.gz` files in the build output are used is not documented (Unverified).

**COOP/COEP:**
- I found no Vercel-specific page. These are ordinary response headers set through `headers` [10].
- (rec) They are only needed if the client uses SharedArrayBuffer or WASM threads.
- Turning on COEP can block cross-origin subresources that lack CORP/CORS headers. That is web-platform behaviour I did not verify against official docs in this session.

### A4. Monorepo setup with pnpm workspaces

- **One Vercel project per deployable directory.** Set its **Root Directory** to the client app folder [14][15].
- **Files outside the Root Directory.** "By default, your build can access files outside of that directory." The toggle **"Include files outside the root directory in the Build Step"** turns this off [15]. Keep it **on** for workspaces (rec).
- **Install.**
  - Vercel detects the package manager from the lockfile at the repository root, or from the `packageManager` field in the root package.json [14][18].
  - Supported pnpm versions are 6, 7, 8, 9, 10, 11 and 12. The version comes from the lockfile's `lockfileVersion`; for example, `lockfileVersion: 9.0` maps to "pnpm 9 or 10" [18].
  - "The install path is set by the root directory." [15]
  - A filtered install (only the app and its workspace dependencies) is documented [14].
- **Corepack.** Add the environment variable `ENABLE_EXPERIMENTAL_COREPACK` with value `1`, and set `packageManager` in the root package.json. Vercel then uses that package manager [15][18].
- **Automatic skipping of unaffected projects** (enabled by the "Skip deployment" switch) [14]:
  - It doesn't use concurrent build slots.
  - Requirements: a GitHub-connected repo; workspaces declared in `pnpm-workspace.yaml`; a unique `name` in every package; and dependencies between packages declared explicitly.
  - A lockfile change counts only if it affects the project's dependencies. Changes outside the workspace definition count as global and redeploy everything.
- **Ignored Build Step** (`ignoreCommand`). Builds cancelled this way still count towards the deployment and concurrent-build limits [14].
- **Turborepo** is optional.
  - Vercel's defaults are a `turbo run build` build command and `npx turbo-ignore --fallback=HEAD^1` as the Ignored Build Step; `turbo query affected` is also documented [23].
  - If you use it, list build-time variables (such as `VITE_*`) in `turbo.json`. Otherwise cached builds can be reused with another environment's values [23][20].
- **Node.js versions for builds (November 2026):**
  - Available: **26.x (default), 24.x, 22.x** [16].
  - `engines.node` in package.json overrides the version chosen in Project Settings [16].
  - Minor and patch versions are rolled out automatically and can differ between the build and functions [16].
  - Node 20 has been deprecated for builds and functions since **2026-10-01**; new deployments using it show an error [17].

### A5. Environment variables, previews, domains, Git LFS

**Environment variables** [20][5][19]:
- **Environments:** Production, Preview (all branches or specific ones; branch-specific values override) and Development. Custom environments also exist [20].
- Changes apply to new deployments only: "Any change you make to environment variables are not applied to previous deployments" [20].
- **Limits:** 64 KB total per deployment and 1,000 variables per environment. Each variable is typed Config or Secret [20][5].
- **VITE_ variables:**
  - All project variables are readable during the Build Step [20].
  - Vercel's Vite page says system variables can be read in Vite at build time by prefixing them with VITE. For example, `VITE_VERCEL_ENV` returns `preview`, `production` or `development` [19].
  - Only `VITE_`-prefixed variables reach the client bundle. That is Vite's own convention, which I did not re-verify here.
  - Treat every `VITE_` value as public (rec).

**Preview URLs** [21][24]:
- Commit URL: `<project-name>-<unique-hash>-<scope-slug>.vercel.app`.
- Branch URL: `<project-name>-git-<branch-name>-<scope-slug>.vercel.app`.
- Each DNS label is truncated to 63 characters.
- URLs are "publicly accessible by default" unless Deployment Protection is on [21].
- A custom Preview Deployment Suffix needs Pro or Enterprise [21].
- Standard Protection is available on all plans and protects everything except production domains [24].

**Domains, Git LFS:**
- **Custom domains:** 50 per project on Hobby [5]. Paid Pro teams get one free domain for the first year [8].
- **Git LFS:** a toggle in Project Settings → Git; "You must redeploy your project after turning Git LFS on" [22]. The default state is not stated (Unverified).

---

## B. Render

### B1. Web services: WebSockets, timeouts, ports

**WebSockets** [25]:
- "Render web services can accept inbound WebSocket connections from the public internet." "Render does not enforce a maximum duration for WebSocket connections."
- Connections "close automatically when the instance is replaced (for example, during a deploy)". Render sends SIGTERM and "gives it a 30-second window to shut down gracefully", which can be extended to 300 s.
- The load balancer "assigns each incoming WebSocket connection to a random instance". "Clients are not guaranteed to reconnect to the same instance after a disruption."
- Render recommends periodic keepalive messages (ping/pong) in both directions and reconnects with exponential backoff.
- No idle timeout is documented (Unverified). Keep app-level heartbeats (rec).

**HTTP** [26][27]:
- The load balancer terminates TLS and redirects HTTP to HTTPS. HTTP/2 is listed as a web-service feature [26].
- "Render web services allow HTTP responses to take up to 100 minutes." [27]

**Ports** [26]:
- Bind to host `0.0.0.0`. `PORT` defaults to `10000`. Ports 18012, 18013 and 19099 are reserved.
- "Render forwards inbound traffic to only _one_ HTTP port per web service." Extra ports are reachable only over the private network.

**Private network** [28]:
- Web and private services "can use any protocol", with up to 75 open ports, but only within the same region and workspace.
- **Free web services "can _send_ private network requests, but they can't _receive_ them."**
- Public UDP or arbitrary-TCP ingress is not documented. Only the single HTTP(S)/WSS port is public per [26] (Unverified that nothing else exists).

### B2. Free instance (primary focus) and paid compute plans

| Item | Free web service | Source |
|---|---|---|
| CPU / RAM | 0.1 CPU / 512 MB (plan ID `free`) | [31][37] |
| Spin-down trigger | "Render spins down a Free web service that goes 15 minutes without receiving any inbound traffic. This includes both HTTP requests and WebSocket messages from existing connections." | [29] |
| Wake-up / cold start | It spins back up "whenever it next receives an HTTP request or new WebSocket connection. This process takes about one minute." Render shows a loading page to connecting browsers in the meantime | [29] |
| Free instance hours | "Render grants 750 Free instance hours to each workspace per calendar month". Spun-down services consume none; unused hours don't roll over | [29] |
| When hours are exhausted | Render suspends all Free web services until the start of the next month | [29] |
| Bandwidth and build minutes | "Free web services count against your monthly included amounts of outbound bandwidth and build pipeline minutes". Hobby: 5 GB outbound, then $0.15/GB; 500 pipeline minutes, then $5 per 1,000 | [29][30] |
| Over the bandwidth allowance, no payment method | Free services are suspended for the rest of the month | [29] |
| Over the build-minute allowance, no payment method | New builds are disabled for the rest of the month; services keep running | [29] |
| Restarts | "Render might restart a Free web service at any time." | [29] |
| Filesystem | Ephemeral; local changes are lost on redeploy, restart or spin-down | [29] |
| Not available on Free | Persistent disks, scaling beyond one instance, edge caching, one-off jobs, SSH/shell, receiving private-network traffic | [29] |
| Pre-deploy command | "available for paid web services, private services, and background workers", so not on Free | [36][37] |
| Outbound mail ports | Ports 25, 465 and 587 are blocked on Free (25 is blocked for every service) | [29] |
| High-traffic suspension | Render may suspend a Free service that "initiates unusually high traffic", for example calls to external databases or APIs | [29] |
| robots.txt | While spun down, `/robots.txt` gets a disallow-all response and does not wake the service | [29] |
| Previews | Hobby workspaces get single-service previews; full-stack preview environments need Pro | [30] |

**Does an open WebSocket keep a free instance awake?**
- Yes, provided inbound WebSocket messages arrive at least every 15 minutes [29].
- Two points are undocumented (Unverified): whether an idle open socket counts, and whether protocol-level ping/pong control frames count. Send an application-level heartbeat from the client (rec).
- Whether Render's own health checks count as traffic is also not documented (Unverified) [35].
- (calc) A connected player sending input at 30 Hz keeps the service awake, so the service burns instance hours whenever anyone is connected.

**Do two free services (staging + prod) fit?** (calc from [29][30])
- A 30-day month has 720 h and a 31-day month 744 h. One always-awake service uses 720–744 of the 750 h, leaving only 6–30 h for everything else.
- Two services fit only if their combined awake time stays at or under 750 h. For example, production could be awake only while people play, and staging only briefly.
- If the hours run out, **production is suspended too**.
- The Hobby workspace allows 1 workspace and up to 25 services [30].

**Paid compute plans.** Prices are from the Nov 2026 pricing page [30]. Plan IDs come from [31][32]. The plans were renamed on 2026-08-26 and "All compute plans keep their existing pricing". Legacy names still work in Blueprints [31][32].

| Plan ID (legacy name) | CPU | RAM | Price/month |
|---|---|---|---|
| `free` | 0.1 | 512 MB | $0 |
| `0.5c-512mb` (`starter`) | 0.5 | 512 MB | $7 |
| `1c-2g` (`standard`) | 1 | 2 GB | $25 |
| `2c-4g` (`pro`) | 2 | 4 GB | $85 |
| `2c-8g` | 2 | 8 GB | $135 |
| `2c-16g` | 2 | 16 GB | $200 |
| `4c-8g` (`pro_plus`) | 4 | 8 GB | $175 |
| `4c-16g` (`pro_max`) | 4 | 16 GB | $225 |
| `4c-32g` | 4 | 32 GB | $350 |
| `8c-16g` | 8 | 16 GB | $300 |
| `8c-32g` (`pro_ultra`) | 8 | 32 GB | $450 |
| `8c-64g` | 8 | 64 GB | $1,000 |
| `12c-24g` / `12c-48g` / `12c-96g` | 12 | 24 / 48 / 96 GB | $450 / $800 / $1,500 |

- Compute "billing is prorated to the second" [30].
- Workspace plans: Hobby $0 + compute; Pro $25/month + compute; Scale $499/month + compute; Enterprise custom [30]. Details are in B7.
- **Engineering note (rec):** 0.1 CPU is a tenth of one core. Running several 16-player rooms at 30 Hz on a free instance is a real performance risk, so load-test early. The first always-on upgrade is `0.5c-512mb` at $7/month [30].

### B3. Regions and co-location with Aiven

- **Render regions:** Oregon, Ohio, Virginia, Frankfurt, Singapore [34]. Blueprint slugs: `oregon` (default), `ohio`, `virginia`, `frankfurt`, `singapore` [37].
- "Render doesn't currently support changing the region for an existing service or database." [34]
- I found no region restriction for Free services in the pages fetched (Unverified).
- **Aiven side:** free and Developer tiers offer "No choice of cloud provider or specific cloud region", and Aiven "reserves the right to change the cloud provider, region, or configuration" of those services [42].
- **Co-location (rec):** it can't be planned up front.
  1. Create the Aiven service first and read its cloud/region in the console.
  2. Create the Render service in the nearest Render region.
  3. Accept that Aiven may later move the database.

### B4. Health checks, zero-downtime deploys, graceful shutdown

**Health checks** [35]:
- Configured with `healthCheckPath`. HTTP checks are for web services only; other checks are TCP.
- Render probes "every few seconds". A check passes on a 2xx/3xx response within 5 s.
- After 15 s of consecutive failures the instance is removed from routing. After 60 s it is restarted.
- New instances must pass health checks before traffic switches to them. "If this condition is not met within 15 minutes, Render cancels the deploy."

**Deploys and shutdown** [36][37]:
- **Zero-downtime:** "All service types redeploy with zero downtime, unless they attach a persistent disk." [36]
- **Graceful shutdown:**
  - Render sends SIGTERM, then SIGKILL after the shutdown delay.
  - The delay is 30 s by default and can be set up to 300 s with **`maxShutdownDelaySeconds`** (integer 1–300) in render.yaml or the API. It can't be customised for services with a persistent disk [36][37].
  - Whether Free services honour a custom value is not stated (Unverified).
- **Deploy timeouts:** build command 120 min, pre-deploy command 30 min, start command 15 min [36].

**Open WebSockets during deploys:**
- Sockets on the old instance close when it is replaced [25].
- Old and new instances overlap briefly, so both have database pools open at the same time. Size pools for twice the normal count during deploys (rec).
- With a single free instance, every deploy or random restart disconnects every player. In-memory room state is lost unless persisted (rec).

### B5. render.yaml Blueprint spec (Node web service in a monorepo)

- **Spec:** https://render.com/docs/blueprint-spec [37].
- **JSON Schema:** https://render.com/schema/render.yaml.json, also distributed via SchemaStore [37][38].

| Field | Values / default | Notes | Source |
|---|---|---|---|
| `type` | `web` | Required; cannot be changed after creation | [37] |
| `name` | string | Must be unique within the Blueprint | [37] |
| `runtime` | `node` | Replaces the deprecated `env` field | [37] |
| `plan` | `free`, `0.5c-512mb`, … (legacy names such as `starter` still accepted) | **If omitted, a new web service gets `0.5c-512mb`, a paid plan** | [37][31] |
| `region` | `oregon` (default), `ohio`, `virginia`, `frankfurt`, `singapore` | Cannot be changed after creation | [37] |
| `rootDir` | Path; defaults to the repo root | Files outside it are unavailable at build time and at runtime | [37][40] |
| `buildCommand` | string | Required for non-Docker services | [37] |
| `startCommand` | string | Required for most services | [37] |
| `healthCheckPath` | Path starting with `/` | Web services only | [37][35] |
| `envVars` | Entries with `key` plus one of: `value`, `sync: false`, `generateValue: true`, `fromService`; or a `fromGroup` entry | `sync: false` prompts for a value only when the Blueprint is first created; it is ignored on later syncs, omitted from preview environments, and not allowed in environment groups. `generateValue` creates a random base64-encoded 256-bit value. `fromGroup` adds every variable from an environment group | [37] |
| `envVarGroups` | Root-level list of groups, each with `name` and `envVars` | Groups can't reference services or other groups | [37] |
| `autoDeployTrigger` | `commit` (default for new services), `checksPass`, `off` | Takes precedence over the deprecated `autoDeploy` (`true` = `commit`, `false` = `off`). The dashboard labels are "On Commit", "After CI Checks Pass" and "Off" | [37][36] |
| `buildFilter` | `paths`, `ignoredPaths`: glob lists relative to the **repo root** | Ignored paths win over included ones. Changes to the Blueprint YAML are always processed | [37][40] |
| `preDeployCommand` | string | **Paid instances only, not `free`** | [37][36] |
| `numInstances` | integer, default 1 | No effect when autoscaling is enabled. Free cannot scale beyond one instance | [37][29] |
| `scaling` | `minInstances`, `maxInstances`, `targetCPUPercent`, `targetMemoryPercent` | Autoscaling requires a Pro workspace or higher | [37][30] |
| `maxShutdownDelaySeconds` | integer 1–300, default 30 | Not customisable with a persistent disk | [37][36] |
| `previews.generation` | Service level: `manual` / `automatic`; root level also allows `off` | Replaces the deprecated `pullRequestPreviewsEnabled` / `previewsEnabled` | [37] |
| `branch` | If omitted: the Blueprint's own branch when service and Blueprint share a repo; otherwise the repo's default branch | — | [37] |

### B6. Node version, pnpm, build cache, monorepo builds

**Node version** [39]:
- Precedence, highest first: the `NODE_VERSION` environment variable, then `.node-version`, then `.nvmrc`, then `engines.node` in package.json.
- If the root package.json has no version, Render uses "the first `package.json` file it finds in a subdirectory".
- Accepted formats are a semver version or an alias such as `lts`. "Always include an upper bound in your version range."
- The default for services created on or after 2026-10-21 is **24.22.1**.

**pnpm and Corepack:**
- No Render docs page I fetched describes pnpm or Corepack detection (Unverified).
- A Render article recommends pinning pnpm with the `packageManager` field. It also notes that "Node.js 25 and later no longer bundle Corepack by default" [41] (summary). Render's default, Node 24, is therefore unaffected (calc).
- `pnpm install` appears among Render's example build commands [36] (summary).

**Monorepo builds** [40]:
- `rootDir` scopes all commands, and "Files outside your service's root directory are not available to the service at build time or at runtime."
- Build-filter globs are relative to the repo root.
- (rec) For a pnpm workspace, leave `rootDir` at the repo root, use a workspace-filtered build, and set `buildFilter.paths` to cover the server and shared packages.

**Build cache:** behaviour not verified in this session (Unverified).

### B7. Previews/staging, static outbound IPs, bandwidth, logs, metrics

Workspace plans, from the pricing page [30]:

| Feature | Hobby ($0) | Pro ($25/mo) | Scale ($499/mo) |
|---|---|---|---|
| Max services | 25 | Unlimited | Unlimited |
| Team seats / workspaces | 1 / 1 | Unlimited / 1 | Unlimited / Unlimited |
| Outbound bandwidth | 5 GB/mo, then $0.15/GB | 25 GB/mo, then $0.15/GB | 1 TB/mo, then $0.15/GB |
| Standard build pipeline | 500 min/mo, then $5 per 1,000 | 1,000 min/mo, then $5 per 1,000 | 5,000 min/mo, then $5 per 1,000 |
| Previews | Single-service previews | Adds full-stack preview environments | Same as Pro |
| Environments per project | 2 | Unlimited | Unlimited |
| Horizontal autoscaling | No | Yes | Yes |
| Dedicated (static outbound) IPs | Not available | $100/mo per IP set | $100/mo per IP set |
| Custom domains included | 2, then $0.25 per domain per month | 15 | 25 |
| Log retention | 7 days | 14 days | 30 days |
| HTTP request logs | No | Yes | Yes |
| Rollback history | 5 builds | 15 builds | 30 builds |

- **Metrics retention:** "Extended metrics retention" is a Scale feature [30]. Day counts for Hobby and Pro appeared only in a search summary (7 and 14 days) (Unverified).
- **Default outbound IPs:** "Outbound IP ranges are shared across _all_ services in the same region". Find them under the service's Connect → Outbound tab. A service "might use any IP address within its associated ranges" [33].
- **Preview URLs on Render:** single-service previews are available on Hobby [30]. Whether a preview of a free service is allowed, or consumes free hours, is not documented (Unverified).

**Bandwidth estimate for the game** (calc; assumptions are mine):
- Server-to-client traffic per full room ≈ 16 players × 30 snapshots/s × S bytes per snapshot.
- At S = 100 B that is 48 KB/s, about 173 MB per hour. At S = 200 B it is about 346 MB per hour. WebSocket framing and TLS overhead come on top.
- Hobby's 5 GB therefore covers roughly **14–29 full-room-hours per month** [30].
- This assumes WebSocket egress counts as outbound bandwidth. That is likely but not explicitly stated (Unverified).
- Mitigations (rec): delta-compressed or quantised snapshots, a network send rate lower than the 30 Hz simulation, and interest management (only sending each player what's near them).

---

## C. Aiven for MySQL

### C1. Free plan status, specs, cheapest paid plans

**The MySQL free tier is retired** [43][42]:
- "The MySQL Free tier is retired. You can no longer create new MySQL services on the free plan. Need MySQL? The Developer plan gives you the same managed MySQL, always on, for $5/month." [43]
- FAQ: "Is there still a free MySQL database on Aiven? No. New MySQL services can no longer be created on the free plan." [43]
- The docs' Free tier list now names only Apache Kafka, OpenSearch, PostgreSQL and Valkey (page last updated 2026-11-06) [42].
- Not stated anywhere I looked (all Unverified) [42][43]:
  - the retirement date;
  - what happens to free MySQL services that already exist;
  - any cap on the number of free services.

**Rules for the remaining free services** [42]:
- "You don't need a credit card to create a free service and you can use them indefinitely free of charge."
- Aiven may "Power off free services with no initial usage within the first few hours after the service is running".
- Aiven may also "Power off free services with no continuative activity on the service. A notification is sent before the service is powered off."
- You "can power them back on at any time". The idle threshold in days is not stated.
- Aiven may also "Change the cloud provider, region, or configuration at any time."

**MySQL options, November 2026:**

| Option | Price | CPU / RAM / storage | Behaviour | Limits | Source |
|---|---|---|---|---|---|
| MySQL Free | n/a | n/a | **Retired for new services** | n/a | [43] |
| **MySQL Developer** | **$5/month** | 1 CPU / 1 GB / 8 GB on a dedicated VM ("up to 8 GB" in the docs); single node | Always on: "not automatically powered off when inactive". "Daily backup to a remote location". Basic ticket support | No choice of cloud or region; no VPC; no static IPs; no integrations; no forking. No high availability or uptime SLA ("built for development, testing and personal projects") | [43][42] |
| PostgreSQL Free (the only $0 database) | $0 | 1 CPU / 1 GB / 1 GB | "Powers off when idle"; documentation-only support | "No integrations or connection pooling"; cannot select cloud or region | [43][44] |
| Hobbyist / Startup | "starting from $12 / month" / "starting from $75 / month" in the server-rendered pricing table, which is labelled PostgreSQL | n/a | n/a | MySQL-specific prices could not be isolated (Unverified) | [44] |

- **MySQL major version** on Developer: not stated (Unverified).
- **Backups:** Developer includes them [43][42].
- **Several logical databases in one service** (e.g. separate staging and prod databases): not verified (Unverified). Check this in the Aiven console before planning around it.

### C2. SSL/TLS, CA certificate, connection fields

- "All traffic to Aiven services is always protected by TLS." [46]
- "Aiven for MySQL® requires the Aiven project CA certificate to connect when using `VERIFY_CA` or `VERIFY_IDENTITY` as the SSL mode." [46]
- "Every Aiven project has its own private Certificate Authority (CA)" shared by all of the project's services [46].
- **CA download:** service **Overview** → **Connection information** → **CA Certificate** → **Download**. The CLI alternative is `avn service user-creds-download` [46].
- **Contradiction:** a search summary of Aiven's Cloud security page says MySQL does not enforce TLS server-side unless users are set to require SSL [49] (summary). I did not fetch that page.
  - (rec) Always connect with TLS and verify both the CA and the hostname.
- **Console field labels, default database name, Service URI format and its `ssl-mode` value** are **Unverified**. The Node.js how-to URL I tried returned 404.
- **Supplying the CA to mysql2 on Render (rec):**
  - The CA is a public certificate, not a secret. It can ship as a file in the repo, or its PEM text can be supplied through an environment variable or a Render secret file.
  - Render lists "Environment variables & secret files" as a feature [30]; the secret-file mount path is Unverified.
  - Database passwords must only ever live in Render/Vercel environment settings, never in the repo.

### C3. Connection limits and pooling

- Formulas [47]:
  - below 4 GiB: "max_connections = 75 × RAM + extra_connection";
  - at 4 GiB or more: "100 × RAM + extra_connection";
  - `extra_connection` is 1, reserved for the system process.
- "`max_connections` isn't a configurable advanced parameter in Aiven for MySQL"; to get more connections you need a plan with more RAM [47].
- **1 GB plan:** about **76** connections (calc).
  - Whether the MySQL Developer tier caps this lower is not stated (Unverified). The PostgreSQL Developer tier is documented with `max_connections` 20 [42].
- **Pooling:**
  - No server-side connection pooler for MySQL is documented [47].
  - The Free/Developer pricing cards say "No integrations or connection pooling" [44].
  - A changelog entry dated 2026-11-05 about new configurable connection-limit parameters was seen only in a search summary [51] (summary).
- **Recommended application pool (rec):**
  - Use 5–10 connections per Render instance.
  - Double that for the zero-downtime overlap during deploys [36].
  - Add headroom for staging, migrations and admin tools. The total stays well under about 76.

### C4. MySQL settings that affect migrations; IP allowlisting

- **`sql_require_primary_key`:**
  - Docs: "Require primary key to be defined for new tables or old tables modified with ALTER TABLE and fail if missing." [48]
  - The **default is not stated** on the advanced-parameters page, which was last updated 2024-10-16 [48].
  - An Aiven help article describes disabling it per session or through advanced configuration [50] (summary), which implies it is normally on (Unverified).
  - (rec) Give every table a primary key, including any bookkeeping tables created by the migration tool.
- **`sql_mode`:** when unset, "Aiven default SQL mode (strict, SQL standard compliant) will be assigned" [48].
- **Character set:** `mysql.collation_server` defaults to `utf8mb4_0900_ai_ci`, and "Only collations of the utf8mb4 character set are accepted." [48]
- **Time zone:** `default_time_zone` accepts a UTC offset, a zone name or `SYSTEM`. Its default is not stated (Unverified) [48].
  - (rec) Store UTC and set the session time zone explicitly.
- **Other defaults:**
  - `innodb_lock_wait_timeout` 120 s and `max_allowed_packet` 64 MB [48].
  - `wait_timeout` and `interactive_timeout` defaults are not stated [48]. (rec) Configure the pool to recover from server-closed idle connections.
- **IP allowlist ("IP filter")** [45]:
  - Default is `0.0.0.0/0`, which allows every connection.
  - Entries are in CIDR notation, set under Service settings → Cloud and network → Set/Edit IP address allowlist.
  - Warning: "If you remove `0.0.0.0/0` without adding networks or addresses used by clients, no client can connect to your service."
  - Availability on Free/Developer tiers and the maximum number of entries are not stated.
- **Implications (rec):**
  - Render's outbound addresses are regional ranges shared with every Render customer in that region [33]. Allowlisting them narrows exposure but does not isolate you.
  - Render's Dedicated IPs are paid and not available on Hobby [30].
  - GitHub-hosted runners have no fixed IPs (Unverified for 2026), so migrations run from CI need the filter left open or a different migration path.
  - Either way, rely on TLS with CA verification plus a strong generated password.

---

## D. GitHub Actions

- **Public repos:** "The use of standard GitHub-hosted runners is free … In public repositories" [52].
- **Private repos on GitHub Free** (personal accounts and Free organizations) [52]:
  - "$12 USD" per month of included compute, plus 500 MB of artifact storage.
  - At Linux 2-core x64's "$0.006 USD per minute", that is about 2,000 minutes (calc). Linux 1-core costs $0.002/min.
  - Without a payment method, "usage is blocked once you consume the included compute usage".
- **`ubuntu-latest`:**
  - It maps to Ubuntu 24.04 x64 per the actions/runner-images README [53] (summary).
  - The 2026-10-26 image release runs 24.04.5 LTS [54] (summary).
  - Moves of the `-latest` label roll out over 1–2 months, and an Ubuntu 26.04 image exists as a pre-release [53] (summary).
  - (rec) Pin `ubuntu-24.04` for stability.
- **actionlint:** not confirmed as preinstalled on GitHub-hosted images (Unverified). (rec) Install and run it as an explicit workflow step, or locally.

---

## E. Free vs paid recommendation and gotchas

### E1. Recommendation table (monthly)

| Environment | Vercel | Render | Aiven database | GitHub | Monthly cost |
|---|---|---|---|---|---|
| **Dev (local)** | Not needed; run the Vite dev server locally | Not needed; run Node locally | Local MySQL, or a separate database on the shared Aiven service (Unverified whether allowed) | Free | **$0** |
| **Staging ($0)** | Hobby preview deployments using the stable branch URL [21] | A second Free web service only if combined awake hours stay at or under 750/month [29]; otherwise deploy staging only occasionally | Same Aiven service with a separate database and user (Unverified) | Free | **$0** |
| **Production, strict $0** | Hobby, non-commercial use only [6] | Free: sleeps after 15 min, ~1 min wake-up, 5 GB/month egress on Hobby [29][30] | **No free MySQL exists.** Options: Aiven free PostgreSQL (means switching engine) [43], or a pre-existing free MySQL service whose future is undocumented | Public repo | **$0** |
| **Production, minimal spend keeping MySQL (rec)** | Hobby | Free | **MySQL Developer, $5** [43] | Public repo | **$5** |
| **Production, always-on server (rec if cold starts hurt)** | Hobby; Pro ($20) if the game is monetised in any way [6][8] | `0.5c-512mb` at $7 [30], plus Hobby bandwidth (5 GB, then $0.15/GB) | MySQL Developer, $5 | Public repo | **$12** (+$20 if commercial) |

### E2. Setup order (rec, derived from the facts above)

1. **Decide the database path:** MySQL Developer at $5/month, free PostgreSQL, or an existing free MySQL service [43].
2. **Create the Aiven service.** Note the cloud/region Aiven assigns [42], download the project CA [46], create an application user, and decide on the IP filter [45].
3. **Create the Render service from the Blueprint** [37]:
   - set `plan: free` explicitly, and choose the `region` nearest the database;
   - keep `rootDir` at the repo root, and set `buildFilter`, `healthCheckPath` and `autoDeployTrigger`;
   - use `sync: false` for secrets.
4. **Create the Vercel project** [15][16][10]:
   - Root Directory = the client app folder, with "Include files outside the root directory" left on;
   - Node 24.x, and `ENABLE_EXPERIMENTAL_COREPACK=1` if pinning pnpm;
   - per-environment `VITE_` variables for the Render HTTPS and WSS origins;
   - vercel.json with the immutable-asset headers and the SPA rewrite.
5. **Configure the server's CORS and WebSocket origin allowlist** for the production domain and the chosen preview URL pattern [21].
6. **GitHub Actions:** use a public repo (free) on `ubuntu-24.04` [52][53].

### E3. Gotchas

1. **Aiven free MySQL is gone.** Resolve the database decision before writing `.env.example` or migrations [43].
2. **Omitting `plan:` in render.yaml creates a paid `0.5c-512mb` service.** Always write `plan: free` [37].
3. **The 750 free hours are per workspace.** Two always-awake services exhaust them, and then **every** free service is suspended until next month [29].
4. **Connected players keep the free instance awake,** because inbound WebSocket messages count [29]. That's good for uptime and bad for the hours budget.
5. **Cold start takes about 1 minute,** and browsers see a loading page [29]. Expect the first API call or WebSocket handshake to stall or fail. (rec) Show a "waking server" state and retry with backoff [25].
6. **Every deploy, and any random restart, drops all sockets** on the single free instance [25][29]. Handle SIGTERM within 30 s [36] and persist room state.
7. **There is no `preDeployCommand` on Free** [36]. Run migrations another way: as a start-up step or manually (rec).
8. **Render's `rootDir` hides sibling workspace packages** [40]. Vercel is the opposite: by default it includes files outside the Root Directory [15].
9. **Render region is immutable** [34], and Aiven's free/Developer tiers neither let you pick a region nor promise it won't change [42]. Create the database first.
10. **5 GB/month of Render egress on Hobby is tight** for 16 players at 30 Hz (calc) [30]. Exceeding it without a card suspends the free services [29].
11. **Render outbound IPs are shared regional ranges.** Dedicated IPs are paid and not on Hobby [33][30]. Aiven's IP filter is open by default [45].
12. **Vercel Hobby rules:** non-commercial only, and ads count [6]. Hobby projects can't connect to repos owned by a GitHub organization [5]. Exceeding a Hobby limit can pause that feature for 30 days [9].
13. **Vercel preview URLs change with every commit.** The Render CORS/WebSocket origin allowlist must accept the branch-URL pattern or a fixed staging origin (rec) [21]. Deployment Protection, if enabled, also gates previews for testers [24].
14. **Vercel environment changes need a redeploy,** and `VITE_` values are baked into the public bundle [20][19].
15. **Vercel's default `Cache-Control` for static files is `max-age=0, must-revalidate`** [12]. Add immutable caching for hashed assets only. The SPA rewrite never shadows real files, because the filesystem takes precedence [10].
16. **Node defaults differ:** Vercel 26.x vs Render 24.22.1 [16][39]. Pin 24.x on both via `engines` and `.node-version`. On Vercel, Corepack needs `ENABLE_EXPERIMENTAL_COREPACK=1` [15], and Corepack is not bundled with Node 25+ [41] (summary).
17. **About 76 MySQL connections on a 1 GB plan** (calc) [47], with no MySQL pooler [44]. Deploy overlap doubles the pools [36].
18. **Render may suspend Free services that generate "unusually high traffic"** to external databases or APIs [29]. Batch database writes such as saves and leaderboards (rec).

---

## Contradictions & uncertainty

- **Vercel WebSocket status:**
  - The KB, updated 2026-10-01, still says "public beta" [2].
  - The changelog dated 2026-10-20 says "generally available" [3].
  - The docs page (2026-08-10) only says "available on all plans" [1].
  - Render's comparison page calls Vercel's support "beta" [27].
  - The maximum-duration limits are the same everywhere [1][2][4].
- **Vercel Node versions page:** its metadata says "last_updated 2026-02-27", yet it lists 26.x as the default [16]. The metadata is probably stale.
- **Vercel pnpm mapping:** the package-manager table maps `lockfileVersion` 7.0 to pnpm 9, and lists pnpm 11 and 12 as supported without any lockfile mapping [18]. Pin with Corepack if the exact pnpm version matters.
- **Vercel immutable max-age:** the vercel.json example uses 31556952 s [10]; the Cache-Control recommendation uses 31536000 s [12].
- **Vercel CI:** the pricing page lists "200 CPU minutes/month of Vercel CI" on Hobby [7]. How it relates to ordinary build limits is not explained.
- **Render plan naming:** the pricing page says "Pro", while its FAQ says "Professional plan or higher" [30].
- **Render's 100-minute HTTP limit** comes from a comparison docs page, not a dedicated limits page [27].
- **Render Dedicated IPs:** the outbound-IP docs give no price; the pricing page shows $100/month per IP set on Pro and Scale, and not available on Hobby [33][30].
- **Render metrics retention** day counts were seen only in a search summary (Unverified).
- **Undocumented Render behaviours (Unverified):**
  - whether health checks or WebSocket ping/pong frames count as activity for spin-down [29][35];
  - whether `maxShutdownDelaySeconds` applies to Free instances [36];
  - whether previews of a free service are allowed, and whether they consume free hours;
  - pnpm/Corepack auto-detection (only an article, seen as a search summary) [41].
- **Aiven retirement:** the retirement date and the handling of existing free MySQL services are not documented [42][43].
- **Aiven pricing page:**
  - The server-rendered HTML for `?product=mysql` showed a "Free $0 / month" card and a table explicitly labelled PostgreSQL. This is most likely the default PostgreSQL view, so MySQL Hobbyist/Startup prices are Unverified [44].
  - The same HTML lists Frankfurt, London, Amsterdam, Sydney, New York and San Francisco next to the Free/Developer cards, while the cards say "Cannot select a specific cloud or region". What that list means is unclear [44].
- **Aiven TLS enforcement:** "always protected by TLS" [46] versus "MySQL doesn't enforce TLS" [49] (summary).
- **Aiven `sql_require_primary_key` default** is not stated, and the reference page dates from 2024 [48].
- **Aiven Developer-tier `max_connections`** may differ from the RAM formula [42][47].
- **Aiven connection-limit changelog** (2026-11-05) was seen only in a summary [51].
- **GitHub:** the included allowance is now expressed in dollars ($12); the minute figure is my arithmetic [52]. The `ubuntu-latest` mapping comes from search summaries of the runner-images repo [53][54].

---

## Sources

All accessed 2026-11-11.

1. Vercel Docs: "WebSockets" — https://vercel.com/docs/functions/websockets — accessed 2026-11-11
2. Vercel KB: "Do Vercel Functions support WebSocket connections?" — https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections — accessed 2026-11-11
3. Vercel Changelog: "WebSocket support is now generally available" (2026-10-20) — https://vercel.com/changelog/websocket-support-is-now-generally-available — accessed 2026-11-11
4. Vercel Docs: "Vercel Functions Limits" — https://vercel.com/docs/functions/limitations — accessed 2026-11-11
5. Vercel Docs: "Limits" — https://vercel.com/docs/limits — accessed 2026-11-11
6. Vercel Docs: "Fair Use Guidelines" — https://vercel.com/docs/limits/fair-use-guidelines — accessed 2026-11-11
7. Vercel: "Pricing" — https://vercel.com/pricing — accessed 2026-11-11
8. Vercel Docs: "Vercel Pro Plan" — https://vercel.com/docs/plans/pro-plan — accessed 2026-11-11
9. Vercel Docs: "Vercel Hobby Plan" — https://vercel.com/docs/plans/hobby — accessed 2026-11-11
10. Vercel Docs: "Static Configuration with vercel.json" — https://vercel.com/docs/project-configuration/vercel-json — accessed 2026-11-11
11. Vercel Docs: "Vercel CDN Compression" — https://vercel.com/docs/how-vercel-cdn-works/compression — accessed 2026-11-11
12. Vercel Docs: "Cache-Control headers" — https://vercel.com/docs/caching/cache-control-headers — accessed 2026-11-11
13. Vercel Docs: "Vercel CDN Cache" — https://vercel.com/docs/caching/cdn-cache — accessed 2026-11-11
14. Vercel Docs: "Using Monorepos" — https://vercel.com/docs/monorepos — accessed 2026-11-11
15. Vercel Docs: "Configuring a Build" — https://vercel.com/docs/builds/configure-a-build — accessed 2026-11-11
16. Vercel Docs: "Supported Node.js versions" — https://vercel.com/docs/functions/runtimes/node-js/node-js-versions — accessed 2026-11-11
17. Vercel Changelog: "Node.js 20 is being deprecated on October 1, 2026" — https://vercel.com/changelog/node-js-20-is-being-deprecated — accessed 2026-11-11
18. Vercel Docs: "Package Managers" — https://vercel.com/docs/package-managers — accessed 2026-11-11
19. Vercel Docs: "Vite on Vercel" — https://vercel.com/docs/frameworks/frontend/vite — accessed 2026-11-11
20. Vercel Docs: "Environment variables" — https://vercel.com/docs/environment-variables — accessed 2026-11-11
21. Vercel Docs: "Accessing Deployments through Generated URLs" — https://vercel.com/docs/deployments/generated-urls — accessed 2026-11-11
22. Vercel Docs: "Git settings" — https://vercel.com/docs/project-configuration/git-settings — accessed 2026-11-11
23. Vercel Docs: "Deploying Turborepo to Vercel" — https://vercel.com/docs/monorepos/turborepo — accessed 2026-11-11
24. Vercel Docs: "Deployment Protection on Vercel" — https://vercel.com/docs/deployment-protection — accessed 2026-11-11
25. Render Docs: "WebSockets on Render" — https://render.com/docs/websocket — accessed 2026-11-11
26. Render Docs: "Web Services" — https://render.com/docs/web-services — accessed 2026-11-11
27. Render Docs: "Render vs Vercel" — https://render.com/docs/render-vs-vercel-comparison — accessed 2026-11-11
28. Render Docs: "Private Network" — https://render.com/docs/private-network — accessed 2026-11-11
29. Render Docs: "Deploy for Free" — https://render.com/docs/free — accessed 2026-11-11 (direct fetch plus raw-HTML text check)
30. Render: "Pricing" — https://render.com/pricing — accessed 2026-11-11 (figures read from the server-rendered HTML text; the page renders client-side)
31. Render Docs: "Render Compute Plans" — https://render.com/docs/compute-plans — accessed 2026-11-11
32. Render Docs: "Updates to Render Compute Plans" — https://render.com/docs/compute-plans-update — accessed 2026-11-11
33. Render Docs: outbound IP addresses page — https://render.com/docs/outbound-ip-addresses — accessed 2026-11-11
34. Render Docs: "Regions" — https://render.com/docs/regions — accessed 2026-11-11
35. Render Docs: "Health Checks" — https://render.com/docs/health-checks — accessed 2026-11-11
36. Render Docs: "Deploying on Render" — https://render.com/docs/deploys — accessed 2026-11-11
37. Render Docs: Blueprint YAML reference — https://render.com/docs/blueprint-spec — accessed 2026-11-11 (direct fetch plus raw-HTML check of field names)
38. Render: render.yaml JSON Schema — https://render.com/schema/render.yaml.json — accessed 2026-11-11 (URL found inside [37]; the schema file itself was not opened)
39. Render Docs: Node.js version page — https://render.com/docs/node-version — accessed 2026-11-11
40. Render Docs: "Monorepo Support" — https://render.com/docs/monorepo-support — accessed 2026-11-11
41. Render Articles: "Pinning Node.js, Python & Ruby Versions for Reproducible Builds" — https://render.com/articles/pinning-nodejs-python-ruby-versions — accessed 2026-11-11 (search-result summary only; page not opened)
42. Aiven Docs: platform concept page "free-plan" (Free tier, Developer tier, custom plans, trials; last updated 2026-11-06) — https://aiven.io/docs/platform/concepts/free-plan — accessed 2026-11-11
43. Aiven: free MySQL database page ("The MySQL Free tier is retired") — https://aiven.io/free-mysql-database — accessed 2026-11-11
44. Aiven: "Plans & Pricing" — https://aiven.io/pricing?product=mysql — accessed 2026-11-11 (server-rendered HTML text; the visible table was labelled PostgreSQL)
45. Aiven Docs: restrict-access how-to (IP filter; last updated 2025-03-12) — https://aiven.io/docs/platform/howto/restrict-access — accessed 2026-11-11
46. Aiven Docs: "TLS/SSL certificates" (last updated 2026-10-29) — https://aiven.io/docs/platform/concepts/tls-ssl-certificates — accessed 2026-11-11
47. Aiven Docs: "MySQL max_connections" (last updated 2026-09-08) — https://aiven.io/docs/products/mysql/concepts/max-number-of-connections — accessed 2026-11-11
48. Aiven Docs: "Advanced parameters for Aiven for MySQL" (last updated 2024-10-16) — https://aiven.io/docs/products/mysql/reference/advanced-params — accessed 2026-11-11
49. Aiven Docs: "Cloud security" — https://aiven.io/docs/platform/concepts/cloud-security — accessed 2026-11-11 (search-result summary only; page not opened)
50. Aiven Help: "Create new tables without primary keys" — https://help.aiven.io/en/articles/3633453-mysql-replication-recovery-and-primary-keys — accessed 2026-11-11 (search-result summary only)
51. Aiven: product changelog — https://aiven.io/changelog — accessed 2026-11-11 (search-result summary only)
52. GitHub Docs: GitHub Actions billing — https://docs.github.com/en/billing/concepts/product-billing/github-actions — accessed 2026-11-11
53. GitHub: actions/runner-images README — https://github.com/actions/runner-images — accessed 2026-11-11 (search-result summary only)
54. GitHub: actions/runner-images release "Ubuntu 24.04 (20261026) Image Update" — https://github.com/actions/runner-images/releases/tag/ubuntu24/20261026.354 — accessed 2026-11-11 (search-result summary only)
