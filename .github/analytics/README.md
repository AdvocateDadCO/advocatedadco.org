# Resource click measurement

The separate `advocatedad-resource-clicks` Worker accepts only reviewed resource IDs paired with one of four public source pages: Resources, How Can I Help, the professional BLV guide, and Project INSPIRE. The website marks eligible links with stable IDs. Resource links remain ordinary links; measurement never delays or blocks navigation.

`resource-catalog.json` maps IDs to the existing public link labels and destinations. The collector stores the known label, resource ID, source-page ID, resource type, test/live flag, and a count of one in the `advocatedad_resource_clicks` Analytics Engine dataset. Analytics Engine supplies the timestamp. No request URL, query string, referrer, user agent, IP address, cookies, user identifier, or form input is copied into that dataset. Cloudflare necessarily handles the network request as the hosting provider. Worker request logging is disabled in the configuration. This describes this counter, not Cloudflare's separate security/network processing.

The browser omits credentials and referrers. Global Privacy Control and Do Not Track disable measurement. The collector honors their request headers too. Cross-site origins, unlisted IDs/pages, arbitrary fields, oversized bodies, and unexpected methods are rejected. Origin checks limit browser misuse; this is a public measurement endpoint, not authenticated proof of human activity. Ad blockers, connectivity, disabled JavaScript, automation, and repeated actions affect counts. Counts show link selections, not distinct people, completed downloads, course enrollment, or service outcomes.

Deploy the tested counter before the website through **Resource clicks — reviewed counter deployment**, on current `main`, entering its reviewed full commit SHA. It uses the existing repository Cloudflare deployment credentials, never client-side credentials. A missing API permission must be resolved by the account owner; do not expand permissions automatically. This workflow is separate from the unchanged reviewed Pages release. No DNS, Access policy, or existing Worker route changes are needed.

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
