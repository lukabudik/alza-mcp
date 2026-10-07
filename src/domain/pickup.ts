import { fetch as undiciFetch } from "undici";
import { BRANCHES, type BranchSeed } from "../data/branches.js";
import { TtlCache } from "../infra/cache.js";
import { AlzaError, UpstreamError, UserError, truncateInput } from "../infra/errors.js";
import type { Locale } from "../infra/locale.js";
import type { PickupPoint } from "./types.js";

/**
 * Pickup-point discovery: AlzaBox parcel lockers (live) + AlzaShop showrooms
 * (curated branch dataset), merged and sorted by distance from a geocoded
 * postal code.
 *
 * AlzaBox source — `GET {baseUrl}/api/salesNetwork/v1/places` (live-verified
 * 2026-10-06, docs/gap-analysis.md "AlzaBox locker discovery"). This is the
 * public "sales network" map behind https://www.alza.cz/alzabox and
 * /seznam-prodejen-a-alzaboxu (`salesNetworkMap` article component →
 * `/api/salesNetwork/v1/salesNetworkForm` → its `placesForm`). Unlike the
 * checkout-scoped `/api/personalPickup/v1/places` (HTTP 400 without an
 * `orderId`/`groupId`, verified 2026-09-26 and again 2026-10-06), it needs no
 * cart, no login and no delivery group. `types[0]=1` selects AlzaBoxes,
 * `ordering=0` sorts by distance from `latitude`/`longitude`, and `limit` is
 * capped at 100 by the API (HTTP 400 above that). The upstream ignores
 * `radius`, so the radius is applied locally.
 *
 * One request returns the 100 nearest lockers, which always covers the
 * tool's `limit` (max 50). That list is cached per geocoded centre for
 * {@link LOCKER_TTL_MS}, so repeated queries for the same postal code don't
 * hit Alza again, and no call ever pages through the whole ~4000-locker
 * network. The list carries name, address and GPS but not opening hours.
 * Those live in the per-place detail, `/places/{deliveryId}/{parcelShopId}`
 * (SN3): hours vary per locker (e.g. "Nonstop" vs mall hours "09:00 - 21:00"),
 * so they are looked up best-effort for the returned lockers only, at most
 * {@link MAX_HOURS_LOOKUPS} sequential requests per call, cached for
 * {@link HOURS_TTL_MS}.
 *
 * Product fit: the list says nothing about whether a given product fits a
 * locker. Alza routes large items (observed: 34"+ monitors) away from the
 * whole AlzaBox network; only the cart flow (`delivery_options`) knows.
 */
export interface FindPickupOptions {
  postalCode: string;
  radiusKm?: number;
  limit?: number;
  /** Restrict to one of these types. Default: both. */
  types?: Array<"alzabox" | "branch">;
}

/**
 * Canonical CZ/SK postal code: five digits, no space ("110 00" -> "11000").
 * Throws on blank or malformed input so a junk code never reaches the geocoder
 * (an empty `postalcode` made Nominatim answer with an arbitrary place).
 */
export function normalizePostalCode(input: string): string {
  const trimmed = input.trim();
  if (!/^\d{3}\s?\d{2}$/.test(trimmed)) {
    throw new Error(`postal_code must be a 5-digit Czech/Slovak postal code such as "110 00" or "11000" (got ${trimmed ? `"${trimmed}"` : "a blank value"})`);
  }
  return trimmed.replace(/\s+/g, "");
}

export interface FindPickupResult {
  points: PickupPoint[];
  /** Non-fatal problems, e.g. lockers unavailable while branches were returned. */
  warnings: string[];
}

/** GET a JSON document (absolute URL). Server wiring injects the
 * Cloudflare-capable transport chain; plain fetch gets a 403 bot wall. */
export type JsonGet = (url: string) => Promise<unknown>;

export interface PickupDeps {
  getJson?: JsonGet;
  /** Override the postal-code geocoder (tests). */
  geocode?: (postalCode: string) => Promise<{ lat: number; lng: number }>;
}

