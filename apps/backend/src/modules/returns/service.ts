import { MedusaService } from "@medusajs/framework/utils";
import { ReturnPolicy, ReturnInspection, ReturnTransition } from "./models";
import { returnEligibility, type ReturnDecision, type ReturnPolicyInput } from "./policy";

/**
 * خدمةُ المرتجعات — السياسةُ وسجلُّ الفحص وحسابُ ما يُطلَق إلى الرفّ.
 *
 * ── ما ليس فيها، عمداً ───────────────────────────────────────────
 *
 * **لا تكتب في `inventory_level` ولا في `return`.** جداولُ وحداتٍ
 * أخرى. وهذه تُجيب أسئلةً: «هل يُقبل الإرجاع؟» و«كم يجوز أن يُطلَق من
 * هذا المرتجع؟» — ومن يناديها هو من يحرّك المخزون تحت الحارس.
 *
 * وهكذا يُختبر كلُّ هذا بصفوفٍ مكتوبةٍ بخطّ اليد بلا مستودعٍ ولا طلب.
 */
class ReturnsModuleService extends MedusaService({
  ReturnPolicy,
  ReturnInspection,
  ReturnTransition,
}) {
  /** السياسةُ النافذة — أو `null`. **والغيابُ منعٌ لا سماح**. */
  async policy(): Promise<ReturnPolicyInput | null> {
    const rows = await this.listReturnPolicies({});
    return (rows as any[])[0] ?? null;
  }

  /** الحكمُ الكامل: السياسةُ من القاعدة + معطياتُ الطلب. */
  async decide(args: {
    delivered_at?: Date | string | null;
    category_ids?: string[];
    is_opened?: boolean;
    order_total?: number;
    now?: Date;
  }): Promise<ReturnDecision> {
    return returnEligibility({ policy: await this.policy(), ...args });
  }

  /**
   * 🔴 **الكمّيةُ المسموحُ إطلاقُها إلى الرفّ من مرتجع.**
   *
   * وهي مجموعُ سطور الفحص التي نتيجتُها `resellable` **ناقصَ ما أُطلق
   * منها**. وكلُّ نتيجةٍ أخرى — تالفٌ أو ناقصٌ أو صنفٌ خطأ — **تُسقط
   * من الحساب ولا تُطرح منه**: التالفُ لا يخصم من السليم، فمرتجعٌ فيه
   * سليمةٌ وتالفةٌ يُطلِق واحدة.
   *
   * ويقرؤها المُطلِقُ في القاعدة أيضاً بنفس المنطق — فالحارسُ لا يثق
   * بأن أحداً نادى هذه الدالّة.
   */
  async releasableQuantity(returnId: string, inventoryItemId?: string | null): Promise<number> {
    const rows = (await this.listReturnInspections({
      return_id: returnId,
      outcome: "resellable",
    })) as any[];

    return rows
      .filter((r) => !inventoryItemId || r.inventory_item_id === inventoryItemId)
      .reduce((sum, r) => sum + Math.max(0, Number(r.quantity) - Number(r.released_quantity ?? 0)), 0);
  }

  /**
   * تسجيلُ فحص. **والسببُ إلزاميّ** — يفرضه النموذجُ والقاعدة.
   *
   * ولا `update` هنا ولا في أيّ مكان: السطرُ مُلحَقٌ لا يُعدَّل (قاعدةُ
   * `DO INSTEAD NOTHING` في الهجرة). ومن أراد تصحيحَ حكمٍ يكتب سطراً
   * جديداً — فيبقى الحكمان ويُرى التصحيح.
   */
  async inspect(input: {
    return_id: string;
    return_item_id?: string | null;
    inventory_item_id?: string | null;
    quantity: number;
    outcome: "resellable" | "damaged" | "missing" | "wrong_item";
    reason_ar: string;
    actor_id?: string | null;
  }) {
    const [row] = await this.createReturnInspections([input as any]);
    return row;
  }
}

export default ReturnsModuleService;
