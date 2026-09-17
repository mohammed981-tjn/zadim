import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { Client } from "pg";
import { flashState } from "../modules/promotions/flash";

/**
 * بوّابةُ التخفيض الخاطف.
 *
 * ── وشرطُ القبول مكتوبٌ في الخارطة ──────────────────────────────
 *
 * > «١٠٠ محاولةٍ متزامنةٍ على عشر قطعٍ ⇒ **عشرٌ بالضبط**».
 *
 * ── ولماذا اتصالاتٌ مستقلّة لا `Promise.all` على مجمّعٍ واحد ────
 *
 * لأن المجمّعَ يُسلسل المعاملاتِ على عددٍ محدودٍ من الاتصالات، فيبدو
 * الحارسُ ناجحاً **وهو لم يُختبَر**: لا تزاحمَ أصلاً. ومئةُ اتصالٍ
 * حقيقيٍّ تُنتج التزاحمَ الذي يقع في الإنتاج.
 *
 * ── والنقضُ جزءٌ من البوّابة ────────────────────────────────────
 *
 * تُعاد التجربةُ بحارسٍ **بلا `for update`** ويُتأكَّد أنه **يبيع أكثرَ
 * من السقف**. فبلا هذا النقض تمرّ البوّابةُ خضراءَ على حارسٍ لا يقفل —
 * وهي نفسُ الخضرةِ التي سمحت بـ٩٤ بيعاً من عشرة قبل حارس المخزون.
 *
 * ── 🔴 ونقضٌ يتبع سرعةَ الآلة ليس نقضاً ─────────────────────────
 *
 * سقطت هذه البوّابةُ في CI **على نقضها هي**: الحارسُ بلا قفلٍ باع عشرةً
 * بالضبط، فلم يُثبت النقضُ شيئاً. والسببُ أن فتحَ مئةِ اتصالٍ يُشعِل
 * مئةَ عمليةِ خادمٍ في Postgres، وعلى عدّادَين ذلك **يُسلسل البدايات**:
 * كلُّ إدخالٍ يبدأ بعد أن التزم سابقُه، فلا تزاحمَ أصلاً. ومحلّياً
 * تزاحمت فباعت ١٦ — **فكان الأخضرُ والأحمرُ يقيسان الآلةَ لا الحارس**.
 *
 * فصار النقضُ مقيساً لا مصادَفاً بأمرين:
 *
 * ١. **تُفتح الاتصالاتُ كلُّها أوّلاً** ثم تُطلَق الإدخالاتُ دفعةً
 *    واحدة — فيصير التفاوتُ في البدايات أجزاءَ مِلّي ثانية.
 * ٢. **نافذةُ الفحص→الالتزام تُوسَّع** بـ`pg_sleep` بعد الفحوص وقبل
 *    `return new` — فالنافذةُ التي كانت تُصادَف صارت تُقاس.
 *
 * ── والشاهدُ المضادُّ هو الذي يجعل هذا نقضاً لا حيلة ─────────────
 *
 * لأن قائلاً يقول: «النافذةُ هي التي باعت، لا غيابُ القفل». فتُعاد
 * التجربةُ **بنفس النافذة ومع القفل** ⇒ عشرةٌ بالضبط. فالنافذةُ واحدةٌ
 * والفرقُ سطرٌ واحد: `for update`.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-flash.ts
 */

const STOCK = 10;
const ATTEMPTS = 100;

/**
 * نافذةُ الفحص→الالتزام، موسَّعةً للنقض وحدَه (بالثواني).
 *
 * ١٥٠ مِلّي ثانيةً أكبرُ بمراتبَ من تفاوت بدايات الإدخالات بعد فتح
 * الاتصالات (أجزاءُ مِلّي)، وأصغرُ من أن تُطيل البوّابة: مع القفل
 * ينام الناجحون وحدَهم — عشرةٌ × ١٥٠م ≈ ثانيةٌ ونصف — لأن الرفضَ
 * يقع **قبل** النوم.
 */
const WINDOW_S = 0.15;

/** أقلُّ ما يُقبل من اتصالاتٍ متزامنة: دونه يُقاس سقفُ القاعدة لا الحارس. */
const MIN_JOINED = 60;

