-- Add budget columns to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_budget numeric;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lifetime_budget numeric;

-- Add budget columns to ad_sets table
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS daily_budget numeric;
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS lifetime_budget numeric;

-- Add comments for documentation
COMMENT ON COLUMN campaigns.daily_budget IS 'Daily budget in BRL (converted from cents)';
COMMENT ON COLUMN campaigns.lifetime_budget IS 'Lifetime budget in BRL (converted from cents)';
COMMENT ON COLUMN ad_sets.daily_budget IS 'Daily budget in BRL (converted from cents)';
COMMENT ON COLUMN ad_sets.lifetime_budget IS 'Lifetime budget in BRL (converted from cents)';