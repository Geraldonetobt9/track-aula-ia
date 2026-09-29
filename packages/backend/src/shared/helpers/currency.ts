import { META_API_VERSION } from '../constants/meta-api';
// In-memory cache for exchange rates (persists for the lifetime of the application instance)
const rateCache = new Map<string, { rate: number; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetches the exchange rate from `fromCurrency` to BRL.
 * Returns 1.0 if fromCurrency is already BRL.
 * Uses in-memory cache to avoid repeated API calls within the same sync.
 */
export async function getExchangeRate(fromCurrency: string): Promise<number> {
  const from = fromCurrency.toUpperCase();
  if (from === "BRL") return 1.0;

  const cacheKey = `${from}_BRL`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    if (!response.ok) {
      console.error(`Exchange rate API error: ${response.status}`);
      // Fallback: try alternative API
      return await getFallbackRate(from);
    }

    const data = await response.json();
    const rate = data.rates?.BRL;

    if (!rate || typeof rate !== "number") {
      console.error(`No BRL rate found for ${from}`);
      return await getFallbackRate(from);
    }

    rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
    console.log(`Exchange rate ${from} -> BRL: ${rate}`);
    return rate;
  } catch (error) {
    console.error(`Error fetching exchange rate for ${from}:`, error);
    return await getFallbackRate(from);
  }
}

async function getFallbackRate(from: string): Promise<number> {
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    if (!response.ok) throw new Error(`Fallback API error: ${response.status}`);
    const data = await response.json();
    const rate = data.rates?.BRL;
    if (rate && typeof rate === "number") {
      rateCache.set(`${from}_BRL`, { rate, fetchedAt: Date.now() });
      console.log(`Fallback exchange rate ${from} -> BRL: ${rate}`);
      return rate;
    }
    throw new Error("No rate in fallback");
  } catch (error) {
    console.error("Fallback exchange rate also failed:", error);
    // Last resort: use a hardcoded approximate rate for USD
    if (from === "USD") {
      console.warn("Using hardcoded fallback rate USD->BRL = 5.0");
      return 5.0;
    }
    return 1.0;
  }
}

/**
 * Converts a monetary value from the account currency to BRL.
 * Returns the original value if rate is 1.0 (already BRL).
 */
export function convertToBRL(value: number, exchangeRate: number): number {
  if (exchangeRate === 1.0) return value;
  return Math.round(value * exchangeRate * 100) / 100;
}

/**
 * Converts a BRL value back to the original account currency.
 * Used when sending budget updates to Facebook.
 */
export function convertFromBRL(brlValue: number, exchangeRate: number): number {
  if (exchangeRate === 1.0) return brlValue;
  return Math.round((brlValue / exchangeRate) * 100) / 100;
}

/**
 * Fetches the currency of a Facebook ad account via Graph API.
 */
export async function getAccountCurrency(
  adAccountId: string,
  accessToken: string,
  fbApiVersion: string = META_API_VERSION
): Promise<string> {
  try {
    const url = `https://graph.facebook.com/${fbApiVersion}/${adAccountId}?fields=currency&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("Error fetching account currency:", data.error.message);
      return "BRL"; // Default to BRL on error
    }

    const currency = data.currency || "BRL";
    console.log(`Ad account ${adAccountId} currency: ${currency}`);
    return currency;
  } catch (error) {
    console.error("Error fetching account currency:", error);
    return "BRL";
  }
}