/** Locker list cache lifetime. The network changes rarely. */
export const LOCKER_TTL_MS = 12 * 60 * 60 * 1000;
/** Upstream page-size cap on `/api/salesNetwork/v1/places`. */
const LOCKER_PAGE = 100;
const ALZABOX_TYPE = 1;
/** Per-call cap on locker detail lookups for opening hours (politeness). */
export const MAX_HOURS_LOOKUPS = 10;
/** Locker detail cache lifetime. Labels are day-relative ("Dnes, 6. 10."), so keep it short. */
export const HOURS_TTL_MS = 60 * 60 * 1000;
const LOCKER_NOTE = "Self-service parcel locker.";
const LOCKER_NOTE_NO_HOURS = "Self-service parcel locker; opening hours were not looked up for this one.";

export interface AlzaBoxLocker {
  id: string;
  deliveryId?: number;
  parcelShopId?: number;
  name: string;
  address: string;
  city: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
}

export class Pickup {
  private readonly getJson: JsonGet;
  private readonly lockerCache = new TtlCache<string, AlzaBoxLocker[]>(LOCKER_TTL_MS, 200);
  private readonly hoursCache = new TtlCache<string, string>(HOURS_TTL_MS, 1000);

  constructor(
    private readonly locale: Locale,
    private readonly deps: PickupDeps = {}
  ) {
    this.getJson = deps.getJson ?? plainGetJson;
  }

  async findPickupPoints(opts: FindPickupOptions): Promise<FindPickupResult> {
    const radius = opts.radiusKm ?? 15;
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    // An empty list means "no preference", like an omitted one (the schema
    // documents "Default: both"); it must not silently return nothing.
    const types = new Set(opts.types && opts.types.length > 0 ? opts.types : ["alzabox", "branch"]);

    const postalCode = normalizePostalCode(opts.postalCode);
    const center = this.deps.geocode ? await this.deps.geocode(postalCode) : await this.geocodePostalCode(postalCode);
    const results: PickupPoint[] = [];
    const warnings: string[] = [];

    if (types.has("branch")) {
      const branches = this.branchesNear(center, radius)
        .filter((b) => b.country === this.locale.countryCode)
        .map((b) => seedToPoint(b, distanceKm(center, { lat: b.latitude, lng: b.longitude })));
      results.push(...branches);
    }

    if (types.has("alzabox")) {
      try {
        const lockers = await this.lockersNear(center);
        for (const l of lockers) {
          const d = distanceKm(center, { lat: l.latitude, lng: l.longitude });
          if (d <= radius) results.push(lockerToPoint(l, d));
        }
      } catch (err) {
        // Lockers alone were asked for: nothing useful to return.
        if (!types.has("branch")) throw err;
        warnings.push(`AlzaBox lockers could not be loaded (${errorMessage(err)}); showing showrooms only.`);
      }
    }

    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    const points = results.slice(0, limit);
    await this.addLockerHours(points);
    return { points, warnings };
  }

  /**
   * Best-effort: fill `openingHours` for the returned lockers from the
   * per-place detail (SN3). Only the first {@link MAX_HOURS_LOOKUPS} lockers
   * are looked up, sequentially, and each result is cached for
   * {@link HOURS_TTL_MS}. A failed lookup leaves that locker without hours.
   */
  private async addLockerHours(points: PickupPoint[]): Promise<void> {
    let lookups = 0;
    for (const p of points) {
      if (p.type !== "alzabox" || p.deliveryId === undefined || p.parcelShopId === undefined) continue;
      if (lookups >= MAX_HOURS_LOOKUPS) break;
      lookups++;
      const key = `${this.locale.baseUrl}|${p.deliveryId}/${p.parcelShopId}`;
      try {
        const hours = await this.hoursCache.memoize(key, async () =>
          parseOpeningHours(
            await this.getJson(`${this.locale.baseUrl}/api/salesNetwork/v1/places/${p.deliveryId}/${p.parcelShopId}`),
          ) ?? "",
        );
        if (hours) {
          p.openingHours = hours;
          p.note = LOCKER_NOTE;
        }
      } catch {
        // Keep the locker without hours; the list itself is still valid.
      }
    }
  }

