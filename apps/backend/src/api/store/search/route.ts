import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../../../modules/catalog";
import type CatalogModuleService from "../../../modules/catalog/service";
import { matchesAnyTerm, normalizeArabic } from "../../../modules/catalog/arabic";

/**
 * بحثُ المتجر (بند ٢).
 *
 * ── لماذا التطبيع في الطرفين ──────────────────────────────────────
 *
 * النصُّ المفهرَس مطبَّعٌ عند الكتابة، والاستعلامُ يُطبَّع هنا. وواحدٌ
 * بلا الآخر يُنتج فهرساً **لا يُطابَق أبداً**: نخزّن «ايفون» ويبحث
 * المستخدم عن «أيفون» فلا نجد شيئاً — وهو أسوأ أنواع العطل: النظام
 * يعمل ولا يُخطئ، ويردّ «لا نتائج» بثقة.
 *
 * ── ولماذا المرادفات ──────────────────────────────────────────────
 *
 * التطبيعُ يوحّد رسمَ العربية، ولا يجسر بين لغتين. فالمنتج عنوانُه
 * `iPhone 15 Pro` والمستخدمُ يكتب «ايفون» — ولا جذرَ يجمعهما.
 * والمرادفاتُ **بيانات** يضيفها المدير (ADR-006).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const raw = String(req.query.q ?? "").trim();
  if (!raw) {
    return res.json({ query: "", normalized: "", terms: [], products: [], count: 0 });
  }

  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const normalized = normalizeArabic(raw);
  const terms = await catalog.expandQuery(raw);

  // نقرأ الحقول التي يُطابَق عليها فقط — لا المنتجَ كاملاً لكل مرشَّح.
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "description", "status"],
    filters: { status: "published" },
  });

  // المطابقةُ على النصّ **المطبَّع** من الطرفين، **بكلماتٍ كاملةٍ أو
  // بادئاتٍ لا باحتواء**: `matchesAnyTerm` وحدَها تقرّر، ويناديها
  // سكربتُ الفحص نفسُه — فلا تفترق نسختان (انظر تعليقَها).
  // وهذا مقبولٌ لكتالوجٍ بحجمنا؛ ويوم يكبر ينتقل إلى فهرسٍ خارجيّ
  // خلف نفس هذه الواجهة (ADR-006) — والمُنادي لا يتغيّر.
  const matches = (products as any[]).filter((p) =>
    matchesAnyTerm(`${p.title ?? ""} ${p.description ?? ""} ${p.handle ?? ""}`, terms)
  );

  res.json({
    query: raw,
    normalized,
    terms,
    products: matches.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
    })),
    count: matches.length,
  });
}
