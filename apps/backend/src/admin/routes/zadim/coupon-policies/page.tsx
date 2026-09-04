import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Switch, Button, Table } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost, adminDelete, riyals } from "../../../lib/rtl";

type Policy = {
  id: string;
  promotion_id: string;
  promotion_code: string;
  per_customer_limit: number | null;
  max_discount: number | null;
  first_order_only: boolean;
  priority: number;
};

/**
 * سياساتُ الكوبونات — **المسارُ الذي كان ناقصاً**.
 *
 * `zadim_coupon_policy` كان مبنيّاً ومحروساً ومُختبَراً ولا يضبطه أحد
 * إلا `psql`. رمزُ العرضِ يُدخَل هنا كما كُتب في لوحة العروض (Medusa)
 * — والخادمُ يرفض معرّفَ عرضٍ غيرَ موجود.
 */
const CouponPoliciesPage = () => {
  const [rows, setRows] = useState<Policy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [promotionId, setPromotionId] = useState("");
  const [perCustomer, setPerCustomer] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [priority, setPriority] = useState("100");

  const load = () =>
    adminGet<{ policies: Policy[] }>("/admin/coupons/policies?limit=100")
      .then((d) => setRows(d.policies))
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const create = async () => {
    setBusy("create");
    setMessage(null);
    try {
      const out = await adminPost<{ policy: Policy; warning_ar: string | null }>(
        "/admin/coupons/policies",
        {
          promotion_id: promotionId,
          per_customer_limit: perCustomer.trim() ? Number(perCustomer) : null,
          max_discount: maxDiscount.trim() ? Math.round(Number(maxDiscount) * 100) : null,
          first_order_only: firstOrderOnly,
          priority: Number(priority) || 100,
        }
      );
      setMessage({ ok: true, text: out.warning_ar ?? `أُنشئت سياسةُ ${out.policy.promotion_code}.` });
      setPromotionId("");
      setPerCustomer("");
      setMaxDiscount("");
      setFirstOrderOnly(false);
      setPriority("100");
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
  };

  const remove = async (id: string, code: string) => {
    setBusy(id);
    setMessage(null);
    try {
      await adminDelete(`/admin/coupons/policies/${id}`);
      setMessage({ ok: true, text: `حُذفت سياسةُ ${code} — والاستهلاكاتُ السابقة باقيةٌ في الدفتر.` });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">سياساتُ الكوبونات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">سياساتُ الكوبونات</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          الحدُّ لكل عميلٍ · سقفُ الخصم · أوّلُ طلبٍ فقط — فوق ما يملكه محرّكُ العروض.
          والرمزُ والحالةُ يُضبَطان من لوحة العروض في Medusa؛ هذه الشاشةُ لسياستنا فوقه.
        </Text>

        <Heading level="h2" style={{ marginTop: 24 }}>
          سياسةٌ جديدة
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 480, marginTop: 12 }}>
          <div>
            <Label htmlFor="pid">معرّفُ العرض (promotion_id)</Label>
            <Input id="pid" value={promotionId} onChange={(e) => setPromotionId(e.target.value)} placeholder="promo_..." />
          </div>
          <div>
            <Label htmlFor="pcl">الحدُّ لكل عميل — فارغٌ = بلا حدّ</Label>
            <Input id="pcl" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} placeholder="مثلاً 1" />
          </div>
          <div>
            <Label htmlFor="cap">سقفُ الخصم (ر.س) — فارغٌ = بلا سقف</Label>
            <Input id="cap" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="مثلاً 50" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch id="foo" checked={firstOrderOnly} onCheckedChange={(v) => setFirstOrderOnly(Boolean(v))} />
            <Label htmlFor="foo">لأوّل طلبٍ فقط</Label>
          </div>
          <div>
            <Label htmlFor="prio">الترتيب — الأصغرُ يُطبَّق أوّلاً</Label>
            <Input id="prio" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
          <div>
            <Button onClick={create} disabled={busy === "create" || !promotionId}>
              {busy === "create" ? "جارٍ الإنشاء…" : "إنشاءُ السياسة"}
            </Button>
          </div>
        </div>

        {message && (
          <Text style={{ marginTop: 12, maxWidth: 480 }} className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
            {message.ok ? "ℹ️ " : "🔴 "}
            {message.text}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>
          القائمة
        </Heading>
        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle">لا سياساتٍ بعد.</Text>}
        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>الرمز</Table.HeaderCell>
                <Table.HeaderCell>الحدُّ لكل عميل</Table.HeaderCell>
                <Table.HeaderCell>سقفُ الخصم</Table.HeaderCell>
                <Table.HeaderCell>أوّلُ طلب</Table.HeaderCell>
                <Table.HeaderCell>الترتيب</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell>{p.promotion_code}</Table.Cell>
                  <Table.Cell>{p.per_customer_limit ?? "بلا حدّ"}</Table.Cell>
                  <Table.Cell>{p.max_discount === null ? "بلا سقف" : `${riyals(p.max_discount)} ر.س`}</Table.Cell>
                  <Table.Cell>{p.first_order_only ? "نعم" : "لا"}</Table.Cell>
                  <Table.Cell>{p.priority}</Table.Cell>
                  <Table.Cell>
                    <Button
                      size="small"
                      variant="danger"
                      disabled={busy === p.id}
                      onClick={() => remove(p.id, p.promotion_code)}
                    >
                      {busy === p.id ? "…" : "حذف"}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "سياساتُ الكوبونات" });

export default CouponPoliciesPage;
