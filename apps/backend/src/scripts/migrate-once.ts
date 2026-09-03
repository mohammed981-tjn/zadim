/**
 * هجرةٌ واحدةٌ في الوقت الواحد — **قفلٌ استشاريٌّ حول `medusa db:migrate`**.
 *
 * ── العطلُ الذي وُلد منه هذا الملفّ (أوّلُ نشرةٍ حقيقية) ───────────
 *
 * نقطةُ الدخول تُشغّل الهجرةَ عند كلّ إقلاع، وكُتب في رأسها:
 *
 * > «⚠️ وهذا يفترض **نسخةً واحدة**. ويوم يصير النشرُ نسختين فأكثر
 * >  تُنقل الهجرةُ إلى خطوةِ ما قبل النشر — وإلا تسابقت النسخُ على نفس
 * >  الهجرة.»
 *
 * وهذا ما وقع بالضبط في أوّل نشرة. والمنصّاتُ تُقلع نسخةً جديدةً قبل
 * أن تُسقط القديمة، وتُعيد الإقلاعَ عند كلّ سقوط — فيقرأ إقلاعان جدولَ
 * الهجرات **فارغاً** في اللحظة نفسِها، ويبدآن معاً.
 *
 * وأثرُه ليس «هجرةً تفشل» بل **خليطٌ يبدو عطلَ مخطَّط**:
 *
 * ```
 * constraint "…" already exists           ← الآخرُ سبقك إليه
 * column "variant_id" … does not exist    ← الآخرُ تجاوز هذه الصورة أصلاً
 * cannot alter type of a column used in a trigger definition
 *   detail: trigger zadim_guard_order_transition_trg … depends on "status"
 * ```
 *
 * والثالثةُ أوضحُ دليلٍ على السباق: مُطلِقُنا على `order.status` يُنشأ في
 * هجرةٍ تاريخُها ٢٠٢٦، وهجرةُ Medusa التي تريد `alter column status type`
 * تاريخُها ٢٠٢٤. فلا يلتقيان في تشغيلةٍ مرتَّبة — **إلا حين يعملان
 * معاً**: نسخةٌ وصلت ٢٠٢٦ فأنشأت المُطلِق، وأخرى ما زالت في ٢٠٢٤ تحاول
 * تغييرَ العمود الذي صار المُطلِقُ يعتمد عليه.
 *
 * ── ولماذا قفلٌ لا نقلٌ إلى `preDeployCommand` ───────────────────
 *
 * النقلُ يعالجه **على Railway وحدها**. والقفلُ يعالجه أينما شُغّلت
 * الصورة: محلّياً، وعلى منصّةٍ أخرى، وعند إعادة إقلاعٍ بعد سقوط. وهما
 * لا يتنازعان — من ينقلها إلى ما قبل النشر يبقى هذا القفلُ عنده حارساً
 * لا يضرّ.
 *
 * ── وكيف يعمل ───────────────────────────────────────────────────
 *
 * `pg_advisory_lock` قفلٌ على **الجلسة** لا على المعاملة: يُؤخذ هنا،
 * ويبقى محجوزاً ما دامت هذه العملية حيّةً — فتنتظر النسخةُ الثانية
 * حتى تنتهي الأولى، ثم تجد الهجراتِ مسجَّلةً فلا تفعل شيئاً. وهذا هو
 * السلوكُ الصحيح: **لا تخطّي، بل انتظار**.
 *
 * وهو نفسُ ما تفعله `zatca/service.ts` بالضبط عند إصدار الفواتير
 * (`pg_advisory_xact_lock`) وللسبب نفسِه: قارئان متزامنان لا يجوز أن
 * يقرآ نفسَ الحال ويبنيا عليها.
 *
 * ── ولماذا يسكن `src/scripts/` ──────────────────────────────────
 *
 * لأن `medusa build` يبني **`src/` وحدَه**، وصورةُ الإنتاج تنسخ
 * `.medusa/server` لا المصدر. فملفٌّ خارج `src/` لا يصل الحاويةَ أصلاً،
 * وتناديه نقطةُ الدخول فلا تجده — عطلُ إقلاعٍ لا يظهر إلا في الإنتاج.
 *
 * ووضعُه هنا يُدخله تحت حارسٍ قائم: «نقطةُ الدخول تنادي ما هو مبنيٌّ
 * فعلاً» في `verify.yml` يقابل كلَّ `./src/scripts/*.js` تناديه نقطةُ
 * الدخول بما يُنتجه البناء. فإعادةُ تسميته أو نقلُه تُوقف الورشةَ، لا
 * الإقلاعَ في الإنتاج.
 */
import { spawn } from "child_process";
import { Client } from "pg";

/**
 * مفتاحُ القفل — رقمٌ ثابتٌ يشترك فيه كلُّ من يهاجر هذه القاعدة.
 *
 * ولا يُشتقّ من اسم المخطَّط: نسختان بمخطَّطين مختلفين على نفس القاعدة
 * تهاجران معاً بلا تعارض، ونسختان بنفس المخطَّط **يجب** أن تتسلسلا.
 * فالمفتاحُ يشمل المخطَّط ليفصل الأولى ويجمع الثانية.
 */
function lockKey(schema: string): number {
  // تجزئةٌ بسيطةٌ ثابتةٌ إلى عددٍ صحيحٍ ٣٢ بت — `pg_advisory_lock` يقبل
  // زوجاً من الأعداد، فالأوّلُ توقيعُ المشروع والثاني توقيعُ المخطَّط.
  let h = 0;
  for (const ch of schema) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h;
}

const ZADIM_NAMESPACE = 0x7a6164; // "zad"

