#!/usr/bin/env bash
# ============================================================================
#  التحقّق من مخطط المرحلة ٠
# ----------------------------------------------------------------------------
#  يُقلع Postgres مؤقتاً، ويطبّق المخطط، ثم يشغّل أربعة حرّاس:
#    ١) المخزونُ لا يصير سالباً عند تزاحم عميلين على آخر قطعة
#    ٢) مجموعٌ لا يساوي حدودَه يُرفض عند الكتابة
#    ٣) سجلُّ التدقيق يُلحَق ولا يُعدَّل ولا يُحذف
#    ٤) التقييمُ بلا بندِ شراءٍ حقيقيّ مرفوض
#
#  المخرَج: صفرٌ إن نجح الكلّ، وغيرُ صفرٍ إن سقط واحد. لا تقديرَ فيه.
#  التشغيل:  ./scripts/verify-schema.sh
# ============================================================================
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/docs/02-database-schema.sql"
RUNDIR=$(mktemp -d /tmp/zadim-verify.XXXXXX)
PORT=${PORT:-55432}
FAILURES=0

# Postgres يرفض العمل جذراً، فيُشغَّل بمستخدمٍ غيرِ مميّز إن لزم
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

echo "== تطبيق المخطط =="
if $PSQL -d zadim -q -v ON_ERROR_STOP=1 -f "$SCHEMA" 2>"$RUNDIR/schema.err"; then
  pass "المخطط طُبِّق بلا خطأ"
else
  fail "المخطط فشل"; sed 's/^/     /' "$RUNDIR/schema.err"; exit 1
fi

printf '     جداول=%s  قيود CHECK=%s  مفاتيح أجنبية=%s  فهارس=%s\n' \
  "$(Q -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")" \
  "$(Q -c "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='CHECK';")" \
  "$(Q -c "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY';")" \
  "$(Q -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public';")"

echo
echo "== بيانات الاختبار =="
$PSQL -d zadim -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO products (id, vendor_id, slug, title_ar, status)
VALUES ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001','last-one','آخر قطعة','active');
INSERT INTO product_variants (id, product_id, sku)
VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','SKU-LAST-1');
INSERT INTO stock_locations (id, code, name_ar)
VALUES ('33333333-3333-3333-3333-333333333333','WH-RUH','مستودع الرياض');
INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved)
VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', 1, 0);
INSERT INTO customers (id, full_name) VALUES ('55555555-5555-5555-5555-555555555555','عميل');
SQL

echo
echo "== ١) المخزون السالب — عميلان على آخر قطعة =="
for i in 1 2; do
  ( $PSQL -d zadim -tAq -v ON_ERROR_STOP=1 >"$RUNDIR/buyer_$i.out" 2>&1 <<'SQL'
BEGIN;
SELECT pg_sleep(0.3);
UPDATE inventory_levels SET reserved = reserved + 1
 WHERE variant_id='22222222-2222-2222-2222-222222222222';
COMMIT;
SQL
  ) &
done
wait
OK_COUNT=0
for i in 1 2; do grep -qi 'ERROR' "$RUNDIR/buyer_$i.out" || OK_COUNT=$((OK_COUNT + 1)); done
AVAIL=$(Q -c "SELECT on_hand - reserved FROM inventory_levels;")
if [ "$OK_COUNT" -eq 1 ] && [ "$AVAIL" -eq 0 ]; then
  pass "واحدٌ نجح وواحدٌ رُفض · المتاح=0 لا -1"
else
  fail "نجح $OK_COUNT · المتاح=$AVAIL (المتوقّع: نجاحٌ واحد ومتاح=0)"
fi

echo
echo "== ٢) موازنة المجاميع =="
CH=$(Q -c "SELECT id FROM sales_channels WHERE code='web';")
Q -c "INSERT INTO orders (id,order_number,vendor_id,channel_id) VALUES ('44444444-4444-4444-4444-444444444444','ORD-1','00000000-0000-0000-0000-000000000001','$CH');" >/dev/null
if Q -c "INSERT INTO order_totals (order_id,items_subtotal,shipping_total,grand_total) VALUES ('44444444-4444-4444-4444-444444444444',10000,1500,99999);" >/dev/null 2>&1; then
  fail "مجموعٌ خاطئ قُبِل"
else
  pass "مجموعٌ لا يساوي حدودَه رُفض عند الكتابة"
fi
Q -c "INSERT INTO order_totals (order_id,items_subtotal,shipping_total,grand_total) VALUES ('44444444-4444-4444-4444-444444444444',10000,1500,11500);" >/dev/null \
  && pass "المجموع الصحيح قُبِل" || fail "المجموع الصحيح رُفض"

echo
echo "== ٣) مناعة سجلّ التدقيق =="
Q -c "INSERT INTO audit_logs (actor_label,action,entity,entity_id,old_value,new_value) VALUES ('مدير','product.price.update','product','p-1','{\"price\":19900}','{\"price\":17900}');" >/dev/null
Q -c "UPDATE audit_logs SET new_value='{\"price\":0}';" >/dev/null
Q -c "DELETE FROM audit_logs;" >/dev/null
ROWS=$(Q -c "SELECT count(*) FROM audit_logs;")
VAL=$(Q -c "SELECT new_value->>'price' FROM audit_logs LIMIT 1;")
if [ "$ROWS" = "1" ] && [ "$VAL" = "17900" ]; then
  pass "التعديلُ والحذفُ لا يمرّان · القيمُ قبل وبعد محفوظة"
else
  fail "السجلّ تغيّر: صفوف=$ROWS قيمة=$VAL"
fi

echo
echo "== ٤) التقييم يشترط شراءً =="
if Q -c "INSERT INTO reviews (product_id,customer_id,order_item_id,rating) VALUES ('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555',gen_random_uuid(),5);" >/dev/null 2>&1; then
  fail "تقييمٌ بلا شراءٍ قُبِل"
else
  pass "تقييمٌ بلا بندِ شراءٍ حقيقيّ رُفض"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32m== كلُّ الحرّاس اجتازت ==\033[0m\n'; exit 0
else
  printf '\033[31m== سقط %s حارساً ==\033[0m\n' "$FAILURES"; exit 1
fi
