#!/usr/bin/env bash
# فحصُ الإقلاع: هل يفتح التطبيقُ فعلاً ويبقى حيّاً؟
#
# ── لماذا ملفٌّ لا أسطرٌ في ملفّ العمل ────────────────────────────
#
# أداةُ المحاكي **تشغّل كلَّ سطرٍ وحدَه بـ`sh -c`** — لا كسكربتٍ واحد،
# ولا تقول ذلك في توثيقها. فالبنى متعدّدةُ الأسطر تنكسر: `if` في سطرٍ
# و`fi` في آخر تعني «Syntax error: end of file unexpected». وقد قيس
# مرّتين: `pipefail` أوّلاً ثمّ `if`.
#
# فالمنطقُ في ملفٍّ يُنادى بسطرٍ واحد — ويُقرأ ويُراجَع ككودٍ لا كنصٍّ
# في YAML.
set -u

PKG=co.zadim.store
ACT=com.google.androidbrowserhelper.trusted.LauncherActivity
LOG="${RUNNER_TEMP:-/tmp}/logcat.txt"

echo "── تثبيتُ الحزمة"
adb install -r app/build/outputs/apk/debug/app-debug.apk || exit 1

adb logcat -c
echo "── فتحُ التطبيق"
adb shell am start -n "$PKG/$ACT" || exit 1

# عشرُ ثوانٍ: الانهيارُ عند الإقلاع يقع في أقلَّ من ثانية، والبقاءُ
# بعدها يعني أن الشاشةَ رُسمت وأن ما بعدها شأنُ الشبكة لا الحزمة.
sleep 10
adb logcat -d > "$LOG" 2>/dev/null || true

if adb shell pidof "$PKG" > /dev/null 2>&1; then
  echo "✅ التطبيقُ فُتح وما زال حيّاً بعد عشرِ ثوانٍ."
  # ⚠️ والحياةُ وحدَها لا تكفي: قد يبقى حيّاً وقد رمى استثناءً غيرَ
  # قاتلٍ يُفرغ الشاشة. فيُطبع ما يخصّنا من السجلّ ليُقرأ.
  grep -iE "$PKG|androidbrowserhelper|TWA" "$LOG" | tail -25 | sed 's/^/   /'
  exit 0
fi

echo "⛔ التطبيقُ انهار عند الفتح — وهذا سببُه:"
echo "────────────────────────────────────────────"
grep -B3 -A45 -E "FATAL EXCEPTION|AndroidRuntime" "$LOG" | head -90
echo "──────────── وآخرُ ما سجّلته الحزمة ────────────"
grep -iE "$PKG|androidbrowserhelper" "$LOG" | tail -30
echo "────────────────────────────────────────────"
exit 1
