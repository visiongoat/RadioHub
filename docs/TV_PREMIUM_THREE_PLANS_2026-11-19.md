# TV Premium — 1 / 3 / 12 months

The TV offer keeps the verified Figma card geometry (2712:9594: 479 × 814.794,
original hero, logo and check assets). Five short benefit lines replace the
crowded six-line copy. Monthly, quarterly and yearly options have a separate
renewal line; broadcaster-ad disclosure no longer overlaps the third option.

Quarterly is a real recurring entitlement, not a lifetime-label fallback.
The Vision go live Paddle catalog price `pri_01m7swn71yk53d4ex5cqjzxpfq` was
created and visually verified as EUR 11.99 every three months. Monthly remains
EUR 4.99; annual EUR 29.99. Migration 0064 adds the allowed plan and inserts the
verified public price mapping without overwriting an existing admin mapping.
Public pricing and checkout still read/validate the provider's live price,
including month/frequency=3, and never trust the stored display amount alone.
No customer subscription or payment is created by the migration.

TV QR, native universal-link routing, StoreKit product selection and the web
fallback preserve `premium_quarterly` and the original purchase-account binding.
Paddle webhook fulfillment derives expiry from the verified billing period.
Apple product `megaradio_premium_quarterly` was created with a three-month duration
and EUR 11.99 base price; Apple review availability is independent of Paddle.
A native product missing from StoreKit is never substituted with another SKU.

Validation: clean library/API/web typechecks; focused Paddle billing/HTTP tests
(29 passed), TV offer tests (5 passed), native pairing links (6 passed).
Full release checks and physical installation evidence are recorded after CI.
