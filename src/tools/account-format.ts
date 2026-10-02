/**
 * Concise, human/LLM-readable summaries for the large account envelopes.
 * The full upstream envelope is always preserved in `structuredContent` —
 * the text channel only needs the high-signal fields (per the MCP
 * best-practices audit, docs/mcp-best-practices-audit.md F-06).
 * All formatters are defensive: unknown/missing fields are skipped, never thrown on.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A scalar identifier (string or number) — Alza mixes both across endpoints. */
function scalar(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

const FOOTER = "_Full envelope (identifiers, line details, raw fields) is in structuredContent._";

import type { ToolResult } from "./types.js";

/** Tool result with a concise text channel; the full envelope stays in structuredContent. */
export function withConciseText(value: unknown, format: (v: unknown) => string): ToolResult {
  let text: string;
  try {
    text = format(value);
  } catch {
    text = JSON.stringify(value, null, 2);
  }
  return { content: [{ type: "text", text }], structuredContent: value as Record<string, unknown> };
}

export function formatCart(env: unknown): string {
  const top = asRecord(env) ?? {};
  const info = asRecord(top.info) ?? {};
  const items = asRecord(top.items) ?? {};
  const lines: string[] = [];
  if (num(info.err) === 1) {
    lines.push("# Alza cart", "", `Alza rejected the read (err:1): ${str(info.msg) ?? "no message"}.`);
    return lines.join("\n");
  }
  const userId = num(info.user_id);
  lines.push(`# Alza cart${userId !== undefined ? ` (user ${userId})` : ""}`);
  const cnt = num(info.basket_cnt);
  if (cnt !== undefined) lines.push(`${cnt} item line(s)${str(info.pricePay) ? ` · total ${info.pricePay}` : ""}`);
  if (str(info.email)) lines.push(`account: ${info.email}`);
  if (str(info.orderId)) lines.push(`orderId: ${info.orderId}`);
  const data = Array.isArray(items.data) ? items.data : undefined;
  if (data) {
    lines.push("", "## Items");
    for (const row of data) {
      const r = asRecord(row);
      if (!r) continue;
      const name = str(r.name) ?? str(r.code) ?? "item";
      const code = str(r.code);
      const count = num(r.count);
      const price = str(r.priceVat) ?? str(r.price);
      lines.push(`- ${count !== undefined ? `${count}× ` : ""}${name}${code ? ` (${code})` : ""}${price ? ` — ${price}` : ""}`);
    }
  } else if (str(items.msg)) {
    lines.push("", `items: ${items.msg}`);
  }
  const vouchers = num(items.vouchers_cnt);
  if (vouchers !== undefined) lines.push(`vouchers: ${vouchers}`);
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function formatProfile(env: unknown): string {
  const top = asRecord(env) ?? {};
  if (num(top.err) === 1) return `# Alza profile\n\nAlza rejected the read (err:1): ${str(top.msg) ?? "no message"}.`;
  const lines: string[] = [];
  const userId = num(top.user_id);
  lines.push(`# Alza profile${userId !== undefined ? ` (user ${userId})` : ""}`);
  if (str(top.user_name)) lines.push(`name: ${top.user_name}`);
  if (str(top.email)) lines.push(`email: ${top.email}`);
  const addr = num(top.deliveryaddress_cnt);
  if (addr !== undefined) lines.push(`delivery addresses: ${addr} (per-address actions in structuredContent — pass them to address_upsert/address_delete/address_search)`);
  const baskets = num(top.baskets_cnt);
  if (baskets !== undefined) lines.push(`baskets: ${baskets}`);
  if (top.vip === true) lines.push("vip: yes");
  if (top.twoFactorAuth === true) lines.push("two-factor auth: enabled");
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function formatAddToCart(env: unknown): string {
  const top = asRecord(env) ?? {};
  const lines: string[] = ["# Added to Alza cart"];
  if (num(top.err) === 1) {
    lines.push("", `Alza rejected the add (err:1): ${str(top.msg) ?? "no message"}.`);
    lines.push("", FOOTER);
    return lines.join("\n");
  }
  const data = asRecord(top.data);
  if (data) {
    lines.push(`- ${str(data.name) ?? str(data.code) ?? "product"}${scalar(data.code) ? ` (${data.code})` : ""}${num(data.count) !== undefined ? ` × ${data.count}` : ""}`);
    if (scalar(data.orderItemId)) lines.push(`orderItemId: ${data.orderItemId}`);
  }
  const cnt = num(top.basket_cnt);
  if (cnt !== undefined) lines.push(`cart now holds ${cnt} line(s)`);
  const orderTotal = str(asRecord(top.order)?.priceToPay);
  if (orderTotal) lines.push(`cart total: ${orderTotal}`);
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function formatOrder(env: unknown): string {
  const top = asRecord(env) ?? {};
  const order = asRecord(top.order);
  const lines: string[] = ["# Alza order"];
  if (order) {
    const id = scalar(order.orderId) ?? scalar(order.order_id);
    if (id) lines.push(`orderId: ${id}`);
    const status = str(order.orderStatus) ?? str(order.status) ?? str(order.statusDesc);
    if (status) lines.push(`status: ${status}`);
    const total = str(order.priceVat) ?? str(order.pricePay) ?? str(order.totalPrice);
    if (total) lines.push(`total: ${total}`);
    if (str(order.email)) lines.push(`email: ${order.email}`);
    const parts = Array.isArray(order.parts) ? order.parts : undefined;
    if (parts) lines.push(`parts: ${parts.length}`);
  } else if (num(top.err) === 1) {
    lines.push("", `Alza rejected the read (err:1): ${str(top.msg) ?? "no message"}.`);
  }
  if (asRecord(top.part)) lines.push("", "part detail included (structuredContent).");
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function formatCheckoutPreview(env: unknown): string {
  const top = asRecord(env) ?? {};
  const lines: string[] = ["# Checkout preview (order NOT submitted)"];
  const token = str(top.confirmationToken);
  if (token) lines.push(`confirmation token for place_order: ${token}`);
  const cart = top.cart;
  if (cart !== undefined) {
    try {
      const cartLines = formatCart(cart).split("\n");
      lines.push("", "## Cart", ...cartLines.slice(1));
    } catch {
      lines.push("", "cart: (see structuredContent)");
    }
  }
  const groups = asRecord(top.deliveryPaymentGroups);
  if (groups) {
    const deliveries = groups.deliveries ?? groups.delivery;
    const count = Array.isArray(deliveries) ? deliveries.length : undefined;
    lines.push(`delivery/payment groups: ${count !== undefined ? `${count} delivery option(s)` : "see structuredContent"} — pass a selected_delivery_option_id to delivery_options/checkout_preview as needed`);
  }
  lines.push("", "_Full preview (checkout state, all delivery/payment options) is in structuredContent._");
  return lines.join("\n");
}
