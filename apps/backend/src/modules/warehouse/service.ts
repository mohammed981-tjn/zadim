import { MedusaService } from "@medusajs/framework/utils";
import { LocationProfile, StockMovement, StockAlertRule } from "./models";
import {
  planAllocation,
  type AllocationInput,
  type AllocationPlan,
} from "./allocation";
import {
  findBreaches,
  resolveThreshold,
  type AlertRuleInput,
  type Breach,
  type LevelRow,
} from "./alerts";

/**
 * خدمةُ المستودعات: الملفّاتُ والدفترُ وقواعدُ التنبيه.
 *
 * ── ما ليس فيها، عمداً ───────────────────────────────────────────
 *
 * **لا تقرأ `inventory_level`.** جدولُ وحدةٍ أخرى، وقراءتُه من هنا
 * تربط الوحدتين برباطٍ لا يظهر في أيّ إعلان. فالمنطقُ يأخذ المستوياتِ
 * **معطىً** (`levels`, `availability`)، ومن يناديه هو من يجمعها من
 * وحدة المخزون. وهذا يجعل الاختيارَ والتنبيهَ قابلين للاختبار بصفوفٍ
 * مكتوبةٍ بخطّ اليد، بلا مستودعٍ ولا مادةٍ ولا قاعدة.
 */
class WarehouseModuleService extends MedusaService({
  LocationProfile,
  StockMovement,
  StockAlertRule,
}) {
  /** خطّةُ الشحن: من أيّ مستودعٍ يخرج كلُّ بند. */
  planAllocation(input: AllocationInput): AllocationPlan {
    return planAllocation(input);
  }

  /** المستوياتُ التي بلغت حدَّ التنبيه أو نزلت دونه. */
  findBreaches(levels: LevelRow[], rules: AlertRuleInput[]): Breach[] {
    return findBreaches(levels, rules);
  }

  resolveThreshold(rules: AlertRuleInput[], itemId: string, locationId: string) {
    return resolveThreshold(rules, itemId, locationId);
  }

  /**
   * قواعدُ التنبيه النشطة، جاهزةً للدالّة الخالصة.
   */
  async activeAlertRules(): Promise<AlertRuleInput[]> {
    const rules = await this.listStockAlertRules({ is_active: true });
    return rules.map((r: any) => ({
      id: r.id,
      scope: r.scope,
      inventory_item_id: r.inventory_item_id,
      location_id: r.location_id,
      threshold_quantity: Number(r.threshold_quantity),
      is_active: r.is_active,
    }));
  }

  // ── الدفترُ يُلحَق ولا يُمسّ ───────────────────────────────────
  //
  // القاعدةُ تمنعه بـ`DO INSTEAD NOTHING`، وهذا يمنعه **في الكود**
  // بخطأٍ صريح. والفرق: القاعدةُ تُسقط الكتابةَ **بصمت** (وهو المطلوب
  // منها — أن يمرّ Medusa بلا انفجار)، وهنا يجب أن ينفجر: من يكتب
  // `updateStockMovements` يعرف خطأه في الاختبار لا بعد سنةٍ حين يكتشف
  // أن تعديلاته لم تُحفظ قطّ.
  //
  // وتُكتب حقولاً لا دوالَّ لأن الصنف المولَّد يعرّفها حقولاً.
  updateStockMovements = async (): Promise<never> => {
    throw new Error("[zadim] دفترُ الحركات يُلحَق ولا يُعدَّل.");
  };

  deleteStockMovements = async (): Promise<never> => {
    throw new Error("[zadim] دفترُ الحركات يُلحَق ولا يُحذف.");
  };

  softDeleteStockMovements = async (): Promise<never> => {
    throw new Error("[zadim] دفترُ الحركات يُلحَق ولا يُحذف.");
  };
}

export default WarehouseModuleService;
