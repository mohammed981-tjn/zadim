import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { computeMetrics } from "../modules/dashboard/metrics";
import { summarizeOrders, computeMargin } from "../modules/dashboard/business-metrics";
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
    //
    // و`round` **داخل** الجمع لا خارجه (ADR-034): وحدةُ التقريب الطلبُ
    // لأنه ما يُحصَّل ويُفوتَر. وتقريبُ المجموع وحدَه يُعطي رقماً لا
    // يطابق مجموعَ الفواتير، ثم تُطارَد الهللاتُ في تسوية آخر الشهر.
    const revenueSql = await one(
      `select coalesce(sum(round((os."totals"->>'current_order_total')::numeric)),0)::bigint
         from "zadim"."order_summary" os
         join "zadim"."order" o on o."id" = os."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null and os."deleted_at" is null`
    );
    m.orders.gmv_halalas === revenueSql
      ? pass(`إجمالي المبيعات GMV: ${revenueSql} هللة — يطابق مجموعَ order_summary`)
      : fail(`GMV: اللوحةُ ${m.orders.gmv_halalas} والقاعدةُ ${revenueSql}`);

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

    // ── ١ب) أرقامُ العمل — ولكلٍّ تعريفٌ مكتوب ──────────────────
    //
    // 🔴 **والفاحصُ يسلك طريقاً آخر**: اللوحةُ تقرأ مجاميعَ Medusa
    // المحسوبة، وهذا يعيد بناءَها من **السطور والأجرة والتسويّات
    // وأسطر الضريبة**. ولو قرآ من مكانٍ واحدٍ لصار التطابقُ حتميّاً
    // ولم يحرس شيئاً.
    logger.info("== أرقامُ العمل — والمصطلحاتُ تُعرَّف ==");

    const b = m.business;

    // ⚠️ **والتعريفُ يُفحص قبل الرقم**: قاموسٌ يذكر حقلاً لا وجودَ له،
    // أو حقلٌ يُعلَن بلا سطرٍ في القاموس — كلاهما يعيد المشكلةَ التي
    // بُني القاموسُ لحلّها.
    const { readFileSync } = await import("fs");
    const dict = readFileSync("../../docs/business-rules.md", "utf8");
    const declared = Object.keys(b).filter((k) => k !== "definitions");
    const undocumented = declared.filter((k) => !dict.includes(k));
    undocumented.length === 0
      ? pass(`وكلُّ الحقول الـ${declared.length} لها تعريفٌ في business-rules.md`)
      : fail(`حقولٌ تُعلَن بلا تعريف: ${undocumented.join("، ")}`);

    // ── الهويّةُ المحاسبية: التركيبُ يجمع إلى الكلّ ──────────────
    //
    // وهي أقوى ما في هذه المجموعة: لا تقارن رقماً برقم بل تفحص أن
    // **القطع تُركّب الكلَّ**. فحقلٌ يُحسب بشرطٍ مختلفٍ عن إخوته يظهر
    // هنا ولو طابق كلٌّ منهما استعلامَه وحدَه.
    const identity =
      b.items_net_halalas + b.shipping_net_halalas + b.tax_halalas === b.gmv_halalas;
    identity
      ? pass(
          `والهويّةُ تُغلق: أصناف ${b.items_net_halalas} + شحن ${b.shipping_net_halalas}` +
            ` + ضريبة ${b.tax_halalas} = GMV ${b.gmv_halalas}`
        )
      : fail(
          `الهويّةُ لا تُغلق: ${b.items_net_halalas}+${b.shipping_net_halalas}+${b.tax_halalas}` +
            ` ≠ ${b.gmv_halalas} (فرقٌ ${b.gmv_halalas - b.items_net_halalas - b.shipping_net_halalas - b.tax_halalas})`
        );

    // ── مبيعاتُ الأصناف من السطور نفسِها ────────────────────────
    //
    // (الكميّةُ × سعرُ الوحدة) − تسويّاتُ السطر. وهذا طريقٌ لا يمرّ
    // بأيّ مجموعٍ يحسبه Medusa.
    const itemsSql = await one(
      `select coalesce(round(sum(oi."quantity" * li."unit_price")),0)::bigint
             - coalesce((
                 select round(sum(a."amount"))
                   from "order_line_item_adjustment" a
                   join "order_line_item" li2 on li2."id" = a."item_id" and li2."deleted_at" is null
                   join "order_item" oi2 on oi2."item_id" = li2."id" and oi2."deleted_at" is null
                   join "order" o2 on o2."id" = oi2."order_id"
                  where o2."status" <> 'canceled' and o2."deleted_at" is null and a."deleted_at" is null
               ), 0)::bigint
         from "order_line_item" li
         join "order_item" oi on oi."item_id" = li."id" and oi."deleted_at" is null
         join "order" o on o."id" = oi."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null and li."deleted_at" is null`
    );
    b.items_net_halalas === itemsSql
      ? pass(`مبيعاتُ الأصناف قبل الضريبة: ${itemsSql} — من (كميّة × سعر) − التسويّات`)
      : fail(`الأصناف: اللوحةُ ${b.items_net_halalas} والسطورُ ${itemsSql}`);

    // ── الشحنُ من الأجرة نفسِها ─────────────────────────────────
    const shipSql = await one(
      `select coalesce(round(sum(sm."amount")),0)::bigint
         from "order_shipping_method" sm
         join "order_shipping" os on os."shipping_method_id" = sm."id" and os."deleted_at" is null
         join "order" o on o."id" = os."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null and sm."deleted_at" is null`
    );
    b.shipping_net_halalas === shipSql
      ? pass(`الشحنُ قبل الضريبة: ${shipSql} — يطابق مجموعَ الأجرة`)
      : fail(`الشحن: اللوحةُ ${b.shipping_net_halalas} والأجرةُ ${shipSql}`);

    // ── والضريبةُ **بالطرح** لا بقراءةِ حقلها ──────────────────
    //
    // ⚠️ وجداولُ أسطر الضريبة تحمل **النسبةَ لا المبلغ** (`rate` بلا
    // `total`): المبلغُ محسوبٌ لا مخزَّن. فجمعُها مباشرةً غيرُ ممكن،
    // وإعادةُ حسابه بالنسبة تعيد بناءَ تقريبِ Medusa سطراً سطراً —
    // فتصير البوّابةُ نسخةً ثانيةً من الكود الذي تفحصه.
    //
    // والطرحُ طريقٌ مستقلٌّ فعلاً: المجموعُ من `order_summary`،
    // والأصنافُ والشحنُ من السطور. فما بقي ضريبةٌ بالضرورة.
    const taxSql = revenueSql - itemsSql - shipSql;
    b.tax_halalas === taxSql
      ? pass(`الضريبة: ${taxSql} — بالطرح من مجموعٍ وسطورٍ لا من حقلها`)
      : fail(`الضريبة: اللوحةُ ${b.tax_halalas} والطرحُ ${taxSql}`);

    // ── العملاءُ والمتكرّرون من `group by` لا من حلقةٍ في JS ─────
    const customersSql = await one(
      `select count(distinct "customer_id")::int from "order"
        where "status" <> 'canceled' and "deleted_at" is null and "customer_id" is not null`
    );
    b.customers_count === customersSql
      ? pass(`العملاء المميَّزون: ${customersSql}`)
      : fail(`العملاء: اللوحةُ ${b.customers_count} والقاعدةُ ${customersSql}`);

    const repeatSql = await one(
      `select count(*)::int from (
         select "customer_id" from "order"
          where "status" <> 'canceled' and "deleted_at" is null and "customer_id" is not null
          group by "customer_id" having count(*) >= 2
       ) r`
    );
    b.repeat_customers === repeatSql
      ? pass(`المتكرّرون (طلبان فأكثر): ${repeatSql}`)
      : fail(`المتكرّرون: اللوحةُ ${b.repeat_customers} والقاعدةُ ${repeatSql}`);

    // 🔴 والضيوفُ يُعدّون طلباتٍ لا أشخاصاً — ولا يُبتلعون في العملاء.
    const guestsSql = await one(
      `select count(*)::int from "order"
        where "status" <> 'canceled' and "deleted_at" is null and "customer_id" is null`
    );
    b.guest_orders === guestsSql
      ? pass(`طلباتُ الضيوف: ${guestsSql} — معدودةٌ منفصلةً لا في العملاء`)
      : fail(`الضيوف: اللوحةُ ${b.guest_orders} والقاعدةُ ${guestsSql}`);

    // ── متوسّطُ قيمة الطلب ─────────────────────────────────────
    b.orders_count > 0 && b.aov_halalas === Math.round(b.gmv_halalas / b.orders_count)
      ? pass(`متوسّطُ قيمة الطلب: ${b.aov_halalas} هللة`)
      : fail(`المتوسّط لا يطابق GMV÷الطلبات: ${b.aov_halalas}`);

    // ── 🔴 والمستردُّ يُقاس بمبلغٍ غيرِ صفر ────────────────────
    //
    // وقاعدةُ الفحص خاليةٌ من المرتجعات، فمقارنةُ صفرٍ بصفرٍ تمرّ إلى
    // الأبد ولا تحرس شيئاً. فيُزرع مبلغٌ في ملخّص طلبٍ قائمٍ ويُقاس
    // الأثر، ثمّ يُعاد كما كان.
    const [victim] = (
      await pg.raw(
        `select os."id", os."totals" from "order_summary" os
           join "order" o on o."id" = os."order_id"
          where o."status" <> 'canceled' and o."deleted_at" is null and os."deleted_at" is null
          limit 1`
      )
    )?.rows ?? [];

    if (!victim) {
      fail("لا ملخّصَ طلبٍ لزرع مستردٍّ فيه — فحصُ صافي المبيعات لم يجرِ");
    } else {
      const original = victim.totals;
      const SEEDED = 7313; // رقمٌ غيرُ مريح: لا يقع صدفةً على أيّ مجموع
      try {
        // ⚠️ و**المدفوعُ يُزرع معه**: القاعدةُ تحمل حارساً
        // (`zadim_order_totals_sane`) يرفض مستردّاً أكبرَ من المدفوع.
        // فرفضت الزرعةَ الأولى — وهي رفضةٌ صحيحةٌ تُبقي الفحصَ صادقاً:
        // بياناتُ الفحص يجب أن تكون **ممكنةً في الواقع**، وإلا قِيس
        // الحسابُ على حالةٍ لا تقع.
        await pg.raw(
          `update "order_summary"
              set "totals" = jsonb_set(
                    jsonb_set(("totals")::jsonb, '{paid_total}', ?::jsonb),
                    '{refunded_total}', ?::jsonb)
            where "id" = ?`,
          [String(SEEDED), String(SEEDED), victim.id]
        );
        const after = await computeMetrics(container);
        after.business.refunded_halalas === SEEDED &&
        after.business.net_sales_halalas === after.business.gmv_halalas - SEEDED
          ? pass(`وصافي المبيعات ينزل بالمستردّ بالضبط (${SEEDED} هللة)`)
          : fail(
              `صافي المبيعات: مستردٌّ ${after.business.refunded_halalas} ` +
                `وصافٍ ${after.business.net_sales_halalas} من GMV ${after.business.gmv_halalas}`
            );
      } finally {
        await pg.raw(`update "order_summary" set "totals" = ? where "id" = ?`, [
          original,
          victim.id,
        ]);
      }
    }

    // ── 🔴 التغطيةُ تُذكر، والمجهولُ لا يُحسب بصفر ─────────────
    b.margin_covered_lines <= b.margin_total_lines &&
    b.inventory_costed_items <= b.inventory_total_items
      ? pass(
          `والتغطيةُ معلَنة: هامشٌ على ${b.margin_covered_lines}/${b.margin_total_lines} سطراً` +
            ` · ومخزونٌ على ${b.inventory_costed_items}/${b.inventory_total_items} صنفاً`
        )
      : fail("التغطيةُ أكبرُ من الكلّ — الحسابُ يعدّ ما لا يعرفه");

    const costedSql = await one(
      `select count(*)::int from "order_line_item" li
         join "order_item" oi on oi."item_id" = li."id" and oi."deleted_at" is null
         join "order" o on o."id" = oi."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null
          and li."deleted_at" is null and li."unit_cost" is not null`
    );
    b.margin_covered_lines === costedSql
      ? pass(`والسطورُ المغطّاة: ${costedSql} — من التكلفة المجمَّدة على السطر`)
      : fail(`التغطية: اللوحةُ ${b.margin_covered_lines} والقاعدةُ ${costedSql}`);

    // 🔴 **وانقضِ الحارس** — بالحساب لا بالكتابة.
    //
    // ⚠️ أوّلُ صياغةٍ لهذا الفحص نزعت تكلفةَ سطرٍ بـ`update` لتتأكّد
    // أنه يخرج من الحساب. **فرفضتها القاعدة**: مُطلِقٌ يجمّد
    // `unit_cost` لحظةَ البيع ولا يدعها تُغيَّر. والرفضُ صحيحٌ —
    // تكلفةٌ تُعدَّل بعد البيع تعيد كتابةَ هامشِ الماضي.
    //
    // فالنقضُ يصير حسابياً وهو أقوى: يُعاد بناءُ **بسط الهامش** من
    // السطور المغطّاة وحدَها، ويُقارَن بما كان سيكون لو حُسب المجهولُ
    // بصفر. والفرقُ بينهما هو الكذبةُ التي يمنعها هذا التصميم.
    const coveredNetSql = await one(
      `select coalesce(round(sum(oi."quantity" * li."unit_price")),0)::bigint
             - coalesce((
                 select round(sum(a."amount"))
                   from "order_line_item_adjustment" a
                   join "order_line_item" li2 on li2."id" = a."item_id" and li2."deleted_at" is null
                   join "order_item" oi2 on oi2."item_id" = li2."id" and oi2."deleted_at" is null
                   join "order" o2 on o2."id" = oi2."order_id"
                  where o2."status" <> 'canceled' and o2."deleted_at" is null
                    and a."deleted_at" is null and li2."unit_cost" is not null
               ), 0)::bigint
         from "order_line_item" li
         join "order_item" oi on oi."item_id" = li."id" and oi."deleted_at" is null
         join "order" o on o."id" = oi."order_id"
        where o."status" <> 'canceled' and o."deleted_at" is null
          and li."deleted_at" is null and li."unit_cost" is not null`
    );

    b.contribution_margin_halalas === coveredNetSql - b.cogs_halalas
      ? pass(
          `وبسطُ الهامش **مبيعاتُ المغطّى وحدَه** (${coveredNetSql}) − تكلفتُه (${b.cogs_halalas})`
        )
      : fail(
          `الهامش: اللوحةُ ${b.contribution_margin_halalas} والقاعدةُ ${coveredNetSql - b.cogs_halalas}`
        );

    // والكذبةُ التي تُمنع، مقيسةً بالأرقام لا موصوفةً بالكلام.
    if (b.margin_covered_lines < b.margin_total_lines) {
      const lie = b.items_net_halalas - b.cogs_halalas;
      lie > b.contribution_margin_halalas
        ? pass(
            `ولو حُسب المجهولُ بصفرٍ لصار الهامشُ ${lie} بدل ${b.contribution_margin_halalas}` +
              ` — أكبرَ بـ${lie - b.contribution_margin_halalas} هللة، **ويرتفع كلَّما ساء التسجيل**`
          )
        : fail("لا فرقَ بين الحسابين — فالمجهولُ يدخل بصفرٍ فعلاً");
    } else {
      pass("والتغطيةُ كاملةٌ في هذه القاعدة — فلا فرقَ يُقاس");
    }

    // والتكلفةُ مجمَّدةٌ: القاعدةُ ترفض تغييرَها بعد البيع.
    const [frozen] = (
      await pg.raw(
        `select "id", "unit_cost" from "order_line_item"
          where "unit_cost" is not null and "deleted_at" is null limit 1`
      )
    )?.rows ?? [];
    if (frozen) {
      let changed = false;
      try {
        await pg.raw(`update "order_line_item" set "unit_cost" = 1 where "id" = ?`, [frozen.id]);
        changed = true;
      } catch {
        /* المُطلِقُ رفض — وهو المطلوب */
      }
      !changed
        ? pass("وتكلفةُ السطر **مجمَّدةٌ في القاعدة** — فلا يُعاد كتابةُ هامشِ الماضي")
        : fail("غُيّرت تكلفةُ سطرٍ بعد البيع — وهامشُ كلّ شهرٍ ماضٍ صار قابلاً للتعديل");
    }

    // ── والحدودُ تُفحص على الدالّة الخالصة لا ببذرِ متجر ────────
    logger.info("== وحدودُ الحساب — على الدالّة الخالصة ==");

    const empty = summarizeOrders([]);
    empty.aov_halalas === null && empty.gmv_halalas === 0 && empty.cancel_rate_bp === 0
      ? pass("لا طلبات ⇒ المتوسّطُ `null` **لا صفر** — وصفرٌ يُقرأ خبراً كارثياً عن متجرٍ يعمل")
      : fail(`حالةُ الفراغ: ${JSON.stringify(empty)}`);

    const allCanceled = summarizeOrders([
      { id: "a", status: "canceled", customer_id: "c1", total: 1000, discount_total: 100, tax_total: 150, shipping_total: 200, shipping_subtotal: 175, item_subtotal: 700 },
      { id: "b", status: "canceled", customer_id: "c2", total: 2000, discount_total: 0, tax_total: 300, shipping_total: 200, shipping_subtotal: 175, item_subtotal: 1500 },
    ]);
    allCanceled.gmv_halalas === 0 &&
    allCanceled.tax_halalas === 0 &&
    allCanceled.shipping_halalas === 0 &&
    allCanceled.cancel_rate_bp === 10000
      ? pass("وكلُّها ملغاة ⇒ **صفرٌ في كلّ رقمٍ ماليّ** لا في الإيراد وحدَه · ونسبةُ إلغاءٍ ١٠٠٪")
      : fail(`الملغاةُ تسرّبت: ${JSON.stringify(allCanceled)}`);

    const guestsOnly = summarizeOrders([
      { id: "g1", status: "pending", customer_id: null, total: 500, discount_total: 0, tax_total: 65, shipping_total: 0, shipping_subtotal: 0, item_subtotal: 435 },
      { id: "g2", status: "pending", customer_id: null, total: 500, discount_total: 0, tax_total: 65, shipping_total: 0, shipping_subtotal: 0, item_subtotal: 435 },
    ]);
    guestsOnly.customers_count === 0 &&
    guestsOnly.guest_orders === 2 &&
    guestsOnly.gmv_halalas === 1000
      ? pass("وضيوفٌ فقط ⇒ صفرُ عملاءَ وطلبان — ولا يُبتلعون ولا يصيرون أشخاصاً")
      : fail(`الضيوف: ${JSON.stringify(guestsOnly)}`);

    const uncovered = computeMargin(
      [
        { variant_id: "v1", quantity: 2, unit_cost: 300 },
        { variant_id: "v2", quantity: 5, unit_cost: null },
      ],
      1000
    );
    uncovered.cogs_halalas === 600 &&
    uncovered.margin_covered_lines === 1 &&
    uncovered.margin_total_lines === 2
      ? pass("وسطرٌ بلا تكلفةٍ لا يدخل التكلفةَ بصفر — والتغطيةُ ١ من ٢")
      : fail(`الهامش: ${JSON.stringify(uncovered)}`);

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
