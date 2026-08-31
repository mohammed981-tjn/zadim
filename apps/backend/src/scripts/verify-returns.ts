import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { RETURNS_MODULE } from "../modules/returns";
import type ReturnsModuleService from "../modules/returns/service";
import { returnEligibility } from "../modules/returns/policy";
import { rankLocations } from "../modules/warehouse/allocation";

/**
 * بوّابةُ المرحلة ١٠ — المرتجعات (`07-roadmap.md`).
 *
 * > الراجعُ **لا يعود إلى الرفّ آلياً** — يدخل موقع الحجر والفحصُ بشريّ.
 *
 * ── وتُؤخذ حرفياً ────────────────────────────────────────────────
 *
 * لا يكفي أن تُعيد الخدمةُ رفضاً. **يُقاس المتاحُ للبيع قبل وبعد**:
 * مرتجعٌ يُستلَم ويُعيد رسالةً ثم يرفع المتاحَ خلفها أسوأُ من قبولٍ
 * صريح، لأنه يبدو آمناً. وكلُّ فحصٍ هنا يقيس أثراً، لا يقرأ ردّاً.
 *
 * ⚠️ **ولا تُشغَّل على قاعدةٍ حقيقية**: تُنشئ موقعَ حجرٍ ومرتجعاتٍ
 * وشهاداتِ فحصٍ **لا تُحذف** (قاعدةُ `DO INSTEAD NOTHING`). وهذا حالُ
 * كل بوّاباتنا: تكتب في قاعدةٍ تُخلق وتموت مع التشغيلة.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-returns.ts
 */

