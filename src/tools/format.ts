import type { Product, ProductReviews, SearchResult, Category, PickupPoint } from "../domain/types.js";

export function formatPrice(price: number | undefined, currency: string): string {
  if (price === undefined) return "—";
  return `${price.toLocaleString("cs-CZ")} ${currency}`;
}

export function formatProductLine(p: Product): string {
  const parts = [`**${p.name}**`];
  parts.push(`code: \`${p.code}\``);
  if (p.price !== undefined) parts.push(`${formatPrice(p.price, p.currency)}`);
  if (p.availability) parts.push(p.availability);
  if (p.rating !== undefined) parts.push(`★ ${p.rating.toFixed(1)}`);
  return `- ${parts.join(" · ")}\n  ${p.url}`;
}

export function formatSearchResult(res: SearchResult): string {
  if (res.products.length === 0) {
    return `No products found for **"${res.query}"**.`;
  }
  const lines: string[] = [
    `Found ${res.total} results for **"${res.query}"** (showing ${res.products.length}):`,
    "",
    ...res.products.map(formatProductLine),
  ];
  return lines.join("\n");
}

export function formatProduct(p: Product): string {
  const lines: string[] = [`# ${p.name}`, ``, `Code: \`${p.code}\``, `URL: ${p.url}`];
  if (p.price !== undefined) {
    let line = `Price: **${formatPrice(p.price, p.currency)}**`;
    if (p.originalPrice && p.originalPrice > p.price) {
      const save = p.originalPrice - p.price;
      line += ` (was ${formatPrice(p.originalPrice, p.currency)}, save ${formatPrice(save, p.currency)})`;
    }
    lines.push(line);
  }
  if (p.availability) lines.push(`Availability: ${p.availability}`);
  if (p.rating !== undefined) lines.push(`Rating: ★ ${p.rating.toFixed(1)} / 5`);
  if (p.brand) lines.push(`Brand: ${p.brand}`);
  if (p.category) lines.push(`Category: ${p.category}`);
  if (p.params && p.params.length > 0) {
    lines.push("", "## Specs");
    for (const param of p.params) {
      lines.push(`- **${param.name}**: ${param.value}`);
    }
  }
  return lines.join("\n");
}

export function formatReviews(r: ProductReviews): string {
  const lines: string[] = [`# Reviews for ${r.code}`];
  if (r.ratingAverage !== undefined) {
    lines.push(
      `Average: ★ ${r.ratingAverage.toFixed(1)}${r.reviewCount ? ` (${r.reviewCount} reviews)` : ""}`
    );
  }
  if (r.reviews.length === 0) {
    lines.push("", "_No individual reviews available._");
    return lines.join("\n");
  }
  lines.push("", "## Recent reviews");
  for (const rev of r.reviews) {
    const head = [rev.author ?? "Anonymous", rev.date, rev.rating !== undefined ? `★ ${rev.rating}` : null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`### ${head}`);
    if (rev.body) lines.push(rev.body);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatCategories(cats: Category[]): string {
  if (cats.length === 0) return "No categories.";
  return cats
    .map((c) => `- **${c.name}** (id: ${c.id})${c.childCount ? ` — ${c.childCount} subcategories` : ""}`)
    .join("\n");
}

export function formatPickupPoints(points: PickupPoint[]): string {
  if (points.length === 0) return "No pickup points found in the requested radius.";
  const lines: string[] = [];
  for (const p of points) {
    const head = `**${p.name}** (${p.type === "alzabox" ? "AlzaBox locker" : "showroom"})`;
    const distance = p.distanceKm !== undefined ? ` · ${p.distanceKm} km` : "";
    lines.push(`${head}${distance}`);
    lines.push(`  ${p.address}, ${p.city}${p.postalCode ? ` ${p.postalCode}` : ""}`);
    if (p.openingHours) lines.push(`  Open: ${p.openingHours}`);
    if (p.note) lines.push(`  ${p.note}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
