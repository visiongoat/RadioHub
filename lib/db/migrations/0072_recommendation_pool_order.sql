-- radiohub:concurrent-index
-- Keep bounded recommendation candidates in their exact stable public order.
-- No source JSON or time-dependent health predicate is stored in this index.
CREATE INDEX CONCURRENTLY stations_recommendation_order_idx ON stations USING btree (votes DESC NULLS LAST, click_count DESC NULLS LAST, id);
