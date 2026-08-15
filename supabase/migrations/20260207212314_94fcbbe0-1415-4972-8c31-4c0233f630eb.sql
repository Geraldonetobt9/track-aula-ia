-- Fix unique constraint to handle NULLs correctly using COALESCE
-- Drop the existing constraint if it exists
ALTER TABLE daily_ad_spend DROP CONSTRAINT IF EXISTS daily_ad_spend_user_id_facebook_campaign_id_facebook_adset__key;

-- Drop any existing unique index
DROP INDEX IF EXISTS idx_daily_ad_spend_unique;
DROP INDEX IF EXISTS daily_ad_spend_user_id_facebook_campaign_id_facebook_adset__key;

-- Create unique index that treats NULLs correctly
CREATE UNIQUE INDEX idx_daily_ad_spend_unique 
ON daily_ad_spend (
  user_id, 
  COALESCE(facebook_campaign_id, ''), 
  COALESCE(facebook_adset_id, ''), 
  COALESCE(facebook_ad_id, ''), 
  date
);