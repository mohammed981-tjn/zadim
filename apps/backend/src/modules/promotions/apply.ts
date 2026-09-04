import { ContainerRegistrationKeys, Modules, PromotionActions } from "@medusajs/framework/utils";
import { updateCartPromotionsWorkflow } from "@medusajs/medusa/core-flows";
import { COUPON_POLICY_MODULE } from ".";
import type PromotionsPolicyService from "./service";
import { checkCoupon } from "./eligibility";

/**
 * وضعُ كوبونٍ على سلّة — **الوصل**، وهو ما يجعل بندَي ٢٦/٢٧ يعملان.
 *
 * ── ولماذا `REPLACE` برمزٍ واحدٍ لا `ADD` ───────────────────────
 *
 * `01-domain-model.md` §٣ يقرّر: **«ولا يجتمع كوبونان»**. و`REPLACE`
 * يمسح رموزَ التسويّات القائمة ثم يضع المُرسَل — فالقاعدةُ تصير
 * **بنيةً لا فحصاً**: لا مسارَ يضع اثنين أصلاً.
 *
 * ⚠️ **والعروضُ التلقائية تبقى**: قُرئ في `promotion-module` أن
 * `computeActions` يعيد إضافةَ كلِّ عرضٍ `is_automatic` مطابقٍ في كل
 * حساب. فـ`REPLACE` لا يُطفئها — يُبدّل الكوبونَ وحدَه.
 *
 * ── وترتيبُ الفحص: المحرّكُ أوّلاً ثم سياستُنا ───────────────────
 *
 * لأن سقفَ الخصم يحتاج **الخصمَ المحسوبَ فعلاً**، ولا يُعرف قبل أن
 * يحسبه المحرّك. فيوضع الكوبون، ثم يُقاس أثرُه، فإن خالف سياستَنا
 * **نُزع** وأُعيد سببٌ مقروء.
 */
export type ApplyOutcome =
  | { ok: true; code: string; discount_total: number }
  | { ok: false; code: string; message_ar: string };

export async function applyCoupon(
  scope: any,
  input: { cart_id: string; code: string; customer_id?: string | null }
): Promise<ApplyOutcome> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const promo: any = scope.resolve(Modules.PROMOTION);
  const policies = scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;

  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code) {
    return { ok: false, code: "CODE_REQUIRED", message_ar: "اكتبْ رمزَ الخصم." };
  }

  // العرضُ موجودٌ ونشط؟ — وهذا سؤالُ المحرّك لا سؤالُنا.
  const [promotion] = (await promo.listPromotions({ code })) as any[];
  if (!promotion) {
    return { ok: false, code: "CODE_INVALID", message_ar: "رمزُ الخصم غيرُ صحيح." };
  }
  if (promotion.is_automatic) {
    // عرضٌ تلقائيٌّ ليس كوبوناً — يُطبَّق على من ينطبق عليه بلا رمز.
    // وقبولُ رمزِه هنا يجعل «الرمز» يبدو سببَ الخصم وهو ليس كذلك.
    return { ok: false, code: "CODE_INVALID", message_ar: "رمزُ الخصم غيرُ صحيح." };
  }

  const before = await cartDiscount(query, input.cart_id);

  try {
    await updateCartPromotionsWorkflow(scope).run({
      input: { cart_id: input.cart_id, promo_codes: [code], action: PromotionActions.REPLACE },
    });
  } catch (err) {
    return {
      ok: false,
      code: "CODE_INVALID",
      message_ar: "رمزُ الخصم غيرُ صحيح.",
    };
  }

  const after = await cartDiscount(query, input.cart_id);

  // 🔴 خصمٌ صفرٌ ليس نجاحاً.
  //
  // المحرّكُ يقبل الرمزَ ولا يُنتج تسويةً حين لا تنطبق قواعدُه (سلّةٌ
  // دون الحدّ الأدنى، أو منتجٌ خارج المؤهَّل). ورسالةُ «طُبِّق» بخصمٍ
  // صفرٍ أسوأُ من رفضٍ صريح: العميلُ يؤكّد ظانّاً أنه وفّر.
  if (after <= before) {
    await removeCoupon(scope, input.cart_id);
    return {
      ok: false,
      code: "NOT_ELIGIBLE",
      message_ar: "هذا الرمزُ لا ينطبق على سلّتك الحالية.",
    };
  }

  const policy = await policies.policyFor(promotion.id);
  const customerId = String(input.customer_id ?? "").trim();
  const verdict = checkCoupon(
    policy
      ? {
          per_customer_limit: policy.per_customer_limit ?? null,
          max_discount: policy.max_discount ?? null,
          first_order_only: Boolean(policy.first_order_only),
        }
      : null,
    {
      redemptions_by_customer: customerId
        ? await policies.redemptionsBy(promotion.id, customerId)
        : 0,
      previous_orders: customerId ? await orderCount(query, customerId) : 0,
      computed_discount: after - before,
      is_guest: !customerId,
    }
  );

  if (!verdict.ok) {
    // ⚠️ ويُنزع فعلاً لا يُترك: سلّةٌ تحمل كوبوناً رُفض تُتمّ بخصمه.
    await removeCoupon(scope, input.cart_id);
    return { ok: false, code: verdict.code, message_ar: verdict.message_ar };
  }

  return { ok: true, code, discount_total: after };
}

