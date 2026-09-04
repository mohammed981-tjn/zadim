import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { COUPON_POLICY_MODULE } from "../../../../modules/promotions";
import type PromotionsPolicyService from "../../../../modules/promotions/service";

type Body = {
  promotion_id?: string;
  per_customer_limit?: number | null;
  max_discount?: number | null;
  first_order_only?: boolean;
  priority?: number;
};

/**
 * سياساتُ الكوبونات — **المسارُ الذي كان ناقصاً**.
 *
 * ── ما كان يقع ───────────────────────────────────────────────────
 *
 * `zadim_coupon_policy` مبنيٌّ ومحروسٌ بقيودٍ ومُختبَرٌ ببوّابةٍ صمدت
 * تحت مئةٍ متزامنة — **ولا مسارَ إداريَّ يكتبه**. أي سياسةٌ لا
 * يستطيع أحدٌ ضبطَها إلا بـ`psql`.
 *
 * 🔴 وهذا **بالضبط** الصنفُ الذي بُني هذا التدقيقُ كلُّه لكشفه: قدرةٌ
 * مكتملةٌ مُختبَرةٌ لا يناديها مسارُ إنتاجٍ واحد، وبوّابتُها خضراءُ
 * لأنها تنادي الدالّةَ بيدها. وهو نصُّ القاعدة الحاكمة في `CLAUDE.md`.
 *
 * ── و`promotion_id` يُتحقَّق منه في Medusa ─────────────────────
 *
 * ⚠️ ولا مفتاحَ أجنبيَّ إلى `promotion`: جدولُ وحدةٍ أخرى، والربطُ
 * بمفتاحٍ عبر حدود الوحدات يكسر ترقياتِ Medusa. فيُقرأ العرضُ من
 * خدمته ويُرفض المعرّفُ المجهول — **ورمزُه يُنسخ للقراءة** كي يبقى
 * الدفترُ مقروءاً بعد حذف العرض.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotions = req.scope.resolve<PromotionsPolicyService>(COUPON_POLICY_MODULE);
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.promotion_id) filters.promotion_id = q.promotion_id;

  const [policies, count] = await promotions.listAndCountCouponPolicies(filters, {
    take: Math.min(Number(q.limit ?? 50) || 50, 200),
    skip: Number(q.offset ?? 0) || 0,
    order: { priority: "ASC" },
  });
  res.json({ policies, count });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const promotions = req.scope.resolve<PromotionsPolicyService>(COUPON_POLICY_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const promotionId = String(body.promotion_id ?? "").trim();
  if (!promotionId) {
    return res.status(400).json({
      error: { code: "PROMOTION_REQUIRED", message_ar: "معرّفُ العرض مطلوب." },
    });
  }

  // العرضُ يُقرأ من محرّكه — ورمزُه يُنسخ. ولا سياسةَ لعرضٍ لا وجودَ له:
  // صفٌّ يتيمٌ لا يُطبَّق أبداً ولا يشكو أحد.
  const { data: found } = await query.graph({
    entity: "promotion",
    fields: ["id", "code", "application_method.type"],
    filters: { id: promotionId },
  });
  const promotion = (found as any[])[0];
  if (!promotion) {
    return res.status(404).json({
      error: {
        code: "PROMOTION_NOT_FOUND",
        message_ar: "لا عرضَ بهذا المعرّف — أنشئه في لوحة العروض أوّلاً.",
      },
    });
  }

  const invalid = validate(body);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const policy = await promotions.createCouponPolicies({
      promotion_id: promotionId,
      promotion_code: promotion.code,
      per_customer_limit: body.per_customer_limit ?? null,
      max_discount: body.max_discount ?? null,
      first_order_only: Boolean(body.first_order_only),
      priority: body.priority ?? 100,
    } as any);
    return res.status(201).json({ policy, warning_ar: capWarning(body, promotion) });
  } catch (err) {
    const text = String((err as Error)?.message ?? "");
    // الفهرسُ الفريد: سياسةٌ واحدةٌ لكل عرض. وسياستان تعنيان سلوكاً
    // يتبع أيَّهما قُرئ أوّلاً — وهو أسوأُ من غياب السياسة.
    if (/IDX_zadim_coupon_policy_promotion|already exists|duplicate/i.test(text)) {
      return res.status(409).json({
        error: {
          code: "POLICY_EXISTS",
          message_ar: "لهذا العرض سياسةٌ بالفعل — عدّلها بدل إنشاء ثانية.",
        },
      });
    }
    throw err;
  }
}

/**
 * 🔴 **تنبيهُ السقف — يُقال للمدير لحظةَ ضبطه لا بعد شكوى عميل.**
 *
 * ── وهو مبنيٌّ على قياسٍ لا ظنّ ────────────────────────────────
 *
 * قِيس على Medusa 2.19 بقراءة القاعدة ومصدرِ سيرِ العمل:
 *
 * | ما بُحث عنه | ما وُجد |
 * |---|---|
 * | سقفُ مالٍ لكلّ طلب | **لا وجودَ له** — `promotion_application_method` فيه `max_quantity`، وهو سقفُ **كمية** |
 * | ميزانيةٌ مالية | `promotion_campaign_budget` بـ`limit`/`used` — **لكلّ الحملة لا لكلّ طلب** |
 * | هل يُقصّ الخصمُ بأيدينا؟ | **لا** — `updateCartPromotionsWorkflow` ينفّذ `removeLineItemAdjustmentsStep` ثمّ `createLineItemAdjustmentsStep` من `computeActions` |
 *
 * فأيُّ مبلغٍ نكتبه في `cart_line_item_adjustment` **يُمحى عند أوّل
 * إعادةِ حسابٍ للعروض** — وهي تقع مع كلّ تغيّرٍ في السلّة. ولذلك
 * السقفُ يعمل **بالرفض لا بالقصّ**: قرارٌ مقيسٌ لا تأجيلٌ كسول.
 *
 * ⚠️ **والأداةُ الصحيحةُ لسقفٍ لكلّ طلبٍ داخل المحرّك: كوبونُ مبلغٍ
 * ثابت** — فالسقفُ هو المبلغُ نفسُه.
 */
