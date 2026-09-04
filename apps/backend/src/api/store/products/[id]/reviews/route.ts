import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { REVIEWS_MODULE } from "../../../../../modules/reviews";
import type ReviewsModuleService from "../../../../../modules/reviews/service";
import { identityFromToken } from "../../../../../modules/checkout/identity";

/**
 * تقييماتُ منتج — `GET` و`POST /store/products/:id/reviews`.
 *
 * 🔴 **ولا يُقبل `customer_id` من الجسم**، والشراءُ يُفحص في القاعدة
 * لا هنا (`zadim_guard_review_purchase_trg`). فما يقع هنا ترجمةُ
 * رفضِ المُطلِق إلى رسالةٍ يفهمها صاحبُها — لا حراسةٌ ثانية.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const reviews = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE);
  const productId = req.params.id;

  const [rows, summary] = await Promise.all([
    reviews.publishedFor(productId),
    reviews.summaryFor(productId),
  ]);

  res.json({
    // ⚠️ **ولا يُعاد `customer_id`.** التقييمُ عامٌّ يُقرأ بلا حساب،
    // ومعرّفُ العميل فيه يربط رأياً بشخصٍ لمن يجمع الردود.
    reviews: (rows as any[]).map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      created_at: r.created_at,
    })),
    summary,
  });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ لكتابة تقييم." },
    });
  }

  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;
  const rating = Number(body.rating);
  const lineItemId = String(body.order_line_item_id ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({
      error: { code: "RATING_RANGE", message_ar: "التقييمُ من ١ إلى ٥." },
    });
  }
  if (!lineItemId) {
    return res.status(400).json({
      error: {
        code: "PURCHASE_REQUIRED",
        message_ar: "لا تقييمَ بلا شراء — اختر الطلبَ الذي اشتريتَ منه.",
      },
    });
  }

  const reviews = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE);
  try {
    const created = await reviews.createReviews({
      product_id: req.params.id,
      customer_id: identity.customer_id,
      order_line_item_id: lineItemId,
      rating,
      body: typeof body.body === "string" && body.body.trim() ? body.body.trim() : null,
    } as any);

    // ⚠️ **ويُقال صراحةً إنه لم يُنشر بعد.** ولو رُدّ «تمّ» وحدَه لبحث
    // صاحبُه عن تقييمه على الصفحة فلا يجده، وظنّ المتجرَ ابتلعه.
    return res.status(201).json({
      review: { id: (created as any)?.id, status: "pending" },
      message_ar: "وصل تقييمُك، ويُنشر بعد المراجعة.",
    });
  } catch (err) {
    const text = String((err as Error)?.message ?? "");

    // رفضُ المُطلِق: «لا تقييمَ بلا شراء» بمعانيه الثلاثة.
    if (text.includes("zadim:")) {
      return res.status(403).json({
        error: {
          code: "PURCHASE_REQUIRED",
          message_ar: "لا تقييمَ بلا شراء — تأكّدْ أنك اشتريتَ هذا المنتج بهذا الطلب.",
        },
      });
    }
    // اصطدامُ القيد الفريد: قيّمه من قبل.
    if (/duplicate|unique|already exists/i.test(text)) {
      return res.status(409).json({
        error: { code: "ALREADY_REVIEWED", message_ar: "قيّمتَ هذا الشراءَ من قبل." },
      });
    }
    throw err;
  }
}
