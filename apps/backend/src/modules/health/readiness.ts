/**
 * جهوزيّةُ النشرة — **هل هذه القاعدةُ متجرٌ فعلاً؟**
 *
 * ── لماذا وحدةٌ لا منطقٌ داخل المسار ──────────────────────────────
 *
 * لأن المسارَ لا يُختبَر إلا بخادمٍ يعمل، فتبقى الفحوصُ بلا حارسٍ في
 * CI. وهنا تُنادى الدالّةُ من مسارِ `/ready` (وفاحصُ الوصل يفرض ذلك)،
 * ومن بوّابةٍ تنقضها على قاعدةٍ حقيقيّة.
 *
 * ── وما الذي تفحصه ولماذا هذا بالذات ─────────────────────────────
 *
 * `/health` من Medusa يقول «خادمُ HTTP يستجيب» ولا شيءَ غير ذلك. وقد
 * سقطت أوّلُ نشرةٍ حقيقيّة (2026-09-03) بخادمٍ **يستجيب** ومخطَّطٍ
 * نصفَ مهاجَرٍ خلفَه.
 *
 * وأهمُّ الفحوص هو الثالث. هجراتُ Medusa الأساسية (١٦٧) تكتب SQL خاماً
 * **غيرَ مؤهَّل**، فتنزل حيث يقول `search_path`. وهجراتُ وحداتنا (٢٢)
 * تنزل في المخطَّط المضبوط. فإن لم يُضبط `search_path` انقسمت العائلتان
 * بين `public` و`zadim`: **كلُّ جدولٍ موجود، والمتجرُ لا يقلع**،
 * والرسالةُ «relation does not exist» لجدولٍ تراه بعينك.
 *
 * ولا تُفشي شيئاً: أعدادُ الطلبات والعملاءِ والمالِ ليست هنا — بواعثُ
 * صحّةٍ فقط، وعددُ منتجاتٍ معروضٌ لكل زائرٍ أصلاً.
 */

export type Check = { ok: boolean; detail_ar: string };

export type Readiness = {
  ok: boolean;
  schema: string;
  checks: Record<string, Check>;
  /** ما يفعله المالكُ الآن — بترتيبٍ لا يُقدَّم فيه لاحقٌ على سابق. */
  next_ar: string[];
};

/** اسمُ المخطَّط يُركَّب في SQL، فيُفحص شكلُه قبل ذلك. */
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/i;

/** جدولٌ من هجرات Medusa الأساسية · وجدولٌ من هجرات وحداتنا. */
const CORE_TABLE = "product";
const OURS_TABLE = "zadim_audit_log";

type Pg = { raw: (sql: string, bindings?: unknown[]) => Promise<any> };

function rows(r: any): any[] {
  // knex يردّ الشكلَ خاماً، وتعدّدُ الجُمَل يردّ مصفوفةَ نتائج.
  return Array.isArray(r) ? (r[r.length - 1]?.rows ?? []) : (r?.rows ?? []);
}

