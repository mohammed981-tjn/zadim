import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "./index";
import type WarehouseModuleService from "./service";
import { FINANCE_MODULE } from "../finance";
import type FinanceModuleService from "../finance/service";

/**
 * تسويةُ المخزون — **طلبٌ ثمّ موافقةٌ ثمّ أثر**.
 *
 * ── ولماذا ثلاثُ خطواتٍ لا واحدة ─────────────────────────────────
 *
 * شرطُ القبول يُقاس **بالأثر**: «الرصيدُ لا يتغيّر قبل الموافقة
 * الثانية». وتسويةٌ تقع ثمّ تُراجَع تعني أن البضاعةَ خرجت من الدفتر
 * ساعةً على الأقلّ — وفي تلك الساعة يُطلَب الصنفُ ولا يُباع، أو
 * يُعاد شراؤه بلا حاجة.
 *
 * ⚠️ **والقرارُ يُثبَّت عند الطلب لا عند التطبيق**: `needs_approval`
 * تُحسب مرّةً وتُخزَّن. ولو حُسبت عند التطبيق لأمكن خفضُ الحدّ في
 * السياسة بعد طلبِ تسويةٍ كبيرة، فتمرّ بلا موافقةٍ لأن الحدَّ تغيّر
 * بينهما. والسياسةُ التي تحكم تسويةً هي سياسةُ **يومِ طلبها**.
 */

export type RequestInput = {
  inventory_item_id: string;
  location_id: string;
  delta: number;
  reason?: "adjustment" | "stocktake" | "damage" | "correction";
  requested_by: string;
  note?: string | null;
};

export type AdjustOutcome =
  | { ok: true; id: string; needs_approval: boolean; value_halalas: number | null }
  | { ok: false; code: string; message_ar: string };

/** قيمةُ التسوية من التكلفة المجمَّدة — أو `null` إن لم تُسجَّل. */
async function valueOf(scope: any, inventoryItemId: string, qty: number): Promise<number | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const finance = scope.resolve(FINANCE_MODULE) as FinanceModuleService;

  // صنفُ المخزون ⇐ المتغيّر ⇐ التكلفة.
  const { data: links } = await query.graph({
    entity: "product_variant_inventory_item",
    fields: ["variant_id"],
    filters: { inventory_item_id: inventoryItemId },
  });
  const variantId = (links as any[])[0]?.variant_id;
  if (!variantId) return null;

  const cost = await finance.currentCost(variantId);
  return cost === null ? null : Math.abs(qty) * cost;
}

/**
 * طلبُ تسوية. **ولا أثرَ الآن** — يُكتب صفٌّ ينتظر.
 */
export async function requestAdjustment(
  scope: any,
  input: RequestInput
): Promise<AdjustOutcome> {
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;

  const delta = Number(input.delta);
  if (!Number.isInteger(delta) || delta === 0) {
    return {
      ok: false,
      code: "DELTA_INVALID",
      message_ar: "الفرقُ عددٌ صحيحٌ غيرُ صفر (والسالبُ نقصٌ).",
    };
  }
  if (!input.requested_by) {
    return {
      ok: false,
      code: "ACTOR_REQUIRED",
      message_ar: "لا تسويةَ بلا طالبٍ معروف — ومن لا يُعرف لا يُحاسَب.",
    };
  }

  const policy = await warehouse.adjustmentPolicy();
  if (!policy.is_enabled) {
    return {
      ok: false,
      code: "ADJUSTMENTS_DISABLED",
      message_ar: "التسويةُ اليدويةُ موقوفةٌ حالياً (جردٌ مقفل).",
    };
  }

  const value = await valueOf(scope, input.inventory_item_id, delta);

  // 🔴 **أيُّهما وقع أوّلاً**: الكمّيةُ أو القيمة. و«عشرُ قطعٍ» حدٌّ
  // معقولٌ لأقلامٍ وبابٌ مفتوحٌ لهواتف — ومن أراد السرقةَ يختار الغالي.
  //
  // ⚠️ وصنفٌ بلا تكلفةٍ يُقاس بالكمّية وحدَها، ويُقال ذلك في الردّ:
  // «مرّت لأن قيمتَها مجهولة» جملةٌ يجب أن يقرأها المدير.
  const byQty = Math.abs(delta) > policy.threshold_quantity;
  const byValue = value !== null && value > policy.threshold_value_halalas;
  const needsApproval = byQty || byValue;

  const row = (await warehouse.createStockAdjustments({
    inventory_item_id: input.inventory_item_id,
    location_id: input.location_id,
    delta,
    reason: input.reason ?? "adjustment",
    state: "pending",
    needs_approval: needsApproval,
    requested_by: input.requested_by,
    value_halalas: value,
    note: input.note ?? null,
  } as any)) as any;

  return {
    ok: true,
    id: row.id,
    needs_approval: needsApproval,
    value_halalas: value,
  };
}

/**
 * الموافقة — **ومن طلب لا يوافق**.
 *
 * والقيدُ في القاعدة (`zadim_stock_adjustment_two_eyes`) هو الحكم، لا
 * هذا الشرط: مسارٌ آخرُ لا يمرّ بهذه الدالّة يجب أن يُمنع أيضاً.
 * وهذا يترجم رفضَ القاعدة إلى رسالةٍ عربيةٍ مفهومة.
 */
