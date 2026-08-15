/** One event as received from the sGTM container, already stripped of PII. */
export interface GtmEvent {
  id: string;
  event_name: string;
  event_id: string | null;
  event_time: string;
  value: number | null;
  currency: string | null;
  page_url: string | null;
  /**
   * Host from `page_url` — scheme, path, query and port removed, lowercased.
   *
   * Kept at subdomain granularity: `loja.exemplo.com` and `blog.exemplo.com`
   * are different sites, and `www.` is a subdomain like any other. Visits are
   * counted per host.
   */
  page_host: string | null;
  has_fbp: boolean;
  has_fbc: boolean;
  fbclid: string | null;
  /** The site's own user id, sent as `id_do_usuario`. Null for anonymous traffic. */
  external_user_id: string | null;
  /** `external_user_id` when known, otherwise the hashed `_fbp`. What visits group by. */
  visitor_key: string | null;
  /**
   * How many visits this person had **on this domain** up to and including
   * this event.
   *
   * A visit is one access — one PageView. On a PageView this is its own
   * position (1st, 2nd, 3rd access); on a Purchase it is how many visits the
   * person had before buying. See `visit_scope` for what it is counted over.
   *
   * `0` means no PageView was recorded before this event. Null
   * when the visitor could not be identified at all, or for a live event whose
   * number could not yet be inferred locally.
   */
  visit_number: number | null;
  /**
   * What `visit_number` was counted over.
   *
   * `host` — accesses on this event's own `page_host`, the normal case.
   * `all_hosts` — the event arrived without a `page_url`, so there is no host
   * to scope to and the count spans every site of that person. Purchases
   * typically land here.
   */
  visit_scope: 'host' | 'all_hosts' | null;

  created_at: string;
}


/** One row of the "who visits the most" ranking, counted inside the selected period. */
export interface GtmTopVisitor {
  visitor_key: string;
  /** The site's own user id, when the person was logged in. Null for anonymous traffic. */
  external_user_id: string | null;
  /** PageView events in the period. */
  visits: number;
  /** Every event in the period, visits included. */
  events: number;
  purchases: number;
  revenue: number;
  /** How many distinct subdomains this person touched. */
  hosts: number;
  /**
   * Count per event name, e.g. `{ page_view: 6, add_to_cart: 1, purchase: 1 }`.
   *
   * An object rather than fixed fields because the set of names is whatever the
   * sGTM triggers send — not knowable up front, and it changes when a tag is
   * added.
   */
  events_by_name: Record<string, number>;
  first_seen: string;
  last_seen: string;
}