export async function removeCoupon(scope: any, cartId: string): Promise<void> {
  await updateCartPromotionsWorkflow(scope).run({
    input: { cart_id: cartId, promo_codes: [], action: PromotionActions.REPLACE },
  });
}

async function cartDiscount(query: any, cartId: string): Promise<number> {
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "discount_total"],
    filters: { id: cartId },
  });
  return Math.round(Number((data?.[0] as any)?.discount_total ?? 0));
}

async function orderCount(query: any, customerId: string): Promise<number> {
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "status"],
    filters: { customer_id: customerId },
  });
  return ((data ?? []) as any[]).filter((o) => o.status !== "canceled").length;
}

/**
 * تسجيلُ استهلاك الكوبونات على طلبٍ وقع — **وبدونه الحدُّ حبرٌ**.
 *
 * ── ولماذا هنا لا عند وضع الكوبون على السلّة ────────────────────
 *
 * لأن سلّةً فيها كوبونٌ قد تُهجر. ولو عُدّ الاستهلاكُ عند الوضع لأحرق
 * عميلٌ حدَّه بفتح سلّةٍ وتركها — ثم لا يستطيع الشراء.
 *
 * ── ولا يُسقط الطلبَ إن تعذّر ──────────────────────────────────
 *
 * الطلبُ وقع والمالُ التُزم به. وتعذُّرُ قيدِ الاستهلاك عطلٌ يُصلَح،
 * لا سببٌ لردّ عميل — نفسُ منطق مشترِك الفاتورة. **ويُكتب تحذيراً**:
 * حدُّ كوبونٍ لم يُقيَّد حالٌ يجب أن تُرى في السجلّ.
 *
 * ⚠️ **والعميلُ الضيفُ لا يُسجَّل**: لا هويّةَ يُعدّ عليها. والكوبونُ
 * ذو الحدِّ لكل عميل مرفوضٌ للضيف أصلاً في `checkCoupon` — فلا ثقبَ
 * هنا، وإنما صفٌّ لا معنى له لو كُتب.
 */
export async function recordRedemptions(
  scope: any,
  input: { cart_id: string; order_id: string; customer_id?: string | null }
): Promise<number> {
  const customerId = String(input.customer_id ?? "").trim();
  if (!customerId) return 0;

  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const promo: any = scope.resolve(Modules.PROMOTION);
  const policies = scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER);

  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "items.adjustments.code"],
    filters: { id: input.order_id },
  });
  const codes = new Set<string>();
  for (const it of ((data?.[0] as any)?.items ?? []) as any[]) {
    for (const a of (it.adjustments ?? []) as any[]) {
      if (a?.code) codes.add(String(a.code));
    }
  }
  if (!codes.size) return 0;

  let written = 0;
  for (const code of codes) {
    try {
      const [promotion] = (await promo.listPromotions({ code })) as any[];
      // العروضُ التلقائية لا تُسجَّل: لا حدَّ لها لكلّ عميلٍ ولا رمزَ
      // يستعمله أحد — وتسجيلُها يُثقل الدفترَ بصفوفٍ لا تُقرأ.
      if (!promotion || promotion.is_automatic) continue;

      await policies.createCouponRedemptions({
        promotion_id: promotion.id,
        promotion_code: code,
        customer_id: customerId,
        cart_id: input.cart_id,
        order_id: input.order_id,
      } as any);
      written++;
    } catch (err) {
      logger.warn(
        `[zadim] ⚠️ لم يُقيَّد استهلاكُ الكوبون «${code}» للطلب ${input.order_id}: ` +
          `${String((err as Error)?.message ?? err)} — الحدُّ لكل عميلٍ غيرُ محسوبٍ لهذا الاستعمال.`
      );
    }
  }
  return written;
}