  /** The 100 AlzaBoxes nearest to `center`, cached per ~100 m grid cell. */
  private async lockersNear(center: { lat: number; lng: number }): Promise<AlzaBoxLocker[]> {
    const lat = center.lat.toFixed(3);
    const lng = center.lng.toFixed(3);
    const key = `${this.locale.baseUrl}|${lat},${lng}`;
    return this.lockerCache.memoize(key, async () => {
      const url =
        `${this.locale.baseUrl}/api/salesNetwork/v1/places` +
        `?types%5B0%5D=${ALZABOX_TYPE}&latitude=${lat}&longitude=${lng}` +
        `&ordering=0&limit=${LOCKER_PAGE}&offset=0`;
      return parseSalesNetworkPlaces(await this.getJson(url));
    });
  }

  private branchesNear(center: { lat: number; lng: number }, radius: number): BranchSeed[] {
    return BRANCHES.filter(
      (b) => distanceKm(center, { lat: b.latitude, lng: b.longitude }) <= radius
    );
  }

  /**
   * Lightweight CZ/SK postal-code → (lat, lng) lookup using the public
   * Nominatim service (OpenStreetMap, nominatim.openstreetmap.org). The
   * normalised postal code and the storefront's country code are sent to that
   * third-party service (no Alza data, no API key); it is rate-limited to
   * ~1 req/s, so results are cached for a week under the normalised code.
   */
  private readonly geocodeCache = new TtlCache<string, { lat: number; lng: number }>(
    7 * 24 * 60 * 60 * 1000
  );

  private async geocodePostalCode(postalCode: string): Promise<{ lat: number; lng: number }> {
    postalCode = normalizePostalCode(postalCode);
    const key = `${this.locale.countryCode}:${postalCode}`;
    return this.geocodeCache.memoize(key, async () => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("postalcode", postalCode);
      url.searchParams.set("country", this.locale.countryCode);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      const res = await undiciFetch(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "alza-mcp-community/0.1.0 (postal-code-geocoder; +https://github.com/lukabudik/alza-mcp-community)",
        },
      });
      if (!res.ok) {
        throw new AlzaError(`Postal-code lookup (OpenStreetMap Nominatim, not Alza) failed with HTTP ${res.status}; try again later.`);
      }
      const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
      const first = arr[0];
      if (!first) {
        throw new UserError(`Unknown postal code ${truncateInput(postalCode)}: the geocoder (OpenStreetMap Nominatim) found no location for it in ${this.locale.countryCode}.`);
      }
      return { lat: Number(first.lat), lng: Number(first.lon) };
    });
  }
}

interface RawPlace {
  id?: unknown;
  deliveryId?: unknown;
  parcelShopId?: unknown;
  type?: unknown;
  typeText?: unknown;
  name?: unknown;
  addressText?: unknown;
  gpsPosition?: { latitude?: unknown; longitude?: unknown } | null;
}

/**
 * Parse a `/api/salesNetwork/v1/places` page into AlzaBox lockers. Entries
 * that aren't AlzaBoxes or lack GPS are dropped. `addressText` looks like
 * "Hradecká 1151/9, 50003 Hradec Králové": the part after the last comma is
 * "<PSČ> <city>".
 */
