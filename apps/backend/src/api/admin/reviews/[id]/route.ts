import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { REVIEWS_MODULE } from "../../../../modules/reviews";
import type ReviewsModuleService from "../../../../modules/reviews/service";

/**
 * مراجعةُ تقييم — `POST /admin/reviews/:id` بـ`{ status }`.
 *
 * ── ولماذا مسارُ مراجعةٍ في نفس دفعة الميزة ─────────────────────
 *
 * لأن `status` يبدأ `pending` (والنشرُ الفوريُّ يجعل صفحةَ المنتج
 * لوحةَ إعلانات). **وميزةٌ تُكتب ولا تُنشر ميزةٌ لا تعمل**: يكتب
 * العملاءُ تقييماتٍ لا يراها أحدٌ أبداً، ولا شيءَ يشكو.
 *
 * فالمراجعةُ تصل مع الكتابة لا بعدها بدفعة.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;
  const status = String(body.status ?? "");

  if (!["published", "rejected", "pending"].includes(status)) {
    return res.status(400).json({
      error: { code: "BAD_STATUS", message_ar: "الحالة: published أو rejected أو pending." },
    });
  }

  const reviews = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE);
  const [existing] = await reviews.listReviews({ id: req.params.id }, { take: 1 });
  if (!existing) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا تقييمَ بهذا المعرّف." },
    });
  }

  await reviews.updateReviews({
    id: req.params.id,
    status,
    // سببُ الرفض يُحفظ: «رُفض» بلا سبب تجعل الدعمَ يخمّن حين يسأل
    // صاحبُه، والمراجعَ التالي يعيد الحكمَ من الصفر.
    moderation_note:
      typeof body.moderation_note === "string" ? body.moderation_note.trim() || null : null,
  } as any);

  res.json({ id: req.params.id, status });
}

/** قائمةُ المراجعة — المعلَّقةُ أوّلاً، وهي ما يفتحه المدير. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const reviews = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE);
  const [row] = await reviews.listReviews({ id: req.params.id }, { take: 1 });
  if (!row) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا تقييمَ بهذا المعرّف." },
    });
  }
  res.json({ review: row });
}
