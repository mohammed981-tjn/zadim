import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { NOTIFY_MODULE } from "../modules/notify";
import type NotifyModuleService from "../modules/notify/service";
import { MARKETING_MODULE } from "../modules/marketing";
import type MarketingModuleService from "../modules/marketing/service";
import { discoverNotifyProviders } from "../modules/notify/discover";
import { redeliverPending, loadRetryPolicy } from "../modules/marketing/redeliver";
import { isRetriable, nextState } from "../modules/marketing/retry";

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

    // ── ٦) 🔴 والإعادةُ لها حدّ — ثم يُشطب ولا يُحيا ────────────
    //
    // وهذا هو شرطُ القبول حرفياً: «رسالةٌ تفشل ثلاثاً تصير `dead` ولا
    // تُعاد أبداً · والإعادةُ بعد سقوطٍ في منتصف الدورة لا تُرسل لأحدٍ
    // مرّتين — **يُقاس بعدّ الصفوف لا بالردّ**».
    logger.info("== والإعادةُ لها حدّ ==");

    const policy = await loadRetryPolicy(pg);
    policy.max_attempts >= 1 && policy.retry_after_seconds >= 0
      ? pass(`السياسةُ من صفّها: ${policy.max_attempts} محاولات · ${policy.retry_after_seconds}ث`)
      : fail("لا سياسةَ إعادةٍ تُقرأ — والرقمُ عاد إلى الكود");

    // 🔴 والدالّةُ الخالصةُ تُفحص بجدولِ حقيقةٍ **قبل** أن تُصدَّق على
    // القاعدة: الصفُّ الثالثُ هو الفخّ الذي يجعل المُعيدَ يدور أبداً.
    const truth: Array<[string, number, boolean, string]> = [
      ["failed", 0, true, "فشلٌ حقيقيٌّ دون الحدّ ⇒ يُعاد"],
      ["failed", policy.max_attempts, false, "بلغ الحدَّ ⇒ لا يُعاد"],
      ["queued", 0, true, "حُجز ولم يُحاوَل قطّ ⇒ يُعاد"],
      ["queued", 1, false, "🔴 المزوّدُ نفسُه قال queued ⇒ **لا يُعاد** وإلا دار أبداً"],
      ["sent", 0, false, "نهائيّة"],
      ["dead", 0, false, "مشطوبةٌ ⇒ لا تُعاد أبداً"],
      ["suppressed", 0, false, "قرارُ عميلٍ يُحترم"],
    ];
    let truthOk = true;
    for (const [status, attempts, expected, why] of truth) {
      const got = isRetriable({ status, attempts, next_attempt_at: null }, policy);
      if (got !== expected) {
        fail(`جدولُ الحقيقة سقط: (${status}, ${attempts}) ⇒ ${got} والمتوقَّع ${expected} — ${why}`);
        truthOk = false;
      }
    }
    if (truthOk) pass(`وقرارُ الإعادة يطابق جدولَ الحقيقة (${truth.length} صفّاً)`);

    // والشطبُ عند الحدّ لا قبله ولا بعده.
    nextState({ status: "failed" }, policy.max_attempts, policy).status === "dead" &&
    nextState({ status: "failed" }, policy.max_attempts - 1, policy).status === "failed"
      ? pass("والشطبُ عند الحدّ بالضبط — لا قبله ولا بعده")
      : fail("حدُّ الشطب لا يطابق السياسة");

    // ── صفُّ فحصٍ حقيقيّ، ومزوّدٌ يفشل عمداً ───────────────────
    const sendId = `nsend_${tag}`;
    const failing = async () => ({
      status: "failed" as const,
      provider: "gate-failing",
      error: "المزوّدُ ساقطٌ عمداً",
    });

    await pg.raw(
      `insert into "zadim_notification_send"
         ("id","send_key","event_id","channel","recipient","status")
       values (?, ?, ?, 'email', ?, 'queued')`,
      [sendId, `evt_retry_${tag}:email:r-${tag}@zadim.test`, `evt_retry_${tag}`, `r-${tag}@zadim.test`]
    );

    const attemptsOf = async (id: string) => {
      const r = await pg.raw(
        `select count(*)::int as n from "zadim_notification_attempt" where "send_id" = ?`,
        [id]
      );
      return Number((r?.rows ?? [])[0]?.n ?? 0);
    };
    const statusOf = async (id: string) => {
      const r = await pg.raw(`select "status" from "zadim_notification_send" where "id" = ?`, [id]);
      return String((r?.rows ?? [])[0]?.status ?? "");
    };

    // ⚠️ **والزمنُ يُقرَّب لا يُنتظَر**: المهلةُ تتّسع إلى مئاتِ الثواني،
    // وبوّابةٌ تنام دقائقَ لا تُشغَّل في CI فتُعطَّل — وبوّابةٌ معطَّلةٌ
    // حارسٌ غائب. فيُدفع `next_attempt_at` إلى الماضي بين الدورات،
    // وهو بالضبط ما يفعله مرورُ الوقت.
    for (let cycle = 1; cycle <= policy.max_attempts; cycle++) {
      await pg.raw(
        `update "zadim_notification_send" set "next_attempt_at" = now() - interval '1 second'
          where "id" = ? and "status" in ('queued','failed')`,
        [sendId]
      );
      await redeliverPending(container, { limit: 500, deliver: failing });
    }

    const deadStatus = await statusOf(sendId);
    const deadCount = await attemptsOf(sendId);
    deadStatus === "dead" && deadCount === policy.max_attempts
      ? pass(`وبعد ${policy.max_attempts} محاولاتٍ فاشلةٍ صارت \`dead\` (${deadCount} صفّاً في الدفتر)`)
      : fail(`الشطبُ لم يقع: الحالة ${deadStatus} والمحاولات ${deadCount}`);

    // 🔴 ودورةٌ رابعةٌ **لا تلمسها** — يُقاس بعدّ الصفوف لا بالردّ.
    await pg.raw(
      `update "zadim_notification_send" set "next_attempt_at" = now() - interval '1 second'
        where "id" = ?`,
      [sendId]
    );
    await redeliverPending(container, { limit: 500, deliver: failing });
    (await attemptsOf(sendId)) === deadCount
      ? pass("ودورةٌ رابعةٌ لا تُضيف صفّاً — المشطوبُ لا يُعاد أبداً")
      : fail("المشطوبُ أُعيد — والحدُّ حبرٌ");

    // ── والقاعدةُ هي الحارس، لا الخدمة ────────────────────────
    //
    // 🔴 **انقضِ الحارسَ**: لو كان المنعُ شرطَ `if` في `redeliverPending`
    // لمرّ كلُّ ما فوق، ثم كتب مشغّلٌ في psql سطراً فأحيا المشطوب.
    let revived = false;
    try {
      await pg.raw(`update "zadim_notification_send" set "status" = 'queued' where "id" = ?`, [
        sendId,
      ]);
      revived = true;
    } catch {
      /* المُطلِقُ رفض — وهو المطلوب */
    }
    !revived
      ? pass("و`update` مباشرٌ في القاعدة يُرفض — الشطبُ يحرسه مُطلِقٌ لا عادةُ كود")
      : fail("أُحييَ المشطوبُ بجملة SQL واحدة — الحارسُ في الخدمة وحدَها");

    // ولا محاولةَ على رسالةٍ سُلّمت: **الإرسالُ مرّتين مستحيلُ التسجيل**.
    const sentId = `nsend_sent_${tag}`;
    await pg.raw(
      `insert into "zadim_notification_send"
         ("id","send_key","event_id","channel","recipient","status")
       values (?, ?, ?, 'email', ?, 'sent')`,
      [sentId, `evt_sent_${tag}:email:s-${tag}@zadim.test`, `evt_sent_${tag}`, `s-${tag}@zadim.test`]
    );
    let loggedOnSent = false;
    try {
      await marketing.logAttempt(sentId, { status: "failed", provider: "gate" });
      loggedOnSent = true;
    } catch {
      /* مرفوض — وهو المطلوب */
    }
    !loggedOnSent
      ? pass("ولا محاولةَ تُسجَّل على رسالةٍ سُلّمت — فلا تُسلَّم مرّتين")
      : fail("سُجّلت محاولةٌ على رسالةٍ سُلّمت — والبابُ مفتوحٌ للنسخة الثانية");

    // ── والدفترُ يُلحَق ولا يُمسّ ──────────────────────────────
    await pg.raw(
      `update "zadim_notification_attempt" set "error" = 'مُحرَّف' where "send_id" = ?`,
      [sendId]
    );
    await pg.raw(`delete from "zadim_notification_attempt" where "send_id" = ?`, [sendId]);
    const stillThere = await attemptsOf(sendId);
    const tampered = await pg.raw(
      `select count(*)::int as n from "zadim_notification_attempt"
        where "send_id" = ? and "error" = 'مُحرَّف'`,
      [sendId]
    );
    stillThere === deadCount && Number((tampered?.rows ?? [])[0]?.n ?? 0) === 0
      ? pass("والدفترُ يُلحَق ولا يُمسّ — لا تعديلَ ولا حذف")
      : fail("دفترُ المحاولات قَبِل تعديلاً أو حذفاً");

    // ── والمُعادُ يحمل نصَّه ────────────────────────────────────
    //
    // 🔴 **وهذا الفحصُ وُلد من عطبٍ كاد يُشحن**: أوّلُ كتابةٍ للمُعيد
    // مرّرت `body: ""` لأن صفَّ الإرسال لم يكن يحمل نصّاً أصلاً.
    // والمزوّدُ المسجِّلُ يُخفي ذلك إلى الأبد — لا يقرأ النصَّ ولا
    // يرسل. ثم يصل مزوّدٌ حقيقيٌّ فتخرج **رسائلُ فارغةٌ** لكلّ مُعاد.
    const bodyId = `nsend_body_${tag}`;
    const originalBody = `نصٌّ محفوظٌ ${tag}`;
    await pg.raw(
      `insert into "zadim_notification_send"
         ("id","send_key","event_id","channel","recipient","status","subject","body")
       values (?, ?, ?, 'email', ?, 'queued', ?, ?)`,
      [
        bodyId,
        `evt_body_${tag}:email:b-${tag}@zadim.test`,
        `evt_body_${tag}`,
        `b-${tag}@zadim.test`,
        `عنوانٌ ${tag}`,
        originalBody,
      ]
    );

    let seenBody: string | null = null;
    let seenSubject: string | null = null;
    await redeliverPending(container, {
      limit: 500,
      deliver: async (plan) => {
        if (plan.recipient === `b-${tag}@zadim.test`) {
          seenBody = plan.body;
          seenSubject = plan.subject;
        }
        return { status: "failed" as const, provider: "gate-body", error: "عمداً" };
      },
    });

    seenBody === originalBody && seenSubject === `عنوانٌ ${tag}`
      ? pass("والمُعادُ يحمل **نصَّه المحفوظ** — لا رسالةً فارغةً ولا نصّاً ثالثاً من قالبٍ عُدِّل")
      : fail(`المُعادُ فقد نصَّه: ${JSON.stringify({ seenBody, seenSubject })}`);

    // ومسارُ `dispatch` يحفظ النصَّ عند الحجز — وإلا فالمُعادُ فارغٌ
    // مهما كان المُعيدُ سليماً.
    const savedBody = await pg.raw(
      `select "body" from "zadim_notification_send" where "event_id" = ? limit 1`,
      [`evt_sup_${tag}`]
    );
    String((savedBody?.rows ?? [])[0]?.body ?? "").length > 0
      ? pass("و`claimSend` يحفظ النصَّ لحظةَ الحجز")
      : fail("صفُّ الإرسال بلا نصّ — وكلُّ إعادةٍ منه رسالةٌ فارغة");

    // ── ٧) 🔴 ومئةُ مُعيدٍ متزامنٍ لا يُرسلون نسختين ────────────
    //
    // وهذا الفحصُ **يقيس الصفوف لا الردود**: مُعيدٌ يردّ «لم أُرسل»
    // وقد أرسل يمرّ من فحصٍ يقرأ الردّ، ولا يمرّ من عدٍّ في القاعدة.
    logger.info("== ومُعيدون متزامنون لا يُرسلون نسختين ==");

    const raceId = `nsend_race_${tag}`;
    await pg.raw(
      `insert into "zadim_notification_send"
         ("id","send_key","event_id","channel","recipient","status")
       values (?, ?, ?, 'email', ?, 'queued')`,
      [raceId, `evt_race_${tag}:email:c-${tag}@zadim.test`, `evt_race_${tag}`, `c-${tag}@zadim.test`]
    );

    let actualSends = 0;
    const counting = async () => {
      actualSends++;
      return { status: "failed" as const, provider: "gate-race", error: "عمداً" };
    };
    await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        redeliverPending(container, { limit: 500, deliver: counting })
      )
    );

    const raceAttempts = await attemptsOf(raceId);
    raceAttempts === 1
      ? pass(`و٥٠ مُعيداً متزامناً أنتجوا **محاولةً واحدة** (${raceAttempts} صفّاً في الدفتر)`)
      : fail(`٥٠ مُعيداً أنتجوا ${raceAttempts} محاولةً — الإيجارُ لا يحجز`);

    // والنداءُ الفعليُّ للمزوّد يُعدّ أيضاً: صفٌّ واحدٌ في الدفتر مع
    // نداءين للمزوّد يعني نسختين وصلتا وسُجّلت واحدة.
    actualSends <= 1
      ? pass(`ولم يُنادَ المزوّدُ إلا ${actualSends} مرّة — لا نسخةَ ثانيةٌ وصلت`)
      : fail(`نُوديَ المزوّدُ ${actualSends} مرّةً لرسالةٍ واحدة`);

    // ── ٨) وسقوطٌ في منتصف الدورة لا يُنتج نسختين ──────────────
    //
    // 🔴 وهذا هو العطبُ الذي كاد يُشحَن: `dispatch` لو لم يسجّل محاولةً
    // بقي الصفُّ `attempts = 0` بعد إرسالٍ وقع — وذلك **بالضبط** شرطُ
    // «حُجز ولم يُحاوَل» عند المُعيد، فيُسلّمه ثانيةً بعد ربع ساعة.
    // والمزوّدُ المسجِّلُ كان سيُخفي ذلك لأنه لا يرسل شيئاً أصلاً.
    const dispatchedRow = await pg.raw(
      `select "id","attempts","status" from "zadim_notification_send" where "event_id" = ? limit 1`,
      [`evt_sup_${tag}`]
    );
    const dRow = (dispatchedRow?.rows ?? [])[0];
    if (!dRow) {
      fail("لا صفَّ من مسار `dispatch` لفحصه");
    } else {
      Number(dRow.attempts) >= 1
        ? pass("ومسارُ `dispatch` يسجّل محاولتَه — فلا يلتقطه المُعيدُ كـ«لم يُحاوَل»")
        : fail("`dispatch` أرسل ولم يسجّل محاولة — والمُعيدُ سيُرسلها ثانيةً");
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
    // ⚠️ **ولا حذفَ لما صار له دفتر**: الأبُ يُحذف فيُلاحقه الحذفُ
    // المتتالي إلى الدفتر، فيردّه قاعدةُ «لا حذف» ثم يسقط قيدُ
    // المفتاح الأجنبيّ — فيُنظَّف ما لا دفترَ له وحدَه، ويبقى الباقي
    // شاهداً كإيصالات المشتريات.
    await pg.raw(
      `delete from "zadim_notification_send" s
        where s."event_id" like ?
          and not exists (
            select 1 from "zadim_notification_attempt" a where a."send_id" = s."id"
          )`,
      [`%${tag}%`]
    );
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ الإشعارات اجتازت.");
}
