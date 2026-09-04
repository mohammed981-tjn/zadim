import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "../modules/warehouse";
import type WarehouseModuleService from "../modules/warehouse/service";
import {
  requestAdjustment,
  approveAdjustment,
  applyAdjustment,
  rejectAdjustment,
} from "../modules/warehouse/adjust";

/**
 * بوّابةُ تسوية المخزون (البند ١٫٤).
 *
 * ── وشرطُ القبول يُقاس بالأثر لا بالردّ ──────────────────────────
 *
 * > تسويةٌ فوق حدٍّ يضبطه المدير **تحتاج فاعلَين مختلفَين** · ويُقاس
 * > بالأثر: **الرصيدُ لا يتغيّر قبل الموافقة الثانية**.
 *
 * 🔴 ومسارٌ يردّ «ممنوع» ثمّ يغيّر الرصيدَ خلفه أسوأُ من مسارٍ يسمح
 * صراحةً — فالأوّلُ يمنح ثقةً بلا مقابل. فكلُّ فحصٍ هنا **يقرأ
 * `stocked_quantity` قبل وبعد**، ولا يكتفي بالردّ.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-adjustments.ts
 */
export default async function verifyAdjustments({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const inventory = container.resolve(Modules.INVENTORY);
  const warehouse = container.resolve(WAREHOUSE_MODULE) as WarehouseModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `adj-${Date.now()}`;
  const ALICE = `user_alice_${tag}`;
  const BOB = `user_bob_${tag}`;

  // مستوى مخزونٍ حقيقيٌّ للقياس عليه.
  const levels = (await inventory.listInventoryLevels({}, { take: 1 })) as any[];
  if (!levels.length) {
    logger.error("⛔ لا مستوى مخزونٍ في القاعدة — البوّابةُ لا تستطيع القياس.");
    process.exit(1);
  }
  const level = levels[0];
  const ITEM = level.inventory_item_id;
  const LOC = level.location_id;

  const stockNow = async (): Promise<number> => {
    const r = await pg.raw(
      `select "stocked_quantity"::int as q from "inventory_level"
        where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null`,
      [ITEM, LOC]
    );
    return Number((r?.rows ?? [])[0]?.q ?? -1);
  };

  const policy = await warehouse.adjustmentPolicy();
  const BIG = policy.threshold_quantity + 3; // فوق الحدّ يقيناً
  const SMALL = 1; // تحته يقيناً (والحدُّ لا يقلّ عن ١ عملياً)

  const startStock = await stockNow();

  try {
    logger.info("== السياسةُ من صفّها ==");
    policy.threshold_quantity >= 0 && policy.threshold_value_halalas >= 0
      ? pass(
          `الحدُّ: ${policy.threshold_quantity} قطعةً أو ${policy.threshold_value_halalas} هللة — **أيُّهما وقع أوّلاً**`
        )
      : fail("لا سياسةَ تسويةٍ تُقرأ");

    // ── ١) 🔴 فوق الحدّ: الرصيدُ لا يتغيّر قبل الموافقة ────────
    logger.info("== وفوق الحدّ: لا أثرَ قبل الموافقة الثانية ==");

    const big = await requestAdjustment(container, {
      inventory_item_id: ITEM,
      location_id: LOC,
      delta: BIG,
      requested_by: ALICE,
      note: "بوّابة",
    });
    if (!big.ok) {
      fail(`تعذّر طلبُ التسوية: ${big.message_ar}`);
      throw new Error("stop");
    }
    big.needs_approval
      ? pass(`تسويةٌ بـ${BIG} قطعةً تجاوزت الحدَّ ⇒ تلزم موافقةٌ ثانية`)
      : fail(`تسويةٌ بـ${BIG} مرّت بلا موافقة والحدُّ ${policy.threshold_quantity}`);

    (await stockNow()) === startStock
      ? pass(`**والرصيدُ لم يتغيّر بالطلب** (${startStock}) — الطلبُ ليس أثراً`)
      : fail(`تغيّر الرصيدُ بمجرّد الطلب: ${await stockNow()} بعد ${startStock}`);

    // والتطبيقُ قبل الموافقة يُردّ — **ويُقاس بالرصيد لا بالردّ**.
    const early = await applyAdjustment(container, big.id, ALICE);
    const afterEarly = await stockNow();
    !early.ok && early.code === "APPROVAL_REQUIRED" && afterEarly === startStock
      ? pass("وتطبيقٌ قبل الموافقة يُردّ **والرصيدُ كما هو** — لا ردٌّ يمنع وأثرٌ يقع خلفه")
      : fail(
          `التطبيقُ المبكر: ${JSON.stringify(early)} والرصيدُ ${afterEarly} (كان ${startStock})`
        );

    // ── ٢) 🔴 ولا أحدَ يوافق على تسويةِ نفسِه ──────────────────
    logger.info("== ولا أحدَ يوافق على تسويةِ نفسِه ==");

    const selfApprove = await approveAdjustment(container, big.id, ALICE);
    !selfApprove.ok && selfApprove.code === "SELF_APPROVAL"
      ? pass("موافقةُ الطالبِ نفسِه **تُرفض**")
      : fail(`قُبلت موافقةُ الطالب على نفسه: ${JSON.stringify(selfApprove)}`);

    // **وانقضِ الحارس**: لو كان في الخدمة وحدَها لمرّ هذا.
    let selfInDb = false;
    try {
      await pg.raw(
        `update "zadim_stock_adjustment"
            set "state" = 'approved', "approved_by" = ?, "approved_at" = now()
          where "id" = ?`,
        [ALICE, big.id]
      );
      selfInDb = true;
    } catch {
      /* القيدُ رفض — وهو المطلوب */
    }
    !selfInDb
      ? pass("و`update` مباشرٌ في القاعدة يُرفض أيضاً — **القيدُ هو الحارس لا شرطُ الخدمة**")
      : fail("وُوفق على التسوية من psql بنفس الطالب — والحارسُ في الكود وحدَه");

    // ── ٣) والموافقةُ من ثانٍ تفتح الباب ──────────────────────
    const ok = await approveAdjustment(container, big.id, BOB);
    ok.ok ? pass("وموافقةُ شخصٍ ثانٍ تمرّ") : fail(`تعذّرت موافقةُ الثاني: ${JSON.stringify(ok)}`);

    (await stockNow()) === startStock
      ? pass("**والرصيدُ لم يتغيّر بالموافقة** — الموافقةُ إذنٌ لا أثر")
      : fail("تغيّر الرصيدُ بمجرّد الموافقة");

    const applied = await applyAdjustment(container, big.id, BOB);
    const afterApply = await stockNow();
    applied.ok && afterApply === startStock + BIG
      ? pass(`وبالتطبيق تغيّر الرصيدُ ${startStock} ⇒ ${afterApply} (+${BIG})`)
      : fail(`التطبيق: ${JSON.stringify(applied)} والرصيدُ ${afterApply}`);

    // ودفترُ الحركات قيّدها بسببها ومرجعها — لا حركةَ بلا أثرٍ مقروء.
    const mov = await pg.raw(
      `select "delta"::int as d, "reason", "actor_id" from "zadim_stock_movement"
        where "reference_type" = 'stock_adjustment' and "reference_id" = ?`,
      [big.id]
    );
    const m = (mov?.rows ?? [])[0];
    m && Number(m.d) === BIG && m.actor_id === BOB
      ? pass(`ودفترُ الحركات قيّدها (${m.d} · ${m.reason} · بفاعلٍ مسجَّل)`)
      : fail(`لا قيدَ في دفتر الحركات: ${JSON.stringify(mov?.rows ?? [])}`);

    // والمطبَّقُ لا يُحيا.
    let revived = false;
    try {
      await pg.raw(`update "zadim_stock_adjustment" set "state" = 'pending' where "id" = ?`, [
        big.id,
      ]);
      const [after] = (await warehouse.listStockAdjustments({ id: big.id })) as any[];
      revived = after?.state === "pending";
    } catch {
      /* المُطلِقُ رفض */
    }
    !revived
      ? pass("والمطبَّقُ لا يُحيا — تاريخٌ لا حالةٌ تُعدَّل")
      : fail("أُعيدت تسويةٌ مطبَّقةٌ إلى الانتظار");

    // ── ٤) تحت الحدّ: تمرّ بلا موافقة ─────────────────────────
    logger.info("== وتحت الحدّ تمرّ — فحارسٌ يُتجاوَز أسوأُ من حارسٍ غائب ==");

    const before2 = await stockNow();
    const small = await requestAdjustment(container, {
      inventory_item_id: ITEM,
      location_id: LOC,
      delta: -SMALL,
      reason: "damage",
      requested_by: ALICE,
    });
    if (!small.ok) {
      fail(`تعذّر الطلبُ الصغير: ${small.message_ar}`);
    } else {
      const applySmall = await applyAdjustment(container, small.id, ALICE);
      const after2 = await stockNow();
      !small.needs_approval && applySmall.ok && after2 === before2 - SMALL
        ? pass(
            `تسويةُ قطعةٍ واحدةٍ تمرّ بفاعلٍ واحد (${before2} ⇒ ${after2}) — ` +
              `واشتراطُ موافقةٍ على كلّ قطعةٍ يقتل التسجيلَ نفسَه`
          )
        : fail(
            `الصغيرة: موافقةٌ ${small.needs_approval} · ${JSON.stringify(applySmall)} · رصيدٌ ${after2}`
          );
    }

    // ── ٥) 🔴 والكمّيةُ لا تُغيَّر بعد الطلب ───────────────────
    //
    // وهذا أخطرُ التفافٍ على الموافقة الثانية ولا يمنعه شرطُ «من وافق»:
    // يُطلب «ثلاث قطع» فيوافق ثانٍ، ثمّ تصير ثلاثمئةً قبل التطبيق.
    logger.info("== والكمّيةُ لا تُغيَّر بعد الطلب ==");

    const sneaky = await requestAdjustment(container, {
      inventory_item_id: ITEM,
      location_id: LOC,
      delta: 3,
      requested_by: ALICE,
    });
    if (sneaky.ok) {
      let escalated = false;
      try {
        await pg.raw(`update "zadim_stock_adjustment" set "delta" = 300 where "id" = ?`, [
          sneaky.id,
        ]);
        const [after] = (await warehouse.listStockAdjustments({ id: sneaky.id })) as any[];
        escalated = Number(after?.delta) === 300;
      } catch {
        /* المُطلِقُ رفض */
      }
      !escalated
        ? pass("و«ثلاثُ قطعٍ» لا تصير «ثلاثمئة» بعد الطلب — والموافقُ يوافق على ما رأى")
        : fail("غُيّرت الكمّيةُ بعد الطلب — والموافقةُ الثانيةُ صارت تحصيلَ حاصل");

      await rejectAdjustment(container, sneaky.id, BOB, "تنظيفُ بوّابة");
    }

    // ── ٦) ولا رصيدَ سالب ─────────────────────────────────────
    const cur = await stockNow();
    const impossible = await requestAdjustment(container, {
      inventory_item_id: ITEM,
      location_id: LOC,
      delta: -(cur + 50),
      requested_by: ALICE,
    });
    if (impossible.ok) {
      await approveAdjustment(container, impossible.id, BOB);
      let applied2: any = null;
      try {
        applied2 = await applyAdjustment(container, impossible.id, BOB);
      } catch (e) {
        applied2 = { threw: String((e as Error).message) };
      }
      const afterNeg = await stockNow();
      afterNeg === cur
        ? pass(`ولا رصيدَ سالب: تسويةٌ تُنزله دون الصفر تُرفض والرصيدُ ${afterNeg} كما هو`)
        : fail(`نزل الرصيدُ إلى ${afterNeg} (كان ${cur})`);
      await rejectAdjustment(container, impossible.id, BOB, "تنظيفُ بوّابة").catch(() => {});
    }
  } catch (e) {
    if (String((e as Error).message) !== "stop") throw e;
  } finally {
    // ⚠️ **والرصيدُ يُعاد** — بوّابةٌ تترك المخزونَ مختلفاً تُفسد
    // بوّاباتٍ أخرى تقرؤه، ثمّ يُطارَد السببُ في المكان الخطأ.
    const now = await stockNow();
    if (now !== startStock && now >= 0) {
      await pg.transaction(async (trx: any) => {
        await trx.raw(`select set_config('zadim.movement_reason', 'correction', true)`);
        await trx.raw(`select set_config('zadim.movement_reference_type', 'gate', true)`);
        await trx.raw(`select set_config('zadim.movement_reference_id', ?, true)`, [tag]);
        await trx.raw(
          `update "inventory_level" set "stocked_quantity" = ?
            where "inventory_item_id" = ? and "location_id" = ? and "deleted_at" is null`,
          [startStock, ITEM, LOC]
        );
      });
      logger.info(`  ℹ️ أُعيد الرصيدُ إلى ${startStock} بقيدِ تصحيحٍ في الدفتر (لا بمسحٍ).`);
    }
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ التسويات اجتازت — أربعُ عيونٍ فوق الحدّ، والأثرُ بعد الموافقة.");
}
