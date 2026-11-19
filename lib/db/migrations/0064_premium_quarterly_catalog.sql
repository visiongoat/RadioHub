-- Real Paddle catalog entry verified in the Vision go live dashboard, 2026-11-19.
-- This does not grant access: checkout and webhooks still verify the provider price,
-- its three-month cycle, payment state, account binding and actual billing period.
ALTER TABLE stripe_subscription_plans DROP CONSTRAINT stripe_subscription_plans_plan_id_check;
ALTER TABLE stripe_subscription_plans ADD CONSTRAINT stripe_subscription_plans_plan_id_check
  CHECK (plan_id IN ('remove_ads','premium_monthly','premium_quarterly','premium_yearly','premium_lifetime'));
INSERT INTO stripe_subscription_plans
  (id,plan_id,paddle_price_id,label,description,currency,amount,is_active)
VALUES ('premium_quarterly_catalog_20261119','premium_quarterly','pri_01m7swn71yk53d4ex5cqjzxpfq',
        'Quarterly','Billed every 3 months, cancel anytime','eur',1199,true)
ON CONFLICT (plan_id) DO NOTHING;