export function capWarning(
  body: { max_discount?: number | null },
  promotion: { application_method?: { type?: string } | null }
): string | null {
  if (body.max_discount === undefined || body.max_discount === null) return null;
  if (promotion?.application_method?.type !== "percentage") return null;

  return (
    "هذا العرضُ نسبةٌ مئوية، والسقفُ يعمل عليه بالرفض لا بالقصّ: سلّةٌ " +
    "يتجاوز خصمُها السقفَ تُردّ برسالةٍ ولا يُقصّ خصمُها إليه. والسببُ " +
    "مقيس — محرّكُ Medusa يحذف التسويّاتِ ويُعيد بناءها من حسابه مع كلّ " +
    "تغيّرٍ في السلّة، فأيُّ قصٍّ بأيدينا يُمحى. ولسقفٍ يعمل بالقصّ " +
    "استعملْ كوبونَ مبلغٍ ثابت — فالسقفُ هو المبلغُ نفسُه. وللحدّ " +
    "الكلّيّ استعملْ ميزانيةَ الحملة في لوحة العروض."
  );
}

/**
 * التحقّقُ من الحدود — **ويُردّ برسالةٍ ولا يُقصّ بصمت**.
 *
 * ومديرٌ كتب صفراً يقصد «ممنوعٌ على الجميع»، وقصُّه إلى واحدٍ يعطيه
 * سلوكاً لم يطلبه ولا يعرف أنه وقع. والقاعدةُ ترفضه أيضاً — وهذا
 * يترجم الرفضَ لا يستبدله.
 */
export function validate(body: Body): { code: string; message_ar: string } | null {
  if (body.per_customer_limit !== undefined && body.per_customer_limit !== null) {
    const n = Number(body.per_customer_limit);
    if (!Number.isInteger(n) || n < 1) {
      return {
        code: "LIMIT_RANGE",
        message_ar:
          "الحدُّ لكل عميلٍ عددٌ صحيحٌ من ١ فأعلى. ولإيقاف الكوبون استعملْ حالتَه في لوحة العروض — لا حدَّ صفرٍ يبدو حدّاً وهو إطفاء.",
      };
    }
  }

  if (body.max_discount !== undefined && body.max_discount !== null) {
    const n = Number(body.max_discount);
    // بالهللات صحيحةً (ADR-008): «١٠٠» هنا ريالٌ واحدٌ لا مئة.
    if (!Number.isInteger(n) || n < 1) {
      return {
        code: "CAP_RANGE",
        message_ar: "سقفُ الخصم بالهللات صحيحةً من ١ فأعلى (١٠٠ هللة = ريال).",
      };
    }
  }

  if (body.priority !== undefined) {
    const n = Number(body.priority);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      return { code: "PRIORITY_RANGE", message_ar: "الترتيبُ عددٌ صحيحٌ بين ٠ و١٠٠٠٠." };
    }
  }

  return null;
}