export default async function verifyReturns({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const returns = container.resolve(RETURNS_MODULE) as ReturnsModuleService;
  const warehouse = container.resolve<any>("warehouse");

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vret-${Date.now()}`;
  const madePolicies: string[] = [];
  const restorePolicy: string[] = [];
  const madeProfiles: string[] = [];
  const madeReturns: string[] = [];
  const madeOrders: string[] = [];
  const madeLevels: string[] = [];
  let quarantineId = "";
  /** ما رفعته البوّابةُ على الرفّ — يُعاد في النهاية. */
  let shelfRestore: { id: string; stocked: number } | null = null;

  /** ينفّذ داخل معاملةٍ بسببٍ معلوم — نفسُ آليّة دفتر الحركات (م٣). */
  const withReason = async (
    reason: string,
    returnId: string | null,
    fn: (trx: any) => Promise<void>
  ) => {
    await pg.transaction(async (trx: any) => {
      await trx.raw(`select set_config('zadim.movement_reason', ?, true)`, [reason]);
      await trx.raw(`select set_config('zadim.return_id', ?, true)`, [returnId ?? ""]);
      await fn(trx);
    });
  };

  const raises = async (fn: () => Promise<any>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (e: any) {
      return String(e?.message ?? e);
    }
  };

  try {
    // ── ١) الأهليّة: منطقٌ خالصٌ بلا رقمٍ مبرمَج ─────────────────
    logger.info("== أهليّةُ الإرجاع: بيانات لا كود ==");

    const delivered = new Date("2026-08-01T10:00:00Z");
    const noPolicy = returnEligibility({ policy: null, delivered_at: delivered });
    !noPolicy.eligible && noPolicy.code === "RETURNS_DISABLED"
      ? pass("بلا سياسةٍ: **يُمنع** — وغيابُ الصفّ ليس موافقة")
      : fail(`المتوقّع RETURNS_DISABLED: ${JSON.stringify(noPolicy)}`);

    const open = { is_enabled: true };
    returnEligibility({ policy: open, delivered_at: delivered }).eligible
      ? pass("سياسةٌ بلا نافذةٍ ⇒ بلا حدٍّ زمنيّ — **لا رقمَ افتراضيَّ في الكود**")
      : fail("ثمّةَ مدّةٌ مبرمَجةٌ في مكانٍ ما");

    const undelivered = returnEligibility({ policy: open, delivered_at: null });
    !undelivered.eligible && undelivered.code === "NOT_DELIVERED"
      ? pass("ولا إرجاعَ لما لم يُسلَّم — الطريقُ إلغاءٌ لا مرتجع")
      : fail(`المتوقّع NOT_DELIVERED: ${JSON.stringify(undelivered)}`);

    const win = { is_enabled: true, window_days: 14 };
    const day = (n: number) => new Date(delivered.getTime() + n * 86400000);

    returnEligibility({ policy: win, delivered_at: delivered, now: day(13) }).eligible
      ? pass("اليومُ الثالثَ عشرَ من نافذةِ ١٤ يمرّ")
      : fail("رُفض داخلَ النافذة");

    // **الحدُّ شاملٌ لا حاجز**: من قرأ «١٤ يوماً» فهم أن الرابعَ عشرَ له.
    returnEligibility({ policy: win, delivered_at: delivered, now: day(14) }).eligible
      ? pass("**وعند الحدّ بالضبط يمرّ** — الحدُّ شاملٌ لا حاجز")
      : fail("اليومُ الرابعَ عشرَ رُفض من نافذةِ ١٤");

    const late = returnEligibility({ policy: win, delivered_at: delivered, now: day(15) });
    !late.eligible && late.code === "WINDOW_EXPIRED"
      ? pass("واليومُ الخامسَ عشرَ يُرفض")
      : fail(`المتوقّع WINDOW_EXPIRED: ${JSON.stringify(late)}`);

    // ⚠️ ساعاتٌ لا تُغيّر يوماً: الفرقُ يُقاس بالأيام الكاملة، وإلا صار
    // من استلم مساءً مرفوضاً ومن استلم صباحاً مقبولاً — فرقٌ لا يُشرح.
    const evening = new Date("2026-08-01T23:59:00Z");
    returnEligibility({
      policy: win,
      delivered_at: evening,
      now: new Date("2026-08-15T00:01:00Z"),
    }).eligible
      ? pass("وساعةُ الاستلام لا تُقدّم يوماً ولا تؤخّره")
      : fail("الحسابُ بالميلي ثانية لا بالأيام");

    const excl = returnEligibility({
      policy: { is_enabled: true, excluded_category_ids: ["pcat_food"] },
      delivered_at: delivered,
      category_ids: ["pcat_food"],
    });
    !excl.eligible && excl.code === "CATEGORY_EXCLUDED"
      ? pass("وتصنيفٌ مستثنىً يُرفض")
      : fail(`المتوقّع CATEGORY_EXCLUDED: ${JSON.stringify(excl)}`);

    const opened = returnEligibility({
      policy: { is_enabled: true, accepts_opened: false },
      delivered_at: delivered,
      is_opened: true,
    });
    !opened.eligible && opened.code === "OPENED_NOT_ACCEPTED"
      ? pass("ومفتوحُ العبوة يُرفض حين تمنعه السياسة")
      : fail(`المتوقّع OPENED_NOT_ACCEPTED: ${JSON.stringify(opened)}`);

    // ── ٢) موقعُ الحجر لا يُشحن منه — بشاهدٍ موجب ────────────────
    logger.info("== موقعُ الحجر لا يُباع منه ==");

    const profiles = [
      { location_id: "sloc_shelf", city: "الرياض", priority: 10, is_fulfilment_enabled: true },
      { location_id: "sloc_hold", city: "الرياض", priority: 99, is_fulfilment_enabled: true, is_returns_location: true },
    ];
    const ranked = rankLocations(["sloc_shelf", "sloc_hold"], profiles, "الرياض");

    !ranked.includes("sloc_hold") && ranked.includes("sloc_shelf")
      ? pass("موقعُ الحجر **لا يُرشَّح للشحن ولو كانت أولويتُه أعلى**")
      : fail(`الترتيب: ${ranked.join(" · ")}`);

    // 🔴 الشاهدُ الموجب: فحصٌ أعمى يُعيد «غيرَ مرشَّحٍ» أيضاً.
    const sameOff = rankLocations(
      ["sloc_shelf", "sloc_hold"],
      profiles.map((p) => ({ ...p, is_returns_location: false })),
      "الرياض"
    );
    sameOff.includes("sloc_hold")
      ? pass("**ونفسُ البيانات بالعلم مطفأً ⇒ يُرشَّح** — فالترشيحُ للعلم لا لشيءٍ آخر")
      : fail("لم يُرشَّح حتى بالعلم مطفأً — الفحصُ لا يقيس ما نظنّه");

    // ── ٣) القاعدةُ تمنع أن يكون المكانُ رفّاً وحجراً معاً ──────
    logger.info("== الرفُّ والحجرُ لا يجتمعان ==");

    const both = await raises(async () => {
      const [p] = await warehouse.createLocationProfiles([
        { location_id: `${tag}-both`, is_fulfilment_enabled: true, is_returns_location: true },
      ]);
      madeProfiles.push(p.id);
    });
    both
      ? pass("موقعٌ يُشحن منه **وهو حجرٌ** ترفضه القاعدة — والحالةُ لا توجد أصلاً")
      : fail("قُبل موقعٌ رفٌّ وحجرٌ معاً");

    // موقعُ الحجر الحقيقيّ لهذه التشغيلة
    const [hold] = await warehouse.createLocationProfiles([
      {
        location_id: `${tag}-hold`,
        city: "الرياض",
        is_fulfilment_enabled: false,
        is_returns_location: true,
        display_name_ar: "حجرُ المرتجعات",
      },
    ]);
    madeProfiles.push(hold.id);
    quarantineId = hold.location_id;

    // ── ٤) المرتجعُ ينزل في الحجر لا على الرفّ ───────────────────
    logger.info("== المرتجعُ لا يُستلَم على الرفّ ==");

    // ⚠️ **بوّابةٌ تقف على أثر بوّابةٍ أخرى ليست بوّابة.**
    //
    // كانت هذه تقرأ أوّلَ طلبٍ في القاعدة — فتمرّ في CI (حيث تسبقها
    // بوّابةُ الإتمام فتُنشئ طلبات) **وتسقط على قاعدةٍ من البذور
    // وحدَها**. وترتيبُ خطواتٍ في ملفّ ورشةٍ ليس عقداً: يُعاد ترتيبُه
    // يوماً فتسقط بوّابةٌ لسببٍ لا علاقةَ له بما تحرسه.
    //
    // فتصنع طلبَها بنفسها إن لم تجد. وهو صفٌّ أدنى: المرتجعُ يحتاج
    // `order_id` لأن العمودَ إلزاميّ، ولا يحتاج طلباً حقيقياً —
    // والحرّاسُ المفحوصون هنا لا يقرؤون الطلبَ أصلاً.
    let [order] = await pg("zadim.order").select("id", "version").limit(1);
    if (!order) {
      const oid = `order_${tag}`;
      await pg("zadim.order").insert({
        id: oid,
        version: 1,
        currency_code: "sar",
        status: "pending",
        is_draft_order: false,
      });
      madeOrders.push(oid);
      order = { id: oid, version: 1 };
    }

    const [shelfLevel] = await pg("zadim.inventory_level")
      .whereNull("deleted_at")
      .select("id", "location_id", "inventory_item_id", "stocked_quantity", "reserved_quantity")
      .limit(1);
    if (!shelfLevel) {
      fail("لا مستوى مخزونٍ في القاعدة — شغّل البذورَ أوّلاً");
      throw new Error("no level");
    }
    // البوّابةُ ترفع الرفَّ قطعتين لتقيس أثرَ الإطلاق، ثم تُعيدهما.
    // ولولا ذلك لانتفخ مخزونُ قاعدة التطوير قطعتين في كل تشغيلة —
    // وهو نوعُ الأثر الذي جعل بوّابةَ المرحلة ٦ تسقط في كل إعادة.
    // (والإنقاصُ لا يمرّ بالحارس: يهمّه ما **يدخل** الرفَّ لا ما يخرج.)
    shelfRestore = { id: shelfLevel.id, stocked: Number(shelfLevel.stocked_quantity) };

    const newReturn = async (locationId: string | null) => {
      const id = `return_${tag}_${Math.random().toString(36).slice(2, 8)}`;
      await pg("zadim.return").insert({
        id,
        order_id: order.id,
        order_version: order.version ?? 1,
        status: "requested",
        location_id: locationId,
      });
      madeReturns.push(id);
      return id;
    };

    const onShelf = await raises(() => newReturn(shelfLevel.location_id));
    onShelf?.includes("موقع حجر")
      ? pass("مرتجعٌ إلى مستودع البيع **ترفضه القاعدة** — لا الكود")
      : fail(`المتوقّع رفضٌ من القاعدة: ${onShelf ?? "قُبل"}`);

    const retId = await newReturn(quarantineId);
    pass(`ومرتجعٌ إلى الحجر يُقبل (${retId.slice(0, 22)}…)`);

    // ── ٥) الانتقالاتُ من جدولها ────────────────────────────────
    logger.info("== انتقالاتُ المرتجع ==");

    const canceled = await newReturn(quarantineId);
    await pg("zadim.return").where({ id: canceled }).update({ status: "canceled" });

    const revive = await raises(() =>
      pg("zadim.return").where({ id: canceled }).update({ status: "received" })
    );
    revive?.includes("انتقالٌ ممنوع")
      ? pass("**والملغى لا يُستلَم** — كما أن الملغى من الطلبات لا يُحيا")
      : fail(`قُبل canceled ⇐ received: ${revive ?? "بلا خطأ"}`);

    const legal = await raises(() =>
      pg("zadim.return").where({ id: retId }).update({ status: "received" })
    );
    !legal
      ? pass("والانتقالُ الشرعيّ (requested ⇐ received) يمرّ — الحارسُ لا يقفل الطريق")
      : fail(`رُفض انتقالٌ شرعيّ: ${legal}`);

    // ── ٦) لا يُستلَم أكثرُ مما طُلب ────────────────────────────
    logger.info("== الكمّياتُ ==");

    const itemId = `retitem_${tag}`;
    const rawQty = JSON.stringify({ value: "3", precision: 20 });
    await pg("zadim.return_item").insert({
      id: itemId,
      return_id: retId,
      item_id: `li_${tag}`,
      quantity: 3,
      raw_quantity: rawQty,
      received_quantity: 0,
      raw_received_quantity: JSON.stringify({ value: "0", precision: 20 }),
      damaged_quantity: 0,
      raw_damaged_quantity: JSON.stringify({ value: "0", precision: 20 }),
    });

    const over = await raises(() =>
      pg("zadim.return_item").where({ id: itemId }).update({ received_quantity: 5 })
    );
    over?.includes("يتجاوز المطلوب")
      ? pass("استلامُ خمسٍ من مرتجعٍ طُلبت فيه ثلاثٌ **ترفضه القاعدة**")
      : fail(`قُبل استلامٌ زائد: ${over ?? "بلا خطأ"}`);

    await pg("zadim.return_item").where({ id: itemId }).update({ received_quantity: 3 });
    const overDamaged = await raises(() =>
      pg("zadim.return_item").where({ id: itemId }).update({ damaged_quantity: 4 })
    );
    overDamaged?.includes("يتجاوز المستلَم")
      ? pass("ولا يُتلف ما لم يصل — التالفُ لا يتجاوز المستلَم")
      : fail(`قُبل تالفٌ زائد: ${overDamaged ?? "بلا خطأ"}`);

    // ── ٧) 🔴 البوّابة: الاستلامُ لا يرفع المتاحَ للبيع ──────────
    logger.info("== الاستلامُ في الحجر لا يمسّ المتاحَ للبيع ==");

    const availableOnShelf = async () => {
      const [row] = await pg("zadim.inventory_level")
        .where({ id: shelfLevel.id })
        .select("stocked_quantity", "reserved_quantity");
      return Number(row.stocked_quantity) - Number(row.reserved_quantity);
    };

    const beforeAvail = await availableOnShelf();

    // مستوى مخزونٍ في الحجر لنفس الصنف
    const holdLevelId = `ilev_${tag}`;
    await pg("zadim.inventory_level").insert({
      id: holdLevelId,
      inventory_item_id: shelfLevel.inventory_item_id,
      location_id: quarantineId,
      stocked_quantity: 0,
      reserved_quantity: 0,
      incoming_quantity: 0,
    });
    madeLevels.push(holdLevelId);

    await withReason("return", retId, async (trx) => {
      await trx("zadim.inventory_level").where({ id: holdLevelId }).update({ stocked_quantity: 3 });
    });

    const [holdRow] = await pg("zadim.inventory_level")
      .where({ id: holdLevelId })
      .select("stocked_quantity");
    const afterAvail = await availableOnShelf();

    Number(holdRow.stocked_quantity) === 3
      ? pass("الراجعُ دخل الحجرَ (٣ قطع)")
      : fail(`مخزونُ الحجر: ${holdRow.stocked_quantity}`);

    afterAvail === beforeAvail
      ? pass(`**والمتاحُ للبيع لم يتغيّر بقطعةٍ واحدة** (${beforeAvail} ⇐ ${afterAvail})`)
      : fail(`المتاحُ تغيّر: ${beforeAvail} ⇒ ${afterAvail}`);

    // ── ٨) 🔴 ولا رفَّ قبل حكمٍ بشريّ ───────────────────────────
    logger.info("== لا رفَّ قبل فحص ==");

    const noCert = await raises(() =>
      withReason("return", retId, async (trx) => {
        await trx("zadim.inventory_level")
          .where({ id: shelfLevel.id })
          .update({ stocked_quantity: Number(shelfLevel.stocked_quantity) + 1 });
      })
    );
    noCert?.includes("فُحص وحُكم بسلامته")
      ? pass("رجوعٌ إلى الرفّ **بلا شهادةِ فحصٍ ترفضه القاعدة**")
      : fail(`قُبل رجوعٌ بلا فحص: ${noCert ?? "بلا خطأ"}`);

    const noReturnId = await raises(() =>
      withReason("return", null, async (trx) => {
        await trx("zadim.inventory_level")
          .where({ id: shelfLevel.id })
          .update({ stocked_quantity: Number(shelfLevel.stocked_quantity) + 1 });
      })
    );
    noReturnId?.includes("بلا مرتجعٍ معلوم")
      ? pass("و«سببُه مرتجع» بلا مرتجعٍ معلومٍ لا يكفي — الادّعاءُ ليس شهادة")
      : fail(`قُبل بلا مرتجع: ${noReturnId ?? "بلا خطأ"}`);

    // فحصٌ تالفٌ لا يفتح شيئاً
    await returns.inspect({
      return_id: retId,
      inventory_item_id: shelfLevel.inventory_item_id,
      quantity: 1,
      outcome: "damaged",
      reason_ar: "كسرٌ في العلبة",
      actor_id: `user_${tag}`,
    });

    const damagedOnly = await raises(() =>
      withReason("return", retId, async (trx) => {
        await trx("zadim.inventory_level")
          .where({ id: shelfLevel.id })
          .update({ stocked_quantity: Number(shelfLevel.stocked_quantity) + 1 });
      })
    );
    damagedOnly?.includes("فُحص وحُكم بسلامته")
      ? pass("**وفحصٌ نتيجتُه «تالف» لا يُطلِق شيئاً** — والتالفُ لا يخصم من السليم")
      : fail(`تالفٌ أطلق بضاعة: ${damagedOnly ?? "بلا خطأ"}`);

    // وشهادةُ سلامةٍ بقطعتين
    const cert = await returns.inspect({
      return_id: retId,
      inventory_item_id: shelfLevel.inventory_item_id,
      quantity: 2,
      outcome: "resellable",
      reason_ar: "سليمةٌ بعلبتها",
      actor_id: `user_${tag}`,
    });

    const releasable = await returns.releasableQuantity(retId, shelfLevel.inventory_item_id);
    releasable === 2
      ? pass("وشهادةُ سلامةٍ بقطعتين ⇒ المُجاز قطعتان")
      : fail(`المُجاز ${releasable} والمتوقّع ٢`);

    const ok = await raises(() =>
      withReason("return", retId, async (trx) => {
        await trx("zadim.inventory_level")
          .where({ id: shelfLevel.id })
          .update({ stocked_quantity: Number(shelfLevel.stocked_quantity) + 2 });
      })
    );
    !ok
      ? pass("**وبالشهادة يمرّ** — الحارسُ يقطع الطريقَ الآليّ ولا يقفل الطريقَ الصحيح")
      : fail(`رُفض رجوعٌ مشهودٌ له: ${ok}`);

    const afterRelease = await availableOnShelf();
    afterRelease === beforeAvail + 2
      ? pass(`والمتاحُ للبيع ارتفع قطعتين لا ثلاثاً (${beforeAvail} ⇒ ${afterRelease})`)
      : fail(`المتاحُ ${afterRelease} والمتوقّع ${beforeAvail + 2}`);

    // ── ٩) الشهادةُ تُصرف مرّةً واحدة ───────────────────────────
    logger.info("== الشهادةُ لا تُصرف مرّتين ==");

    const [spent] = (await returns.listReturnInspections({ id: cert.id })) as any[];
    Number(spent.released_quantity) === 2
      ? pass("**والقاعدةُ خصمت المُصروف من الشهادة بنفسها** — لا الكود")
      : fail(`released_quantity = ${spent.released_quantity}`);

    const twice = await raises(() =>
      withReason("return", retId, async (trx) => {
        await trx("zadim.inventory_level")
          .where({ id: shelfLevel.id })
          .update({ stocked_quantity: Number(shelfLevel.stocked_quantity) + 4 });
      })
    );
    twice?.includes("فُحص وحُكم بسلامته")
      ? pass("وصرفٌ ثانٍ بنفس الشهادة يُرفض")
      : fail(`صُرفت الشهادةُ مرّتين: ${twice ?? "بلا خطأ"}`);

    // ── ١٠) الشهادةُ لا تُعدَّل ولا تُحذف ───────────────────────
    logger.info("== الشهادةُ لا تُعدَّل ولا تُحذف ==");

    const edited = await raises(() =>
      pg("zadim.zadim_return_inspection").where({ id: cert.id }).update({ outcome: "damaged" })
    );
    edited?.includes("لا يُعدَّل")
      ? pass("تغييرُ حكمٍ بعد صرفه **ترفضه القاعدة**")
      : fail(`عُدِّل الحكم: ${edited ?? "بلا خطأ"}`);

    const unspent = await raises(() =>
      pg("zadim.zadim_return_inspection").where({ id: cert.id }).update({ released_quantity: 0 })
    );
    unspent?.includes("لا يُنقَص")
      ? pass("وتنقيصُ المصروف يُرفض — وإلا صُرفت الشهادةُ مرّتين")
      : fail(`نُقِّص المصروف: ${unspent ?? "بلا خطأ"}`);

    await pg("zadim.zadim_return_inspection").where({ id: cert.id }).del();
    const [survivor] = (await returns.listReturnInspections({ id: cert.id })) as any[];
    survivor
      ? pass("والحذفُ لا يفعل شيئاً — الشهادةُ باقية")
      : fail("حُذفت الشهادة");

    const emptyReason = await raises(() =>
      returns.inspect({
        return_id: retId,
        quantity: 1,
        outcome: "resellable",
        reason_ar: "   ",
      })
    );
    emptyReason
      ? pass("وحكمٌ بلا سبب يُرفض — والفراغُ بمسافةٍ ليس سبباً")
      : fail("قُبل حكمٌ بلا سبب");

    // ── ١١) السياسةُ من القاعدة ─────────────────────────────────
    logger.info("== السياسةُ من القاعدة ==");

    const foreign = await pg("zadim.zadim_return_policy").whereNull("deleted_at").select("id");
    const foreignIds = (foreign as any[]).map((r) => r.id);
    if (foreignIds.length) {
      await pg("zadim.zadim_return_policy")
        .whereIn("id", foreignIds)
        .update({ deleted_at: new Date() });
      restorePolicy.push(...foreignIds);
    }

    const [pol] = await returns.createReturnPolicies([
      { is_enabled: true, window_days: 7, note: `بوّابة ${tag}` },
    ]);
    madePolicies.push(pol.id);

    let dup = false;
    try {
      const [p2] = await returns.createReturnPolicies([{ is_enabled: false }]);
      madePolicies.push(p2.id);
    } catch {
      dup = true;
    }
    dup
      ? pass("سياسةٌ واحدةٌ نافذة — الثانيةَ يردّها القيد")
      : fail("سياستان نافذتان: الحكمُ يعتمد على أيِّهما قُرئت أوّلاً");

    const decision = await returns.decide({ delivered_at: day(3) as any, now: day(5) });
    decision.eligible && decision.days_left === 5
      ? pass("والحكمُ يقرأ السياسةَ من القاعدة (بقي ٥ أيام)")
      : fail(`الحكم: ${JSON.stringify(decision)}`);

    const zeroWindow = await raises(() =>
      pg("zadim.zadim_return_policy").where({ id: pol.id }).update({ window_days: 0 })
    );
    zeroWindow
      ? pass("ونافذةُ صفرٍ ترفضها القاعدة — من أراد المنعَ يطفئ السياسة")
      : fail("قُبلت نافذةُ صفر");
  } finally {
    // التنظيف — والشهاداتُ **لا تُحذف** (قاعدةُ الحذف تبتلعها)، وهذا
    // مقصود: سجلٌّ يُنظّفه اختبارٌ ليس سجلّاً.
    await pg("zadim.zadim_return_policy").whereIn("id", madePolicies).del();
    if (restorePolicy.length) {
      await pg("zadim.zadim_return_policy")
        .whereIn("id", restorePolicy)
        .update({ deleted_at: null });
    }
    if (shelfRestore) {
      await pg("zadim.inventory_level")
        .where({ id: shelfRestore.id })
        .update({ stocked_quantity: shelfRestore.stocked });
    }
    await pg("zadim.inventory_level").whereIn("id", madeLevels).del();
    await pg("zadim.return_item").whereIn("return_id", madeReturns).del();
    await pg("zadim.return").whereIn("id", madeReturns).del();
    // الطلبُ الذي صنعناه (إن صنعناه) — ومعه حدثُ الصندوق الذي كتبه
    // مُطلِقُ المرحلة ٥ عند إدراجه.
    if (madeOrders.length) {
      await pg("zadim.zadim_outbox_event").whereIn("aggregate_id", madeOrders).del();
      await pg("zadim.order").whereIn("id", madeOrders).del();
    }
    await pg("zadim.zadim_location_profile").whereIn("id", madeProfiles).del();
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص المرتجعات.`);
  logger.info(
    "✅ كلُّ فحوص المرحلة ١٠ اجتازت — الراجعُ في الحجر، والرفُّ لا يُفتح إلا بحكمٍ بشريّ."
  );
}
