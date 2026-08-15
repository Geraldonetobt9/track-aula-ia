/**
 * Discord Webhook URLs — mapped by channel purpose.
 *
 * Copy this file to discord-webhooks.config.ts and fill in the real URLs.
 * The real config file is gitignored.
 */
export const DISCORD_WEBHOOKS = {
  // ── Per-platform channels (webhook activity) ──────────────────────
  hotmart: 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN',
  guru: '',
  kiwify: '',
  hubla: '',
  kirvano: '',
  perfectpay: '',
  ticto: '',
  payt: '',
  cakto: '',
  eduzz: '',
  mundpay: '',
  monetizze: '',
  greenn: '',
  lastlink: '',
  ggcheckout: '',
  cartpanda: '',

  // ── Consolidated channels ─────────────────────────────────────────
  webhookErrors: '',
  webhookActivity: '',
  resumoDiario: '',
  integrations: '',
  apiErrors: '',
  dataIntegrity: '',

  // ── Account / Profile changes ─────────────────────────────────────
  accountChanges: '',
} as const;

export type DiscordChannel = keyof typeof DISCORD_WEBHOOKS;