async function main() {
  const schema = process.env.DATABASE_SCHEMA || "zadim";
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error("[zadim] DATABASE_URL غير مضبوط — لا هجرةَ بلا قاعدة.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  // ── 🔴 مسارُ البحث قبل الهجرة — وإلا تناثر المخطَّط بلا خطأ ──────
  //
  // `medusa db:migrate` **لا يضع كلَّ جداوله في `databaseSchema`**. جداولُ
  // وحداتنا (٢٢) تحترمه، وهجراتُ Medusa الأساسية (١٦٧) تكتب SQL خاماً
  // بأسماءٍ غيرِ مؤهَّلة — فتذهب حيث يقول `search_path`.
  //
  // وافتراضُ Postgres `"$user", public`. فالمخطَّطُ يصيب **فقط** حين يوافق
  // اسمُ المخطَّط اسمَ الدور. وهو ما يقع في الورشة صدفةً (المستخدم `zadim`
  // والمخطَّط `zadim`) — فتمرّ خضراءَ أبداً. ويقع خلافُه على أيّ قاعدةٍ
  // دورُها `postgres` (وهو الافتراضُ في Railway وسوبابيس معاً).
  //
  // وقِيس على Postgres 16:
  //
  //   دورٌ `zadim` + مخطَّط `zadim`   ⇒ ١٩٠/١٩٠ في المخطَّط ✅
  //   دورٌ `zadim` + مخطَّط `zadim2`  ⇒ ١٦٧ في `public` و٢٢ في المخطَّط ⛔
  //   وبعد `alter role … set search_path` ⇒ ١٩٠/١٩٠ ✅
  //
  // والأسوأ أن التناثر **لا يبدو عطلَ مخطَّط**: الهجرةُ تمضي، ثم تسقط
  // المُحمِّلاتُ بـ«relation does not exist» لجدولٍ موجودٍ في مخطَّطٍ آخر.
  //
  // ⚠️ وعلى قاعدةٍ مشتركة (ADR-009 سابقاً) يعني التناثرُ أن ١٦٧ جدولاً
  // من جداولنا تُخلط بجداول جارِنا في `public` — وهو بالضبط ما كُتب
  // المخطَّطُ المنفصل لمنعه.
  //
  // فيُفحص هنا **قبل** أيّ هجرة: `current_schema()` هو أوّلُ مخطَّطٍ
  // موجودٍ في مسار البحث — أي حيث تنزل الجداولُ غيرُ المؤهَّلة فعلاً.
  const { rows: sp } = await client.query(
    "select current_schema() as effective, current_setting('search_path') as path"
  );
  const effective = sp?.[0]?.effective ?? null;

  if (effective !== schema) {
    const db = (await client.query("select current_database() as d")).rows[0].d;
    const role = (await client.query("select current_user as u")).rows[0].u;
    console.error(
      `[zadim] ⛔ مسارُ البحث لا يبدأ بالمخطَّط المضبوط.\n` +
        `        المضبوط: ${schema} · والفعليّ: ${effective} · المسار: ${sp?.[0]?.path}\n` +
        `        ولو هاجرنا الآن لنزل ١٦٧ جدولاً من جداول Medusa في «${effective}»\n` +
        `        و٢٢ فقط في «${schema}» — ثم يسقط الإقلاع برسالةٍ لا تدلّ على السبب.\n` +
        `        شغّل مرّةً واحدةً على القاعدة:\n` +
        `          alter role ${role} in database ${db} set search_path = ${schema}, public;\n` +
        `        ثم أعِد النشر.`
    );
    await client.end();
    process.exit(1);
  }

  console.log(`[zadim] مسارُ البحث سليم (${sp?.[0]?.path}).`);

  const key = lockKey(schema);
  console.log(`[zadim] انتظارُ قفل الهجرة (${schema})…`);

  // 🔴 `pg_advisory_lock` **ينتظر ولا يُخفق**. والبديلُ `try_advisory_lock`
  // يعود فوراً بـfalse، فتُقلع النسخةُ الثانيةُ على قاعدةٍ نصفَ مهاجَرة
  // وتخدم طلباتٍ بمخطَّطٍ ناقص — وذاك أسوأُ من انتظارِ دقيقة.
  await client.query("select pg_advisory_lock($1, $2)", [ZADIM_NAMESPACE, key]);
  console.log("[zadim] القفلُ بيدنا — تشغيل الهجرات…");

  const code: number = await new Promise<number>((resolve) => {
    const child = spawn("npx", ["medusa", "db:migrate"], { stdio: "inherit" });
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", (e: Error) => {
      console.error(`[zadim] تعذّر تشغيلُ الهجرة: ${e.message}`);
      resolve(1);
    });
  });

  // يُفكّ صراحةً ثم تُغلق الجلسة. وفكُّه لازمٌ حتى مع الفشل: نسخةٌ
  // تسقط وهي ممسكةٌ بالقفل تُعلّق كلَّ إقلاعٍ بعدها حتى تموت جلستُها
  // في القاعدة — وذاك انقطاعٌ يبدو بلا سبب.
  await client.query("select pg_advisory_unlock($1, $2)", [ZADIM_NAMESPACE, key]);
  await client.end();

  if (code !== 0) {
    console.error(`[zadim] الهجرةُ فشلت (${code}). لا يُقلع الخادمُ على مخطَّطٍ ناقص.`);
    process.exit(code);
  }
  console.log("[zadim] ✅ الهجرات تمّت.");
}

main().catch((e: Error) => {
  console.error(`[zadim] عطلٌ في مُشغّل الهجرة: ${e.message}`);
  process.exit(1);
});
