import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

type GenderResult = 'male' | 'female' | 'unknown';
type GenderCache = Record<string, GenderResult>;

// Global cache to avoid re-fetching across re-renders
const globalCache: GenderCache = {};

export function useGenderize(names: string[]) {
  const [genderMap, setGenderMap] = useState<GenderCache>({});
  const [loading, setLoading] = useState(false);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const uniqueNames = [...new Set(names.filter(Boolean))];
    const cacheKey = uniqueNames.sort().join('|');

    if (cacheKey === lastKeyRef.current || uniqueNames.length === 0) return;
    lastKeyRef.current = cacheKey;

    // Check which names are already cached
    const uncached = uniqueNames.filter(n => {
      const firstName = n.trim().split(/\s+/)[0].toLowerCase();
      return !(firstName in globalCache);
    });

    // If all cached, just return from cache
    if (uncached.length === 0) {
      const result: GenderCache = {};
      uniqueNames.forEach(n => {
        const firstName = n.trim().split(/\s+/)[0].toLowerCase();
        result[n] = globalCache[firstName] || 'unknown';
      });
      setGenderMap(result);
      return;
    }

    const fetchGenders = async () => {
      setLoading(true);
      try {
        const data = await api.post<{ results: Record<string, { gender: string }> }>('/utils/genderize', {
          names: uncached,
        });

        if (data?.results) {
          Object.entries(data.results).forEach(([firstName, info]: [string, any]) => {
            globalCache[firstName.toLowerCase()] = info.gender === 'male' ? 'male'
              : info.gender === 'female' ? 'female' : 'unknown';
          });
        }
      } catch (err) {
        console.error('Genderize fetch error:', err);
      }

      // Build result map from cache
      const result: GenderCache = {};
      uniqueNames.forEach(n => {
        const firstName = n.trim().split(/\s+/)[0].toLowerCase();
        result[n] = globalCache[firstName] || 'unknown';
      });
      setGenderMap(result);
      setLoading(false);
    };

    fetchGenders();
  }, [names.join('|')]);

  return { genderMap, loading };
}
