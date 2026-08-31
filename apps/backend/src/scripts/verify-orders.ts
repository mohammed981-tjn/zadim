import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";
import { ORDERS_MODULE } from "../modules/orders";
import type OrdersModuleService from "../modules/orders/service";
import { allowedTargets, checkTransition, terminalStates } from "../modules/orders/transitions";

/**
 * بوّابةُ المرحلة ٥ — الطلبات (`07-roadmap.md`).
 *
 * > **كلُّ انتقالٍ ممنوعٍ في [`03`](03-state-machines.md) له اختبارٌ
 * > يثبت رفضه.** و`cancelled → confirmed` مستحيل. وتغييرُ سعر منتجٍ
 * > اليوم **لا يغيّر فاتورةَ أمس** — اختبارٌ صريح.
 *
 * ── و«كلُّ انتقال» تُؤخذ حرفياً ─────────────────────────────────
 *
 * لا تُنتقى أمثلةٌ محفوظة. تُبنى **المصفوفةُ كاملةً** — كلُّ حالةٍ إلى
 * كل حالة — وتُجرَّب كلُّها على القاعدة: المسموحُ يجب أن يمرّ، والممنوعُ
 * يجب أن يُردّ. فاختبارٌ ينتقي أمثلتَه يثبت ما اختاره كاتبُه، لا ما
 * يفعله النظام.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-orders.ts
 */

const STATUSES = ["draft", "pending", "requires_action", "completed", "canceled", "archived"];

