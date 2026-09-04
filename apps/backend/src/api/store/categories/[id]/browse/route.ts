import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../../../../../modules/catalog";
import type CatalogModuleService from "../../../../../modules/catalog/service";
import type { Selection } from "../../../../../modules/catalog/service";

/**
 * `GET /store/categories/:id/browse` — **التصفيةُ بالخصائص** (بند ٣).
 *
 * ── لماذا نداءٌ واحدٌ يُعيد المنتجاتِ والفلاترَ معاً ───────────────
 *
 * لأن الأعدادَ **تتغيّر مع كلّ اختيار**. فلو جُلبت المنتجاتُ من مسارٍ
 * والفلاترُ من آخر لوصل أحدُهما قبل الآخر، فيرى الزائرُ منتجاتٍ مصفّاةً
 * وأعداداً قديمةً لثوانٍ — يضغط «أزرق (٥)» فيجد ثلاثة. ونداءٌ واحدٌ
 * يجعلهما لقطةً واحدةً متّسقة.
 *
 * ── شكلُ المُعامل ───────────────────────────────────────────────
 *
 * `?attr[color]=أحمر&attr[color]=أزرق&attr[size]=L`
 *
 * ⚠️ **ولا يُمرَّر معاملٌ مجهولٌ إلى Medusa.** هذا بالضبط ما كان يقع
 * قبلها: كلُّ معاملٍ في العنوان يُمرَّر إلى `/store/products` «ليفسّره
 * الخادم»، وهو **يرفض** ما لا يعرفه — فأوّلُ نقرةٍ على لونٍ تُعيد ٤٠٠
 * لا نتائجَ مصفّاة.
 *
 * وهذه الدالّةُ تفحص **الشكلَ** وحدَه. أما «هل هذه خاصيةٌ في هذا
 * التصنيف؟» فتقرّره `browseCategory` وتُسقط ما ليس كذلك — وإسقاطُه
 * هناك لا هنا لأن الجوابَ يعتمد على التصنيف لا على الرابط.
 */

/** سقفُ القيم لخاصيةٍ واحدة — رابطٌ بألف قيمةٍ استنزافٌ لا تصفية. */
const MAX_VALUES_PER_ATTRIBUTE = 20;

function readSelection(query: unknown): Selection {
  const attr = (query as any)?.attr;
  if (!attr || typeof attr !== "object" || Array.isArray(attr)) return {};

  const out: Selection = {};
  for (const [code, raw] of Object.entries(attr)) {
    // رمزُ الخاصية يُقيَّد: يدخل في مقارنةِ خرائطَ لا في SQL، لكن رمزاً
    // بألف حرفٍ يملأ السجلَّات بلا فائدة.
    if (typeof code !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(code)) continue;
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .slice(0, MAX_VALUES_PER_ATTRIBUTE);
    if (values.length) out[code] = values;
  }
  return out;
}

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
  const selection = readSelection(req.query);

  const { product_ids, filters } = await catalog.browseCategory(
    categoryId,
    productIds,
    selection
  );

  res.json({
    category: { id: category.id, name: category.name },
    /** المعرّفاتُ فقط — والواجهةُ تجلب تفاصيلَها من `/store/products`
     *  بترجمتها وأسعارِ منطقتها، وهو ما لا تعرفه هذه الوحدة. */
    product_ids,
    count: product_ids.length,
    filters,
  });
}
