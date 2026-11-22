# Bounded recommendation projection

Production logs recorded `Recommendation pool unavailable` / `Query read timeout`
at the existing eight-second query budget. This was not a missing schema or an
empty-result failure. The country pool could succeed while the global pool did
far more work on a cache miss.

Read-only EXPLAIN and four sequential EXPLAIN ANALYZE statements, each limited to
three seconds, showed the following on the live API database. No DDL/data writes,
statistics changes or cache resets were performed.

| Scope | Original execution | IDs-first execution | Candidate row width |
| --- | ---: | ---: | ---: |
| Global |2608ms|35ms|1181 →33bytes|
| Türkiye |79ms|15ms|1181 →33bytes|

These are sequential observations, not a controlled cold-cache benchmark. The
decisive plan difference is that the original global parallel sequential scan
evaluated `jsonb_build_object(source...)` for approximately56000stations before
top-N sorting. Its plan reported199546shared read blocks and551656hits. The
materialized candidate plan omits source JSON until its100ranked IDs are joined
back to the primary key; it reported12863reads. Türkiye already used the country
index to restrict its candidate set to approximately650rows.

The query now selects only ID/votes/click_count inside a `MATERIALIZED` CTE,
keeping the original health/country/genre filters and exact votes/clicks/ID
ordering. It projects the existing public fields for those100IDs afterward.
The response, visibility policy, sixty-second cache and eight-second deadline
are unchanged. An unknown country still returns an empty200response.

Migration0072 adds one compact B-tree in the exact global rank order. Existing
country and health indexes do not provide that ordering. It contains neither
source JSON nor a time-dependent visibility predicate; candidate filtering still
uses the live native policy. With approximately56000rows and a33-byte key, plan
for a few MB of disk, plus temporary concurrent-build I/O. Actual production
index size and build duration must be recorded after the authorized operation.

The reviewed migration runner allows only the exact index statement. It verifies
schema/table ownership, B-tree method, non-uniqueness, three key/total columns,
column order, descending/null options, default operator classes and collations,
absence of expressions/predicates, and valid/ready status. A completed prior
build is reused; an exact invalid prior build is dropped concurrently before a
retry. A conflicting same-name definition is never replaced. The existing
five-second lock timeout and bounded migration statement timeout remain in
effect; no ordinary DML lock or transaction wrapper is added. Failed builds are
not marked complete, and matching invalid remnants are repaired on retry.

Validation:31focused tests passed with no skips, including real disposable
PostgreSQL EXPLAIN assertions for the materialized LIMIT100boundary, absence of
source JSON inside candidates, exact order-index usage without sorting, stable
country/genre/health-filtered IDs and unchanged compact fields. Real PostgreSQL
also verifies safe reuse and rejection of a wrong same-name null ordering.
Shared-library/API type checks and the API production build passed. No web or
mobile UI/wire change is required.

This change is prepared for the combined release; the investigating agent did
not create or modify a production index. Reverting the query keeps the additive
index usable and requires no data reversal. If the index must later be removed,
use a separately authorized `DROP INDEX CONCURRENTLY` operation.
