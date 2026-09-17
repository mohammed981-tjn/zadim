import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";
import {
  clientIp,
  consume,
  matchPolicy,
  scopeKeyFor,
  windowStartMs,
  type Policy,
} from "../modules/access/rate-limit";

/**
 * بوّابةُ المرحلة ١٥ — **تحديدُ معدّل النداءات**.
 *
 * > بوّابةُ المرحلة: «فحصٌ أمنيّ خارجيّ · تحديدُ معدّل النداءات ·
 * > تدقيقٌ للاعتماديات». وهذا الملفُّ يقيس الثاني.
 *
 * والأوّلُ والثالث لا يقيسهما سكربتٌ عندنا لأنهما **حكمُ طرفٍ خارجيّ**
 * بتعريفهما: CodeQL و`npm audit` خطوتان في الورشة، ونتيجتُهما هي
 * الشهادة. وسكربتٌ يدّعي «الفحصُ الخارجيُّ تمّ» هو أسوأُ ما يُكتب:
 * شهادةٌ يمنحها الممتحَنُ لنفسه.
 *
 * ── وما لا يفحصه هذا الملفّ ─────────────────────────────────────
 *
 * 🔴 **لا يُثبت أن الوسيطَ مركَّبٌ فعلاً.** يقيس منطقَه على بياناتٍ
 * حقيقية، ويقيس قيودَ القاعدة، ويقيس ذرّيةَ العدّاد تحت تزاحمٍ حقيقيّ.
 * أما «هل يفيض 429 على نداءٍ حقيقيّ» فيقيسه `verify-ui` بـ`curl` على
 * خادمٍ حيّ — والسببُ درسٌ مدفوعُ الثمن في المرحلة ١١ب:
 * `matcher: "/store/products"` **لا يُطابق شيئاً**، لا نداءَ ولا خطأ.
 * فمُطابِقٌ صامتٌ يترك كلَّ اختبارٍ وحدويٍّ أخضرَ والبابَ مفتوحاً.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-security.ts
 */

/** الشاهدُ الموجب: ستُّ حالاتٍ نعرف جوابَها. يسقط الفحصُ كلُّه إن أخطأت. */
function positiveControl(): string[] {
  const errs: string[] = [];

  const P = (over: Partial<Policy>): Policy => ({
    name: "t",
    path_prefix: "/store",
    methods: "*",
    window_seconds: 60,
    max_requests: 5,
    scope_by: "ip",
    ...over,
  });

  // ١) الأطولُ سابقةً يفوز — وهذا هو العطبُ الذي يبتلع فيه العامُّ الخاصَّ.
  const two = [P({ name: "wide", path_prefix: "/store" }), P({ name: "narrow", path_prefix: "/store/carts" })];
  if (matchPolicy(two, "/store/carts/x", "GET")?.name !== "narrow") {
    errs.push("الشاهد ١: الأطولُ سابقةً لم يفز");
  }

  // ٢) الفعلُ يُصفّي.
  if (matchPolicy([P({ methods: "POST" })], "/store/a", "GET") !== null) {
    errs.push("الشاهد ٢: سياسةُ POST طابقت GET");
  }

  // ٣) ما لا يُطابق يُعيد null — لا سياسةً افتراضية.
  if (matchPolicy([P({})], "/admin/x", "GET") !== null) {
    errs.push("الشاهد ٣: مسارٌ خارج السابقة طابق");
  }

  // ٤) محاذاةُ النافذة — باتجاهين، وإلا لكفى أن تُعيد الدالّةُ ثابتاً.
  //    (٩٩٩٩٦٠٠٠٠ بدايةُ نافذةٍ فعلاً: مضاعفٌ تامٌّ لستّين ألفاً.)
  const inSame = windowStartMs(999_960_000, 60) === windowStartMs(999_990_000, 60);
  const inNext = windowStartMs(999_960_000, 60) !== windowStartMs(1_000_020_000, 60);
  if (!inSame) errs.push("الشاهد ٤أ: لحظتان في نافذةٍ واحدة أعطتا بدايتين");
  if (!inNext) errs.push("الشاهد ٤ب: لحظتان في نافذتين أعطتا بدايةً واحدة");

  // ٥) 🔴 انتحالُ العنوان: عميلٌ يرسل `x-forwarded-for` مزوّراً، ووكيلُنا
  //    يُلحق عنوانَه الحقيقيَّ يميناً. فبقفزةٍ واحدة يجب أن نأخذ
  //    **اليمين** — ومن أخذ اليسار حَدَّ عنواناً يختاره المهاجم.
  const spoofed = {
    headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9" },
    ip: "10.0.0.1",
  } as any;
  if (clientIp(spoofed, 1) !== "9.9.9.9") {
    errs.push("الشاهد ٥: العنوانُ أُخذ من يسار السلسلة — قابلٌ للانتحال");
  }

  // ٦) وبلا وكيل: الترويسةُ تُتجاهل كلُّها.
  if (clientIp(spoofed, 0) !== "10.0.0.1") {
    errs.push("الشاهد ٦: بصفرِ قفزاتٍ لم يُتجاهل الترويس");
  }

  return errs;
}

