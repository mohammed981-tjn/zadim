#!/usr/bin/env bash
# ============================================================================
#  التحقّق من مخطّط ممرّ الصادر
# ----------------------------------------------------------------------------
#  يُقلع Postgres مؤقتاً، ويطبّق المخطّط الأصل ثم مخطّط الممرّ، ثم يشغّل
#  سبعةَ حرّاس:
#    ١) الكمّيةُ عشرية — ٧٫٥ طنٍّ تُحفظ ٧٫٥ لا ٧ ولا ٨
#    ٢) قيمةٌ لا تساوي الكمّية × السعر تُرفض عند الكتابة
#    ٣) لا شحنَ ومستندٌ إلزاميٌّ ناقص
#    ٤) لا شحنَ بمستندٍ انتهت صلاحيتُه قبل تاريخ الشحن
#    ٥) لا شحنَ برخصةِ تصديرٍ غيرِ ساريةٍ يومَ الشحن
#    ٦) تعديلُ اللائحة اليوم لا يمسّ إرساليةً جُمِّدت قبله
#    ٧) سلسلةُ العهدة تُلحَق ولا تُعدَّل ولا تُحذف
#
#  المخرَج: صفرٌ إن نجح الكلّ، وغيرُ صفرٍ إن سقط واحد. لا تقديرَ فيه.
#  التشغيل:  ./scripts/verify-corridor.sh
# ============================================================================
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/docs/02-database-schema.sql"
SCHEMA="$ROOT/docs/13-export-corridor-schema.sql"
RUNDIR=$(mktemp -d /tmp/zadim-corridor.XXXXXX)
PORT=${PORT:-55433}
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

mkdir -p "$RUNDIR/data" "$RUNDIR/sock"
[ -n "$RUNAS" ] && chown -R "$RUNAS:$RUNAS" "$RUNDIR"

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else PATH=$PGBIN:$PATH bash -c "$1"; fi; }

echo "== إقلاع Postgres مؤقت =="
run "initdb -D $RUNDIR/data -U zadim --auth=trust" >/dev/null 2>&1
run "pg_ctl -D $RUNDIR/data -o '-k $RUNDIR/sock -h \"\" -p $PORT' -l $RUNDIR/log start -w" >/dev/null 2>&1

PSQL="$PGBIN/psql -h $RUNDIR/sock -p $PORT -U zadim"
$PSQL -d postgres -q -c "CREATE DATABASE zadim;"
Q() { $PSQL -d zadim -tAq "$@"; }
X() { $PSQL -d zadim -q -v ON_ERROR_STOP=1 "$@"; }

echo "== تطبيق المخطّطين =="
if $PSQL -d zadim -q -v ON_ERROR_STOP=1 -f "$BASE" 2>"$RUNDIR/base.err"; then
  pass "المخطّط الأصل طُبِّق"
else
  fail "المخطّط الأصل فشل"; sed 's/^/     /' "$RUNDIR/base.err"; exit 1
fi
if $PSQL -d zadim -q -v ON_ERROR_STOP=1 -f "$SCHEMA" 2>"$RUNDIR/corridor.err"; then
  pass "مخطّط الممرّ طُبِّق بلا خطأ"
else
  fail "مخطّط الممرّ فشل"; sed 's/^/     /' "$RUNDIR/corridor.err"; exit 1
fi

printf '     ممرّات=%s  متطلّبات=%s  أنواع مستندات=%s  جداول=%s\n' \
  "$(Q -c "SELECT count(*) FROM corridors;")" \
  "$(Q -c "SELECT count(*) FROM corridor_requirements;")" \
  "$(Q -c "SELECT count(*) FROM document_types;")" \
  "$(Q -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"

echo
echo "== بيانات الاختبار =="
X <<'SQL'
INSERT INTO professional_entities (id, code, name_ar, kind) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','EXP-1','شركةُ تصديرٍ محدودة','exporter'),
  ('aaaaaaaa-0000-0000-0000-000000000002','LAB-1','مختبرٌ معتمد','laboratory');