export default async function verifyFlash({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const schema = process.env.DATABASE_SCHEMA || "zadim";
  const conn = process.env.DATABASE_URL as string;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vflash-${Date.now()}`;
  const made: string[] = [];

  /**
   * نصُّ الحارس الأصليّ كما هو في الهجرة — **يُقرأ من القاعدة لا يُنسخ**.
   *
   * ونسخةٌ يدويّةٌ هنا تتقادم بصمت: تُعدَّل الهجرةُ فيبقى النقضُ ينقض
   * حارساً لم يعُد موجوداً، ويمرّ أخضرَ على العطب.
   */
  const originalGuard = (
    await pg.raw(`select prosrc from pg_proc where proname = 'zadim_guard_flash_claim'`)
  )?.rows?.[0]?.prosrc as string;
  if (!originalGuard) {
    throw new Error("zadim: لا حارسَ في القاعدة — الهجرةُ لم تُطبَّق، والنقضُ بلا أصلٍ يُعاد إليه.");
  }

  const install = (body: string) =>
    pg.raw(
      `create or replace function "zadim_guard_flash_claim"()
         returns trigger language plpgsql as $ZADIM$${body}$ZADIM$;`
    );

  /** نزعُ القفل — والتأكّدُ أنه كان هناك، فنقضٌ لم يُطبَّق أسوأُ من غيابه. */
  const withoutLock = (src: string) => {
    if (!/\bfor update\b/.test(src)) {
      throw new Error("zadim: النقضُ لم يُطبَّق — لا «for update» في نصّ الحارس.");
    }
    return src.replace(/\bfor update\b/, "");
  };

  /** توسيعُ النافذة: بعد الفحوص كلِّها وقبل `return new` الأخيرة. */
  const withWindow = (src: string) => {
    const at = src.lastIndexOf("return new;");
    if (at < 0) {
      throw new Error("zadim: النقضُ لم يُطبَّق — لا «return new;» أخيرةٌ في نصّ الحارس.");
    }
    return `${src.slice(0, at)}perform pg_sleep(${WINDOW_S});\n        ${src.slice(at)}`;
  };

  const newSale = async (
    id: string,
    o: {
      from?: string;
      to?: string;
      quantity_limit?: number | null;
      per_customer_limit?: number | null;
      is_active?: boolean;
    } = {}
  ) => {
    const sid = `${id}-${tag}`;
    await pg.raw(
      `insert into "zadim_flash_sale"
         ("id","promotion_id","promotion_code","starts_at","ends_at",
          "quantity_limit","per_customer_limit","is_active")
       values (?, ?, ?, now() + (? )::interval, now() + (? )::interval, ?, ?, ?)`,
      [
        sid,
        `promo-${sid}`,
        `CODE-${sid}`,
        o.from ?? "-1 hour",
        o.to ?? "1 hour",
        o.quantity_limit ?? null,
        o.per_customer_limit ?? null,
        o.is_active ?? true,
      ]
    );
    made.push(sid);
    return sid;
  };

  /** مطالبةٌ واحدة — تُعيد رمزَ الرفض أو `null` عند النجاح. */
  const claim = async (
    saleId: string,
    customer: string,
    cart: string,
    quantity = 1,
    id = `${cart}-${Math.random().toString(36).slice(2, 8)}`
  ): Promise<string | null> => {
    try {
      await pg.raw(
        `insert into "zadim_flash_sale_claim"
           ("id","flash_sale_id","customer_key","cart_id","quantity")
         values (?, ?, ?, ?, ?)`,
        [id, saleId, customer, cart, quantity]
      );
      return null;
    } catch (e) {
      const m = /zadim:\s*(FLASH_[A-Z_]+)/.exec(String((e as Error)?.message));
      return m?.[1] ?? "OTHER";
    }
  };

  /**
   * مئةُ اتصالٍ حقيقيّ — **تُفتح كلُّها ثم تُطلَق دفعةً واحدة**.
   *
   * ولا مجمَّعٌ: المجمَّعُ يُسلسل المعاملاتِ على اتصالاتٍ معدودة فيبدو
   * الحارسُ ناجحاً وهو لم يُختبَر. ولا فتحٌ مع الإطلاق: فتحُ الاتصال
   * يُشعِل عمليةَ خادمٍ في Postgres، وعلى عدّادَين تُسلسَل البدايات
   * فيلتزم السابقُ قبل أن يبدأ اللاحق — وذاك بعينه ما أسقط هذه
   * البوّابةَ على نقضها في CI.
   *
   * ويُعاد `joined` لأن سقفَ اتصالات القاعدة يُنقص المشاركين، ويجب أن
   * يُقال بصوتٍ عالٍ لا أن يُحسب رفضاً من الحارس.
   */
  const storm = async (saleId: string): Promise<{ ok: number; joined: number }> => {
    const clients = await Promise.all(
      Array.from({ length: ATTEMPTS }, async () => {
        const c = new Client({ connectionString: conn });
        try {
          await c.connect();
          await c.query(`set search_path to "${schema}"`);
          return c;
        } catch {
          try {
            await c.end();
          } catch {
            /* اتصالٌ لم يُفتح لا يُغلق */
          }
          return null;
        }
      })
    );
    const joined = clients.filter((c) => c !== null).length;

    // 🔴 كلُّ الاستعلامات تُطلَق في نفس الدورة — لا `await` بينها.
    const results = await Promise.allSettled(
      clients.map((c, i) =>
        c
          ? c.query(
              `insert into "zadim_flash_sale_claim"
                 ("id","flash_sale_id","customer_key","cart_id","quantity")
               values ($1, $2, $3, $4, 1)`,
              [`${saleId}-s${i}`, saleId, `cust${i}`, `${saleId}-cart${i}`]
            )
          : Promise.reject(new Error("no-connection"))
      )
    );

    await Promise.allSettled(clients.map((c) => c?.end()));
    return { ok: results.filter((r) => r.status === "fulfilled").length, joined };
  };

  const netOf = async (saleId: string): Promise<number> => {
    const r = await pg.raw(
      `select coalesce(sum("quantity"), 0)::int as n from "zadim_flash_sale_claim"
        where "flash_sale_id" = ?`,
      [saleId]
    );
    return Number(r?.rows?.[0]?.n ?? 0);
  };

  try {
    // ── ١) البوّابة: مئةٌ متزامنةٌ على عشر ────────────────────────
    logger.info(`== البوّابة: ${ATTEMPTS} محاولةً متزامنةً على ${STOCK} قطع ==`);
    const gate = await newSale("gate", { quantity_limit: STOCK });
    const { ok: okGate, joined } = await storm(gate);
    const netGate = await netOf(gate);

    logger.info(
      `     شارك ${joined} اتصالاً من ${ATTEMPTS} · نجحت ${okGate} · ` +
        `رُفضت ${joined - okGate} · المجموعُ الصافي ${netGate}`
    );
    joined >= MIN_JOINED
      ? pass(`${joined} اتصالاً حقيقيّاً تزاحمت دفعةً واحدة`)
      : fail(
          `لم يتّصل إلا ${joined} من ${ATTEMPTS} — سقفُ اتصالات القاعدة يخنق القياس، ` +
            `فما يُقاس هنا ليس الحارس.`
        );
    okGate === STOCK
      ? pass(`نجح ${STOCK} بالضبط ورُفض ${joined - STOCK}`)
      : fail(`نجح ${okGate} والمتوقّع ${STOCK} — بيعٌ زائدٌ في العرض`);
    netGate === STOCK
      ? pass(`الدفترُ يقول ${STOCK} — الحقيقةُ في الصفوف لا في عدّاد`)
      : fail(`الدفترُ يقول ${netGate} والمتوقّع ${STOCK}`);

    // ── ٢) 🔴 نقضُ القفل: بلا `for update` وبنافذةٍ موسَّعة ───────
    logger.info(`== النقض: نفسُ الحارس بلا قفل، والنافذةُ ${WINDOW_S * 1000}م ==`);
    await install(withWindow(withoutLock(originalGuard)));
    const loose = await newSale("nolock", { quantity_limit: STOCK });
    const okLoose = (await storm(loose)).ok;

    logger.info(`     بلا قفل: نجحت ${okLoose} على سقف ${STOCK}`);
    okLoose > STOCK
      ? pass(`بلا القفل بِيع ${okLoose} من ${STOCK} — فالقفلُ هو الحارسُ لا الشرط`)
      : fail(
          `بلا القفل بِيع ${okLoose} فقط — النقضُ لم يُثبت شيئاً. ` +
            `فإمّا أن التزاحمَ لم يقع (اتصالاتٌ مُسلسَلة) أو أن الفحصَ يقيس غيرَ ما يظنّ.`
        );

    // ── ٢ب) الشاهدُ المضادّ: **نفسُ النافذة مع القفل** ⇒ عشرةٌ ────
    //
    // وبدونه يبقى الاعتراضُ قائماً: «النافذةُ هي التي باعت لا غيابُ
    // القفل». والفرقُ بين التجربتين سطرٌ واحد.
    logger.info("== الشاهدُ المضادّ: نفسُ النافذة ومعها القفل ==");
    await install(withWindow(originalGuard));
    const ctl = await newSale("ctl", { quantity_limit: STOCK });
    const okCtl = (await storm(ctl)).ok;

    logger.info(`     بالقفل وبنفس النافذة: نجحت ${okCtl}`);
    okCtl === STOCK
      ? pass(`النافذةُ نفسُها ومع القفل ${STOCK} بالضبط — فالفرقُ «for update» لا السرعة`)
      : fail(`بالقفل وبنفس النافذة نجحت ${okCtl} والمتوقّع ${STOCK}`);

    // وقد أُعيد الحارسُ الأصليّ: يُتأكَّد بقياسٍ ثالثٍ لا بالثقة.
    await install(originalGuard);
    const back = await newSale("back", { quantity_limit: STOCK });
    const okBack = (await storm(back)).ok;
    okBack === STOCK
      ? pass(`وبعودة الحارس الأصليّ: ${STOCK} بالضبط`)
      : fail(`الحارسُ لم يعُد كما كان: ${okBack} من ${STOCK}`);

    // ── ٣) النافذةُ والإطفاء ─────────────────────────────────────
    logger.info("== النافذةُ والإطفاءُ — من ساعة القاعدة لا من ساعة الزائر ==");
    const soon = await newSale("soon", { from: "1 day", to: "2 day" });
    const over = await newSale("over", { from: "-2 day", to: "-1 day" });
    const off = await newSale("off", { is_active: false });

    (await claim(soon, "k", "c1")) === "FLASH_NOT_STARTED"
      ? pass("عرضٌ لم يبدأ ⇒ يُرفض")
      : fail("عرضٌ لم يبدأ مرّ");
    (await claim(over, "k", "c2")) === "FLASH_ENDED"
      ? pass("عرضٌ انتهى ⇒ يُرفض")
      : fail("عرضٌ منتهٍ مرّ");
    (await claim(off, "k", "c3")) === "FLASH_INACTIVE"
      ? pass("عرضٌ مُطفأ ⇒ يُرفض")
      : fail("عرضٌ مُطفأ مرّ");
    (await claim(`لا-وجود-${tag}`, "k", "c4")) === "FLASH_NOT_FOUND"
      ? pass("عرضٌ لا وجودَ له ⇒ يُرفض")
      : fail("مطالبةٌ على عرضٍ غيرِ موجود مرّت");

    // ── ٤) حدُّ العميل ───────────────────────────────────────────
    logger.info("== حدُّ العميل ==");
    const per = await newSale("per", { per_customer_limit: 2 });
    const a1 = await claim(per, "same", "p1");
    const a2 = await claim(per, "same", "p2");
    const a3 = await claim(per, "same", "p3");
    const other = await claim(per, "other", "p4");

    a1 === null && a2 === null && a3 === "FLASH_PER_CUSTOMER"
      ? pass("اثنتان تمرّان والثالثةُ تُرفض — والحدُّ عند بلوغه لا بعده")
      : fail(`حدُّ العميل: ${a1} · ${a2} · ${a3}`);
    other === null ? pass("وعميلٌ آخرُ لا يتأثّر") : fail(`عميلٌ آخرُ رُفض: ${other}`);

    // ── ٥) سلّةٌ واحدةٌ لا تطالب مرّتين ──────────────────────────
    logger.info("== إعادةُ إرسالِ الإتمام ==");
    const dup = await newSale("dup", { quantity_limit: 5 });
    await claim(dup, "k", "same-cart");
    const twice = await claim(dup, "k", "same-cart");
    twice !== null && (await netOf(dup)) === 1
      ? pass("سلّةٌ واحدةٌ ⇒ قطعةٌ واحدة، ولو أُعيد الإرسال")
      : fail(`سلّةٌ واحدةٌ أكلت ${await netOf(dup)} قطعة`);

    // ── ٦) الردُّ يُعيد السعة ────────────────────────────────────
    logger.info("== الردُّ — صفٌّ مقابلٌ لا حذف ==");
    const one = await newSale("one", { quantity_limit: 1 });
    await claim(one, "a", "ca");
    const full = await claim(one, "b", "cb");
    await claim(one, "a", "ca", -1, `rel-${tag}`);
    const after = await claim(one, "b", "cb2");

    full === "FLASH_SOLD_OUT" && after === null
      ? pass("نفد ثم رُدَّت قطعةٌ فمرّ التالي — ولا سعةَ محبوسة")
      : fail(`الردُّ لم يُعِد السعة: نفاد=${full} بعدُ=${after}`);
    (await netOf(one)) === 1
      ? pass("والدفترُ يحمل الثلاثةَ صفوفٍ ومجموعُها الصافي ١")
      : fail(`المجموعُ الصافي ${await netOf(one)} والمتوقّع ١`);

    // ── ٧) الدفترُ يُلحَق ولا يُمسّ ──────────────────────────────
    logger.info("== الدفترُ يُلحَق ولا يُمسّ ==");
    const led = await newSale("ledger", { quantity_limit: 5 });
    const lid = `led-${tag}`;
    await claim(led, "k", "lc", 1, lid);
    await pg.raw(`update "zadim_flash_sale_claim" set "order_id" = 'ord_1' where "id" = ?`, [lid]);
    await pg.raw(
      `update "zadim_flash_sale_claim" set "quantity" = 999, "order_id" = 'ord_hack' where "id" = ?`,
      [lid]
    );
    await pg.raw(`delete from "zadim_flash_sale_claim" where "id" = ?`, [lid]);
    const row = (
      await pg.raw(`select "quantity", "order_id" from "zadim_flash_sale_claim" where "id" = ?`, [lid])
    )?.rows?.[0];

    row && Number(row.quantity) === 1 && row.order_id === "ord_1"
      ? pass("ختمٌ واحدٌ بمعرّف الطلب يمرّ، وما بعده لا يُمسّ ولا يُحذف")
      : fail(`الدفترُ مُسّ: ${JSON.stringify(row)}`);

    // ── ٨) حالةُ العرض للواجهة — ولا تحكم ───────────────────────
    logger.info("== حالةُ العرض (للعرض لا للحكم) ==");
    const base = {
      id: "x",
      promotion_id: "p",
      promotion_code: "C",
      quantity_limit: null,
      per_customer_limit: null,
      is_active: true,
    };
    const now = new Date("2026-09-17T12:00:00.000Z");
    const st = (from: string, to: string, active = true) =>
      flashState(
        { ...base, is_active: active, starts_at: new Date(from), ends_at: new Date(to) },
        now
      ).phase;

    st("2026-09-17T13:00:00Z", "2026-09-17T14:00:00Z") === "upcoming" &&
    st("2026-09-17T11:00:00Z", "2026-09-17T13:00:00Z") === "live" &&
    st("2026-09-17T10:00:00Z", "2026-09-17T11:00:00Z") === "ended" &&
    st("2026-09-17T11:00:00Z", "2026-09-17T13:00:00Z", false) === "inactive" &&
    st("2026-09-17T11:00:00Z", "2026-09-17T12:00:00Z") === "ended"
      ? pass("أربعُ حالاتٍ، والنهايةُ حصريّةٌ كما يفحصها المُطلِق")
      : fail("حالةُ العرض لا تطابق ما يفحصه المُطلِق");
  } finally {
    // 🔴 الحارسُ يُعاد هنا لا بعد النقض: لو سقط ما بين النقض وإعادته
    // لبقيت القاعدةُ بحارسٍ بلا قفل — بوّابةٌ حمراءُ تترك خلفها عطباً
    // أسوأَ مما جاءت تكشف.
    await install(originalGuard);

    // تنظيفٌ كامل: الدفترُ محميٌّ بقاعدة، فتُعطَّل للحذف ثم تُعاد.
    await pg.raw(`alter table "zadim_flash_sale_claim" disable rule "zadim_flash_sale_claim_no_delete"`);
    await pg.raw(`delete from "zadim_flash_sale_claim" where "flash_sale_id" like ?`, [`%${tag}`]);
    await pg.raw(`alter table "zadim_flash_sale_claim" enable rule "zadim_flash_sale_claim_no_delete"`);
    for (const id of made) await pg.raw(`delete from "zadim_flash_sale" where "id" = ?`, [id]);
  }

  if (failures) {
    logger.error(`\n⛔ بوّابةُ التخفيض الخاطف: ${failures} إخفاقاً.`);
    process.exit(1);
  }
  logger.info("\n✅ بوّابةُ التخفيض الخاطف: البوّابةُ ونقضُها وسبعُ قواعد.");
}
