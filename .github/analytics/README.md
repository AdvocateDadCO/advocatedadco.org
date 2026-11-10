# Resource click measurement

The separate `advocatedad-resource-clicks` Worker accepts only reviewed resource IDs paired with one of four public source pages: Resources, How Can I Help, the professional BLV guide, and Project INSPIRE. The website marks eligible links with stable IDs. Resource links remain ordinary links; measurement never delays or blocks navigation.

`resource-catalog.json` maps IDs to the existing public link labels and destinations. The collector stores the known label, resource ID, source-page ID, resource type, test/live flag, and a count of one in the `advocatedad_resource_clicks` Analytics Engine dataset. Analytics Engine supplies the timestamp. No request URL, query string, referrer, user agent, IP address, cookies, user identifier, or form input is copied into that dataset. Cloudflare necessarily handles the network request as the hosting provider. Worker request logging is disabled in the configuration. This describes this counter, not Cloudflare's separate security/network processing.

The browser omits credentials and referrers. Global Privacy Control and Do Not Track disable measurement. The collector honors their request headers too. Cross-site origins, unlisted IDs/pages, arbitrary fields, oversized bodies, and unexpected methods are rejected. Origin checks limit browser misuse; this is a public measurement endpoint, not authenticated proof of human activity. Ad blockers, connectivity, disabled JavaScript, automation, and repeated actions affect counts. Counts show link selections, not distinct people, completed downloads, course enrollment, or service outcomes.

The counter was deployed through the signed-in Cloudflare code editor after Rob explicitly approved the temporary service bootstrap and immediate replacement with the tested source. The editor contents were copied back and compared with the tested source before deployment. Its `CLICKS` binding points to `advocatedad_resource_clicks`; saved settings confirm Logs and Traces are off. No DNS, Access policy, or existing Worker route was changed.

The initial **Resource clicks — reviewed counter deployment** workflow attempt was denied because the existing Pages deployment credential did not have access to the Worker deployment resource. That optional workflow remains manual and current-main gated; do not retry it unless the account owner has separately authorized appropriate deployment access. No credential permissions were expanded for this release. Future changes can use the authenticated Cloudflare code editor: deploy the reviewed source, preserve the dataset binding and logging settings, and verify health plus a marked test event before website activation. The reviewed Pages release workflow remains unchanged.

Initial live release: source commit `2757e1ac2886aac9f7bff6ad899aea53760a1b22`, PR #37. Website verification run `42749977513` and publication run `42751489548` passed. The public health endpoint returned `ready: true`, and an initial synthetic test event was visible in Analytics Engine Studio, labeled `test`. Browser verification and the final aggregate report are recorded in the local delivery evidence.

## Read the report

In the Cloudflare account, open Workers Analytics Engine / Analytics Explorer and select `advocatedad_resource_clicks`. Use the SQL below. Reports stay in the authenticated Cloudflare dashboard. Store monthly aggregate snapshots locally for comparison because Analytics Engine retains data for three months. Use sample weights in aggregates; if sampling occurs, values are estimates.

```sql
SELECT blob2 AS resource, blob3 AS source_page, blob4 AS link_type,
       SUM(_sample_interval * double1) AS clicks
FROM advocatedad_resource_clicks
WHERE timestamp >= NOW() - INTERVAL '30' DAY AND blob5 = 'live'
GROUP BY resource, source_page, link_type
ORDER BY clicks DESC
```

For a named calendar period, replace the relative-time condition with UTC start-inclusive/end-exclusive timestamps. Do not confuse these outbound, download, and guide-selection counts with social-platform link clicks or Cloudflare Web Analytics pageviews. Keep the denominator and reporting dates explicit in monthly recommendations.

## Verification

Run `node .github/analytics/click-tests.mjs`. `/health` reports storage-binding readiness without generating a click. For a real browser test, visit a supported page with `?resource_tracking_test=1`, activate a marked resource link, then query the same dataset with `blob5 = 'test'`. Test clicks are excluded from the live report. The query parameter is a public QA flag; no other query parameter is sent. The website does not expose a public report endpoint.

When links change, update the catalog, allowed-page pairs, corresponding HTML attributes, and generated Worker constants together, then rerun tests. Current coverage is 78 distinct resource destinations on four pages, including internal guide selections and downloads. Keep the production endpoint in `resource-clicks.js` aligned with the configured Worker name.
