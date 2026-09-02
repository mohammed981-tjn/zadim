#!/bin/sh
# نقطةُ دخولِ الحاوية: تُهيّئ القاعدة ثم تُسلّم للخادم.
#
# ── لماذا الهجرةُ هنا لا في البناء ────────────────────────────────
#
# لأن القاعدةَ **غيرُ موجودةٍ وقتَ البناء**: الصورةُ تُبنى في مكانٍ
# لا يرى قاعدةَ الإنتاج. فالهجرةُ تقع عند الإقلاع، حيث الاتصالُ قائم.
#
# ⚠️ وهذا يفترض **نسخةً واحدة**. ويوم يصير النشرُ نسختين فأكثر تُنقل
# الهجرةُ إلى خطوةِ ما قبل النشر (`preDeployCommand` في Railway) —
# وإلا تسابقت النسخُ على نفس الهجرة.
set -e

# 🔴 خطوةٌ لا يُستغنى عنها: **Medusa لا يُنشئ المخطَّط، يفترض وجودَه.**
#
# وقاعدةٌ جديدةٌ ليس فيها إلا `public`، فتسقط أوّلُ هجرةٍ بـ«no schema
# has been selected to create in» — رسالةٌ تبدو عطلَ إعدادٍ في الكود
# وهي غيابُ سطرٍ واحد. (سقطت عليها أوّلُ تشغيلةِ CI، فصار السطرُ
# مكتوباً في الورشة — وهنا للسبب نفسِه.)
node -e '
const { Client } = require("pg");
const schema = process.env.DATABASE_SCHEMA || "zadim";
if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
  // اسمُ مخطَّطٍ يأتي من البيئة يُركَّب في SQL — فيُفحص شكلُه قبل ذلك.
  console.error(`[zadim] اسمُ مخطَّطٍ غيرُ صالح: ${schema}`);
  process.exit(1);
}
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query(`create schema if not exists "${schema}"`))
  .then(() => { console.log(`[zadim] المخطَّط «${schema}» جاهز.`); return c.end(); })
  .catch((e) => { console.error(`[zadim] تعذّر تهيئةُ المخطَّط: ${e.message}`); process.exit(1); });
'

echo "[zadim] تشغيل الهجرات…"
npx medusa db:migrate

# ── البذر: لماذا هنا لا نقلاً لنسخةٍ من قاعدةٍ أخرى ─────────────────
#
# كان البديلُ المدروس أن تُبنى القاعدةُ في مكانٍ ثم تُنقل بـ`pg_dump`
# إلى الإنتاج. ورُفض لسببين قِيسا لا خُمّنا:
#
# ١) **النقلُ لا يُتحقَّق منه.** نسخةٌ منقولةٌ بحرفٍ مقلوبٍ في مُعرّفٍ
#    واحد تبدو سليمةً حتى تنكسر بعد شهر. أما البذرُ فيُنتجه الكودُ
#    نفسُه الذي سيُشغّل المتجر — فإن كان خطأً كان خطأً ظاهراً في CI.
#
# ٢) **النقلُ يصلح مرّةً واحدة.** وقاعدةٌ ثانيةٌ يوماً ما (اختبارٌ،
#    انتقالُ مزوّد، تعافٍ من نسخةٍ احتياطية) تُعيدك إلى الصفر. وهذا
#    السطرُ يعمل في كلِّ مرّة.
#
# 🔴 ومحروسٌ بمتغيّرٍ صريح: قاعدةُ إنتاجٍ فيها طلباتُ عملاءَ حقيقيّين
# لا يُشغَّل عليها بذرٌ بحادثةٍ عابرة. تضبطه **مرّةً** عند أوّل إقلاع
# ثم تنزعه. (والسكربتاتُ الثلاثةُ متماثلةٌ عند الإعادة — مُثبَتٌ
# بتشغيلها مرّتين على قاعدةٍ من عدم: ٥ منتجات · ١٩ ترجمة · ٧ أدوار
# قبلَ الإعادة وبعدَها سواء — فلو شُغّلت مرّتين لم يتضاعف شيء.)
if [ "$ZADIM_SEED_ON_BOOT" = "true" ]; then
  echo "[zadim] بذرُ القاعدة (ZADIM_SEED_ON_BOOT=true)…"
  npx medusa exec ./src/scripts/seed-access.js
  npx medusa exec ./src/scripts/seed-catalog.js
  npx medusa exec ./src/scripts/seed-commerce.js
  echo "[zadim] ✅ البذر تمّ. انزع ZADIM_SEED_ON_BOOT بعد هذا الإقلاع."
fi

# ── مفتاحُ النشر يُطبع في السجلّ ────────────────────────────────────
#
# لأنه **عامٌّ بالتصميم** (يُرسله المتصفّحُ في كل طلب)، ولأن الواجهةَ
# لا تعمل بدونه: `NEXT_PUBLIC_MEDUSA_PK` في Vercel قيمتُه هذه. وبلا
# هذا السطر يلزمك فتحُ لوحة الإدارة لتقرأه — خطوةٌ لا داعيَ لها.
#
# وليس سرّاً يُخفى: السرُّ هو المفتاحُ السرّيُّ (`sk_`)، وهذا ليس هو.
node -e '
const { Client } = require("pg");
const schema = process.env.DATABASE_SCHEMA || "zadim";
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query(`set search_path to "${schema}"; select token from api_key where type = $$publishable$$ and revoked_at is null limit 1`))
  .then((r) => {
    const rows = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
    if (rows[0]) console.log(`[zadim] مفتاحُ النشر: ${rows[0].token}`);
    else console.log("[zadim] ⚠️ لا مفتاحَ نشرٍ في القاعدة — شغّل الإقلاع مرّةً بـZADIM_SEED_ON_BOOT=true.");
    return c.end();
  })
  // طباعةُ المفتاح راحةٌ لا شرطُ عمل: تعذّرُها لا يمنع الإقلاع.
  .catch((e) => { console.error(`[zadim] تعذّرت قراءةُ مفتاح النشر: ${e.message}`); });
'

echo "[zadim] إقلاع الخادم…"
exec "$@"
