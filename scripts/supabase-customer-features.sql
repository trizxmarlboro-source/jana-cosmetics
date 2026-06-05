create extension if not exists pgcrypto;

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  "orderId" text not null,
  "productId" text not null,
  "buyerEmail" text not null,
  "buyerName" text,
  rating integer not null check (rating between 1 and 5),
  comment text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("orderId", "productId", "buyerEmail")
);

create index if not exists customer_reviews_buyer_email_idx
  on public.customer_reviews ("buyerEmail");

create table if not exists public.order_notifications (
  "orderId" text primary key,
  "buyerEmail" text not null,
  provider text not null default 'resend',
  status text not null default 'sent',
  "sentAt" timestamptz not null default now()
);
