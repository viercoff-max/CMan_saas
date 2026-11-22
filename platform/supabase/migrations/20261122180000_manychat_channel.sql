-- Phase 3 (2026-11-22): ManyChat as a channel. A business's ManyChat flow calls Conversa (External Request) with
-- the contact's question; Conversa answers with its assistant and keeps the conversation in the inbox; a person
-- can reply from the inbox through the ManyChat API. Secrets (API key, request token) stay in tenant_secrets.
alter table public.conversations drop constraint conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('telegram', 'whatsapp', 'instagram', 'messenger', 'manychat', 'simulator'));
alter table public.channel_accounts drop constraint channel_accounts_channel_check;
alter table public.channel_accounts add constraint channel_accounts_channel_check
  check (channel in ('telegram', 'whatsapp', 'instagram', 'messenger', 'manychat'));
