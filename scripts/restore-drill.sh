#!/usr/bin/env bash
# تمرينُ الاستعادة — **نسخةٌ تُؤخذ وتُستعاد ويُقاس ما نجا**.
#
# ── ولماذا تمرينٌ لا فقرةٌ في وثيقة ──────────────────────────────
#
# بوّابةُ المرحلة ١٦ نصُّها: «تعافٍ من نسخةٍ احتياطية **مُجرَّبٌ فعلاً**
# لا موثَّقٌ فقط». ونسخةٌ لم تُستعَد مرّةً واحدةً ليست نسخةً احتياطية —
# هي ملفٌّ يُطمئن. ولا يُعرف أنها لا تعمل إلا يومَ يُحتاج إليها.
#
# ── وأخطرُ ما يفحصه: هل نجا الحرّاس ─────────────────────────────
#
# 🔴 قاعدةٌ مستعادةٌ **بجداولَ كاملةٍ وبلا مُطلِقات** تبدو سليمةً تماماً:
# الصفوفُ كلُّها هناك، والتقاريرُ تعمل، والواجهةُ تفتح. ثم تبيع أربعةً
# وتسعين من عشرة أوّلَ يوم ضغط — لأن الحارسَ كان دالّةً ومُطلِقاً، لا
# عموداً.
#
# ونفسُ الشيء لقواعد المنع (`do instead nothing`): دفترٌ صار قابلاً
# للتعديل بعد الاستعادة دفترٌ لا يُوثَق به بأثرٍ رجعيّ — ولا يُكتشف
# أبداً، لأن تعديلَه لا يُخطئ.
#
# فيُقاس هنا **أن الحرّاس يعملون في القاعدة المستعادة**، لا أنهم
# مذكورون في مخرَج `pg_dump`.
#
# التشغيل: bash scripts/restore-drill.sh
set -euo pipefail

SRC_URL="${DATABASE_URL:?DATABASE_URL مطلوب}"
SCHEMA="${DATABASE_SCHEMA:-zadim}"
DRILL_DB="zadim_restore_drill_$$"
WORK="$(mktemp -d)"
DUMP="$WORK/zadim.dump"

fails=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ⛔ $1"; fails=$((fails + 1)); }

# قاعدةُ الإدارة: نفسُ الخادم وقاعدةُ `postgres` — لإنشاء قاعدةِ التمرين
ADMIN_URL="$(python3 - "$SRC_URL" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
u = urlsplit(sys.argv[1])
print(urlunsplit((u.scheme, u.netloc, "/postgres", u.query, u.fragment)))
PY
)"
DRILL_URL="$(python3 - "$SRC_URL" "$DRILL_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
u = urlsplit(sys.argv[1])
print(urlunsplit((u.scheme, u.netloc, "/" + sys.argv[2], u.query, u.fragment)))
PY
)"

