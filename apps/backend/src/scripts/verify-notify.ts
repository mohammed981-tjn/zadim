import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { NOTIFY_MODULE } from "../modules/notify";
import type NotifyModuleService from "../modules/notify/service";
import { MARKETING_MODULE } from "../modules/marketing";
import type MarketingModuleService from "../modules/marketing/service";
import { discoverNotifyProviders } from "../modules/notify/discover";

/**
 * بوّابةُ مزوّد الإشعارات (بند ٤٣).
 *
 * 🔴 **وأهمُّ ما تحرسه أن الحالةَ لا تكذب.** فطبقةُ إشعاراتٍ تقول
 * «أُرسلت» عمّا لم يُرسَل أسوأُ من غيابها: يُبنى عليها تقريرٌ ثم قرار.
 * والمزوّدُ الافتراضيُّ يسجّل ولا يرسل — **فيجب أن يبقى `queued`**.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-notify.ts
 */
export default async function verifyNotify({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const notify = container.resolve(NOTIFY_MODULE) as NotifyModuleService;
  const marketing = container.resolve(MARKETING_MODULE) as MarketingModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `nt-${Date.now()}`;
  const mail = `optout-${tag}@zadim.test`;

  try {
    // ── ١) الاكتشافُ لا القائمة ────────────────────────────────
    logger.info("== المزوّدون يُكتشفون من مجلَّدهم ==");

    const found = discoverNotifyProviders();
    found.some((p) => p.id === "log")
      ? pass(`المجلَّدُ يُقرأ (${found.map((p) => p.id).join("، ")})`)
      : fail("لم يُكتشف أيُّ مزوّد — راجعْ notify/providers/");

    const registered = await notify.registered();
    const problems = await notify.problems();
    registered.includes("log")
      ? pass("والتحميلُ الكسولُ سجّلهم — لا قائمةَ أسماءٍ في الإعداد")
      : fail(
          `لم يُسجَّل مزوّدٌ: ${JSON.stringify(registered)} — ` +
            `والأسباب: ${problems.join(" · ") || "لا سببَ مسجَّل (وهذا بذاته عطب)"}`
        );

    // 🔴 ولا خطأَ تحميلٍ صامت: مجلَّدٌ يُكتشف ولا يُسجَّل يجب أن يقول لماذا.
    problems.length === 0
      ? pass("ولا مزوّدَ تعذّر تحميلُه")
      : fail(`تعذّر تحميلُ مزوّدين: ${problems.join(" · ")}`);

    // 🔴 ولا اسمَ مزوّدٍ خارج مجلَّده — نفسُ حارس النواقل.
    const { readFileSync } = await import("fs");
    const config = readFileSync("medusa-config.ts", "utf8");
    !/notify\/providers\/\w/.test(config)
      ? pass("ولا اسمَ مزوّدٍ في `medusa-config.ts` — إضافةُ مزوّدٍ مجلَّدٌ واحدٌ وكفى")
      : fail("اسمُ مزوّدٍ ظهر في الإعداد — الوعدُ انكسر");

    // ── ٢) 🔴 الحالةُ لا تكذب ──────────────────────────────────
    logger.info("== والحالةُ لا تكذب ==");

    const plan = {
      event_id: `evt_${tag}`,
      channel: "email" as const,
      recipient: `ok-${tag}@zadim.test`,
      subject: "س",
      body: "ن",
      send_key: `evt_${tag}:email:ok-${tag}@zadim.test`,
    };

    const out = await notify.deliver(plan);
    out.status === "queued" && out.provider === "log"
      ? pass("المزوّدُ المسجِّل يقول `queued` **لا `sent`** — فلا يُدَّعى إرسالٌ لم يقع")
      : fail(`المزوّدُ ادّعى ${out.status} — تقريرٌ يقول «وصلت» ثم قرارٌ عليه`);

    // قناةٌ بلا مزوّد؟ المزوّدُ المسجِّل يخدم الثلاثةَ، فيُفحص الاختيار.
    (await notify.providerFor("sms"))?.id === "log"
      ? pass("واختيارُ مزوّد القناة يعمل")
      : fail("لا مزوّدَ للرسائل النصّية");

    // ── ٣) 🔴 إلغاءُ الاشتراك ──────────────────────────────────
    logger.info("== وإلغاءُ الاشتراك يُسكِت ==");

    (await notify.isSuppressed("email", mail)) === false
      ? pass("قبل الإلغاء: لا كتم")
      : fail("مستقبِلٌ جديدٌ وُجد مكتوماً");

    const first = await notify.optOut("email", mail);
    first.created ? pass("والإلغاءُ يُسجَّل") : fail("الإلغاءُ لم يُسجَّل");

    // متماثلٌ عند الإعادة: ضغطتان على الرابط لا تُنشئان صفّين.
    const again = await notify.optOut("email", mail);
    !again.created && again.id === first.id
      ? pass("وضغطةٌ ثانيةٌ على الرابط لا تُنشئ صفّاً ثانياً — ولا تُردّ بخطأ")
      : fail("الإلغاءُ المكرّر أنشأ صفّاً");

    (await notify.isSuppressed("email", mail))
      ? pass("وبعده يُعدّ مكتوماً")
      : fail("الإلغاءُ سُجّل ولا أثرَ له");

    // 🔴 والكتمُ **بالقناة**: من ألغى بريدَه قد يبقى راضياً عن النصّية.
    !(await notify.isSuppressed("sms", mail))
      ? pass("والكتمُ بالقناة لا بالشخص — من ألغى بريدَه لم يُلغِ رسائلَه النصّية")
      : fail("إلغاءُ البريد كتم الرسائلَ النصّية أيضاً");

    // والتسليمُ يحترمه.
    const blocked = await notify.deliver({ ...plan, recipient: mail });
    blocked.suppressed === true
      ? pass("والتسليمُ يُردّ قبل أن يصل المزوّد")
      : fail("رسالةٌ سُلّمت لمن ألغى اشتراكَه");

    // ── ٤) والوسمُ `suppressed` لا `failed` ────────────────────
    //
    // والفرقُ ليس تجميلياً: `failed` تدخل تقاريرَ الأعطال فتُقرأ مشكلةً
    // تقنيةً تُطارَد، و`suppressed` قرارُ عميلٍ يُحترم.
    // 🔴 **والبوّابةُ تزرع قالبَها بنفسها.**
    //
    // أوّلُ تشغيلٍ تخطّى هذا الفحصَ بـ«لا قالبَ لهذا الحدث» — وجدولُ
    // القوالب فارغٌ في قاعدة الفحص. **وفحصٌ يتخطّى نفسَه بصمتٍ ليس
    // فحصاً**: يبقى أخضرَ إلى الأبد ولا يحرس شيئاً. فالبوّابةُ تصنع
    // ما تحتاجه ثم تنظّفه.
    await pg.raw(
      `insert into "zadim_notification_template"
         ("id","event","channel","subject_ar","body_ar","is_active")
       values (?, ?, 'email', 'س', 'ن', true)`,
      [`ntpl_${tag}`, `PriceDropped-${tag}`]
    );

    const dispatched = await marketing.dispatch(
      {
        id: `evt_sup_${tag}`,
        event: `PriceDropped-${tag}`,
        aggregate_type: "price",
        aggregate_id: `price_${tag}`,
        payload: {},
        occurred_at: new Date(),
        attempts: 0,
      },
      { email: mail, phone: null, locale: "ar" },
      (p) => notify.deliver(p)
    );

    if (dispatched.claimed === 0) {
      fail("لم يُحجز إرسالٌ رغم وجود قالب — الوسمُ لم يُفحص");
    } else {
      const rows = await pg.raw(
        `select "status" from "zadim_notification_send" where "event_id" = ?`,
        [`evt_sup_${tag}`]
      );
      const statuses = (rows?.rows ?? []).map((r: any) => r.status);
      statuses.length && statuses.every((s: string) => s === "suppressed")
        ? pass(`والسجلُّ يُوسَم \`suppressed\` لا \`failed\` (${statuses.join("، ")})`)
        : fail(`الوسمُ خاطئ: ${JSON.stringify(statuses)}`);
    }

    // ── ٥) والعودةُ ممكنة ──────────────────────────────────────
    (await notify.optIn("email", mail))
      ? pass("والعودةُ ممكنة — الإلغاءُ ليس باباً بلا مقبض")
      : fail("تعذّرت العودة");
    !(await notify.isSuppressed("email", mail))
      ? pass("وبعد العودة يُسلَّم إليه")
      : fail("بقي مكتوماً بعد العودة");
  } finally {
    await pg.raw(`delete from "zadim_notification_template" where "id" = ?`, [`ntpl_${tag}`]);
    await pg.raw(`delete from "zadim_notification_optout" where "recipient" like ?`, [`%${tag}%`]);
    await pg.raw(`delete from "zadim_notification_send" where "event_id" like ?`, [`%${tag}%`]);
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ الإشعارات اجتازت.");
}
