/**
 * تنبيهُ النفاد — **دالّةٌ خالصة** أيضاً.
 *
 * تأخذ المستوياتِ والقواعدَ وتُعيد الخروق. ولا تعرف من أين جاءت
 * المستويات: من القاعدة، أو من اختبارٍ يمرّر عشرةَ صفوفٍ بخطّ اليد.
 */

export type LevelRow = {
  inventory_item_id: string;
  location_id: string;
  stocked_quantity: number;
  reserved_quantity: number;
};

export type AlertRuleInput = {
  id: string;
  scope: "global" | "item" | "location" | "item_location";
  inventory_item_id?: string | null;
  location_id?: string | null;
  threshold_quantity: number;
  is_active?: boolean | null;
};

export type Breach = {
  inventory_item_id: string;
  location_id: string;
  available: number;
  threshold: number;
  rule_id: string;
  scope: AlertRuleInput["scope"];
};

const SPECIFICITY: Record<AlertRuleInput["scope"], number> = {
  item_location: 4,
  item: 3,
  location: 2,
  global: 1,
};

/**
 * أخصُّ قاعدةٍ نشطةٍ تنطبق، و`null` إن لم تنطبق واحدة.
 *
 * وعند تساوي الخصوصية يُؤخذ **الأدنى حدّاً**: قاعدتان بنفس النطاق
 * خطأٌ إداريّ، والاختيارُ الأحوطُ حينها أن يُنبَّه أبكر لا أن يُسكت.
 */
export function resolveThreshold(
  rules: AlertRuleInput[],
  itemId: string,
  locationId: string
): AlertRuleInput | null {
  const applicable = rules.filter((r) => {
    if (r.is_active === false) return false;
    switch (r.scope) {
      case "item_location":
        return r.inventory_item_id === itemId && r.location_id === locationId;
      case "item":
        return r.inventory_item_id === itemId;
      case "location":
        return r.location_id === locationId;
      case "global":
        return true;
      default:
        return false;
    }
  });

  if (!applicable.length) return null;

  return applicable.sort((a, b) => {
    const d = SPECIFICITY[b.scope] - SPECIFICITY[a.scope];
    if (d !== 0) return d;
    if (a.threshold_quantity !== b.threshold_quantity) {
      return a.threshold_quantity - b.threshold_quantity;
    }
    return a.id < b.id ? -1 : 1;
  })[0];
}

export function findBreaches(levels: LevelRow[], rules: AlertRuleInput[]): Breach[] {
  const out: Breach[] = [];

  for (const lvl of levels) {
    const rule = resolveThreshold(rules, lvl.inventory_item_id, lvl.location_id);
    if (!rule) continue;

    // المتاحُ لا الموجود: بضاعةٌ كلُّها محجوزةٌ نفدت وإن امتلأ الرفّ.
    const available =
      (Number(lvl.stocked_quantity) || 0) - (Number(lvl.reserved_quantity) || 0);

    if (available <= rule.threshold_quantity) {
      out.push({
        inventory_item_id: lvl.inventory_item_id,
        location_id: lvl.location_id,
        available,
        threshold: rule.threshold_quantity,
        rule_id: rule.id,
        scope: rule.scope,
      });
    }
  }

  // الأشدُّ نقصاً أوّلاً — فمن يفتح التقرير يرى ما يحترق قبل ما يدخّن.
  return out.sort((a, b) => a.available - b.available);
}
