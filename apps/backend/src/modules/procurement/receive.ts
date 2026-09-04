import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from ".";
import type ProcurementModuleService from "./service";
import { FINANCE_MODULE } from "../finance";
import type FinanceModuleService from "../finance/service";

/**
 * **الوصل** — وهو ما يجعل بند ٣٣ يعمل لا يوجد فقط (`07-roadmap.md`:
 * «أوامرُ الشراء **تزيد المخزون**»).
 *
 * ── ثلاثةُ آثارٍ لفعلٍ واحد، وترتيبُها ليس اعتباطاً ───────────────
 *
 * ١. **الإيصالُ يُكتب أوّلاً** — وبكتابته يُحدّث مُطلِقُ القاعدة عدّادَ
 *    السطر ويُقفل الأمرَ إن اكتمل، **ويرفض الاستلامَ الزائد بقيد**.
 *    فإن سقط شيءٌ بعدَه سقط بلا أن يزيد المخزون.
 * ٢. **ثم يزيد المخزون** — داخل معاملةٍ مضبوطةِ السبب والمرجع، فيكتب
 *    مُطلِقُ `zadim_stock_movement` سطراً سببُه `receipt` ومرجعُه أمرُ
 *    الشراء. والدفترُ يُكتب في القاعدة لا هنا (لا مسارَ كتابةٍ له بحال).
 * ٣. **ثم تُكتب التكلفة** — صفٌّ في `zadim_variant_cost` بسعرِ السطر.
 *
 * ── ولماذا الثالثةُ أهمُّ ممّا تبدو ──────────────────────────────
 *
 * `zadim_variant_cost` كان يصل الإنتاجَ **فارغاً**: العمودُ محروسٌ
 * ومجمَّدٌ ولا كاتبَ له. وكلُّ يومٍ يبيع فيه المتجرُ بلا تكلفةٍ مسجّلة
 * يومٌ **لا يمكن معرفةُ ربحه أبداً** — لأن السطرَ يُجمّد `unit_cost`
 * لحظةَ وقوعه ولا يُملأ بأثرٍ رجعيّ. فالاستلامُ هو الكاتبُ الطبيعيّ:
 * السعرُ الذي دُفع فعلاً، من الورقة التي دُفع بها.
 *
 * ⚠️ **ولا يُكتب صفُّ تكلفةٍ لإيصالٍ سالب**: التصحيحُ يُرجع بضاعةً ولا
 * يعني أننا اشترينا بسعرٍ سالب.
 */
export type ReceiveInput = {
  purchase_order_line_id: string;
  quantity: number;
  actor_id?: string | null;
  actor_label?: string | null;
  note?: string | null;
};

export type ReceiveOutcome =
  | { ok: true; receipt_id: string; stocked_after: number; cost_recorded: boolean }
  | { ok: false; code: string; message_ar: string };