export default async function verifyOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const orders = container.resolve(ORDERS_MODULE) as OrdersModuleService;
  const orderModule = container.resolve(Modules.ORDER);
  const regionModule = container.resolve(Modules.REGION);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const rules = await orders.rules();
  const made: string[] = [];
  const madeFulfilments: string[] = [];
  const madeMoney: string[] = [];

  const tag = `vord-${Date.now()}`;
  let seq = 0;
  const seedOrder = async (status: string) => {
    const id = `order_${tag}_${seq++}`;
    await pg.raw(
      `insert into "zadim"."order" ("id","currency_code","status","email")
       values (?, 'sar', ?::"zadim"."order_status_enum", 'gate@zadim.test')`,
      [id, status]
    );
    made.push(id);
    return id;
  };
  const statusOf = async (id: string) => {
    const r = await pg.raw(`select "status"::text as s from "zadim"."order" where "id" = ?`, [id]);
    return (r?.rows ?? r)[0]?.s as string;
  };

  try {
    // ── ١) المنطقُ الخالص ───────────────────────────────────────
    logger.info("== المنطقُ الخالص ==");

    checkTransition("canceled", "pending", rules).allowed === false
      ? pass("`canceled ⇒ pending` مرفوضٌ في المنطق")
      : fail("المنطقُ يسمح بإحياء الملغى");

    checkTransition("pending", "pending", rules).allowed === true
      ? pass("الانتقالُ إلى النفس يمرّ — فهو ليس انتقالاً")
      : fail("تحديثٌ لا يمسّ الحالة يُرفض — سيُعطّل كلَّ كتابةٍ على الطلب");

    const cancelCheck = checkTransition("pending", "canceled", rules, { has_shipment: true });
    !cancelCheck.allowed && cancelCheck.code === "SHIPMENT_EXISTS"
      ? pass("الإلغاءُ بعد الشحن مرفوضٌ برمزه الخاصّ")
      : fail(`المتوقّع SHIPMENT_EXISTS: ${JSON.stringify(cancelCheck)}`);

    checkTransition("pending", "canceled", rules, { has_shipment: false }).allowed
      ? pass("والإلغاءُ قبل الشحن يمرّ")
      : fail("الإلغاءُ قبل الشحن مرفوض");

    const terminal = terminalStates(STATUSES, rules);
    terminal.includes("canceled") && terminal.includes("archived")
      ? pass(`الحالاتُ النهائية تُحسب من الجدول: ${terminal.join(" · ")}`)
      : fail(`النهائيّات: ${terminal.join(",")}`);

    allowedTargets("completed", rules).join(",") === "archived"
      ? pass("المكتملُ لا يذهب إلا إلى الأرشيف")
      : fail(`وجهاتُ completed: ${allowedTargets("completed", rules).join(",")}`);

    // ── ٢) 🔴 المصفوفةُ كاملةً على القاعدة ──────────────────────
    logger.info("== المصفوفة: كلُّ حالةٍ إلى كل حالة، على القاعدة ==");

    let allowedOk = 0;
    let deniedOk = 0;
    const wrong: string[] = [];

    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to) continue;

        const shouldPass = checkTransition(from, to, rules, { has_shipment: false }).allowed;
        const id = await seedOrder(from);

        let threw = false;
        try {
          await pg.raw(
            `update "zadim"."order" set "status" = ?::"zadim"."order_status_enum" where "id" = ?`,
            [to, id]
          );
        } catch {
          threw = true;
        }

        const landed = await statusOf(id);
        const actuallyPassed = !threw && landed === to;

        if (actuallyPassed === shouldPass) {
          shouldPass ? allowedOk++ : deniedOk++;
        } else {
          wrong.push(`${from}⇒${to} (متوقّع ${shouldPass ? "يمرّ" : "يُردّ"})`);
        }
      }
    }

    wrong.length === 0
      ? pass(
          `${allowedOk} انتقالاً مسموحاً مرّ، و**${deniedOk} ممنوعاً رُدّ** — المصفوفةُ كاملةً (${allowedOk + deniedOk} حالة)`
        )
      : fail(`خالفت ${wrong.length}: ${wrong.slice(0, 5).join(" · ")}`);

    // والانتقالُ الذي تسمّيه البوّابة بالاسم
    const revive = await seedOrder("canceled");
    let revived = false;
    try {
      await pg.raw(
        `update "zadim"."order" set "status" = 'pending'::"zadim"."order_status_enum" where "id" = ?`,
        [revive]
      );
      revived = (await statusOf(revive)) === "pending";
    } catch {
      revived = false;
    }
    !revived
      ? pass("**الملغى لا يُحيا** — ولا حتى بجملة SQL مباشرة")
      : fail("🔴 الملغى عاد حيّاً");

    // ── ٣) الإلغاءُ بعد الشحن — الحارسُ عبر ثلاثة جداول ─────────
    logger.info("== الإلغاءُ بعد شحنةٍ شُحنت ==");

    const shippedOrder = await seedOrder("pending");
    const fid = `ful_${tag}`;
    await pg.raw(
      `insert into "zadim"."fulfillment"
         ("id","location_id","provider_id","shipped_at","packed_at")
       values (?, 'sloc_gate', 'manual_manual', now(), now())`,
      [fid]
    );
    madeFulfilments.push(fid);
    await pg.raw(
      `insert into "zadim"."order_fulfillment" ("id","order_id","fulfillment_id")
       values (?, ?, ?)`,
      [`ofu_${tag}`, shippedOrder, fid]
    );

    let cancelBlocked = false;
    try {
      await pg.raw(
        `update "zadim"."order" set "status" = 'canceled'::"zadim"."order_status_enum" where "id" = ?`,
        [shippedOrder]
      );
    } catch {
      cancelBlocked = true;
    }
    cancelBlocked && (await statusOf(shippedOrder)) === "pending"
      ? pass("طلبٌ شُحنت منه شحنةٌ لا يُلغى — والطريقُ مرتجعٌ لا إلغاء")
      : fail("أُلغي طلبٌ مشحون");

    // وبإلغاء الشحنة يعود الإلغاءُ ممكناً
    await pg.raw(`update "zadim"."fulfillment" set "canceled_at" = now() where "id" = ?`, [fid]);
    await pg.raw(
      `update "zadim"."order" set "status" = 'canceled'::"zadim"."order_status_enum" where "id" = ?`,
      [shippedOrder]
    );
    (await statusOf(shippedOrder)) === "canceled"
      ? pass("وبإلغاء الشحنة يُلغى الطلب — الحارسُ يقيس الواقعَ لا تاريخَه")
      : fail("تعذّر الإلغاء بعد إلغاء الشحنة");

    // ── ٤) الحدثُ في نفس المعاملة ───────────────────────────────
    logger.info("== صندوقُ الأحداث ==");

    const evOrder = await seedOrder("pending");
    const eventsFor = async (id: string) =>
      orders.listOutboxEvents({ aggregate_id: id }, { order: { occurred_at: "ASC" } });

    let evs = await eventsFor(evOrder);
    evs.length === 1 && (evs[0] as any).event === "OrderPlaced"
      ? pass("إنشاءُ الطلب ⇒ حدثُ OrderPlaced، بلا نداءٍ من الكود")
      : fail(`أحداثُ الإنشاء: ${JSON.stringify(evs.map((e: any) => e.event))}`);

    await pg.raw(
      `update "zadim"."order" set "status" = 'completed'::"zadim"."order_status_enum" where "id" = ?`,
      [evOrder]
    );
    evs = await eventsFor(evOrder);
    const last = evs[evs.length - 1] as any;
    last?.event === "OrderCompleted" &&
    last?.payload?.from === "pending" &&
    last?.payload?.to === "completed"
      ? pass("وتغيّرُ الحالة ⇒ حدثٌ بحمولةٍ فيها من وإلى")
      : fail(`حدثُ التغيّر: ${JSON.stringify(last?.event)} / ${JSON.stringify(last?.payload)}`);

    // ما وقع لا يُعاد كتابتُه
    let evImmutable = false;
    try {
      await pg.raw(`update "zadim"."zadim_outbox_event" set "event" = 'مزوَّر' where "id" = ?`, [
        last.id,
      ]);
    } catch {
      evImmutable = true;
    }
    evImmutable
      ? pass("حدثٌ وقع لا يُعاد كتابتُه")
      : fail("حمولةُ الحدث قابلةٌ للتزوير");

    // ودفترُ المحاولات يُكتب
    await orders.markDelivered(last.id);
    const [delivered] = await orders.listOutboxEvents({ id: last.id });
    (delivered as any).delivered_at
      ? pass("و`delivered_at` يُكتب — دفترُ المحاولات ليس دفترَ الوقائع")
      : fail("تعذّر تسجيلُ التسليم");

    await pg.raw(`delete from "zadim"."zadim_outbox_event" where "id" = ?`, [last.id]);
    (await orders.listOutboxEvents({ id: last.id })).length === 1
      ? pass("والحذفُ لا يُغيّر شيئاً")
      : fail("حُذف حدث");

    // ── ٥) حرمةُ الفاتورة ───────────────────────────────────────
    logger.info("== حرمةُ الفاتورة ==");

    const [region] = await regionModule.listRegions({});
    const [live] = await orderModule.createOrders([
      {
        region_id: region?.id,
        currency_code: "sar",
        email: "gate@zadim.test",
        items: [{ title: "بند فحص", quantity: 1, unit_price: 10000 }],
      } as any,
    ]);
    made.push(live.id);

    const { data: liveOrders } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.unit_price"],
      filters: { id: live.id },
    });
    const lineId = (liveOrders[0] as any).items[0].id;

    await pg.transaction(async (trx: any) => {
      await trx.raw(`set local "zadim.actor_id" = 'user_gate'`);
      await trx.raw(`update "zadim"."order_line_item" set "unit_price" = 12345 where "id" = ?`, [
        lineId,
      ]);
    });

    const changes = await orders.listInvoiceChanges({ line_item_id: lineId });
    const ch = changes[0] as any;
    changes.length === 1 &&
    Number(ch.old_value) === 10000 &&
    Number(ch.new_value) === 12345 &&
    ch.actor_id === "user_gate"
      ? pass("تعديلُ سطرِ طلبٍ قائمٍ **يُسجَّل** بالقديم والجديد وفاعله")
      : fail(`سجلُّ التغيير: ${JSON.stringify(changes)}`);

    await pg.raw(
      `update "zadim"."order" set "status" = 'canceled'::"zadim"."order_status_enum" where "id" = ?`,
      [live.id]
    );

    let invBlocked = false;
    try {
      await pg.raw(`update "zadim"."order_line_item" set "unit_price" = 999 where "id" = ?`, [
        lineId,
      ]);
    } catch {
      invBlocked = true;
    }
    invBlocked
      ? pass("**وفاتورةُ طلبٍ مُغلَقٍ لا تُمسّ**")
      : fail("أُعيدت كتابةُ فاتورةِ طلبٍ ملغى");

    // ── ٦) تغييرُ السعر اليوم وفاتورةُ أمس ──────────────────────
    logger.info("== تغييرُ سعرِ اليوم وفاتورةُ أمس ==");

    const { data: real } = await query.graph({
      entity: "order",
      fields: ["id", "total", "status", "items.variant_id", "items.unit_price"],
    });
    const withVariant = (real as any[]).find(
      (o) => (o.items ?? []).some((i: any) => i.variant_id) && o.status !== "canceled"
    );

    if (!withVariant) {
      fail("لا طلبَ بمتغيّرٍ حقيقيّ — شغّل verify-checkout أوّلاً");
    } else {
      const item = withVariant.items.find((i: any) => i.variant_id);
      const oldPrice = Number(item.unit_price);
      const oldTotal = Number(withVariant.total);

      await updateProductVariantsWorkflow(container).run({
        input: {
          product_variants: [
            { id: item.variant_id, prices: [{ currency_code: "sar", amount: oldPrice + 7777 }] },
          ],
        },
      });

      const { data: after } = await query.graph({
        entity: "order",
        fields: ["id", "total", "items.unit_price"],
        filters: { id: withVariant.id },
      });
      const nowTotal = Number((after[0] as any).total);

      nowTotal === oldTotal
        ? pass(`سعرُ المنتج ارتفع ${oldPrice} ⇒ ${oldPrice + 7777} وفاتورةُ أمس ${nowTotal} كما هي`)
        : fail(`تغيّرت فاتورةُ أمس: ${oldTotal} ⇒ ${nowTotal}`);

      await updateProductVariantsWorkflow(container).run({
        input: {
          product_variants: [
            { id: item.variant_id, prices: [{ currency_code: "sar", amount: oldPrice }] },
          ],
        },
      });
    }

    // ── ٧) المحورُ الماليّ: المستردُّ لا يتجاوز المحصَّل ────────
    logger.info("== المستردُّ لا يتجاوز المحصَّل ==");

    const pay = await pg.raw(`select "id" from "zadim"."payment" limit 1`);
    const paymentId = (pay?.rows ?? pay)[0]?.id;

    if (!paymentId) {
      fail("لا دفعةً للفحص — شغّل verify-checkout أوّلاً");
    } else {
      const capId = `cap_${tag}`;
      await pg.raw(
        `insert into "zadim"."capture" ("id","payment_id","amount","raw_amount")
         values (?, ?, 10000, jsonb_build_object('value','10000','precision',20))`,
        [capId, paymentId]
      );
      madeMoney.push(`capture:${capId}`);

      const ref1 = `ref_${tag}_a`;
      await pg.raw(
        `insert into "zadim"."refund" ("id","payment_id","amount","raw_amount")
         values (?, ?, 6000, jsonb_build_object('value','6000','precision',20))`,
        [ref1, paymentId]
      );
      madeMoney.push(`refund:${ref1}`);
      pass("استردادٌ ٦٠٠٠ من محصَّلٍ ١٠٠٠٠ يمرّ");

      let overBlocked = false;
      const ref2 = `ref_${tag}_b`;
      try {
        await pg.raw(
          `insert into "zadim"."refund" ("id","payment_id","amount","raw_amount")
           values (?, ?, 5000, jsonb_build_object('value','5000','precision',20))`,
          [ref2, paymentId]
        );
        madeMoney.push(`refund:${ref2}`);
      } catch {
        overBlocked = true;
      }
      overBlocked
        ? pass("**واستردادٌ يتجاوز المحصَّل مستحيلٌ** — لا ممنوعٌ في الكود")
        : fail("مرّ استردادٌ مجموعُه ١١٠٠٠ من محصَّلٍ ١٠٠٠٠");
    }
  } finally {
    // تنظيفٌ حقيقيّ. **وأحداثُ الصندوق تبقى**: قاعدةُ «لا حذف» تُسقط
    // حذفَها بصمت، وهو المطلوب منها — وصندوقٌ ينظّفه اختبارٌ ليس صندوقاً.
    for (const m of madeMoney) {
      const [kind, id] = m.split(":");
      await pg(`zadim.${kind}`).where({ id }).del();
    }
    await pg("zadim.order_fulfillment").whereIn("fulfillment_id", madeFulfilments).del();
    await pg("zadim.fulfillment").whereIn("id", madeFulfilments).del();
    await pg("zadim.order_item").whereIn("order_id", made).del();
    await pg("zadim.order_summary").whereIn("order_id", made).del();
    await pg("zadim.order").whereIn("id", made).del();
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الطلبات.`);
  logger.info("✅ كلُّ فحوص المرحلة ٥ اجتازت — المصفوفةُ كاملةً، والملغى لا يُحيا.");
}
