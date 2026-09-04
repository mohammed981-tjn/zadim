import { MedusaService } from "@medusajs/framework/utils";
import { CouponPolicy, CouponRedemption } from "./models";

/**
 * سياساتُ الكوبونات — طبقتُنا فوق محرّك Medusa.
 *
 * ⚠️ **ولا تحرس ما تحرسه القاعدة**: الحدُّ لكل عميل مُطلِقٌ وفهرسٌ فريد،
 * والدفترُ لا يُعدَّل بمُطلِق. وفحصٌ هنا يُضاعف المنطقَ ولا يزيد أماناً.
 */
class PromotionsPolicyService extends MedusaService({
  CouponPolicy,
  CouponRedemption,
}) {
  /** سياسةُ عرضٍ بعينه — أو `null` فيعمل بحدود Medusa وحدَها. */
  async policyFor(promotionId: string) {
    if (!promotionId) return null;
    const rows = (await this.listCouponPolicies({ promotion_id: promotionId })) as any[];
    return rows[0] ?? null;
  }

  /** كم استهلك هذا العميلُ من هذا الكوبون — **يُعدّ ولا يُخزَّن**. */
  async redemptionsBy(promotionId: string, customerId: string): Promise<number> {
    if (!promotionId || !customerId) return 0;
    const rows = (await this.listCouponRedemptions({
      promotion_id: promotionId,
      customer_id: customerId,
    })) as any[];
    return rows.length;
  }

  /** ترتيبُ التطبيق لكلّ رمز — يقرؤه `orderByPriority`. */
  async priorityMap(): Promise<Map<string, number>> {
    const rows = (await this.listCouponPolicies({})) as any[];
    return new Map(rows.map((r) => [String(r.promotion_code), Number(r.priority)]));
  }
}

export default PromotionsPolicyService;
