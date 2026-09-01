import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { MARKETING_MODULE } from "../modules/marketing";
import type MarketingModuleService from "../modules/marketing/service";
import { matchesSegment } from "../modules/marketing/segments";
import { fillTemplate, planSends, sendKey } from "../modules/marketing/dispatcher";

/**
 * بوّابةُ المرحلة ١١ — التسويق (`07-roadmap.md`).
 *
 * > السلةُ المتروكة · انخفاضُ السعر · عودةُ التوفّر · الشرائح —
 * > **كلُّها من `outbox_events` لا من مهامّ تمسح الجداول**.
 *
 * ── والشطرُ الثاني يُفحص حرفياً ──────────────────────────────────
 *
 * لا يكفي أن نبني الصندوقَ ونقول «ولا نمسح». **يُبحث في الكود عن
 * ماسحٍ**، ومعه شاهدٌ موجب: سطرٌ ماسحٌ مصطنَعٌ يجب أن يُمسَك. وفاحصٌ
 * يُعيد «صفراً» قد يكون سليماً وقد يكون أعمى، والاثنان يُنتجان نفسَ
 * السطر (نفسُ درس فاحص أجور الشحن في م٧).
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-marketing.ts
 */

/**
 * نمطُ الماسح: قراءةُ جدولٍ **بشرطٍ زمنيّ** — «من لم يتحرّك منذ…».
 *
 * ── وشرطان لا نمطٌ واحد ─────────────────────────────────────────
 *
 * أوّلُ محاولةٍ كانت تعبيراً واحداً طويلاً، **وأمسك واحداً من ثلاثة**
 * في شاهده الموجب: عاملُ المقارنة في knex نصٌّ لا رمز
 * (`.where("updated_at", "<", x)`)، والتعبيرُ كان ينتظر الرمزَ ملاصقاً.
 * ولولا الشاهدُ الموجب لمرّ الفاحصُ الأعمى بـ«صفر ماسح» ولصُدِّق.
 *
 * فصار شرطين مقروءين: **جدولٌ يُقرأ** و**عمودُ وقتٍ يُقارَن** — ولزوم
 * اجتماعِهما في السطر هو ما يميّز الماسحَ عن التحديث العاديّ.
 */
const TABLE_READ =
  /(?:\b(?:from|table|join)\s+|["'`]|\(\s*["'`])(?:zadim\.)?(?:cart|cart_line_item|inventory_level)\b/i;
const TIME_WINDOW = /\b(?:updated_at|created_at|last_seen)\b["'`\s,]*(?:<=|>=|<|>)/i;
const SWEEPER = { test: (l: string) => TABLE_READ.test(l) && TIME_WINDOW.test(l) };

/** ملفّاتٌ تُستثنى، **والاستثناءُ معلَنٌ لا مدفون**. */
const SKIP = [
  "node_modules",
  ".medusa",
  "dist",
  // الهجراتُ تكتب المُطلِقات، والمُطلِقُ هو البديلُ عن الماسح لا نسخةٌ
  // منه. ونصُّه يذكر الجداولَ والأوقاتَ بحكم عمله.
  "migrations",
  // وهذا الملفُّ نفسُه: يحمل النمطَ ليبحث به، ولولا استثناؤه لأمسك
  // نفسَه وأعلن عطلاً لا وجودَ له.
  "verify-marketing.ts",
];

function scanForSweepers(root: string): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (SKIP.some((s) => full.includes(s))) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry)) continue;

      // التعليقاتُ تُنزع قبل الفحص: شرحٌ يذكر ماسحاً ليقول «لا نفعل
      // هذا» ليس ماسحاً. وفاحصٌ يشكو من التعليقات يُعلّم الناسَ ألّا
      // يكتبوها.
      const src = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1");

      src.split("\n").forEach((line, i) => {
        if (SWEEPER.test(line)) hits.push({ file: full, line: i + 1, text: line.trim().slice(0, 80) });
      });
    }
  };

  walk(root);
  return hits;
}