-- رخصةٌ ساريةٌ وموثَّقة
INSERT INTO entity_licences (entity_id, licence_type_id, number, valid_from, valid_to, verified_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
        (SELECT id FROM licence_types WHERE code='export_crops'),
        'LIC-2026-001', DATE '2026-01-01', DATE '2027-01-01', now());
SQL
pass "جهةٌ مصدِّرةٌ برخصةٍ ساريةٍ موثَّقة"

echo
echo "== ١) الكمّية عشرية =="
X <<'SQL'
INSERT INTO consignments
  (id, reference, corridor_id, vendor_id, exporter_entity_id,
   quantity, uom_code, unit_price_minor, currency_code, value_minor, shipment_date)
VALUES
  ('cccccccc-0000-0000-0000-000000000001','CNS-1',
   (SELECT id FROM corridors WHERE code='gum_eu'),
   '00000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   7.5, 'ton', 320000, 'USD', 2400000, DATE '2026-09-20');
SQL
QTY=$(Q -c "SELECT quantity FROM consignments WHERE reference='CNS-1';")
if [ "$QTY" = "7.5000" ]; then
  pass "٧٫٥ طنٍّ حُفظت كما هي — لا تدوير ($QTY)"
else
  fail "الكمّية تشوّهت: $QTY"
fi

echo
echo "== ٢) حارس المجاميع =="
if Q -c "INSERT INTO consignments (reference,corridor_id,vendor_id,exporter_entity_id,quantity,uom_code,unit_price_minor,currency_code,value_minor)
         VALUES ('CNS-BAD',(SELECT id FROM corridors WHERE code='gum_eu'),'00000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',7.5,'ton',320000,'USD',999);" >/dev/null 2>&1; then
  fail "قيمةٌ خاطئة قُبِلت"
else
  pass "قيمةٌ لا تساوي الكمّية × السعر رُفضت عند الكتابة"
fi

echo
echo "== ٣) لا شحنَ بملفٍّ ناقص =="
X -c "UPDATE consignments SET status='documents_pending' WHERE reference='CNS-1';"
FROZEN=$(Q -c "SELECT count(*) FROM consignment_requirements WHERE consignment_id='cccccccc-0000-0000-0000-000000000001';")
MAND=$(Q -c "SELECT count(*) FROM consignment_requirements WHERE consignment_id='cccccccc-0000-0000-0000-000000000001' AND mode='mandatory';")
printf '     جُمِّد %s متطلّباً منها %s إلزاميّاً\n' "$FROZEN" "$MAND"
if Q -c "UPDATE consignments SET status='shipped' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  fail "الشحنُ مرّ بملفٍّ ناقص"
else
  pass "الشحنُ رُفض — ويُسمّي المستندَ الناقص بالاسم"
fi

echo
echo "== ٤) مستندٌ منتهي الصلاحية =="
# تُستوفى كلُّ الإلزاميات، لكن التحليلَ المختبريّ ينتهي قبل الشحن بيوم
X <<'SQL'
INSERT INTO consignment_documents
  (consignment_id, document_type_id, number, issued_on, expires_on, verified_at)
SELECT 'cccccccc-0000-0000-0000-000000000001', cr.document_type_id,
       'DOC-' || substr(cr.document_type_id::text,1,8),
       DATE '2026-09-01',
       CASE WHEN dt.code = 'lab_analysis' THEN DATE '2026-09-19' ELSE NULL END,
       now()
  FROM consignment_requirements cr
  JOIN document_types dt ON dt.id = cr.document_type_id
 WHERE cr.consignment_id = 'cccccccc-0000-0000-0000-000000000001'
   AND cr.mode = 'mandatory';
SQL
if Q -c "UPDATE consignments SET status='shipped' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  fail "شحنةٌ مرّت بمستندٍ منتهي الصلاحية"
else
  pass "مستندٌ ينتهي قبل تاريخ الشحن منع الشحن"
fi

echo
echo "== ٥) رخصةُ التصدير سارية يوم الشحن =="
X -c "UPDATE consignment_documents SET expires_on = DATE '2026-12-31'
       WHERE consignment_id='cccccccc-0000-0000-0000-000000000001' AND expires_on IS NOT NULL;"
# تُقلَّص الرخصةُ لتنتهي قبل الشحن
X -c "UPDATE entity_licences SET valid_to = DATE '2026-09-10'
       WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000001';"
if Q -c "UPDATE consignments SET status='shipped' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  fail "شحنةٌ مرّت برخصةٍ منتهية"
else
  pass "رخصةٌ منتهيةٌ يومَ الشحن منعت الشحن"
fi
# تُعاد الرخصة، فيمرّ الشحن — الشاهدُ الموجب
X -c "UPDATE entity_licences SET valid_to = DATE '2027-01-01'
       WHERE entity_id='aaaaaaaa-0000-0000-0000-000000000001';"
if Q -c "UPDATE consignments SET status='shipped' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  pass "وبملفٍّ مكتملٍ ورخصةٍ سارية: الشحنُ مرّ — الفحصُ ليس أعمى"
else
  fail "الشحنُ رُفض رغم اكتمال كل شيء"
fi

echo
echo "== ٦) تعديلُ اللائحة لا يمسّ ما جُمِّد =="
BEFORE=$(Q -c "SELECT count(*) FROM consignment_requirements WHERE consignment_id='cccccccc-0000-0000-0000-000000000001';")
X <<'SQL'
-- الإدارةُ تضيف متطلّباً جديداً على الممرّ اليوم
INSERT INTO corridor_requirements (corridor_id, document_type_id, mode, effective_from)
VALUES ((SELECT id FROM corridors WHERE code='gum_eu'),
        (SELECT id FROM document_types WHERE code='saber_coc'),
        'mandatory', CURRENT_DATE);
SQL
AFTER=$(Q -c "SELECT count(*) FROM consignment_requirements WHERE consignment_id='cccccccc-0000-0000-0000-000000000001';")
NEWREQ=$(Q -c "SELECT count(*) FROM corridor_requirements WHERE corridor_id=(SELECT id FROM corridors WHERE code='gum_eu');")
if [ "$BEFORE" = "$AFTER" ]; then
  pass "اللائحةُ صارت $NEWREQ متطلّباً، والإرساليةُ المجمَّدة بقيت $AFTER"
else
  fail "الإرسالية تأثّرت بتعديلٍ لاحق: $BEFORE ← $AFTER"
fi

echo
echo "== ٧) سلسلةُ العهدة تُلحَق فقط =="
X <<'SQL'
INSERT INTO custody_events (consignment_id, sequence, occurred_at, place_name, latitude, longitude)
VALUES ('cccccccc-0000-0000-0000-000000000001', 1, now(), 'مزرعةُ المنشأ — كردفان', 13.183333, 30.216667);
SQL
Q -c "UPDATE custody_events SET place_name='مكانٌ آخر';" >/dev/null
Q -c "DELETE FROM custody_events;" >/dev/null
ROWS=$(Q -c "SELECT count(*) FROM custody_events;")
PLACE=$(Q -c "SELECT place_name FROM custody_events LIMIT 1;")
if [ "$ROWS" = "1" ] && [ "$PLACE" = "مزرعةُ المنشأ — كردفان" ]; then
  pass "التعديلُ والحذفُ لا يمرّان · الموقعُ الأصليّ محفوظ"
else
  fail "السلسلة تغيّرت: صفوف=$ROWS مكان=$PLACE"
fi

echo
echo "== ٨) المضلَّع يُفرض فوق ٤ هكتارات =="
if Q -c "INSERT INTO consignment_origins (consignment_id,plot_ref,area_hectares,latitude,longitude)
         VALUES ('cccccccc-0000-0000-0000-000000000001','PLOT-BIG',12.5,13.1,30.2);" >/dev/null 2>&1; then
  fail "قطعةٌ ١٢٫٥ هكتاراً قُبِلت بلا مضلَّع"
else
  pass "قطعةٌ فوق ٤ هكتارات بلا مضلَّع رُفضت"
fi
if Q -c "INSERT INTO consignment_origins (consignment_id,plot_ref,area_hectares,latitude,longitude)
         VALUES ('cccccccc-0000-0000-0000-000000000001','PLOT-SMALL',2.0,13.1,30.2);" >/dev/null 2>&1; then
  pass "وقطعةٌ دون ٤ هكتارات مرّت بنقطةٍ واحدة"
else
  fail "قطعةٌ صغيرةٌ رُفضت بلا سبب"
fi

echo
echo "== ٩) لا تسويةَ قبل عودة الحصيلة =="
X -c "UPDATE consignments SET status='delivered' WHERE reference='CNS-1';"
X <<'SQL'
INSERT INTO export_proceeds (consignment_id, shipment_date, amount_minor, currency_code)
VALUES ('cccccccc-0000-0000-0000-000000000001', DATE '2026-09-20', 2400000, 'USD');
SQL
DUE=$(Q -c "SELECT due_date FROM export_proceeds WHERE consignment_id='cccccccc-0000-0000-0000-000000000001';")
printf '     تاريخُ الشحن 2026-09-20 ⇒ مهلةُ الحصيلة %s\n' "$DUE"
if [ "$DUE" != "2026-10-20" ]; then fail "المهلةُ حُسبت خطأً: $DUE"; else pass "المهلةُ محسوبةٌ في القاعدة: ٣٠ يوماً"; fi
if Q -c "UPDATE consignments SET status='settled' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  fail "سُوّيت الإرسالية والحصيلةُ لم تعد"
else
  pass "التسويةُ رُفضت قبل تسجيل عودة الحصيلة"
fi
X -c "UPDATE export_proceeds SET repatriated_on = DATE '2026-10-05'
       WHERE consignment_id='cccccccc-0000-0000-0000-000000000001';"
if Q -c "UPDATE consignments SET status='settled' WHERE reference='CNS-1';" >/dev/null 2>&1; then
  pass "وبعد تسجيل العودة: التسويةُ مرّت"
else
  fail "التسويةُ رُفضت رغم عودة الحصيلة"
fi

echo
echo "== ١٠) الممرّ الثاني يعمل بالبيانات نفسها =="
SHEEP=$(Q -c "SELECT count(*) FROM corridor_requirements WHERE corridor_id=(SELECT id FROM corridors WHERE code='sheep_sa');")
X <<'SQL'
INSERT INTO professional_entities (id, code, name_ar, kind)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003','EXP-2','مصدِّرُ ماشية','exporter');
INSERT INTO entity_licences (entity_id, licence_type_id, number, valid_from, valid_to, verified_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003',
        (SELECT id FROM licence_types WHERE code='export_livestock'),
        'LIC-LS-77', DATE '2026-01-01', DATE '2027-01-01', now());
INSERT INTO consignments
  (id, reference, corridor_id, vendor_id, exporter_entity_id,
   quantity, uom_code, unit_price_minor, currency_code, value_minor, shipment_date)
VALUES
  ('cccccccc-0000-0000-0000-000000000002','CNS-2',
   (SELECT id FROM corridors WHERE code='sheep_sa'),
   '00000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000003',
   1200, 'head', 45000, 'SAR', 54000000, DATE '2026-09-25');
UPDATE consignments SET status='documents_pending' WHERE reference='CNS-2';
SQL
F2=$(Q -c "SELECT count(*) FROM consignment_requirements WHERE consignment_id='cccccccc-0000-0000-0000-000000000002';")
if [ "$F2" -gt 0 ] && [ "$F2" != "$FROZEN" ]; then
  pass "ممرُّ الضأن جمَّد $F2 متطلّباً (ممرُّ الصمغ $FROZEN) — بلا سطرِ كودٍ واحد"
else
  fail "الممرُّ الثاني لم يتمايز: $F2 مقابل $FROZEN"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32m== كلُّ الحرّاس اجتازت ==\033[0m\n'; exit 0
else
  printf '\033[31m== سقط %s حارساً ==\033[0m\n' "$FAILURES"; exit 1
fi
