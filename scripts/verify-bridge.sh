#!/usr/bin/env bash
# ============================================================================
#  التحقّق من جسر سودجري ← زاديم
# ----------------------------------------------------------------------------
#  يُقلع Postgres، ويطبّق المخطّطات الثلاثة (٠٢ · ١٣ · ١٥)، ثم يشغّل:
#    ١) عرضٌ صحيح يصير إرساليةً في `draft` — والكمّيةُ العشرية تعبر كما هي
#    ٢) والمنشأُ وسلسلةُ العهدة والأدلّة تعبر معه
#    ٣) عرضٌ بلا إذنٍ صريح يُرفض — وغيابُ الحقل رفضٌ لا قبول
#    ٤) مصدِّرٌ لا نعرفه يُرفض — الجسرُ لا يصنع هويّة
#    ٥) درجةٌ من سلعةٍ أخرى تُرفض
#    ٦) وجهةٌ بلا ممرٍّ تُرفض
#    ٧) قطعةٌ فوق ٤ هكتارات بلا مضلَّع تُرفض — الجسرُ لا يُعفي من الحرّاس
#    ٨) المرفوضُ يُسجَّل بسببه ولا يسقط صامتاً — ولا يترك إرساليةً نصفَ مبنيّة
#    ٩) إعادةُ الإرسال لا تُنشئ إرساليةً ثانية
#   ١٠) بصمةٌ مشوّهة تُرفض
#   ١١) الإرساليةُ المُنشأة **لا تحمل أيَّ مفتاحٍ إلى سودجري**
#   ١٢) وسلسلةُ العهدة العابرة تبقى غيرَ قابلةٍ للتعديل
#
#  المخرَج: صفرٌ إن نجح الكلّ. لا تقديرَ فيه.
#  التشغيل:  ./scripts/verify-bridge.sh
# ============================================================================
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNDIR=$(mktemp -d /tmp/zadim-bridge.XXXXXX)
PORT=${PORT:-55444}
FAILURES=0

RUNAS=""
[ "$(id -u)" -eq 0 ] && id -u postgres >/dev/null 2>&1 && RUNAS="postgres"

cleanup() {
  [ -d "$RUNDIR/data" ] && ${RUNAS:+su "$RUNAS" -c} \
    "PATH=$PGBIN:\$PATH pg_ctl -D $RUNDIR/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$RUNDIR"
}
trap cleanup EXIT

pass() { printf '  \033[32m✅ %s\033[0m\n' "$1"; }
fail() { printf '  \033[31m⛔ %s\033[0m\n' "$1"; FAILURES=$((FAILURES + 1)); }

# المخطّطات تُنسخ إلى مكانٍ يقرؤه مستخدم postgres
cp "$ROOT/docs/02-database-schema.sql"       "$RUNDIR/02.sql"
cp "$ROOT/docs/13-export-corridor-schema.sql" "$RUNDIR/13.sql"
cp "$ROOT/docs/15-bridge-schema.sql"          "$RUNDIR/15.sql"
mkdir -p "$RUNDIR/data" "$RUNDIR/sock"
[ -n "$RUNAS" ] && chown -R "$RUNAS:$RUNAS" "$RUNDIR"

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else PATH=$PGBIN:$PATH bash -c "$1"; fi; }

echo "== إقلاع Postgres مؤقت =="
run "initdb -D $RUNDIR/data -U zadim --auth=trust" >/dev/null 2>&1
run "pg_ctl -D $RUNDIR/data -o '-k $RUNDIR/sock -h \"\" -p $PORT' -l $RUNDIR/log start -w" >/dev/null 2>&1

PSQL="$PGBIN/psql -h $RUNDIR/sock -p $PORT -U zadim"
run "$PSQL -d postgres -q -c 'create database zadim'"
Q() { run "$PSQL -d zadim -tAq -c \"$1\""; }
X() { run "$PSQL -d zadim -q -v ON_ERROR_STOP=1 -f $1"; }

echo "== تطبيق المخطّطات الثلاثة =="
for f in 02 13 15; do
  if X "$RUNDIR/$f.sql" 2>"$RUNDIR/$f.err"; then
    pass "المخطّط $f طُبِّق"
  else
    fail "المخطّط $f فشل"; sed 's/^/     /' "$RUNDIR/$f.err"; exit 1
  fi
done

echo
echo "== مصدِّرٌ مرخَّصٌ واحد (يُوثَّق هنا لا يُستورد) =="
run "$PSQL -d zadim -q -v ON_ERROR_STOP=1 -c \"
insert into professional_entities (id, code, name_ar, kind) values
  ('bbbbbbbb-0000-0000-0000-000000000001','SUD-EXP-1','مصدِّرُ صمغٍ محدود','exporter');
