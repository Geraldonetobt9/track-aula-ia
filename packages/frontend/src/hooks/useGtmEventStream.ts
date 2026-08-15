import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { isOperatorEmail } from '@/lib/featureAccess';
import { GtmEvent } from '@/types/gtmEvents';

/**
 * Ceiling for what the stream keeps in memory. The list is virtualized, so the
 * limit is about heap and counter cost, not scroll performance — older events
 * remain reachable through the paginated history.
 */
const MAX_EVENTS_IN_MEMORY = 500;

const PAGE_SIZE = 50;

/** Window for the events/min counter. */
const RATE_WINDOW_MS = 60_000;

export interface StreamCounters {
  total: number;
  perMinute: number;
  fbpPercentage: number;
  fbcPercentage: number;
}

interface ListResponse {
  events: GtmEvent[];
  nextCursor: string | null;
}

/**
 * Shape Realtime delivers: the full row, including columns the page never
 * shows (`visitor_hash`, `raw`). `value` arrives as a string because Postgres
 * numerics do not fit a JS number safely.
 */
interface GtmEventRow {
  id: string;
  event_name: string;
  event_id: string | null;
  event_time: string;
  value: string | number | null;
  currency: string | null;
  page_url: string | null;
  page_host: string | null;
  has_fbp: boolean;
  has_fbc: boolean;
  fbclid: string | null;
  external_user_id: string | null;
  visitor_key: string | null;
  created_at: string;
}

/** Narrows the Realtime row to what the page renders. */
function toGtmEvent(row: GtmEventRow): GtmEvent {
  return {
    id: row.id,
    event_name: row.event_name,
    event_id: row.event_id ?? null,
    event_time: row.event_time,
    value: row.value === null || row.value === undefined ? null : Number(row.value),
    currency: row.currency ?? null,
    page_url: row.page_url ?? null,
    page_host: row.page_host ?? null,
    has_fbp: !!row.has_fbp,
    has_fbc: !!row.has_fbc,
    fbclid: row.fbclid ?? null,
    external_user_id: row.external_user_id ?? null,
    visitor_key: row.visitor_key ?? null,
    // Realtime carries the row, not the aggregate. Filled in below from what
    // is already on screen; stays null when the visitor has no history loaded.
    visit_number: null,
    visit_scope: row.page_host ? 'host' : 'all_hosts',
    created_at: row.created_at,
  };
}

/** Mirrors the name normalisation in gtm_events_page: tags spell it several ways. */
function isAccess(eventName: string): boolean {
  return eventName.toLowerCase().replace(/_/g, '') === 'pageview';
}

/**
 * Infers the visit number of an event that arrived over Realtime.
 *
 * The server computes this from the visitor's whole history; a live row has no
 * aggregate attached. Rather than issue a request per event, we continue from
 * the most recent event of the same visitor **on the same host** already on
 * screen: a PageView is the next visit, anything else belongs to the one
 * already in progress.
 *
 * Matching the host matters — counts are per subdomain, so continuing from an
 * event on another site would report a number from the wrong sequence.
 *
 * Returns null when that visitor has nothing loaded for this host — the number
 * then appears on the next refresh rather than being guessed.
 */
function inferVisitNumber(incoming: GtmEvent, loaded: GtmEvent[]): number | null {
  if (!incoming.visitor_key) return null;

  // An event without a host is counted across every host, and the loaded rows
  // only carry per-host numbers — there is nothing here to continue from. It
  // resolves on the next refresh, which is better than showing a per-host
  // number as if it were the total. Purchases usually take this path.
  if (!incoming.page_host) return null;

  const previous = loaded.find(
    (event) =>
      event.visitor_key === incoming.visitor_key &&
      event.page_host === incoming.page_host &&
      event.visit_number !== null,
  );
  if (!previous) return isAccess(incoming.event_name) ? 1 : null;

  const previousNumber = previous.visit_number as number;
  return isAccess(incoming.event_name) ? previousNumber + 1 : previousNumber;
}