export async function receivePurchaseLine(
  scope: any,
  input: ReceiveInput
): Promise<ReceiveOutcome> {
  const procurement = scope.resolve(PROCUREMENT_MODULE) as ProcurementModuleService;
  const finance = scope.resolve(FINANCE_MODULE) as FinanceModuleService;
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const qty = Number(input.quantity);
  if (!Number.isInteger(qty) || qty === 0) {
    return {
      ok: false,
      code: "QUANTITY_INVALID",
      message_ar: "الكميةُ عددٌ صحيحٌ غيرُ صفر (والسالبُ تصحيحُ استلام).",
    };
  }

  const [line] = (await procurement.listPurchaseOrderLines({
    id: input.purchase_order_line_id,
  })) as any[];
  if (!line) {
    return { ok: false, code: "LINE_NOT_FOUND", message_ar: "لا سطرَ بهذا المعرّف." };
  }

  const [order] = (await procurement.listPurchaseOrders({
    id: line.purchase_order_id,
  })) as any[];
  if (!order) {
    return { ok: false, code: "ORDER_NOT_FOUND", message_ar: "لا أمرَ شراءٍ لهذا السطر." };
  }

  // ── ١) الإيصال — والقاعدةُ تحرس ما بعده ────────────────────────
  let receiptId = "";
  try {
    const receipt = (await procurement.createPurchaseReceipts({
      purchase_order_id: line.purchase_order_id,
      purchase_order_line_id: line.id,
      quantity: qty,
      received_by: input.actor_id ?? null,
      received_by_label: input.actor_label ?? null,
      note: input.note ?? null,
    } as any)) as any;
    receiptId = receipt?.id;
  } catch (err) {
    const text = String((err as Error)?.message ?? "");
    // رفضُ المُطلِق أو القيد يُترجَم إلى رسالةٍ يفهمها المستلم — ولا
    // يُبتلع: بضاعةٌ تُرفض بلا سببٍ مقروء تُدخَل ثانيةً بيدٍ أخرى.
    if (/quantity_received|received_range/i.test(text)) {
      return {
        ok: false,
        code: "OVER_RECEIPT",
        message_ar: `الاستلامُ يتجاوز المطلوب — وصل ${line.quantity_received} من ${line.quantity_ordered}.`,
      };
    }
    if (text.includes("zadim:")) {
      return {
        ok: false,
        code: "RECEIPT_REFUSED",
        message_ar: text.replace(/^.*zadim:\s*/, ""),
      };
    }
    throw err;
  }

  // ── ٢) المخزون — بسببٍ ومرجعٍ يقرؤهما دفترُ الحركات ────────────
  let stockedAfter = 0;
  await pg.transaction(async (trx: any) => {
    await trx.raw(`select set_config('zadim.movement_reason', 'receipt', true)`);
    await trx.raw(`select set_config('zadim.movement_reference_type', 'purchase_order', true)`);
    await trx.raw(`select set_config('zadim.movement_reference_id', ?, true)`, [
      line.purchase_order_id,
    ]);
    await trx.raw(`select set_config('zadim.movement_actor_id', ?, true)`, [
      input.actor_id ?? "",
    ]);

    // 🔴 `for update` على صفّ المستوى: مستلمان متزامنان على نفس الرفّ
    // يقرآن نفسَ الرصيد فيكتب الثاني فوق الأوّل — فتضيع كميةُ أحدهما
    // من الرصيد بينما إيصالاها كلاهما مكتوب.
    const rows = await trx.raw(
      `select "id", "stocked_quantity", "incoming_quantity" from "inventory_level"
        where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null
        for update`,
      [line.inventory_item_id, order.location_id]
    );
    const level = rows?.rows?.[0];
    if (!level) {
      throw new Error(
        `zadim: لا مستوى مخزونٍ للصنف ${line.inventory_item_id} في الموقع ${order.location_id}`
      );
    }

    stockedAfter = Number(level.stocked_quantity) + qty;
    // القادمُ ينقص بما وصل ولا يصير سالباً: أمرٌ لم يُحجز قادمُه (أُنشئ
    // قبل هذه الدفعة) لا يجعل الرقمَ سالباً بعد استلامه.
    const incomingAfter = Math.max(0, Number(level.incoming_quantity ?? 0) - qty);

    await trx.raw(
      `update "inventory_level"
          set "stocked_quantity" = ?, "incoming_quantity" = ?, "updated_at" = now()
        where "id" = ?`,
      [stockedAfter, incomingAfter, level.id]
    );
  });

  // ── ٣) التكلفة — للموجب وحدَه ─────────────────────────────────
  let costRecorded = false;
  if (qty > 0) {
    await finance.recordCost({
      variant_id: line.variant_id,
      unit_cost: Number(line.unit_cost),
      source: "purchase_order",
      note: `أمرُ شراء ${line.purchase_order_id}`,
    });
    costRecorded = true;
  }

  return { ok: true, receipt_id: receiptId, stocked_after: stockedAfter, cost_recorded: costRecorded };
}

/**
 * إرسالُ أمرٍ إلى المورّد — والكمياتُ تصير **قادمة**.
 *
 * و`incoming` ليس تجميلاً: هو ما يمنع طلبَ نفس البضاعة مرّتين. ومديرُ
 * مخزونٍ يرى «صفرٌ متاح» ولا يرى «مئةٌ قادمة» يُصدر أمراً ثانياً.
 */
export async function placePurchaseOrder(
  scope: any,
  purchaseOrderId: string
): Promise<{ ok: true; lines: number } | { ok: false; code: string; message_ar: string }> {
  const procurement = scope.resolve(PROCUREMENT_MODULE) as ProcurementModuleService;
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const [order] = (await procurement.listPurchaseOrders({ id: purchaseOrderId })) as any[];
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND", message_ar: "لا أمرَ بهذا المعرّف." };

  const lines = (await procurement.listPurchaseOrderLines({
    purchase_order_id: purchaseOrderId,
  })) as any[];
  if (!lines.length) {
    // أمرٌ بلا سطورٍ يُرسَل إلى مورّدٍ يعني ورقةً فارغة. ويُمنع هنا لا
    // في القاعدة: القاعدةُ لا تعرف «فارغ» — تعرف صفوفاً.
    return { ok: false, code: "ORDER_EMPTY", message_ar: "لا سطورَ في هذا الأمر." };
  }

  try {
    await procurement.updatePurchaseOrders({
      id: purchaseOrderId,
      status: "placed",
      placed_at: new Date(),
    } as any);
  } catch (err) {
    const text = String((err as Error)?.message ?? "");
    if (text.includes("zadim:")) {
      return { ok: false, code: "TRANSITION_REFUSED", message_ar: text.replace(/^.*zadim:\s*/, "") };
    }
    throw err;
  }

  await pg.transaction(async (trx: any) => {
    for (const l of lines) {
      await trx.raw(
        `update "inventory_level"
            set "incoming_quantity" = coalesce("incoming_quantity", 0) + ?, "updated_at" = now()
          where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null`,
        [Number(l.quantity_ordered), l.inventory_item_id, order.location_id]
      );
    }
  });

  return { ok: true, lines: lines.length };
}
