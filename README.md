# Reading site publishing

Public, generated scholarly reader output for **reading.michaelmvh.com**. Application code,
templates, icons, discovery, and tests belong in
[scholarly-rss-feed](https://github.com/michaelmvh/scholarly-rss-feed).
This repository owns only publication validation and GitHub Pages deployment.

## Current status

Infrastructure only: there is no production snapshot yet. DNS and the existing NAS service
are unchanged. Deployment requires both a validated `site/` snapshot and the explicit
repository variable `PAGES_DEPLOY_ENABLED=true`; it is disabled by default.

## Publishing contract

The NAS exports into a fresh staging directory, validates it, then replaces only `site/` in
this checkout and pushes one complete snapshot commit. It must preserve `.github/`, scripts,
and repository metadata. Restore the previous `site/` archive into the exporter's `--previous`
input to retain already published article pages and identities.

Only allowlisted public files may enter `site/`. Never copy `.env`, provider caches,
credentials, logs, or source configuration. The validator rejects symlinks, hardlinks,
unexpected files, incomplete snapshots, unsafe/broken HTML links, invalid RSS, mismatched
counts/identities, and sites over 500 MiB. It never fetches third-party URLs.

Using Node.js 24 or newer:

```sh
npm ci
npm run check
npm test
node scripts/validate.ts /path/to/staged-output
PREVIOUS_SITE=/path/to/previous-output node scripts/validate.ts /path/to/staged-output
```

`PREVIOUS_SITE` additionally rejects older snapshots, removed feeds, and record-count drops
greater than 40%. Investigate before using the one-run override `ALLOW_FEED_SHRINK=true` for
intentional configuration/retention changes. A complete snapshot is still required.
generation time is not proof of upstream catalog completeness. The source stack's
[strict-refresh follow-up](https://github.com/michaelmvh/scholarly-rss-feed/pull/5) requires
successful discovery refreshes before publication, while still allowing incremental cache
reuse, conditional 304 responses, and explicitly logged optional-enrichment failures.

PRs run validation only. Main pushes and manual runs on main can deploy only after the enable
variable is set. Missing `site/` is allowed while bootstrapping but never deploys; a present,
partial `site/` fails. Deployment uploads only `site/`, not this repository's tooling.

## Operator setup and cutover

1. Merge the reviewed source PR stack and this infrastructure PR.
2. In repository Settings / Pages, select **GitHub Actions**.
3. Configure a repository-scoped NAS write credential and the scheduled export/publish task.
4. Rehearse with a generated snapshot using the project-site URL and matching base path:
   `https://michaelmvh.com/reading-site/` (inherited from the account's custom domain).
   Do not configure `reading.michaelmvh.com` until ready for its DNS cutover.
5. Set `PAGES_DEPLOY_ENABLED=true` only when a reviewed snapshot is ready to deploy.
6. At cutover, export for `https://reading.michaelmvh.com/`, register that custom domain in
   Pages, change only the `reading` CNAME to `michaelmvh.github.io` with DNS-only routing,
   and verify GitHub's certificate before enforcing HTTPS. Leave apex, `www`, and mail alone.
7. Update RSS clients to `/feed.xml` or `/feeds/<name>/feed.xml`. No legacy redirects are needed.

Allow for DNS/certificate delays. Retain the NAS HTTP service until the new deployment has
completed an observation period. Disable the deployment variable to pause publication;
redeploy a reviewed previous snapshot to roll back content. Reverting DNS to the NAS also
requires manually restoring old RSS URLs.

## Independent outage and staleness monitoring

The separate **Monitor reading snapshot** workflow runs every six hours once
`STATUS_MONITOR_ENABLED=true`. Set `STATUS_URL` to the deployed status endpoint: use the
project-site preview URL first, then `https://reading.michaelmvh.com/status.json` after
cutover. `MAX_SNAPSHOT_AGE_HOURS` defaults to 48.

The monitor runs on GitHub rather than the NAS, so a powered-off NAS cannot suppress this
check. It fails on an unreachable endpoint, invalid/HTML response, empty feed counts, a
future timestamp, or a snapshot older than the threshold. Redirects and oversized responses
are rejected. It checks publication freshness, not the age of cached upstream source data.

Configure GitHub Actions failure notifications for the operator, manually run the workflow,
and verify delivery before relying on it. Scheduled workflows can be delayed and GitHub may
disable them after repository inactivity; this is a low-cost check, not an uptime SLA.
An external uptime service can supplement it if stronger monitoring is needed.

The monitor is disabled by default and must not be enabled against the existing NAS reader,
which does not expose the new static `status.json` contract.

## Repository boundaries

Use strict TypeScript for publishing scripts, with runtime validation of generated inputs.
Keep provider-specific logic and UI changes in the source repository. Dependencies are
locked; CI uses `npm ci`. Do not edit generated article files by hand.
