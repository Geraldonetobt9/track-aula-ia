-- Add new columns to sales table for Guru Digital and enhanced tracking
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS customer_doc text,
ADD COLUMN IF NOT EXISTS checkout_source text,
ADD COLUMN IF NOT EXISTS metadata jsonb;