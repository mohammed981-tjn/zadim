import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { REVIEWS_MODULE } from "../../../modules/reviews";
import type ReviewsModuleService from "../../../modules/reviews/service";

/**
 * سردُ التقييمات للمراجعة.
 *
 * ── 🔴 لماذا لم تكن المراجعةُ ممكنةً أصلاً ────────────────────────
 *
 * كان في `/admin/reviews/:id` مسارُ **حكمٍ** (`POST` بـ`status`) ولا
 * مسارَ **سرد**. أي أن المراجعَ يستطيع أن ينشر تقييماً **لو عرف
 * معرّفَه**، ولا شيءَ يعطيه المعرّفات.
 *
 * وأثرُ ذلك ليس نقصَ راحة: التقييماتُ تبدأ `pending` بقصد، والنشرُ
 * لا يقع إلا بمراجعة. فبلا سردٍ **لا يُنشَر تقييمٌ أبداً** — يكتب
 * العملاءُ ولا يرى أحدٌ شيئاً، ولا خطأَ في أيّ سجلّ. وهذا هو
 * «ميزةٌ تُكتب ولا تُنشر ميزةٌ لا تعمل» بعينه، وقد كُتب في تعليق
 * مسارِ الحكم نفسِه ثم وقع.
 *
 * والافتراضُ `pending` لا «الكلّ»: من يفتح الشاشةَ يفتحها ليراجع.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const reviews = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE);

  const status = String(req.query.status ?? "pending");
  const filter: Record<string, unknown> = {};
  // «all» تعني بلا مُرشِّح — لا حالةً اسمُها all.
  if (status !== "all") filter.status = status;
  if (req.query.product_id) filter.product_id = String(req.query.product_id);

  const take = Math.min(Number(req.query.limit ?? 50), 200);
  const skip = Number(req.query.offset ?? 0);

  const [rows, count] = await reviews.listAndCountReviews(filter, {
    take,
    skip,
    order: { created_at: "DESC" },
  });

  res.json({ reviews: rows, count, limit: take, offset: skip });
}