export function useGtmEventStream(
  options: { eventName?: string; from?: string; to?: string } = {},
) {
  const { eventName, from, to } = options;
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspaceContext();
  const allowed = isOperatorEmail(user?.email);
  const enabled = allowed && !!activeWorkspaceId;

  const [events, setEvents] = useState<GtmEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Events that arrived while paused. Kept in state, not a ref, so the counters
  // keep moving while the list is frozen. EventStreamList is memoized, so these
  // updates don't re-render the list itself.
  const [bufferedEvents, setBufferedEvents] = useState<GtmEvent[]>([]);
  const pausedRef = useRef(paused);
  const eventNameRef = useRef(eventName);
  // Read inside the Realtime callback, which closes over the values it was
  // created with. A ref keeps the filter current without resubscribing.
  const rangeRef = useRef({ from, to });

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    eventNameRef.current = eventName;
  }, [eventName]);

  useEffect(() => {
    rangeRef.current = { from, to };
  }, [from, to]);

  const fetchHistory = useCallback(async () => {
    if (!activeWorkspaceId) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: activeWorkspaceId,
        limit: String(PAGE_SIZE),
      });
      if (eventName) params.set('event_name', eventName);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const result = await api.get<ListResponse>(`/gtm/events?${params}`);
      setEvents(result.events ?? []);
      setCursor(result.nextCursor ?? null);
      setBufferedEvents([]);
    } catch (error) {
      console.error('Error loading GTM events:', error);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, eventName, from, to]);

  const loadMore = useCallback(async () => {
    if (!activeWorkspaceId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        workspace_id: activeWorkspaceId,
        limit: String(PAGE_SIZE),
        before: cursor,
      });
      if (eventName) params.set('event_name', eventName);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const result = await api.get<ListResponse>(`/gtm/events?${params}`);
      setEvents((prev) => [...prev, ...(result.events ?? [])]);
      setCursor(result.nextCursor ?? null);
    } catch (error) {
      console.error('Error loading more GTM events:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [activeWorkspaceId, cursor, eventName, from, to, loadingMore]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    fetchHistory();
  }, [enabled, fetchHistory]);

  // Realtime subscription. Re-created when the workspace changes so the server
  // side filter always matches what the page is showing.
  useEffect(() => {
    if (!enabled || !activeWorkspaceId) return;

    const channel = supabase
      .channel(`gtm-events-${activeWorkspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'gtm_events',
          filter: `workspace_id=eq.${activeWorkspaceId}`,
        },
        (payload) => {
          const incoming = toGtmEvent(payload.new as GtmEventRow);

          // The name filter is applied client-side because the subscription
          // already carries a server-side filter and Realtime allows only one.
          const filter = eventNameRef.current;
          if (filter && incoming.event_name !== filter) return;

          // Same for the date range. Without this, filtering to a past window
          // would still see live events streaming in from today.
          const { from: rangeFrom, to: rangeTo } = rangeRef.current;
          if (rangeFrom && incoming.created_at < rangeFrom) return;
          if (rangeTo && incoming.created_at >= rangeTo) return;

          if (pausedRef.current) {
            setBufferedEvents((prev) =>
              [incoming, ...prev].slice(0, MAX_EVENTS_IN_MEMORY),
            );
            return;
          }

          setEvents((prev) => {
            if (prev.some((event) => event.id === incoming.id)) return prev;
            const numbered = {
              ...incoming,
              visit_number: inferVisitNumber(incoming, prev),
            };
            return [numbered, ...prev].slice(0, MAX_EVENTS_IN_MEMORY);
          });
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        // A dropped socket means events were missed while it was down. Refetching
        // the head of the list is cheaper than trying to replay the gap.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          fetchHistory();
        }
      });

    return () => {
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [enabled, activeWorkspaceId, fetchHistory]);

  const resume = useCallback(() => {
    setPaused(false);
    if (bufferedEvents.length === 0) return;

    setEvents((prev) => {
      const seen = new Set(prev.map((event) => event.id));
      const fresh = bufferedEvents.filter((event) => !seen.has(event.id));
      // Oldest first, so each inferred number can build on the one before it.
      const merged = [...prev];
      for (const event of [...fresh].reverse()) {
        merged.unshift({ ...event, visit_number: inferVisitNumber(event, merged) });
      }
      return merged.slice(0, MAX_EVENTS_IN_MEMORY);
    });
    setBufferedEvents([]);
  }, [bufferedEvents]);

  const togglePaused = useCallback(() => {
    if (pausedRef.current) {
      resume();
      return;
    }
    setPaused(true);
  }, [resume]);

  const counters = useMemo<StreamCounters>(() => {
    // Buffered events count toward the totals even while paused — pausing
    // freezes the list, not the measurement.
    const all = bufferedEvents.length > 0 ? [...bufferedEvents, ...events] : events;
    const total = all.length;
    if (total === 0) {
      return { total: 0, perMinute: 0, fbpPercentage: 0, fbcPercentage: 0 };
    }

    const cutoff = Date.now() - RATE_WINDOW_MS;
    const perMinute = all.filter((event) => new Date(event.created_at).getTime() >= cutoff).length;
    const withFbp = all.filter((event) => event.has_fbp).length;
    const withFbc = all.filter((event) => event.has_fbc).length;

    return {
      total,
      perMinute,
      fbpPercentage: Math.round((withFbp / total) * 100),
      fbcPercentage: Math.round((withFbc / total) * 100),
    };
  }, [events, bufferedEvents]);

  return {
    events,
    counters,
    loading,
    loadingMore,
    connected,
    paused,
    bufferedCount: bufferedEvents.length,
    hasMore: !!cursor,
    allowed,
    togglePaused,
    loadMore,
    refresh: fetchHistory,
  };
}
