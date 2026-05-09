import type { Catalog } from "../domain/catalog.js";

/**
 * MCP resource: alza://product/{code}
 * Returns the product as JSON. Browseable; agents can pull a product
 * without invoking a tool.
 */
export function createProductResource(catalog: Catalog) {
  return {
    name: "product",
    template: "alza://product/{code}",
    title: "Alza product by code",
    description: "Fetch full product details as JSON for a given Alza product code.",
    list: undefined,
    handler: async (uri: URL) => {
      // alza://product/WEXOA002B0  →  pathname is "/WEXOA002B0", host is "product"
      const code = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
      const product = await catalog.getProduct(code);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(product, null, 2),
          },
        ],
      };
    },
  };
}
