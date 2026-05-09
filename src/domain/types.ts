export interface Product {
  /** Alza product code, e.g. "WEXOA002B0". This is the canonical identifier. */
  code: string;
  /** Numeric internal id used by REST endpoints. */
  id: number;
  name: string;
  url: string;
  image?: string;
  /** Price as a number in the locale's currency. */
  price?: number;
  /** Original / strike-through price, if discounted. */
  originalPrice?: number;
  currency: string;
  availability?: string;
  /** Rating on 0–5 scale (Alza serves 0–100, we normalize). */
  rating?: number;
  brand?: string;
  category?: string;
  /** Spec params (CPU socket, RAM type, etc.) — opaque key/values. */
  params?: ProductParam[];
}

export interface ProductParam {
  name: string;
  value: string;
}

export interface SearchResult {
  query: string;
  total: number;
  page: number;
  pageSize: number;
  products: Product[];
}

export interface Category {
  id: number;
  name: string;
  url?: string;
  parentId?: number;
  childCount?: number;
}

export interface ProductReview {
  author?: string;
  date?: string;
  rating?: number;
  body?: string;
}

export interface ProductReviews {
  code: string;
  ratingAverage?: number;
  reviewCount?: number;
  reviews: ProductReview[];
}

export interface PickupPoint {
  type: "alzabox" | "branch";
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  /** Distance from query point, in km. */
  distanceKm?: number;
  openingHours?: string;
  /** Free-form note (e.g. "24/7", "self-service"). */
  note?: string;
}
