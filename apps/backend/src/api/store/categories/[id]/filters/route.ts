import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../../../../../modules/catalog";
import type CatalogModuleService from "../../../../../modules/catalog/service";

/**
 * فلاترُ تصنيفٍ — **مولَّدةً لا مبرمَجة** (بند ٣).
 *
 * الواجهةُ ترسم ما يصلها ولا تعرف أن «إلكترونيات» فيها سعةٌ و«ملابس»
 * فيها مقاس. فإضافةُ تصنيفٍ بخصائصَ جديدة **لا تمسّ سطرَ كودٍ واحداً**
 * لا في الخادم ولا في الواجهة.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const categoryId = req.params.id;

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "products.id"],
    filters: { id: categoryId },
  });

  const category = (categories as any[])[0];
  if (!category) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا تصنيفَ بهذا المعرّف" },
    });
  }

  const productIds = (category.products ?? []).map((p: any) => p.id);
  const filters = await catalog.getCategoryFilters(categoryId, productIds);

  res.json({ category: { id: category.id, name: category.name }, filters });
}
