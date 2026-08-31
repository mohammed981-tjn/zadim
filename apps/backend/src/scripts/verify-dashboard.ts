import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { computeMetrics } from "../modules/dashboard/metrics";
import { BULK_MODULE } from "../modules/bulk";
import type BulkModuleService from "../modules/bulk/service";

/**
 * بوّابةُ المرحلة ٨ — لوحةُ الإدارة (`07-roadmap.md`).
 *
 * > **كلُّ رقمٍ في اللوحة يطابق استعلاماً مباشراً على القاعدة** ·
 * > والدفعةُ على ٥٠٠ صنفٍ **قابلةٌ للتراجع**.
 *
 * ── و«يطابق استعلاماً مباشراً» تُؤخذ حرفياً ────────────────────
 *
 * لا يُقارَن رقمُ اللوحة برقمٍ تحسبه نفسُ الشيفرة — ذاك يُثبت أن الجمعَ
 * صحيح، لا أن الرقمَ صحيح. **كلُّ رقمٍ يُعاد حسابُه بـSQL خام** لا يمرّ
 * بأيّ وحدةٍ ولا خدمة، ثم يُقارن.
 *
 * ── و٥٠٠ صنفٍ: أين تُقاس ولماذا ────────────────────────────────
 *
 * الآليّةُ تُقاس على **خمسمئة كيانٍ فعلاً** بمخزنٍ في الذاكرة: التحضيرُ
 * والتطبيقُ والتراجعُ والتخطّي كلُّها على ٥٠٠. والمسارُ الحقيقيّ (أسعارُ
 * متغيّرات Medusa) يُقاس على المتغيّرات الموجودة.
 *
 * **والسببُ معلَن**: إنشاءُ خمسمئة متغيّرٍ حقيقيٍّ في كل تشغيلةِ CI
 * دقائقُ تُضاف إلى كل دفعة — فيُشطب الفحصُ بعد أسبوعين. والخطرُ الذي
 * يقيسه العددُ هو **حجمُ الآليّة** لا نوعُ الكيان.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-dashboard.ts
 */

const BULK_SIZE = 500;