export async function approveAdjustment(
  scope: any,
  id: string,
  approvedBy: string
): Promise<AdjustOutcome> {
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;

  const [row] = (await warehouse.listStockAdjustments({ id })) as any[];
  if (!row) return { ok: false, code: "NOT_FOUND", message_ar: "لا تسويةَ بهذا المعرّف." };
  if (row.state !== "pending") {
    return {
      ok: false,
      code: "NOT_PENDING",
      message_ar: `التسويةُ في حالة «${row.state}» ولا تُوافَق.`,
    };
  }

  try {
    await warehouse.updateStockAdjustments({
      id,
      state: "approved",
      approved_by: approvedBy,
      approved_at: new Date(),
    } as any);
  } catch (err) {
    const text = String((err as Error)?.message ?? "");
    if (/two_eyes/i.test(text)) {
      return {
        ok: false,
        code: "SELF_APPROVAL",
        message_ar:
          "لا يوافق أحدٌ على تسويةِ نفسِه — والموافقةُ الثانيةُ لا تمنع السرقة، تمنع إخفاءَها بلا شريك.",
      };
    }
    throw err;
  }

  return { ok: true, id, needs_approval: row.needs_approval, value_halalas: row.value_halalas };
}

export async function rejectAdjustment(
  scope: any,
  id: string,
  rejectedBy: string,
  reason: string
): Promise<AdjustOutcome> {
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;
  const [row] = (await warehouse.listStockAdjustments({ id })) as any[];
  if (!row) return { ok: false, code: "NOT_FOUND", message_ar: "لا تسويةَ بهذا المعرّف." };
  if (row.state === "applied") {
    return {
      ok: false,
      code: "ALREADY_APPLIED",
      message_ar: "طُبّقت التسويةُ — والتصحيحُ بتسويةٍ مقابلةٍ لا برفضٍ متأخّر.",
    };
  }

  await warehouse.updateStockAdjustments({
    id,
    state: "rejected",
    reject_reason: reason || "بلا سبب",
    approved_by: rejectedBy !== row.requested_by ? rejectedBy : null,
  } as any);
  return { ok: true, id, needs_approval: row.needs_approval, value_halalas: row.value_halalas };
}

/**
 * التطبيق — **وهنا وحدَه يتغيّر الرصيد**.
 *
 * ويُكتب المخزونُ داخل معاملةٍ تحمل سببَ الحركة ومرجعَها وفاعلَها في
 * متغيّرات الجلسة، فيقرؤها مُطلِقُ دفتر الحركات — نفسُ ما يفعله
 * استلامُ المشتريات. **ولا مسارَ ثانٍ يكتب المخزون بلا دفتر.**
 */
export async function applyAdjustment(
  scope: any,
  id: string,
  appliedBy: string
): Promise<AdjustOutcome & { stocked_after?: number }> {
  const warehouse = scope.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const [row] = (await warehouse.listStockAdjustments({ id })) as any[];
  if (!row) return { ok: false, code: "NOT_FOUND", message_ar: "لا تسويةَ بهذا المعرّف." };
  if (row.state === "applied") {
    return { ok: false, code: "ALREADY_APPLIED", message_ar: "طُبّقت التسويةُ من قبل." };
  }
  if (row.state === "rejected") {
    return { ok: false, code: "REJECTED", message_ar: "التسويةُ مرفوضةٌ ولا تُطبَّق." };
  }
  if (row.needs_approval && !row.approved_by) {
    // والقاعدةُ تمنعه أيضاً — وهذا يترجم لا يستبدل.
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      message_ar: "التسويةُ تجاوزت الحدَّ وتنتظر موافقةَ شخصٍ ثانٍ.",
    };
  }

  let stockedAfter = 0;
  await pg.transaction(async (trx: any) => {
    await trx.raw(`select set_config('zadim.movement_reason', ?, true)`, [row.reason]);
    await trx.raw(`select set_config('zadim.movement_reference_type', 'stock_adjustment', true)`);
    await trx.raw(`select set_config('zadim.movement_reference_id', ?, true)`, [row.id]);
    await trx.raw(`select set_config('zadim.movement_actor_id', ?, true)`, [appliedBy || ""]);

    // 🔴 `for update` على صفّ المستوى: تسويتان متزامنتان على نفس الرفّ
    // تقرآن نفسَ الرصيد وتكتبان فوق بعضهما بلا قفل.
    const cur = await trx.raw(
      `select "stocked_quantity" from "inventory_level"
        where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null
        for update`,
      [row.inventory_item_id, row.location_id]
    );
    const before = Number((cur?.rows ?? [])[0]?.stocked_quantity);
    if (!Number.isFinite(before)) {
      throw new Error("zadim: لا مستوى مخزونٍ لهذا الصنف في هذا الموقع");
    }

    stockedAfter = before + Number(row.delta);
    if (stockedAfter < 0) {
      // ⚠️ ولا رصيدَ سالب: الرفُّ لا يحمل ناقصَ ثلاث. والخطأُ مقروءٌ
      // لا صامت — تسويةٌ تُقصّ إلى صفرٍ تُخفي أن الجردَ غلط.
      throw new Error(
        `zadim: التسويةُ تُنزل الرصيدَ إلى ${stockedAfter} — والرفُّ لا يحمل سالباً (الحاليّ ${before})`
      );
    }

    await trx.raw(
      `update "inventory_level" set "stocked_quantity" = ?, "updated_at" = now()
        where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null`,
      [stockedAfter, row.inventory_item_id, row.location_id]
    );
  });

  await warehouse.updateStockAdjustments({
    id,
    state: "applied",
    applied_by: appliedBy,
    applied_at: new Date(),
  } as any);

  return {
    ok: true,
    id,
    needs_approval: row.needs_approval,
    value_halalas: row.value_halalas,
    stocked_after: stockedAfter,
  };
}
