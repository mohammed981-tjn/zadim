#!/usr/bin/env bash
# فحصُ ما قبل الدفع — **فحوصُ المستودع نفسِه لا ما يكفي لتخضير ما كتبتَ**.
#
# ولماذا وُجد (2026-09-04): دُفعت دفعةُ المشتريات بعد تشغيل البوّابات
# العشرين خضراءَ محليّاً — وسقط CI في خطوة **«البناء»** وحدَها. لأن
# `medusa exec` يترجم ما يحتاجه، و`medusa build` يُشغّل `tsc` كاملاً.
# فخطأُ إسنادٍ **في مسارٍ لا تناديه بوّابة** لا يظهر إلا في البناء —
# وهو بعينه درسُ «اختبارُ الدالّة ليس اختبارَ المسار».
#
# التشغيل: bash scripts/preflight.sh            (بلا بوّابات — سريع)
#          bash scripts/preflight.sh --gates    (ومعها البوّابات العشرون)
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
step() { printf "\n── %s\n" "$1"; }
ok()   { echo "  ✅ $1"; }
bad()  { echo "  ⛔ $1"; FAIL=1; }

export DATABASE_URL="${DATABASE_URL:-postgres://zadim:zadim@localhost:5432/zadim_test}"
export DATABASE_SCHEMA="${DATABASE_SCHEMA:-zadim}"
export JWT_SECRET="${JWT_SECRET:-x}"
export COOKIE_SECRET="${COOKIE_SECRET:-x}"
export MEDUSA_BACKEND_URL="${MEDUSA_BACKEND_URL:-http://localhost:9000}"

step "بناءُ الخلفيّة (tsc كاملاً — الذي يسقط ولا تمسكه البوّابات)"
if (cd apps/backend && npx medusa build 2>&1 | tail -3 | grep -q "completed successfully"); then
  ok "medusa build"
else
  bad "medusa build — شغّلْ: cd apps/backend && npx medusa build"
fi

step "أنواعُ الواجهة"
if (cd apps/storefront && npx --no-install tsc --noEmit -p tsconfig.json); then
  ok "tsc --noEmit"
else
  bad "أنواعُ الواجهة"
fi

step "الأدلّة الستّة"
if node scripts/verify-guides.mjs >/dev/null 2>&1; then ok "verify-guides"; else bad "verify-guides"; fi

if [ "${1:-}" = "--gates" ]; then
  step "البوّابات (تحتاج Postgres مُقلَعةً ومبذورة)"
  for f in apps/backend/src/scripts/verify-*.ts; do
    n=$(basename "$f" .ts)
    # 🔴 يُجمَع الخرجُ **ثمّ** يُفحص — ولا يُمرَّر إلى `grep -q`.
    #
    # وهذا عطبٌ قِيس لا احتياط: `grep -q` يخرج عند أوّل مطابقة فيُغلق
    # الأنبوب، وسطرُ النجاح ليس آخرَ ما تطبعه البوّابة. فما تطبعه بعده
    # يصطدم بأنبوبٍ مغلق، ويعلّق `medusa exec` إلى الأبد — عُلّقت
    # `verify-catalog` عشرَ دقائقَ وهي تنتهي في دقيقتين وحدَها.
    #
    # ⚠️ **وأثرُه أخطرُ من بطء**: القاعدةُ في CLAUDE.md أن يُشغَّل هذا
    # قبل كلّ دفع. وحارسٌ يعلّق حارسٌ يُتخطّى — فيصير الدفعُ بلا فحص.
    out=$(cd apps/backend && npx medusa exec "./src/scripts/$n.ts" 2>&1)
    if printf '%s' "$out" | grep -qE "✅ (كلُّ|بوّابة|فحوصُ)"; then
      ok "$n"
    else
      bad "$n"
      # ولا يُبتلع السبب: بوّابةٌ تسقط بلا سطرٍ يقول لماذا تُعاد بيدٍ.
      printf '%s\n' "$out" | tail -12 | sed 's/^/      /'
    fi
  done
fi

echo
[ "$FAIL" -eq 0 ] && echo "✅ جاهزٌ للدفع." || echo "⛔ لا تدفعْ."
exit "$FAIL"