cleanup() {
  psql "$ADMIN_URL" -qc "drop database if exists \"$DRILL_DB\" with (force)" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "── ١) النسخُ الاحتياطي"
pg_dump --schema="$SCHEMA" --no-owner --no-privileges -Fc -f "$DUMP" "$SRC_URL"
SIZE=$(stat -c%s "$DUMP")
[ "$SIZE" -gt 1024 ] && pass "نسخةٌ حجمُها $((SIZE / 1024)) ك.ب" || fail "النسخةُ فارغةٌ أو تافهةُ الحجم ($SIZE بايت)"

echo "── ٢) الاستعادةُ في قاعدةٍ من عدم"
psql "$ADMIN_URL" -qc "create database \"$DRILL_DB\"" >/dev/null
# `--no-owner` لأن دورَ الإنتاج قد لا يوجد في وجهة الاستعادة — وهو
# أوّلُ ما يُسقط استعادةً حقيقيّةً عند مزوّدٍ آخر.
pg_restore --no-owner --no-privileges -d "$DRILL_URL" "$DUMP" >/dev/null 2>"$WORK/restore.err" || true
if grep -qiE "error" "$WORK/restore.err"; then
  fail "الاستعادةُ أخرجت أخطاءً: $(grep -icE 'error' "$WORK/restore.err") سطراً"
  head -3 "$WORK/restore.err" | sed 's/^/     /'
else
  pass "استُعيدت بلا خطأ"
fi

echo "── ٣) الصفوفُ نجت"
for t in product "order" zadim_audit_log zadim_role; do
  a=$(psql "$SRC_URL"   -tAc "select count(*) from \"$SCHEMA\".\"$t\"" 2>/dev/null || echo "-")
  b=$(psql "$DRILL_URL" -tAc "select count(*) from \"$SCHEMA\".\"$t\"" 2>/dev/null || echo "-")
  [ "$a" = "$b" ] && pass "$t: $a = $b" || fail "$t: المصدر $a والمستعادة $b"
done

echo "── ٤) 🔴 والحرّاسُ نجوا — لا عدَّهم بل عملَهم"
for obj in "المُطلِقات:select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='$SCHEMA' and not t.tgisinternal" \
           "قواعدُ المنع:select count(*) from pg_rules where schemaname='$SCHEMA'" \
           "الدوالّ:select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='$SCHEMA'"; do
  name="${obj%%:*}"; sql="${obj#*:}"
  a=$(psql "$SRC_URL"   -tAc "$sql")
  b=$(psql "$DRILL_URL" -tAc "$sql")
  [ "$a" = "$b" ] && [ "$a" -gt 0 ] && pass "$name: $a = $b" || fail "$name: المصدر $a والمستعادة $b"
done

echo "── ٥) 🔴 والأهمّ: الحارسُ **يمنع فعلاً** في القاعدة المستعادة"

# ① حارسُ التخفيض الخاطف: مطالبةٌ فوق السقف يجب أن تُرفض.
psql "$DRILL_URL" -qc "
  insert into \"$SCHEMA\".zadim_flash_sale
    (id, promotion_id, promotion_code, starts_at, ends_at, quantity_limit)
  values ('drill_sale','drill_p','DRILL', now() - interval '1 hour', now() + interval '1 hour', 1);
  insert into \"$SCHEMA\".zadim_flash_sale_claim
    (id, flash_sale_id, customer_key, cart_id, quantity)
  values ('drill_c1','drill_sale','k','c1',1);" >/dev/null 2>&1
if psql "$DRILL_URL" -qc "
  insert into \"$SCHEMA\".zadim_flash_sale_claim
    (id, flash_sale_id, customer_key, cart_id, quantity)
  values ('drill_c2','drill_sale','k','c2',1)" >/dev/null 2>&1; then
  fail "مطالبةٌ فوق السقف **مرّت** في المستعادة — الحارسُ لم ينجُ"
else
  pass "مطالبةٌ فوق السقف رُفضت — مُطلِقُ التخفيض حيّ"
fi

# ② قاعدةُ منع تعديل الدفتر: تعديلٌ يجب ألّا يُغيّر شيئاً.
before=$(psql "$DRILL_URL" -tAc "select count(*) from \"$SCHEMA\".zadim_audit_log")
if [ "$before" -gt 0 ]; then
  psql "$DRILL_URL" -qc "update \"$SCHEMA\".zadim_audit_log set entity = 'محرَّف'" >/dev/null 2>&1 || true
  tampered=$(psql "$DRILL_URL" -tAc "select count(*) from \"$SCHEMA\".zadim_audit_log where entity = 'محرَّف'")
  [ "$tampered" = "0" ] \
    && pass "سجلُّ التدقيق لا يُعدَّل في المستعادة — قاعدةُ المنع حيّة" \
    || fail "عُدِّل $tampered صفّاً في سجلّ التدقيق — الدفترُ صار قابلاً للتحريف"
else
  echo "  ⚠️  سجلُّ التدقيق فارغٌ في المصدر — لا يُقاس منعُ تعديله"
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "⛔ تمرينُ الاستعادة: $fails إخفاقاً. **والنسخةُ التي لا تُستعاد ليست نسخة.**"
  exit 1
fi
echo "✅ تمرينُ الاستعادة: نسخةٌ أُخذت واستُعيدت، والصفوفُ والحرّاسُ نجوا — ومُنعوا فعلاً."