export async function readiness(pg: Pg, schemaRaw?: string): Promise<Readiness> {
  const schema = schemaRaw || process.env.DATABASE_SCHEMA || "zadim";
  const checks: Record<string, Check> = {};
  const next_ar: string[] = [];

  if (!SCHEMA_RE.test(schema)) {
    return {
      ok: false,
      schema,
      checks: { schema_name: { ok: false, detail_ar: `اسمُ مخطَّطٍ غيرُ صالح: ${schema}` } },
      next_ar: ["صحّحْ DATABASE_SCHEMA — حروفٌ وأرقامٌ وشرطةٌ سفليّةٌ فقط."],
    };
  }

  // ① القاعدةُ موصولة. وكلُّ ما بعدها لا معنى له بدونها، فتُقطع هنا.
  try {
    await pg.raw("select 1");
    checks.database = { ok: true, detail_ar: "القاعدةُ موصولة." };
  } catch (e: any) {
    return {
      ok: false,
      schema,
      checks: {
        database: { ok: false, detail_ar: `تعذّر الاتصالُ بالقاعدة: ${e?.message ?? e}` },
      },
      next_ar: ["تحقّقْ من DATABASE_URL — وخُذه من الشبكة الداخلية (‎*.railway.internal‎)."],
    };
  }

  // ② المخطَّطُ موجود. تُنشئه نقطةُ دخول الحاوية، فغيابُه يعني أنها لم تعمل.
  let schemaExists = false;
  try {
    const r = await pg.raw(
      "select 1 from information_schema.schemata where schema_name = ?",
      [schema]
    );
    schemaExists = rows(r).length > 0;
    checks.schema = schemaExists
      ? { ok: true, detail_ar: `المخطَّط «${schema}» موجود.` }
      : { ok: false, detail_ar: `لا مخطَّطَ باسم «${schema}».` };
  } catch (e: any) {
    checks.schema = { ok: false, detail_ar: `تعذّرت قراءةُ المخطَّطات: ${e?.message ?? e}` };
  }
  if (!schemaExists) {
    next_ar.push("راجعْ سجلَّ الإقلاع: نقطةُ الدخول تُنشئ المخطَّط قبل الهجرة.");
  }

  // ③ 🔴 العائلتان في مخطَّطٍ واحد — الفحصُ الذي يكشف عطبَ `search_path`.
  try {
    const r = await pg.raw(
      `select
         count(*) filter (where table_name = ?) as core,
         count(*) filter (where table_name = ?) as ours
       from information_schema.tables
       where table_schema = ?`,
      [CORE_TABLE, OURS_TABLE, schema]
    );
    const row = rows(r)[0] ?? {};
    const core = Number(row.core ?? 0) > 0;
    const ours = Number(row.ours ?? 0) > 0;

    if (core && ours) {
      checks.migrations = { ok: true, detail_ar: "هجراتُ Medusa ووحداتِنا في مخطَّطٍ واحد." };
    } else if (!core && !ours) {
      checks.migrations = { ok: false, detail_ar: "لا جداولَ في المخطَّط — الهجرةُ لم تعمل." };
      next_ar.push(
        "راقبِ السجلَّ حتى «✅ الهجرات تمّت»؛ وإن سقطت فاقرأ §١ب في docs/10-deployment.md."
      );
    } else {
      // الحالةُ الخبيثة: كلُّ جدولٍ موجود، وكلٌّ في بيتٍ غير بيت الآخر.
      checks.migrations = {
        ok: false,
        detail_ar: core
          ? `جداولُ Medusa في «${schema}» وجداولُ وحداتنا ليست فيه.`
          : `جداولُ وحداتنا في «${schema}» وجداولُ Medusa ليست فيه — نزلت في public.`,
      };
      next_ar.push(
        `شغّلْ مرّةً على القاعدة: alter role <الدور> in database <القاعدة> set search_path = ${schema}, public; ` +
          "ثم راجعْ §١ب — المخطَّطُ الآن نصفَ مهاجَرٍ ولا يُصلحه إقلاعٌ جديد."
      );
    }
  } catch (e: any) {
    checks.migrations = { ok: false, detail_ar: `تعذّرت قراءةُ الجداول: ${e?.message ?? e}` };
  }

  // ④ مفتاحُ النشر — الواجهةُ لا تعمل بدونه، وغيابُه يعني أن البذرَ لم يجرِ.
  try {
    const r = await pg.raw(
      `select count(*)::int as n from "${schema}".api_key
        where type = 'publishable' and revoked_at is null`
    );
    const n = Number(rows(r)[0]?.n ?? 0);
    checks.publishable_key =
      n > 0
        ? { ok: true, detail_ar: "في القاعدة مفتاحُ نشرٍ صالح." }
        : { ok: false, detail_ar: "لا مفتاحَ نشرٍ صالحاً في القاعدة." };
    if (n === 0) {
      next_ar.push(
        "أقلعْ مرّةً بـZADIM_SEED_ON_BOOT=true، ثم انسخِ «مفتاحُ النشر: pk_…» من السجلّ إلى " +
          "NEXT_PUBLIC_MEDUSA_PK في Vercel، ثم انزعِ المتغيّر."
      );
    }
  } catch (e: any) {
    checks.publishable_key = { ok: false, detail_ar: `تعذّرت قراءةُ المفاتيح: ${e?.message ?? e}` };
  }

  // ⑤ كتالوج — متجرٌ بلا منتجٍ يعرض صفحةً فارغةً صحيحةً، وهي ليست جهوزيّة.
  try {
    const r = await pg.raw(
      `select count(*)::int as n from "${schema}".${CORE_TABLE} where deleted_at is null`
    );
    const n = Number(rows(r)[0]?.n ?? 0);
    checks.catalog =
      n > 0
        ? { ok: true, detail_ar: `${n} منتجاً في الكتالوج.` }
        : { ok: false, detail_ar: "لا منتجاتٍ — القاعدةُ لم تُبذر." };
    if (n === 0) next_ar.push("أقلعْ مرّةً بـZADIM_SEED_ON_BOOT=true لبذر الكتالوج.");
  } catch (e: any) {
    checks.catalog = { ok: false, detail_ar: `تعذّرت قراءةُ الكتالوج: ${e?.message ?? e}` };
  }

  return {
    ok: Object.values(checks).every((c) => c.ok),
    schema,
    checks,
    next_ar: Object.values(checks).every((c) => c.ok) ? [] : next_ar,
  };
}