insert into entity_licences (entity_id, licence_type_id, number, valid_from, valid_to, verified_at)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        (select id from licence_types where code='export_crops'),
        'LIC-SUD-9', date '2026-01-01', date '2027-06-01', now());\""
pass "جهةٌ مصدِّرةٌ برخصةٍ موثَّقة"

cat > "$RUNDIR/offer.json" <<'JSON'
{
  "source":"sudagri","external_ref":"season-7f3a","consent":true,
  "commodity":"gum_arabic","grade":"hashab_1","destination":"EU",
  "exporter_code":"SUD-EXP-1",
  "quantity":"7.5","uom":"ton","unit_price_minor":320000,"currency_code":"USD",
  "origins":[{"plot_ref":"KRD-11","area_hectares":2.4,"latitude":13.183333,"longitude":30.216667}],
  "custody":[
    {"sequence":1,"occurred_at":"2026-08-01T06:00:00Z","place_name":"مزرعةُ المنشأ — كردفان","latitude":13.183333,"longitude":30.216667},
    {"sequence":2,"occurred_at":"2026-08-14T09:00:00Z","place_name":"مخزنُ الأبيّض","latitude":13.183,"longitude":30.217}],
  "evidence":[{"kind":"milestone","captured_at":"2026-08-01T06:05:00Z",
    "latitude":13.183333,"longitude":30.216667,
    "sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "source_ref":"evidence/9f3a/stage-1.jpg"}]
}
JSON

# نسخةٌ معدَّلةٌ من العرض في ملفٍّ جديد، ثم إدماجُها
variant() {  # الملف · تعبير sed
  sed "$2" "$RUNDIR/offer.json" > "$RUNDIR/$1.json"
  [ -n "$RUNAS" ] && chown "$RUNAS:$RUNAS" "$RUNDIR/$1.json"
  Q "select ingest_offer(pg_read_file('$RUNDIR/$1.json')::jsonb)" >/dev/null
}
[ -n "$RUNAS" ] && chown "$RUNAS:$RUNAS" "$RUNDIR/offer.json"

ingest() { Q "select ingest_offer(pg_read_file('$RUNDIR/offer.json')::jsonb)" >/dev/null; }

echo
echo "== ١) عرضٌ صحيح ⇐ إرساليةٌ في draft =="
ingest
ST=$(Q "select status from inbound_offers where external_ref='season-7f3a'")
CST=$(Q "select c.status from consignments c join inbound_offers o on o.consignment_id=c.id where o.external_ref='season-7f3a'")
QTY=$(Q "select c.quantity from consignments c join inbound_offers o on o.consignment_id=c.id where o.external_ref='season-7f3a'")
VAL=$(Q "select c.value_minor from consignments c join inbound_offers o on o.consignment_id=c.id where o.external_ref='season-7f3a'")
if [ "$ST" = "accepted" ] && [ "$CST" = "draft" ]; then
  pass "قُبل وأُنشئ في draft — الجسرُ لا يشحن"
else
  fail "الحالة: عرض=$ST إرسالية=$CST"
fi
if [ "$QTY" = "7.5000" ] && [ "$VAL" = "2400000" ]; then
  pass "٧٫٥ طنٍّ عبرت كما هي · والقيمة ٢٤٠٠٠٠٠ محسوبةٌ ومحروسة"
else
  fail "الكمّية $QTY والقيمة $VAL"
fi

echo
echo "== ٢) المنشأ والعهدة والأدلّة عبرت =="
O=$(Q "select count(*) from consignment_origins")
C=$(Q "select count(*) from custody_events")
E=$(Q "select count(*) from consignment_evidence_refs")
SEQ=$(Q "select string_agg(place_name, ' ⇐ ' order by sequence desc) from custody_events")
if [ "$O" = "1" ] && [ "$C" = "2" ] && [ "$E" = "1" ]; then
  pass "منشأ=$O · عهدة=$C · أدلّة=$E"
  pass "والسلسلةُ بترتيبها: $SEQ"
else
  fail "منشأ=$O عهدة=$C أدلّة=$E"
fi

reject_case() {  # اسم · معرّف · تعبيرُ sed · نصٌّ متوقَّعٌ في السبب
  variant "$2" "$3"
  local st rs
  st=$(Q "select status from inbound_offers where external_ref='$2'")
  rs=$(Q "select reject_reason from inbound_offers where external_ref='$2'")
  if [ "$st" = "rejected" ] && [[ "$rs" == *"$4"* ]]; then
    pass "$1 — «${rs:0:64}…»"
  else
    fail "$1 (الحالة=$st السبب=$rs)"
  fi
}

echo
echo "== ٣) بلا إذنٍ صريح =="
reject_case "غيابُ الحقل رفضٌ لا قبول" "no-consent" \
  's/"external_ref":"season-7f3a"/"external_ref":"no-consent"/; s/"consent":true,//' "إذنِ نشر"

echo
echo "== ٤) مصدِّرٌ لا نعرفه =="
reject_case "الجسرُ لا يصنع هويّة" "ghost-exporter" \
  's/"external_ref":"season-7f3a"/"external_ref":"ghost-exporter"/; s/SUD-EXP-1/SUD-EXP-GHOST/' "مصدِّرٌ غيرُ معروف"

echo
echo "== ٥) درجةٌ من سلعةٍ أخرى =="
reject_case "درجةُ الضأن على الصمغ" "wrong-grade" \
  's/"external_ref":"season-7f3a"/"external_ref":"wrong-grade"/; s/hashab_1/live_40kg/' "ليست درجةً"

echo
echo "== ٦) وجهةٌ بلا ممرّ =="
reject_case "لا ممرَّ إلى الإمارات للصمغ" "no-corridor" \
  's/"external_ref":"season-7f3a"/"external_ref":"no-corridor"/; s/"destination":"EU"/"destination":"AE"/' "لا ممرَّ"

echo
echo "== ٧) قطعةٌ فوق ٤ هكتارات بلا مضلَّع =="
reject_case "العبورُ من جسرٍ ليس إعفاءً من الحرّاس" "big-plot" \
  's/"external_ref":"season-7f3a"/"external_ref":"big-plot"/; s/"area_hectares":2.4/"area_hectares":12.5/' "polygon_required"

echo
echo "== ٨) المرفوضُ لا يترك أثراً نصفَ مبنيّ =="
CONS=$(Q "select count(*) from consignments")
REJ=$(Q "select count(*) from inbound_offers where status='rejected'")
if [ "$CONS" = "1" ] && [ "$REJ" = "5" ]; then
  pass "خمسةُ رفضٍ مسجَّلٍ بأسبابه · وإرساليةٌ واحدة لا سواها"
else
  fail "إرساليات=$CONS مرفوضات=$REJ (المتوقَّع ١ و٥)"
fi

echo
echo "== ٩) إعادةُ الإرسال =="
ingest
AGAIN=$(Q "select count(*) from consignments")
OFFERS=$(Q "select count(*) from inbound_offers where external_ref='season-7f3a'")
if [ "$AGAIN" = "1" ] && [ "$OFFERS" = "1" ]; then
  pass "نفسُ العرض مرّتين ⇐ إرساليةٌ واحدة وسجلٌّ واحد"
else
  fail "إرساليات=$AGAIN سجلّات=$OFFERS"
fi

echo
echo "== ١٠) بصمةٌ مشوّهة =="
reject_case "بصمةٌ ليست sha256 تُرفض" "bad-hash" \
  's/"external_ref":"season-7f3a"/"external_ref":"bad-hash"/; s/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08/not-a-hash/' "evidence_hash_shape"

echo
echo "== ١١) لا مفتاحَ يعبر الحدّ =="
# لا عمودَ في أيٍّ من جداول الإرسالية يشير إلى سودجري بمعرّفٍ أجنبيّ.
# المعرّفُ الخارجيُّ الوحيد نصٌّ في دفتر الوارد، لا مفتاحٌ في الإرسالية.
LEAK=$(Q "select count(*) from information_schema.columns
          where table_schema='public'
            and table_name in ('consignments','consignment_origins','custody_events',
                               'consignment_evidence_refs','consignment_documents')
            and (column_name like '%sudagri%' or column_name like '%zadam%'
                 or column_name like '%external%' or column_name like '%source_id%')")
REFTYPE=$(Q "select data_type from information_schema.columns
             where table_name='inbound_offers' and column_name='external_ref'")
if [ "$LEAK" = "0" ] && [ "$REFTYPE" = "text" ]; then
  pass "صفرُ أعمدةٍ تشير إلى المصدر في جداول الإرسالية · والمعرّفُ الخارجيّ نصٌّ في دفتر الوارد"
else
  fail "أعمدةٌ عابرة=$LEAK · نوعُ المعرّف=$REFTYPE"
fi

echo
echo "== ١٢) سلسلةُ العهدة العابرة تبقى محميّة =="
Q "update custody_events set place_name='مكانٌ آخر'" >/dev/null
Q "delete from custody_events" >/dev/null
ROWS=$(Q "select count(*) from custody_events")
FIRST=$(Q "select place_name from custody_events order by sequence limit 1")
if [ "$ROWS" = "2" ] && [ "$FIRST" = "مزرعةُ المنشأ — كردفان" ]; then
  pass "التعديلُ والحذفُ لا يمرّان على ما عبر الجسر"
else
  fail "صفوف=$ROWS أوّل=$FIRST"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32m== كلُّ الحرّاس اجتازت ==\033[0m\n'; exit 0
else
  printf '\033[31m== سقط %s حارساً ==\033[0m\n' "$FAILURES"; exit 1
fi