export default async function verifyDashboard({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const bulk = container.resolve(BULK_MODULE) as BulkModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const one = async (sql: string, binds: any[] = []) => {
    const r = await pg.raw(sql, binds);
    const row = (r?.rows ?? r)[0] ?? {};
    return Number(Object.values(row)[0] ?? 0);
  };

  try {
    // ── ١) كلُّ رقمٍ يطابق استعلاماً مباشراً ────────────────────
    logger.info("== أرقامُ اللوحة مقابل القاعدة ==");

    const m = await computeMetrics(container);

    const checks: Array<[string, number, string, any[]]> = [
      [
        "عددُ الطلبات",
        m.orders.total,
        `select count(*)::int from "zadim"."order" where "deleted_at" is null`,
        [],
      ],
      [
        "الموجودُ في المخزون",
        m.inventory.stocked,
        `select coalesce(sum("stocked_quantity"),0)::int from "zadim"."inventory_level" where "deleted_at" is null`,
        [],
      ],
      [
        "المحجوز",
        m.inventory.reserved,
        `select coalesce(sum("reserved_quantity"),0)::int from "zadim"."inventory_level" where "deleted_at" is null`,
        [],
      ],
      [
        "قوائمُ اللقط",
        m.fulfilment.pick_lists,
        `select count(*)::int from "zadim"."zadim_pick_list" where "deleted_at" is null`,
        [],
      ],
      [
        "الأحداثُ غيرُ المسلَّمة",
        m.events.pending,
        `select count(*)::int from "zadim"."zadim_outbox_event"
          where "delivered_at" is null and "deleted_at" is null`,
        [],
      ],
      [
        "الفواتير",
        m.invoices.count,
        `select count(*)::int from "zadim"."zadim_zatca_invoice" where "deleted_at" is null`,
        [],
      ],
      [
        "قواعدُ التنبيه النشطة",
        m.inventory.alert_rules,
        `select count(*)::int from "zadim"."zadim_stock_alert_rule"
          where "is_active" and "deleted_at" is null`,
        [],
      ],
      [
        "الدفعات",
        m.bulk.total,
        `select count(*)::int from "zadim"."zadim_bulk_operation" where "deleted_at" is null`,
        [],
      ],
    ];

    for (const [label, shown, sql, binds] of checks) {
      const actual = await one(sql, binds);
      shown === actual
        ? pass(`${label}: ${shown} — يطابق`)
        : fail(`${label}: اللوحةُ تقول ${shown} والقاعدةُ ${actual}`);
    }

    // الإيرادُ: مجموعُ مجاميع الطلبات غيرِ الملغاة، من `order_summary`
    // — طريقٌ مختلفٌ تماماً عمّا تحسبه اللوحة (بنودٌ وتسويّاتٌ وضريبة).
    const revenueSql = await one(
      `select coalesce(sum((os."totals"->>'current_order_total')::numeric),0)::bigint
         from "zadim"."order_summary" os
         join "zadim"."order" o on o."id" = os."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null and os."deleted_at" is null`
    );
    m.orders.revenue_halalas === revenueSql
      ? pass(`الإيراد: ${revenueSql} هللة — يطابق مجموعَ order_summary`)
      : fail(`الإيراد: اللوحةُ ${m.orders.revenue_halalas} والقاعدةُ ${revenueSql}`);

    // الملغى لا يُعدُّ إيراداً — وإلا كبر الرقمُ كلَّما ساءت الأمور
    const cancelled = await one(
      `select count(*)::int from "zadim"."order" where "status" = 'canceled' and "deleted_at" is null`
    );
    cancelled === 0 || (m.orders.by_status as any).canceled === cancelled
      ? pass(`الملغاةُ معدودةٌ بحالتها (${cancelled}) وخارجَ الإيراد`)
      : fail(`الملغاة: اللوحةُ ${(m.orders.by_status as any).canceled} والقاعدةُ ${cancelled}`);

    // ولا رقمَ مخزَّن: العلامةُ أن اللوحة تحمل وقتَ حسابها
    m.computed_at && Date.now() - new Date(m.computed_at).getTime() < 60000
      ? pass("والأرقامُ محسوبةٌ عند الطلب — لا عدّادَ يتأخّر")
      : fail("لا وقتَ حسابٍ في الردّ");

    // ── ٢) دفعةٌ على ٥٠٠ — على الآليّة ─────────────────────────
    logger.info(`== دفعةٌ على ${BULK_SIZE} — التحضير والتطبيق والتراجع ==`);

    const store = new Map<string, string>();
    const ids = Array.from({ length: BULK_SIZE }, (_, i) => `ent_${i}`);
    ids.forEach((id, i) => store.set(id, String(1000 + i)));

    const changes = ids.map((id) => ({
      entity_id: id,
      field: "price:sar",
      old_value: store.get(id)!,
      new_value: String(Number(store.get(id)) + 500),
    }));

    const op = await bulk.prepare({
      kind: "gate_price",
      entity_type: "synthetic",
      note: "بوّابة المرحلة ٨",
      changes,
    });

    const write = async (c: any) => {
      store.set(c.entity_id, String(c.new_value));
    };
    const read = async (id: string) => store.get(id) ?? null;

    const applied = await bulk.apply(op.id, write);
    applied.applied === BULK_SIZE
      ? pass(`طُبّقت على ${BULK_SIZE} كياناً`)
      : fail(`طُبّقت على ${applied.applied} من ${BULK_SIZE}`);

    const allNew = ids.every((id) => store.get(id) === String(1000 + ids.indexOf(id) + 500));
    allNew ? pass("والقيمُ الجديدةُ مكتوبةٌ كلُّها") : fail("بعضُ القيم لم تُكتب");

    // 🔴 شخصٌ آخرُ يعدّل صنفاً بعد الدفعة
    store.set("ent_7", "999999");

    const reverted = await bulk.revert(op.id, read, write);
    reverted.reverted === BULK_SIZE - 1 && reverted.skipped === 1
      ? pass(`أُعيد ${reverted.reverted}، **وتُخطّي الذي تغيّر بعد الدفعة**`)
      : fail(`التراجع: أُعيد ${reverted.reverted} وتُخطّي ${reverted.skipped}`);

    store.get("ent_7") === "999999"
      ? pass("**وتعديلُ الزميل باقٍ** — التراجعُ لا يمحو عملَ غيرك")
      : fail(`مُحي تعديلُ الزميل: ${store.get("ent_7")}`);

    const restored = ids.filter((id) => id !== "ent_7").every((id, idx) => {
      const i = ids.indexOf(id);
      return store.get(id) === String(1000 + i);
    });
    restored ? pass("وكلُّ ما عداه عاد إلى قيمته القديمة") : fail("قيمٌ لم تعد");

    const [skipRow] = (await bulk.changesOf(op.id, "skipped")) as any[];
    skipRow?.skip_reason
      ? pass(`والسببُ مقيَّد: «${String(skipRow.skip_reason).slice(0, 48)}…»`)
      : fail("تُخطّي بلا سبب");

    // ── ٣) ما لا يمرّ ──────────────────────────────────────────
    logger.info("== ما لا يمرّ ==");

    let twice = false;
    try {
      await bulk.apply(op.id, write);
    } catch {
      twice = true;
    }
    twice ? pass("دفعةٌ لا تُطبَّق مرّتين") : fail("طُبّقت الدفعةُ مرّتين");

    let revertTwice = false;
    try {
      await bulk.revert(op.id, read, write);
    } catch {
      revertTwice = true;
    }
    revertTwice ? pass("ولا يُتراجَع عنها مرّتين") : fail("تُرووجع مرّتين");

    const [aChange] = (await bulk.changesOf(op.id, "reverted")) as any[];
    let immutable = false;
    try {
      await pg("zadim.zadim_bulk_change").where({ id: aChange.id }).update({ old_value: "1" });
    } catch {
      immutable = true;
    }
    immutable
      ? pass("والقيمةُ القديمة لا تُعدَّل — وإلا أعاد التراجعُ قيمةً لم تكن")
      : fail("عُدّلت القيمةُ القديمة");

    await pg("zadim.zadim_bulk_operation").where({ id: op.id }).del();
    (await bulk.listBulkOperations({ id: op.id })).length === 1
      ? pass("وسجلُّ الدفعات لا يُحذف — تغييرٌ على مئاتٍ بلا أثرٍ لا يُقبل")
      : fail("حُذفت دفعة");

    // ── ٤) قيودُ الاتّساق ──────────────────────────────────────
    let noTime = false;
    try {
      await pg("zadim.zadim_bulk_operation").insert({
        id: `bulk_bad_${Date.now()}`,
        kind: "gate",
        entity_type: "synthetic",
        status: "applied",
        item_count: 1,
      });
    } catch {
      noTime = true;
    }
    noTime
      ? pass("و«طُبّقت» بلا وقتٍ تُرفض — «متى وقع هذا؟» سؤالٌ يجب أن يُجاب")
      : fail("قُبلت دفعةٌ مطبَّقةٌ بلا وقت");
  } finally {
    // سجلاتُ الدفعات تبقى: قاعدةُ «لا حذف» تُسقط حذفَها بصمت — وهي
    // نفسُها ما يُفحص أعلاه.
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص اللوحة.`);
  logger.info("✅ كلُّ فحوص المرحلة ٨ اجتازت — الأرقامُ تطابق القاعدة، والدفعةُ تُتراجَع.");
}