export default async function verifyMarketing({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const marketing = container.resolve(MARKETING_MODULE) as MarketingModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vmkt-${Date.now()}`;
  const madeTemplates: string[] = [];
  const madeSegments: string[] = [];
  const madeCarts: string[] = [];
  const madeEvents: string[] = [];
  const madeSends: string[] = [];
  const madeLevels: string[] = [];
  let priceRestore: { id: string; amount: number } | null = null;

  const events = (event: string, aggregateId: string) =>
    pg("zadim.zadim_outbox_event")
      .where({ event, aggregate_id: aggregateId })
      .orderBy("created_at", "asc")
      .select("id", "occurred_at", "payload", "delivered_at");

  try {
    // ── ١) «لا مهامَّ تمسح الجداول» — بشاهدٍ موجب ────────────────
    logger.info("== لا ماسحَ في الكود ==");

    // 🔴 الشاهدُ الموجب أوّلاً: فحصٌ أعمى يُعيد «صفراً» أيضاً.
    const bait = [
      `const stale = await pg("cart").where("updated_at", "<", cutoff)`,
      `select * from zadim.cart_line_item where updated_at <= $1`,
      `knex.from("inventory_level").where("created_at", ">", since)`,
      `await pg("zadim.cart").whereRaw("updated_at < now() - interval '1 hour'")`,
    ];
    const caught = bait.filter((l) => SWEEPER.test(l)).length;
    caught === bait.length
      ? pass(`الفاحصُ يُمسك ثلاثةَ أسطرٍ ماسحةٍ مصطنَعة (${caught}/${bait.length})`)
      : fail(`أمسك ${caught} من ${bait.length} — الفاحصُ أعمى، و«صفرٌ» منه لا يعني شيئاً`);

    const innocent = [
      `const cart = await getCart(id)`,
      `await pg("zadim.inventory_level").where({ id }).update({ stocked_quantity: 5 })`,
      `logger.info("cart updated_at is a column name")`,
      // 🔴 وهذا أهمُّ بريءٍ في القائمة: **قراءةُ الصندوق بالاستحقاق**
      // هي بديلُ الماسح لا نسخةٌ منه — وفاحصٌ يشكو منها يمنع الحلَّ
      // الصحيح.
      `await pg("zadim.zadim_outbox_event").where("occurred_at", "<=", new Date())`,
    ];
    const flagged = innocent.filter((l) => SWEEPER.test(l));
    flagged.length === 0
      ? pass("ولا يشكو من أسطرٍ بريئة")
      : fail(`شكا من بريءٍ: ${flagged[0]}`);

    const sweepers = scanForSweepers(join(process.cwd(), "src"));
    sweepers.length === 0
      ? pass("**ولا ماسحَ واحداً في الكود** — التسويقُ كلُّه من الصندوق")
      : fail(
          `${sweepers.length} ماسحاً: ${sweepers
            .slice(0, 3)
            .map((h) => `${h.file.split("/src/")[1]}:${h.line}`)
            .join(" · ")}`
        );

    // ── ٢) انخفاضُ السعر ⇒ حدث · وارتفاعُه ⇒ لا شيء ─────────────
    logger.info("== انخفاضُ السعر ==");

    const [price] = await pg("zadim.price").whereNull("deleted_at").select("id", "amount").limit(1);
    if (!price) {
      fail("لا سعرَ في القاعدة — شغّل البذورَ أوّلاً");
      throw new Error("no price");
    }
    priceRestore = { id: price.id, amount: Number(price.amount) };

    const beforeDrop = (await events("PriceDropped", price.id)).length;

    await pg("zadim.price").where({ id: price.id }).update({ amount: Number(price.amount) + 1000 });
    const afterRaise = (await events("PriceDropped", price.id)).length;
    afterRaise === beforeDrop
      ? pass("رفعُ السعر **لا يكتب حدثاً** — العميلُ يريد أن يعلم حين يرخص")
      : fail(`الرفعُ كتب ${afterRaise - beforeDrop} حدثاً`);

    await pg("zadim.price").where({ id: price.id }).update({ amount: Number(price.amount) - 500 });
    const dropRows = await events("PriceDropped", price.id);
    dropRows.length === beforeDrop + 1
      ? pass("وخفضُه يكتب **حدثاً واحداً**")
      : fail(`الخفضُ كتب ${dropRows.length - beforeDrop} حدثاً`);

    const dropPayload = dropRows[dropRows.length - 1]?.payload ?? {};
    Number(dropPayload.drop) > 0 && Number(dropPayload.new_amount) < Number(dropPayload.old_amount)
      ? pass(`والفرقُ في الحمولة (${dropPayload.old_amount} ⇒ ${dropPayload.new_amount})`)
      : fail(`الحمولة: ${JSON.stringify(dropPayload)}`);

    madeEvents.push(...dropRows.map((r: any) => r.id));

    // ── ٣) 🔴 الحدثُ في نفس المعاملة — وهذا الفرقُ كلُّه ────────
    logger.info("== الحدثُ يقع ويُلغى مع معاملته ==");

    const beforeTx = (await events("PriceDropped", price.id)).length;
    const txAmount = Number(price.amount) - 500;

    try {
      await pg.transaction(async (trx: any) => {
        await trx("zadim.price").where({ id: price.id }).update({ amount: txAmount - 250 });
        // معاملةٌ تُلغى: ولو كان الحدثُ يُرسَل إلى طابورٍ خارجيّ لَخرج
        // ولا يعود — فيصل العميلَ إعلانُ تخفيضٍ لم يقع.
        throw new Error("rollback on purpose");
      });
    } catch {
      /* مقصود */
    }

    const afterTx = (await events("PriceDropped", price.id)).length;
    const [nowPrice] = await pg("zadim.price").where({ id: price.id }).select("amount");

    afterTx === beforeTx && Number(nowPrice.amount) === txAmount
      ? pass("**معاملةٌ أُلغيت ⇒ لا سعرَ منخفضٌ ولا حدث** — يقعان معاً أو لا يقعان")
      : fail(`الحدث ${afterTx - beforeTx} والسعر ${nowPrice.amount} (المتوقّع ${txAmount})`);

    // ── ٤) عودةُ التوفّر: العبورُ من صفر، لا كلُّ زيادة ─────────
    logger.info("== عودةُ التوفّر ==");

    // ⚠️ **مستوىً خاصٌّ بهذه التشغيلة، لا أوّلُ صفٍّ في القاعدة.**
    //
    // أوّلُ محاولةٍ أخذت أوّلَ مستوىً فسقط الفحص: مُطلِقُ المرحلة ٣
    // يجعل `reserved` **مشتقّاً** من الحجوزات القائمة، وذاك الصفُّ عليه
    // حجوزات — فالمتاحُ يبقى صفراً مهما ارتفع المخزون، ولا عبورَ يقع.
    // والحارسُ سليم؛ **الفخُّ كان في اختيار العيّنة**.
    const [anyItem] = await pg("zadim.inventory_item").whereNull("deleted_at").select("id").limit(1);
    const levelId = `ilev_${tag}`;
    await pg("zadim.inventory_level").insert({
      id: levelId,
      inventory_item_id: anyItem.id,
      location_id: `sloc_${tag}`,
      // ⚠️ **يبدأ بخمسٍ لا بصفر.** أوّلُ محاولةٍ أنشأته صفراً ثم رفعته
      // خمسةً «تهيئةً» — وتلك **عبورٌ حقيقيّ** كتب حدثاً، فاختلّ العدّ
      // وبدا الحارسُ مخطئاً وهو مصيب. والتهيئةُ يجب ألّا تكون هي الفعل
      // المفحوص.
      stocked_quantity: 5,
      reserved_quantity: 0,
      incoming_quantity: 0,
    });
    const level = { id: levelId, inventory_item_id: anyItem.id };
    madeLevels.push(levelId);

    const beforeStock = (await events("BackInStock", level.inventory_item_id)).length;

    // ٥ ⇒ ٨: كان متاحاً، فلا حدث.
    await pg("zadim.inventory_level").where({ id: level.id }).update({ stocked_quantity: 8 });
    const afterMore = (await events("BackInStock", level.inventory_item_id)).length;
    afterMore === beforeStock
      ? pass("زيادةُ مخزونٍ متاحٍ أصلاً (٥ ⇒ ٨) **لا تكتب حدثاً**")
      : fail(`كتبت ${afterMore - beforeStock} حدثاً`);

    // ٠ ⇒ ٥: عبورٌ حقيقيّ.
    await pg("zadim.inventory_level").where({ id: level.id }).update({ stocked_quantity: 0 });
    await pg("zadim.inventory_level").where({ id: level.id }).update({ stocked_quantity: 5 });
    const stockRows = await events("BackInStock", level.inventory_item_id);
    stockRows.length === beforeStock + 1
      ? pass("**والعبورُ من صفرٍ إلى موجب يكتب حدثاً واحداً**")
      : fail(`العبورُ كتب ${stockRows.length - beforeStock} حدثاً`);
    madeEvents.push(...stockRows.map((r: any) => r.id));

    // ── ٥) 🔴 السلّةُ المتروكة: تذكيرٌ واحدٌ يتأخّر ──────────────
    logger.info("== السلّةُ المتروكة ==");

    const cartId = `cart_${tag}`;
    await pg("zadim.cart").insert({ id: cartId, currency_code: "sar", region_id: null });
    madeCarts.push(cartId);

    const addLine = async (n: number) => {
      await pg("zadim.cart_line_item").insert({
        id: `cali_${tag}_${n}`,
        cart_id: cartId,
        title: `صنف ${n}`,
        quantity: 1,
        // `raw_*` أعمدةُ BigNumber عند Medusa — إلزاميّةٌ مع كل مبلغ.
        unit_price: 1000,
        raw_unit_price: JSON.stringify({ value: "1000", precision: 20 }),
      });
    };

    const reminders = () =>
      pg("zadim.zadim_scheduled_reminder")
        .where({ kind: "CartWentQuiet", aggregate_id: cartId })
        .select("id", "due_at", "fired_at", "canceled_at", "cancel_reason");

    for (let i = 0; i < 10; i++) await addLine(i);

    const rem = await reminders();
    rem.length === 1
      ? pass("عشرُ إضافاتٍ إلى السلّة ⇒ **تذكيرٌ واحد** لا عشرة")
      : fail(`${rem.length} تذكيراً — وعشرُ رسائلَ تصل العميلَ عن سلّةٍ واحدة`);

    const due = new Date(rem[0].due_at).getTime();
    due > Date.now() + 30 * 60 * 1000
      ? pass(`وموعدُه في المستقبل (بعد ${Math.round((due - Date.now()) / 60000)} دقيقة)`)
      : fail(`موعدُه ${new Date(due).toISOString()} — والتذكيرُ يجب أن يستحقّ لاحقاً`);

    await new Promise((r) => setTimeout(r, 1100));
    await addLine(99);
    const rem2 = await reminders();
    const due2 = new Date(rem2[0].due_at).getTime();

    rem2.length === 1 && due2 > due
      ? pass("**وتغييرٌ جديدٌ يؤخّر الموعدَ** ولا يُنشئ تذكيراً ثانياً")
      : fail(`التذكيرات ${rem2.length} والموعدُ ${due2 > due ? "تأخّر" : "لم يتأخّر"}`);

    // ── ٦) المُرسِلُ يقرأ المستحقَّ وحدَه ───────────────────────
    logger.info("== الاستحقاق ==");

    const dueNow = async () =>
      pg("zadim.zadim_scheduled_reminder")
        .whereNull("fired_at")
        .whereNull("canceled_at")
        .where("due_at", "<=", new Date())
        .where({ aggregate_id: cartId })
        .select("id");

    (await dueNow()).length === 0
      ? pass("تذكيرٌ لم يستحقّ **لا يُقرأ** — ولا رسالةَ قبل أوانها")
      : fail("قُرئ تذكيرٌ لم يستحقّ");

    await pg("zadim.zadim_scheduled_reminder")
      .where({ id: rem2[0].id })
      .update({ due_at: new Date(Date.now() - 60000) });

    (await dueNow()).length === 1
      ? pass("وحين يستحقّ يُقرأ — بفهرسٍ على الوقت لا بمَسحِ جدول السلال")
      : fail("لم يُقرأ بعد استحقاقه");

    // ── ٧) ومن أتمّ سلّتَه لا يُذكَّر بها ───────────────────────
    await pg("zadim.cart").where({ id: cartId }).update({ completed_at: new Date() });
    const afterDone = await reminders();
    afterDone[0].canceled_at && afterDone[0].cancel_reason
      ? pass(`**ومن أتمّ سلّتَه يسقط تذكيرُه** — ويُلغى بسببٍ مكتوبٍ لا يُحذف (${afterDone[0].cancel_reason})`)
      : fail("بقي التذكيرُ قائماً بعد الشراء");

    // 🔴 وتذكيرٌ حيٌّ واحدٌ يفرضه **فهرسٌ في القاعدة** لا الكود:
    // تُحاوَل كتابةُ تذكيرين لسلّةٍ واحدة، ويجب أن يبقى واحد.
    for (const n of ["dup", "dup2"]) {
      await pg("zadim.zadim_scheduled_reminder")
        .insert({
          id: `rem_${tag}_${n}`,
          kind: "CartWentQuiet",
          aggregate_id: `${cartId}-x`,
          due_at: new Date(),
        })
        .catch(() => undefined);
    }
    const dupCount = await pg("zadim.zadim_scheduled_reminder")
      .where({ kind: "CartWentQuiet", aggregate_id: `${cartId}-x` })
      .whereNull("fired_at")
      .whereNull("canceled_at")
      .count("id as c");
    Number((dupCount as any[])[0].c) === 1
      ? pass("وتذكيرٌ حيٌّ **واحدٌ** لكل سلّة — يفرضه فهرسٌ في القاعدة")
      : fail(`${(dupCount as any[])[0].c} تذكيراً حيّاً لنفس السلّة`);

    // ── ٨) الشرائح: منطقٌ خالصٌ بشاهدٍ موجب ────────────────────
    logger.info("== الشرائح ==");

    const vip = {
      match: "all" as const,
      rules: [
        { field: "total_spent", op: "gte" as const, value: 100000 },
        { field: "city", op: "eq" as const, value: "الرياض" },
      ],
    };

    matchesSegment(vip, { total_spent: 150000, city: "الرياض" })
      ? pass("قاعدتان تنطبقان ⇒ يُطابِق")
      : fail("لم يُطابِق من ينطبق عليه");

    !matchesSegment(vip, { total_spent: 150000, city: "جدة" })
      ? pass("**وواحدةٌ تخلّفت ⇒ لا يُطابِق** (match: all)")
      : fail("طابقَ من تخلّفت عنه قاعدة");

    matchesSegment({ match: "any", rules: vip.rules }, { total_spent: 150000, city: "جدة" })
      ? pass("و`any` تكفيها واحدة")
      : fail("`any` لم تكتفِ بواحدة");

    !matchesSegment({ rules: [] }, { total_spent: 999999 })
      ? pass("**وشريحةٌ بلا قواعدَ لا تُطابِق أحداً** — لا الجميع")
      : fail("شريحةٌ فارغةٌ طابقت الجميع — وحملةٌ تصل كلَّ عميلٍ في المتجر");

    !matchesSegment(
      { rules: [{ field: "city", op: "gt", value: 5 }] },
      { city: "الرياض" }
    )
      ? pass("ومقارنةٌ عدديّةٌ على نصٍّ لا تُطابِق — ولا تُخمَّن بالإكراه")
      : fail("قارنَ نصّاً بعددٍ وأعطى نتيجة");

    // ── ٩) القوالبُ والإرسالُ مرّةً واحدة ──────────────────────
    logger.info("== لا تصل الرسالةُ مرّتين ==");

    const [tpl] = await marketing.createNotificationTemplates([
      {
        event: `PriceDropped-${tag}`,
        channel: "email",
        subject_ar: "انخفض سعرُ {{title}}",
        body_ar: "صار بـ{{new_amount}} بدل {{old_amount}}. {{missing}}",
        body_en: "Now {{new_amount}} instead of {{old_amount}}.",
        is_active: true,
      } as any,
    ]);
    madeTemplates.push(tpl.id);

    fillTemplate("سعرُ {{title}} صار {{new_amount}}{{missing}}", {
      title: "سمّاعة",
      new_amount: 350,
    }) === "سعرُ سمّاعة صار 350"
      ? pass("متغيّرٌ بلا قيمةٍ **يُحذف** ولا يظهر بقوسيه للعميل")
      : fail("المتغيّرُ الناقصُ ظهر في النصّ");

    const evt = {
      id: `evt_${tag}`,
      event: `PriceDropped-${tag}`,
      aggregate_type: "price",
      aggregate_id: price.id,
      payload: { title: "سمّاعة", old_amount: 39900, new_amount: 34900 },
      occurred_at: new Date(),
      attempts: 0,
    };

    const plans = planSends(evt, [tpl as any], { email: "a@zadim.test", locale: "ar" });
    plans.length === 1 && plans[0].body.includes("34900")
      ? pass("والخطّةُ تُبنى من القالب بحمولة الحدث")
      : fail(`الخطّة: ${JSON.stringify(plans)}`);

    planSends(evt, [tpl as any], { phone: "0501234567", locale: "ar" }).length === 0
      ? pass("وقناةُ بريدٍ بلا بريدٍ تُتخطّى — ولا رسالةَ بلا مستقبِل")
      : fail("خُطِّط إرسالٌ بلا عنوان");

    const en = planSends(evt, [tpl as any], { email: "a@zadim.test", locale: "en" });
    en[0]?.body.startsWith("Now")
      ? pass("واللغةُ الإنجليزيةُ تُختار حين تُطلب")
      : fail(`النصّ: ${en[0]?.body}`);

    const first = await marketing.claimSend(plans[0]);
    const second = await marketing.claimSend(plans[0]);
    madeSends.push(first.row.id);

    first.fresh && !second.fresh && first.row.id === second.row.id
      ? pass("**ومفتاحٌ واحدٌ ⇒ سجلُّ إرسالٍ واحد** — لا تصل الرسالةُ مرّتين")
      : fail(`الحجز: ${JSON.stringify([first.fresh, second.fresh])}`);

    const [, sendCount] = await marketing.listAndCountNotificationSends({
      send_key: plans[0].send_key,
    });
    sendCount === 1
      ? pass("وسجلٌّ واحدٌ في القاعدة مهما تكرّر النداء")
      : fail(`${sendCount} سجلّاً`);

    sendKey("evt_1", "email", "a@b.c") === "evt_1:email:a@b.c"
      ? pass("والمفتاحُ يُبنى في مكانٍ واحد")
      : fail("المفتاحُ اختلف");

    // ── ١٠) الشريحةُ من القاعدة ────────────────────────────────
    const [seg] = await marketing.createCustomerSegments([
      { name_ar: `شريحة ${tag}`, definition: vip, is_active: true } as any,
    ]);
    madeSegments.push(seg.id);

    const members = await marketing.membersOf(seg.id, [
      { id: "c1", total_spent: 200000, city: "الرياض" },
      { id: "c2", total_spent: 200000, city: "جدة" },
      { id: "c3", total_spent: 500, city: "الرياض" },
    ]);
    members.length === 1 && members[0].id === "c1"
      ? pass("وشريحةٌ من القاعدة تُرشّح ثلاثةً إلى واحد")
      : fail(`الأعضاء: ${JSON.stringify(members.map((m: any) => m.id))}`);
  } finally {
    if (priceRestore) {
      await pg("zadim.price").where({ id: priceRestore.id }).update({ amount: priceRestore.amount });
    }
    await pg("zadim.inventory_level").whereIn("id", madeLevels).del();
    await pg("zadim.zadim_notification_send").whereIn("id", madeSends).del();
    await pg("zadim.zadim_notification_template").whereIn("id", madeTemplates).del();
    await pg("zadim.zadim_customer_segment").whereIn("id", madeSegments).del();
    await pg("zadim.zadim_scheduled_reminder").where("aggregate_id", "like", `cart_${tag}%`).del();
    await pg("zadim.cart_line_item").whereIn("cart_id", madeCarts).del();
    await pg("zadim.cart").whereIn("id", madeCarts).del();
    // أحداثُ البوّابة تُحذف حذفاً باتّاً — وهي أحداثُ تشغيلةٍ لا وقائعُ
    // متجر. والصندوقُ نفسُه لا يُحذف منه في المسار العاديّ (م٥).
    await pg("zadim.zadim_outbox_event").whereIn("id", madeEvents).del();
    await pg("zadim.zadim_outbox_event").where({ aggregate_id: `cart_${tag}` }).del();
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص التسويق.`);
  logger.info(
    "✅ كلُّ فحوص المرحلة ١١ اجتازت — التسويقُ من الصندوق، ولا ماسحَ في الكود."
  );
}
