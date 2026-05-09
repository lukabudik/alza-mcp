import { fetch as undiciFetch } from "undici";
import { BRANCHES, type BranchSeed } from "../data/branches.js";
import { TtlCache } from "../infra/cache.js";
import { UpstreamError } from "../infra/errors.js";
import type { Locale } from "../infra/locale.js";
import { log } from "../infra/logger.js";
import type { PickupPoint } from "./types.js";

/**
 * AlzaBox locker discovery is not currently available — the api.alzabox.cz
 * host noted in older docs is no longer resolvable, and AlzaBox locations
 * live on the alza.cz/alzabox.htm map page (DOM scrape needed). v0.1 ships
 * with branch-only results; AlzaBox lockers land in v0.2.
 */
const ALZABOX_API_DISABLED = true;

interface AlzaboxApiBox {
  id?: string | number;
  name?: string;
  street?: string;
  city?: string;
  postcode?: string;
  postalCode?: string;
  zipCode?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  latitude?: number;
  longitude?: number;
  openingHours?: string;
  description?: string;
  note?: string;
}

export interface FindPickupOptions {
  postalCode: string;
  radiusKm?: number;
  limit?: number;
  /** Restrict to one of these types. Default: both. */
  types?: Array<"alzabox" | "branch">;
}

export class Pickup {
  private readonly boxCache = new TtlCache<string, PickupPoint[]>(60 * 60 * 1000);

  constructor(private readonly locale: Locale) {}

  async findPickupPoints(opts: FindPickupOptions): Promise<PickupPoint[]> {
    const radius = opts.radiusKm ?? 15;
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    const types = new Set(opts.types ?? ["alzabox", "branch"]);

    const center = await this.geocodePostalCode(opts.postalCode);

    const results: PickupPoint[] = [];

    if (types.has("branch")) {
      const branches = this.branchesNear(center, radius)
        .filter((b) => b.country === this.locale.countryCode)
        .map((b) => seedToPoint(b, distanceKm(center, { lat: b.latitude, lng: b.longitude })));
      results.push(...branches);
    }

    if (types.has("alzabox") && !ALZABOX_API_DISABLED) {
      const boxes = await this.alzaboxesNear(opts.postalCode, center, radius);
      results.push(...boxes);
    }

    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return results.slice(0, limit);
  }

  private branchesNear(center: { lat: number; lng: number }, radius: number): BranchSeed[] {
    return BRANCHES.filter(
      (b) => distanceKm(center, { lat: b.latitude, lng: b.longitude }) <= radius
    );
  }

  private async alzaboxesNear(
    postalCode: string,
    center: { lat: number; lng: number },
    radius: number
  ): Promise<PickupPoint[]> {
    const cached = this.boxCache.get(`all`);
    let boxes = cached;
    if (!boxes) {
      try {
        boxes = await this.fetchAllAlzaboxes();
        this.boxCache.set(`all`, boxes);
      } catch (err) {
        log.warn("alzabox API unavailable, returning branches only", {
          error: (err as Error).message,
        });
        boxes = [];
      }
    }
    return boxes
      .map((b) => ({
        ...b,
        distanceKm: distanceKm(center, { lat: b.latitude ?? 0, lng: b.longitude ?? 0 }),
      }))
      .filter((b) => (b.distanceKm ?? Infinity) <= radius)
      .map((b) => {
        // Prefer an exact postal-code match when distance is similar.
        if (b.postalCode === postalCode) b.distanceKm = Math.min(b.distanceKm ?? 0, 0.1);
        return b;
      });
  }

  private async fetchAllAlzaboxes(): Promise<PickupPoint[]> {
    // Disabled in v0.1 — guarded above. Kept in source so we can flip it on
    // once we DOM-scrape alza.cz/alzabox.htm in v0.2.
    const url = `https://disabled.example/api/v2/boxes`;
    const res = await undiciFetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "alza-mcp/0.1.0 (+https://github.com/lukabudik/alza-mcp)",
      },
    });
    if (!res.ok) {
      throw new UpstreamError(res.status, `AlzaBox API: ${res.statusText}`);
    }
    const body = (await res.json()) as { boxes?: AlzaboxApiBox[] } | AlzaboxApiBox[];
    const list = Array.isArray(body) ? body : body.boxes ?? [];
    return list
      .filter((b) => isFinite(b.gpsLatitude ?? b.latitude ?? NaN))
      .map<PickupPoint>((b) => ({
        type: "alzabox",
        id: String(b.id ?? `${b.gpsLatitude}-${b.gpsLongitude}`),
        name: b.name ?? "AlzaBox",
        address: b.street ?? "",
        city: b.city ?? "",
        postalCode: b.postcode ?? b.postalCode ?? b.zipCode,
        latitude: b.gpsLatitude ?? b.latitude,
        longitude: b.gpsLongitude ?? b.longitude,
        openingHours: b.openingHours ?? "24/7",
        note: b.description ?? b.note,
      }));
  }

  /**
   * Lightweight CZ/SK postal-code → (lat, lng) lookup using the public
   * Nominatim service (OpenStreetMap). No API key required, but rate-limited
   * to ~1 req/s — we cache aggressively.
   */
  private readonly geocodeCache = new TtlCache<string, { lat: number; lng: number }>(
    7 * 24 * 60 * 60 * 1000
  );

  private async geocodePostalCode(postalCode: string): Promise<{ lat: number; lng: number }> {
    const key = `${this.locale.countryCode}:${postalCode}`;
    return this.geocodeCache.memoize(key, async () => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("postalcode", postalCode.replace(/\s+/g, ""));
      url.searchParams.set("country", this.locale.countryCode);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      const res = await undiciFetch(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "alza-mcp/0.1.0 (postal-code-geocoder; +https://github.com/lukabudik/alza-mcp)",
        },
      });
      if (!res.ok) {
        throw new UpstreamError(res.status, `geocode failed for ${postalCode}`);
      }
      const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
      const first = arr[0];
      if (!first) {
        throw new UpstreamError(404, `unknown postal code ${postalCode}`);
      }
      return { lat: Number(first.lat), lng: Number(first.lon) };
    });
  }
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
