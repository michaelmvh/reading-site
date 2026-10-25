# Reading site

The independent reader application for **reading.michaelmvh.com**. This repository owns
reader UX, TypeScript rendering, RSS, browser interactions, styles, icons, and GitHub Pages
deployment. The existing `michaelmvh.github.io` portfolio is a separate site and build.

The NAS runs the Rust collector in
[scholarly-rss-feed](https://github.com/michaelmvh/scholarly-rss-feed), then commits **JSON
only** into `data/`. It does not generate or commit the reader's HTML or RSS. A source or
data push causes GitHub Actions to build this repository into an ignored `dist/` directory
and deploy that artifact. UI-only updates need neither the NAS nor provider API access.

## Status and deployment guard

The implementation is staged in PRs; no production data is bundled here. Missing `data/`
is allowed during bootstrap but cannot deploy. A present, incomplete data directory fails.
Production publication requires `PAGES_DEPLOY_ENABLED=true`, a main-branch build, and a
validated real snapshot. PRs validate/build synthetic examples without deploying them.
Synthetic fixture output must never be mistaken for the production data gate.
Reader and monitoring work is consolidated in [PR #1](https://github.com/michaelmvh/reading-site/pull/1),
paired with [collector/publisher PR #2](https://github.com/michaelmvh/scholarly-rss-feed/pull/2).

## Sources of truth

| Path | Responsibility |
| --- | --- |
| `schema/snapshot-v1.json` | Versioned public JSON contract |
| `data/snapshot.json` | NAS collection timestamp, named feeds, author associations, and checksummed shard manifest |
| `data/articles/<bucket>.json` | Canonical retained records, with stable IDs and provider identity aliases |
| `src/data-model.ts` | Typed data contracts and source-key mapping |
| `src/client/` | Strict TypeScript browser filters and navigation |
| `src/assets/` | Reader styling and its SVG/Apple touch icons |
| `scripts/data.ts`, `validate-data.ts` | Schema, file, identity, association, checksum, and transition validation |
| `scripts/render.ts`, `build.ts` | Static HTML/RSS generation |
| `scripts/validate-site.ts` | Generated-file, URL, RSS, and freshness checks |
| `scripts/monitor.ts` | Independent published-data staleness monitor |
| `dist/` | Generated deployment artifact; never edit or commit |

The schema rejects unknown fields, malformed dates, invalid references, and non-HTTP(S)
article links. The loader rejects symlinks/hardlinks, unexpected files, mixed/checksum-invalid
shards, duplicate identities, and inconsistent feed membership. Each data file is bounded
at 50 MiB and a complete snapshot/site at 500 MiB.

`PREVIOUS_DATA` adds monotonic timestamp, retained-article, and coverage checks. Removed
feeds or a count drop greater than 40% require the deliberate one-run
`ALLOW_FEED_SHRINK=true` override. It does not allow losing retained article identities.
Archive removal or schema migration needs an explicit reviewed procedure.

When discovery bridges previously separate article versions, the collector keeps one
canonical record and retains the other IDs as aliases with `canonical_id` and empty
`identity_keys`. Aliases must point directly to an existing canonical record; feeds use
only canonical IDs. Old article URLs render the canonical content without JavaScript.
Deploy this reader support before publishing collector data containing aliases.

The collector determines discovery/identity associations. The reader does not infer
provider matches from author names. Publication-date precision is explicit when known;
`unknown` is not guessed from an apparent January 1 or first-of-month value.

## Local work

Use Node.js 24 or newer:

```sh
npm ci
npm run check
npm test
npm run build:fixture
npx playwright install chromium
npm run test:browser
```

`build:fixture` creates `.fixture-data/`, then builds synthetic reader pages for
`http://127.0.0.1:8080/`. These are examples, not real collected papers. Playwright starts
and stops its own local static server. For a manual preview after building:

```sh
node scripts/serve.ts
```

`test:browser` includes axe accessibility audits, so accessibility violations fail the
existing CI validation job before deployment. To run only these audits after
`build:fixture`, use `npm run test:a11y`. They check WCAG 2.0/2.1 A/AA, WCAG 2.2 AA,
and axe best-practice rules on mobile and desktop listings, article pages, the not-found
page, expanded filters, empty/error states, and essential content with reader scripts blocked.
Failures attach the full axe results to Playwright's test output, retained by CI for
seven days. These automated checks
complement the keyboard/focus browser tests; they do not establish WCAG conformance or
replace manual keyboard and screen-reader review.

To build actual collector output without modifying the repository's committed `data/`:

```sh
DATA_DIR=/path/to/collector-output \
SITE_URL=https://michaelmvh.com/reading-site/ npm run build
```

`build` replaces only the repository's generated `dist/`, compiles the browser TypeScript,
and validates the output. It does not fetch provider APIs or contact the NAS. The same JSON
can be rebuilt for the production subdomain by changing `SITE_URL`; no recollection is needed.
To validate a snapshot alone, including inside the NAS publisher:

```sh
node scripts/validate-data.ts /path/to/candidate-data
PREVIOUS_DATA=/path/to/previous-data node scripts/validate-data.ts /path/to/candidate-data
```

Runtime validation dependencies are regular dependencies. The NAS can use
`npm ci --omit=dev --ignore-scripts`; it needs neither TypeScript compilation nor Playwright.

## Reader behavior

The reader retains its warm off-white styling, green accents, distinct icons, and complete
pre-rendered listings/article pages. JavaScript enhances local filtering and URL state;
it is not needed for essential content, article previews, navigation, or subscriptions.
The browser makes no NAS/provider requests.

Default author selection excludes optional-only tracked-author papers but includes papers
with no tracked author. All-author mode includes every paper; an explicitly empty custom
selection shows none. Sources use OR membership and combine with date/author filters.
Only sources actually collected for the named feed are offered.

The original date, tracked-author, and grouped paper-source controls filter automatically.
The author dropdown includes an all-authors checkbox; feeds without tracked authors omit
that control. Dropdowns close on outside clicks, Escape, or focus leaving the dropdown.
Clear filters restores configured defaults. A compact, borderless collection dropdown in
the header links the main list and collected protein nanopore/design feeds without
requiring JavaScript. Public collections are listed in `scripts/render.ts`; absent feeds
are omitted. The full headline keeps its original width, without a separate sticky bar.
With JavaScript, switching collections restores each collection's filters and scroll
position within the current tab; explicit URLs and browser history retain their behavior.
Internal pilot/archive collections remain available only at their direct URLs. Article return links,
author highlighting, and RSS links preserve the originating feed when JavaScript is enabled.
Listings, article previews, and RSS identify preprint and curated discovery sources. Papers
without a tracked-author match in the current feed also identify their catalog sources
(OpenAlex or Google Scholar). Shared article pages preserve that feed-specific distinction;
tracked-author highlighting remains the explanation for author-matched catalog papers.

RSS is built from the same JSON, including optional authors regardless of browser filters.
`/feed.xml` aliases the default named feed; `/feeds/<name>/feed.xml` publishes each named
feed. Article links use `/article/<stable-id>/`. Old `?rss` URLs have no compatibility layer.
RSS GUIDs are stable, and collection-added dates are not publication dates.

The full article archive stays in the data repository paths, but is not copied into the
browser's initial payload or the deployed artifact. Per-feed metadata needed by filters is
embedded in that feed's HTML. PDFs and full papers remain at their original providers.

## Hosting and operator gates

`michaelmvh.com` stays with `michaelmvh.github.io`. `reading-site` is an independent GitHub
Pages project. Before assigning its own domain, its preview is
`https://michaelmvh.com/reading-site/`.

The Actions repository variable **`READER_SITE_URL`** controls the build URL; its default is
that preview address. For cutover, set it to `https://reading.michaelmvh.com/` and manually
rebuild. Do not set `SITE_URL` in the NAS publisher. Register/verify the reader custom domain
in Pages, change only the `reading` CNAME to `michaelmvh.github.io` with DNS-only routing,
and verify HTTPS. Allow for propagation/certificate delays and preserve rollback settings.

Cloudflare may remain the DNS provider, but its proxy, tunnel, Pages, and Workers are not
needed to host this reader. Leave portfolio/mail DNS and unrelated tunnels alone.

Use the collector repository's current DSM runbook for the container. Its fine-grained token
needs Contents read/write and Actions read on this repository. It commits only `data/`;
that is a publisher safeguard, not a path-scoped GitHub permission. Keep credentials out
of both repositories and build artifacts.

Required before production: reviewed PR merges, a published collector image, private keys,
a complete real-data export, NAS mount/scheduler rehearsal, preview acceptance, then approved
domain cutover. No workflow here obtains provider keys or turns on publishing automatically.

## Freshness and rollback

`status.json` publishes `data_generated_at` and `data_digest` from the NAS snapshot separately
from `built_at` and `reader_revision`. UI-only rebuilds cannot make old data look fresh.
The RSS channel build date also uses collection time, not UI deployment time.

The independent **Monitor reading snapshot** workflow runs every six hours only after
`STATUS_MONITOR_ENABLED=true`. Set `STATUS_URL` to the preview's `/status.json`, then the
final hostname after cutover. `MAX_SNAPSHOT_AGE_HOURS` defaults to 48. The monitor checks
`data_generated_at`, not `built_at`, and detects invalid/HTML responses, bad counts, future
timestamps, and stale data. It does not claim upstream catalogs are complete.

Configure GitHub Actions failure notifications and verify their delivery. Scheduled jobs
can be delayed/disabled by GitHub and are not an uptime SLA. A powered-off NAS cannot
suppress this independent check.

For a UI regression, restore reader source and rebuild with compatible current data.
For bad data, restore a known-good snapshot and rebuild. Failed builds/deployments retain
the last successful site. Keep schema/data/build revisions together when planning rollback.