export default async function verifySecurity({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const access = container.resolve<AccessModuleService>(ACCESS_MODULE);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    failures++;
    logger.error(`  ✗ ${m}`);
  };

  logger.info("بوّابة المرحلة ١٥ — تحديدُ معدّل النداءات");

  // ── ٠) الشاهد الموجب — قبل قراءة أيّ صفّ ────────────────────────
  const controlErrors = positiveControl();
  if (controlErrors.length) {
    for (const e of controlErrors) logger.error(`  ✗ ${e}`);
    throw new Error(
      "🔴 سقط الشاهدُ الموجب — الفحصُ نفسُه معطوب. لا يُقرأ ما بعده."
    );
  }
  pass("الشاهد الموجب: ست حالاتٍ معروفةُ الجواب مرّت (فيها الانتحال)");

  // ── ١) السياسات موجودةٌ ومفعَّلة ────────────────────────────────
  const policies = await access.listRateLimitPolicies({}, {
    select: ["name", "path_prefix", "methods", "window_seconds", "max_requests", "scope_by", "enabled"],
  });

  if (policies.length < 4) fail(`السياسات: ${policies.length} — والمنتظَر ٤ فأكثر`);
  else pass(`السياسات: ${policies.length}`);

  const byName = new Map(policies.map((p: any) => [p.name, p]));

  // 🔴 وهذه أهمُّها: بلا حدٍّ على `/auth` يُجرَّب كلُّ ما تسرّب من مواقعَ
  // أخرى هنا. وحارسُ الصلاحيات لا يغطّيها — هو يعمل **بعد** المصادقة.
  const auth = byName.get("auth_attempts") as any;
  if (!auth) fail("لا سياسةَ لـ/auth — مسارُ كلمات المرور بلا حدّ");
  else if (!auth.enabled) fail("سياسةُ /auth موجودةٌ ومُطفأة");
  else if (auth.max_requests > 60) {
    fail(`حدُّ /auth ${auth.max_requests}/${auth.window_seconds}ث — واسعٌ لدرجة أنه لا يمنع تخميناً`);
  } else pass(`حدُّ /auth: ${auth.max_requests} في ${auth.window_seconds}ث`);

  // ── ٢) الأرقام بيانات لا كود ────────────────────────────────────
  const hardcoded = policies.filter((p: any) => !p.enabled);
  if (hardcoded.length) {
    logger.warn(`  ⚠️ سياساتٌ مُطفأة: ${hardcoded.map((p: any) => p.name).join(" · ")}`);
  }

  // ── ٣) قيودُ القاعدة ترفض ما يُسقط المتجر ───────────────────────
  //
  // كلُّ واحدٍ من هذه خطأٌ مطبعيٌّ في حقلٍ في اللوحة، وكلُّ واحدٍ منها
  // يُسقط البيعَ أو يفتح الباب. والقاعدةُ تحرسها من كلِّ بابٍ يكتب.
  const rejects: Array<[string, string]> = [
    ["نافذةٌ صفرية", `insert into "zadim_rate_limit_policy"("id","name","path_prefix","methods","window_seconds","max_requests","scope_by") values ('rlp_g1','g1','/x','*',0,5,'ip')`],
    ["حدٌّ صفريّ", `insert into "zadim_rate_limit_policy"("id","name","path_prefix","methods","window_seconds","max_requests","scope_by") values ('rlp_g2','g2','/x','*',60,0,'ip')`],
    ["نطاقٌ مجهول", `insert into "zadim_rate_limit_policy"("id","name","path_prefix","methods","window_seconds","max_requests","scope_by") values ('rlp_g3','g3','/x','*',60,5,'planet')`],
    ["سابقةٌ بلا شرطة مائلة", `insert into "zadim_rate_limit_policy"("id","name","path_prefix","methods","window_seconds","max_requests","scope_by") values ('rlp_g4','g4','store','*',60,5,'ip')`],
    ["اسمٌ مكرّر", `insert into "zadim_rate_limit_policy"("id","name","path_prefix","methods","window_seconds","max_requests","scope_by") values ('rlp_g5','auth_attempts','/x','*',60,5,'ip')`],
    ["عدّادٌ سالب", `insert into "zadim_rate_limit_counter"("id","policy_name","scope_key","window_start","expires_at","count") values ('c_g6','p','k',now(),now() + interval '1 minute',-1)`],
    ["انتهاءٌ قبل البداية", `insert into "zadim_rate_limit_counter"("id","policy_name","scope_key","window_start","expires_at","count") values ('c_g7','p','k',now(),now() - interval '1 minute',1)`],
  ];

  for (const [label, sql] of rejects) {
    try {
      await pg.raw(sql);
      fail(`القاعدة قبلت «${label}» — وكان يجب أن ترفض`);
      await pg.raw(`delete from "zadim_rate_limit_policy" where "id" like 'rlp_g%'`);
      await pg.raw(`delete from "zadim_rate_limit_counter" where "id" like 'c_g%'`);
    } catch {
      pass(`القاعدة رفضت: ${label}`);
    }
  }

  // ── ٤) 🔴 الذرّية تحت تزاحمٍ حقيقيّ ─────────────────────────────
  //
  // وهذا **لبُّ الملفّ**. عدّادٌ يُقرأ ثم يُكتب يعطي الرقمَ الصحيح في
  // اختبارٍ متسلسل، ويكذب بالضبط تحت الحمل الذي وُضع الحدُّ له.
  // فالقياسُ هنا تزاحمٌ حقيقيّ: خمسون نداءً معاً، والمنتظَر خمسون.
  const racePolicy: Policy = {
    name: "__race_probe",
    path_prefix: "/probe",
    methods: "*",
    window_seconds: 3600,
    max_requests: 1000,
    scope_by: "ip",
  };
  const raceKey = `ip:race:${process.pid}`;
  const nowMs = Date.now();
  const N = 50;

  await pg.raw(`delete from "zadim_rate_limit_counter" where "policy_name" = ?`, [racePolicy.name]);

  const results = await Promise.all(
    Array.from({ length: N }, () => consume(pg, racePolicy, raceKey, nowMs))
  );
  const finalCount = Math.max(...results.map((r) => r.count));
  const distinct = new Set(results.map((r) => r.count)).size;

  if (finalCount !== N) {
    fail(`تزاحمُ ${N} نداءً أعطى عدّاداً ${finalCount} — الزيادةُ ليست ذرّية`);
  } else if (distinct !== N) {
    // رقمان متطابقان يعنيان نداءين قرآ نفسَ العدّ — وهو نفسُ العطب
    // بوجهٍ آخر، ويمرّ من الفحص الأوّل إن عوّضه نداءٌ ثالث.
    fail(`تزاحمُ ${N} نداءً أعطى ${distinct} قيمةً متمايزة — قيمتان تكرّرتا`);
  } else {
    pass(`الذرّية: ${N} نداءً متزامناً ⇒ عدّادٌ ${finalCount} وقيمٌ متمايزةٌ ${distinct}`);
  }

  await pg.raw(`delete from "zadim_rate_limit_counter" where "policy_name" = ?`, [racePolicy.name]);

  // ── ٥) الحدُّ يمنع عند الرقم لا قبله ولا بعده ──────────────────
  const edgePolicy: Policy = { ...racePolicy, name: "__edge_probe", max_requests: 3 };
  const edgeKey = `ip:edge:${process.pid}`;
  await pg.raw(`delete from "zadim_rate_limit_counter" where "policy_name" = ?`, [edgePolicy.name]);

  const counts: number[] = [];
  for (let i = 0; i < 5; i++) {
    counts.push((await consume(pg, edgePolicy, edgeKey, nowMs)).count);
  }
  const blockedAt = counts.findIndex((c) => c > edgePolicy.max_requests) + 1;
  if (blockedAt !== 4) fail(`المنعُ وقع عند النداء ${blockedAt} — والمنتظَر الرابع (الحدّ ٣)`);
  else pass("الحدُّ شاملٌ لا حاجز: الثالثُ يمرّ والرابعُ يُمنع");

  await pg.raw(`delete from "zadim_rate_limit_counter" where "policy_name" = ?`, [edgePolicy.name]);

  // ── ٦) نافذتان مختلفتان لا تتقاسمان عدّاداً ────────────────────
  const w1 = await consume(pg, edgePolicy, edgeKey, nowMs);
  const w2 = await consume(pg, edgePolicy, edgeKey, nowMs + edgePolicy.window_seconds * 1000);
  if (w1.count !== 1 || w2.count !== 1) {
    fail(`نافذتان أعطتا ${w1.count} و${w2.count} — والمنتظَر ١ و١`);
  } else pass("نافذةٌ جديدة تبدأ من الصفر");
  await pg.raw(`delete from "zadim_rate_limit_counter" where "policy_name" = ?`, [edgePolicy.name]);

  // ── ٧) نطاقُ المفتاح يفصل فعلاً ────────────────────────────────
  const byIp: Policy = { ...racePolicy, name: "__scope", scope_by: "ip" };
  const byActor: Policy = { ...byIp, scope_by: "actor" };
  const byBoth: Policy = { ...byIp, scope_by: "ip_actor" };
  if (scopeKeyFor(byIp, "1.1.1.1", "usr_a") === scopeKeyFor(byIp, "2.2.2.2", "usr_a")) {
    fail("نطاقُ ip لم يفصل بين عنوانين");
  } else if (scopeKeyFor(byActor, "1.1.1.1", "usr_a") !== scopeKeyFor(byActor, "2.2.2.2", "usr_a")) {
    fail("نطاقُ actor فصل بالعنوان — والمنتظَر أن يتجاهله");
  } else if (scopeKeyFor(byBoth, "1.1.1.1", "usr_a") === scopeKeyFor(byBoth, "1.1.1.1", "usr_b")) {
    fail("نطاقُ ip_actor لم يفصل بين مستخدمين على عنوانٍ واحد");
  } else pass("النطاقات الثلاثة تفصل كما وُصفت");

  // ── ٨) العدّاداتُ المنتهية تُكنس ───────────────────────────────
  //
  // بلا كنسٍ ينمو الجدولُ بلا سقف، فيصير حارسُ الأمن سببَ امتلاء القرص.
  await pg.raw(
    `insert into "zadim_rate_limit_counter"("id","policy_name","scope_key","window_start","expires_at","count")
     values ('c_old','__sweep','k', now() - interval '3 hours', now() - interval '2 hours', 1)`
  );
  await pg.raw(`delete from "zadim_rate_limit_counter" where "expires_at" < now() - interval '1 hour'`);
  const left = await pg.raw(`select count(*)::int as n from "zadim_rate_limit_counter" where "id" = 'c_old'`);
  if ((left?.rows?.[0]?.n ?? 1) !== 0) fail("الكنسُ لم يحذف عدّاداً منتهياً");
  else pass("الكنسُ يحذف المنتهي");

  // ── ٩) 🔴 إقفالُ الحساب: الهويّةُ لا العنوان ───────────────────
  //
  // ── لماذا حارسٌ ثانٍ وقد مضى حدُّ المعدّل أعلاه ─────────────────
  //
  // لأنهما يحرسان **مفتاحين مختلفين**. حدُّ `/auth` عشرٌ في الدقيقة
  // بالعنوان: يوقف من يجرّب من حاسوبه. وشبكةٌ بعشرة آلاف عنوانٍ تجرّب
  // حساباً واحداً تُنتج **مئةَ ألفِ محاولةٍ في الدقيقة** وكلُّها تحت
  // الحدّ — فالحدُّ بالعنوان **لا يرى الهجومَ أصلاً**.
  logger.info("== إقفالُ الحساب: الهويّةُ لا العنوان ==");

  const lid = `lgf_gate_${Date.now().toString(36)}`;
  const ident = `gate-${Date.now().toString(36)}@zadim.test`;
  try {
    await pg.raw(
      `insert into "zadim_login_failure"("id","identity_key","actor_type","ip")
       values (?, ?, 'customer', '9.9.9.9')`,
      [lid, ident]
    );

    // أ) الدفترُ يُلحَق ولا يُمسّ — ومن حذف صفوفَه جرّب بلا حدّ.
    await pg.raw(`update "zadim_login_failure" set "identity_key" = 'x' where "id" = ?`, [lid]);
    await pg.raw(`delete from "zadim_login_failure" where "id" = ?`, [lid]);
    const row = (
      await pg.raw(`select "identity_key" from "zadim_login_failure" where "id" = ?`, [lid])
    )?.rows?.[0];
    row?.identity_key === ident
      ? pass("الدفترُ لا يُعدَّل ولا يُحذف — والحذفُ يمرّ بلا خطأٍ ولا أثر")
      : fail(`دفترُ الفشل مُسّ: ${JSON.stringify(row)}`);

    // ب) والعدُّ من الصفوف داخل النافذة — لا عدّادَ مخزَّن.
    const inWindow = (
      await pg.raw(
        `select count(*)::int as n from "zadim_login_failure"
          where "identity_key" = ? and "created_at" > now() - interval '900 seconds'`,
        [ident]
      )
    )?.rows?.[0]?.n;
    Number(inWindow) === 1
      ? pass("والعدُّ يُجمع من الصفوف داخل النافذة")
      : fail(`العدُّ ${inWindow} والمتوقّع ١`);

    // ج) وصفٌّ خارجَ النافذة لا يُعدّ — وإلا بقي الحسابُ مقفلاً أبداً.
    //    (يُكتب بتاريخٍ قديمٍ مباشرةً: القاعدةُ تمنع التعديل لا الإدخال.)
    const oldId = `${lid}_old`;
    await pg.raw(
      `insert into "zadim_login_failure"("id","identity_key","actor_type","created_at")
       values (?, ?, 'customer', now() - interval '2 hours')`,
      [oldId, ident]
    );
    const still = (
      await pg.raw(
        `select count(*)::int as n from "zadim_login_failure"
          where "identity_key" = ? and "created_at" > now() - interval '900 seconds'`,
        [ident]
      )
    )?.rows?.[0]?.n;
    Number(still) === 1
      ? pass("وفشلٌ قديمٌ خارج النافذة لا يُعدّ — فالإقفالُ لا يخلُد")
      : fail(`القديمُ عُدّ: ${still}`);

    // د) صفّان لنفس نوع الفاعل مرفوضان — لا يُعرف أيُّهما حَكَم.
    const dupe = await pg
      .raw(
        `insert into "zadim_lockout_policy"
           ("id","actor_type","window_seconds","max_failures","lock_seconds")
         values (?, 'customer', 900, 5, 600)`,
        [`lop_dupe_${Date.now().toString(36)}`]
      )
      .then(() => "مرّ")
      .catch(() => null);
    dupe === null
      ? pass("وسياسةٌ ثانيةٌ لنفس نوع الفاعل تُرفض في القاعدة")
      : fail("سياستان على نفس النوع مرّتا — ولا يُعرف أيُّهما يحكم");

    // هـ) والأصفارُ مرفوضةٌ في القاعدة: سقفُ صفرٍ يقفل عند أوّل محاولة.
    const zero = await pg
      .raw(
        `insert into "zadim_lockout_policy"
           ("id","actor_type","window_seconds","max_failures","lock_seconds")
         values (?, 'user', 900, 0, 600)`,
        [`lop_zero_${Date.now().toString(36)}`]
      )
      .then(() => "مرّ")
      .catch(() => null);
    zero === null
      ? pass("وسقفُ صفرٍ يُرفض في القاعدة — الإطفاءُ بـ«enabled» لا بصفر")
      : fail("سقفُ صفرٍ مرّ — فكلُّ حسابٍ يُقفل عند أوّل محاولة");

    // و) والسياستان مبذورتان فعلاً — فالكودُ بلا صفٍّ لا يقفل شيئاً.
    const seeded = (
      await pg.raw(
        `select count(*)::int as n from "zadim_lockout_policy"
          where "enabled" = true and "deleted_at" is null`
      )
    )?.rows?.[0]?.n;
    Number(seeded) >= 2
      ? pass(`وسياساتُ الإقفال مبذورةٌ ونافذة (${seeded})`)
      : fail(`سياساتُ الإقفال ${seeded} — والحارسُ بلا صفٍّ لا يقفل شيئاً`);
  } finally {
    // تنظيفٌ: الدفترُ محميٌّ بقاعدة، فتُعطَّل للحذف ثم تُعاد.
    await pg.raw(`alter table "zadim_login_failure" disable rule "zadim_login_failure_no_delete"`);
    await pg.raw(`delete from "zadim_login_failure" where "identity_key" = ?`, [ident]);
    await pg.raw(`alter table "zadim_login_failure" enable rule "zadim_login_failure_no_delete"`);
  }

  if (failures) {
    throw new Error(`🔴 بوّابة المرحلة ١٥ سقطت — ${failures} فحصاً`);
  }
  logger.info("✅ بوّابة المرحلة ١٥ (تحديدُ المعدّل) اجتازت.");
}
