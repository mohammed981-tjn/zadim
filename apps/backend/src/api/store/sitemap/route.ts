import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../../../modules/catalog";
import type CatalogModuleService from "../../../modules/catalog/service";

/**
 * خريطةُ الموقع (بند ٣٨).
 *
 * 🔴 و`no_index` **يُحترم هنا**: صفحةٌ ممنوعةٌ من الفهرسة ومذكورةٌ في
 * الخريطة رسالتان متناقضتان لجوجل — «افهرسني» و«لا تفهرسني» — وهو
 * يُبلّغ عنها تحذيراً في Search Console ويثق بالموقع أقلّ.
 *
 * ويُعيد JSON لا XML: الواجهةُ هي من يملك النطاق فتبني `<urlset>`
 * بروابطها الكاملة. والخادمُ لا يعرف نطاقَه أصلاً خلف وكيلٍ عكسيّ.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const [{ data: products }, { data: categories }] = await Promise.all([
    query.graph({
      entity: "product",
      fields: ["id", "handle", "updated_at"],
      filters: { status: "published" },
    }),
    query.graph({
      entity: "product_category",
      fields: ["id", "handle", "updated_at"],
      filters: { is_active: true },
    }),
  ]);

  const hidden = new Set(
    (await catalog.listSeoMetas({ no_index: true })).map(
      (s: any) => `${s.entity}:${s.entity_id}`
    )
  );

  const entries = [
    ...(products as any[])
      .filter((p) => !hidden.has(`product:${p.id}`))
      .map((p) => ({ path: `/products/${p.handle}`, updated_at: p.updated_at, priority: 0.8 })),
    ...(categories as any[])
      .filter((c) => !hidden.has(`category:${c.id}`))
      .map((c) => ({ path: `/categories/${c.handle}`, updated_at: c.updated_at, priority: 0.6 })),
  ];

  res.json({ entries, count: entries.length });
}
