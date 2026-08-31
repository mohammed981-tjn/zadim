import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../../../../../modules/catalog";
import type CatalogModuleService from "../../../../../modules/catalog/service";

const ENTITY_QUERY: Record<string, { entity: string; title: string; desc: string }> = {
  product: { entity: "product", title: "title", desc: "description" },
  category: { entity: "product_category", title: "name", desc: "description" },
};

/**
 * بياناتُ SEO لصفحة — بارتدادٍ مبنيّ حين لا يكتبها أحد.
 *
 * والواجهةُ تسأل هذا المسار وتضع ما يصلها في `<head>` — فلا تعرف أنّ
 * بعضَه محفوظٌ وبعضَه مبنيّ.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const kind = String(req.params.entity);
  const spec = ENTITY_QUERY[kind];
  if (!spec) {
    return res.status(400).json({
      error: { code: "INVALID_ENTITY", message_ar: `كيانٌ غير مدعوم: «${kind}»` },
    });
  }

  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: spec.entity,
    fields: ["id", spec.title, spec.desc],
    filters: { id: req.params.id },
  });

  const record = (data as any[])[0];
  if (!record) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا كيانَ بهذا المعرّف" },
    });
  }

  const seo = await catalog.getSeo({
    entity: kind as any,
    entity_id: req.params.id,
    locale: String(req.query.locale ?? "ar"),
    fallback: { title: record[spec.title], description: record[spec.desc] },
  });

  res.json({ seo });
}