export function parseSalesNetworkPlaces(json: unknown): AlzaBoxLocker[] {
  const value = (json as { pickupPlaces?: { value?: unknown } } | null)?.pickupPlaces?.value;
  if (!Array.isArray(value)) {
    throw new UpstreamError(502, "salesNetwork places: unexpected response shape (no pickupPlaces.value)");
  }
  const out: AlzaBoxLocker[] = [];
  for (const raw of value as RawPlace[]) {
    const isBox = raw.type === ALZABOX_TYPE || raw.typeText === "AlzaBox";
    const lat = Number(raw.gpsPosition?.latitude);
    const lng = Number(raw.gpsPosition?.longitude);
    if (!isBox || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const addressText = typeof raw.addressText === "string" ? raw.addressText.trim() : "";
    const comma = addressText.lastIndexOf(",");
    const street = comma >= 0 ? addressText.slice(0, comma).trim() : addressText;
    const tail = comma >= 0 ? addressText.slice(comma + 1).trim() : "";
    const m = /^(\d{3})\s?(\d{2})\s+(.+)$/.exec(tail);
    out.push({
      id: typeof raw.id === "string" ? raw.id : String(raw.parcelShopId ?? raw.id ?? ""),
      deliveryId: typeof raw.deliveryId === "number" ? raw.deliveryId : undefined,
      parcelShopId: typeof raw.parcelShopId === "number" ? raw.parcelShopId : undefined,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.replace(/\s+/g, " ").trim() : "AlzaBox",
      address: street,
      city: m?.[3] ?? tail,
      postalCode: m ? `${m[1]} ${m[2]}` : undefined,
      latitude: lat,
      longitude: lng,
    });
  }
  return out;
}

function lockerToPoint(l: AlzaBoxLocker, distanceKm: number): PickupPoint {
  return {
    type: "alzabox",
    id: l.id,
    name: /alza/i.test(l.name) ? l.name : `AlzaBox ${l.name}`,
    address: l.address,
    city: l.city,
    postalCode: l.postalCode,
    latitude: l.latitude,
    longitude: l.longitude,
    distanceKm,
    parcelShopId: l.parcelShopId,
    deliveryId: l.deliveryId,
    note: LOCKER_NOTE_NO_HOURS,
  };
}

interface RawOpeningDay {
  label?: unknown;
  note?: unknown;
  intervals?: Array<{ label?: unknown }> | null;
}

/**
 * Turn a `/api/salesNetwork/v1/places/{deliveryId}/{parcelShopId}` detail into
 * a one-line opening-hours summary. Alza returns the next 7 days with
 * day-relative labels ("Dnes, 6. 10.", "Zítra, 7. 10.", "Čtvrtek, 8. 10.").
 * Identical days collapse to e.g. "Nonstop (all 7 days)"; otherwise each day is
 * listed. Returns undefined when the detail has no hours.
 */
export function parseOpeningHours(json: unknown): string | undefined {
  const days = (json as { detail?: { openingHours?: unknown } } | null)?.detail?.openingHours;
  if (!Array.isArray(days) || days.length === 0) return undefined;
  const parts = (days as RawOpeningDay[]).map((d) => {
    const intervals = Array.isArray(d.intervals)
      ? d.intervals.map((i) => (typeof i?.label === "string" ? i.label.trim() : "")).filter(Boolean)
      : [];
    const hours = intervals.length > 0 ? intervals.join(", ") : "closed";
    const note = typeof d.note === "string" && d.note.trim() ? ` (${d.note.trim()})` : "";
    return { label: typeof d.label === "string" ? d.label.trim() : "", value: `${hours}${note}` };
  });
  const first = parts[0]!.value;
  if (parts.every((p) => p.value === first)) return `${first} (all ${parts.length} days)`;
  return parts.map((p) => (p.label ? `${p.label}: ${p.value}` : p.value)).join("; ");
}

async function plainGetJson(url: string): Promise<unknown> {
  const res = await undiciFetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new UpstreamError(res.status, `GET ${url} failed`);
  return res.json();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function seedToPoint(seed: BranchSeed, distanceKm: number): PickupPoint {
  return {
    type: "branch",
    id: seed.id,
    name: seed.name,
    address: seed.address,
    city: seed.city,
    postalCode: seed.postalCode,
    latitude: seed.latitude,
    longitude: seed.longitude,
    distanceKm,
    openingHours: seed.openingHours,
    note: seed.note,
  };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 10) / 10;
}
