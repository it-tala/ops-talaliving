import type { ProductStockRow } from "@/services/inventory/contracts";

/** One batch = one product for one customer order line (null = made for stock). */
export function batchKey(r: Pick<ProductStockRow, "product_code" | "project_line_id">) {
  return `${r.product_code}|${r.project_line_id ?? ""}`;
}

export function batchLabel(r: ProductStockRow) {
  return r.project_line_id
    ? `${r.project_code ?? "?"} · baris ${r.line_no ?? "?"}`
    : "Stok (tanpa pesanan)";
}
