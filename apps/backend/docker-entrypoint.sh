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
SCHEMA="${DATABASE_SCHEMA:-zadim}"
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

echo "[zadim] إقلاع الخادم…"
exec "$@"
