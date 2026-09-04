import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Button, Badge, Table, Textarea, Select } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost, riyals } from "../../../lib/rtl";

type Order = {
  id: string;
  supplier_id: string;
  location_id: string;
  status: "draft" | "placed" | "partially_received" | "received" | "cancelled";
  currency_code: string;
  expected_at: string | null;
  note: string | null;
  created_at: string;
};

type Line = {
  id: string;
  variant_id: string;
  inventory_item_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
};

type Detail = { purchase_order: Order & { total_halalas: number }; supplier: { name: string } | null; lines: Line[] };

const STATE_TONE: Record<Order["status"], "green" | "orange" | "red" | "grey"> = {
  draft: "grey",
  placed: "orange",
  partially_received: "orange",
  received: "green",
  cancelled: "red",
};
const STATE_AR: Record<Order["status"], string> = {
  draft: "مسوَّدة",
  placed: "أُرسل للمورّد",
  partially_received: "استُلم جزئياً",
  received: "استُلم كاملاً",
  cancelled: "أُلغي",
};

type LineDraft = { variant_id: string; quantity: string; unit_cost: string };

/**
 * أوامرُ الشراء (بند ٣٣) — **إنشاءٌ ثمّ إرسالٌ ثمّ استلام، بثلاثِ عيونٍ مختلفة**.
 *
 * من يُصدر الأمرَ ليس من يعتمده، ومن يعتمده ليس بالضرورة من يستلم —
 * والصلاحياتُ تفرض ذلك بمفردها (`05-rbac-matrix.md`)، وهذه الشاشةُ
 * تعرض الأزرارَ المناسبةَ لحالة الأمر فقط.
 */
const PurchaseOrdersPage = () => {
  const [rows, setRows] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ variant_id: "", quantity: "", unit_cost: "" }]);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [receiveLineId, setReceiveLineId] = useState("");
  const [receiveQty, setReceiveQty] = useState("");

  const load = () =>
    adminGet<{ purchase_orders: Order[] }>("/admin/procurement/purchase-orders?limit=100")
      .then((d) => setRows(d.purchase_orders))
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const openDetail = (id: string) => {
    setSelected(id);
    setDetail(null);
    setReceiveLineId("");
    setReceiveQty("");
    adminGet<Detail>(`/admin/procurement/purchase-orders/${id}`)
      .then(setDetail)
      .catch((e) => setMessage({ ok: false, text: e.message }));
  };

  const updateLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const create = async () => {
    setBusy("create");
    setMessage(null);
    try {
      const payload = lines
        .filter((l) => l.variant_id.trim())
        .map((l) => ({
          variant_id: l.variant_id.trim(),
          quantity: Number(l.quantity),
          unit_cost: Math.round(Number(l.unit_cost) * 100),
        }));
      if (!payload.length) throw new Error("أضفْ سطراً واحداً على الأقل.");

      await adminPost("/admin/procurement/purchase-orders", {
        supplier_id: supplierId,
        location_id: locationId,
        expected_at: expectedAt || null,
        note: note || null,
        lines: payload,
      });
      setMessage({ ok: true, text: "أُنشئ أمرُ الشراء كمسوَّدة." });
      setSupplierId("");
      setLocationId("");
      setExpectedAt("");
      setNote("");
      setLines([{ variant_id: "", quantity: "", unit_cost: "" }]);
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
  };

  const place = async (id: string) => {
    setBusy("place");
    setMessage(null);
    try {
      await adminPost(`/admin/procurement/purchase-orders/${id}/place`);
      setMessage({ ok: true, text: "أُرسل الأمرُ للمورّد." });
      openDetail(id);
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
  };

  const receive = async () => {
    if (!selected || !receiveLineId) return;
    setBusy("receive");
    setMessage(null);
    try {
      const out = await adminPost<{ stocked_after: number }>(
        `/admin/procurement/purchase-orders/${selected}/receive`,
        { line_id: receiveLineId, quantity: Number(receiveQty) }
      );
      setMessage({ ok: true, text: `اُستلمت — الرصيدُ الآن ${out.stocked_after}.` });
      setReceiveQty("");
      openDetail(selected);
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
          <Heading level="h1">أوامرُ الشراء</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">أوامرُ الشراء</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          معرّفُ المتغيّر (variant_id) ومعرّفُ المورّد والموقع تُنسخ من شاشاتها. والتكلفةُ بالريال هنا وتُحفظ بالهللات.
        </Text>

        <Heading level="h2" style={{ marginTop: 24 }}>
          أمرٌ جديد
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 560, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="supplier">معرّفُ المورّد</Label>
              <Input id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="sup_..." />
            </div>
            <div>
              <Label htmlFor="location">معرّفُ موقع الاستلام</Label>
              <Input id="location" value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="sloc_..." />
            </div>
          </div>
          <div>
            <Label htmlFor="expected">تاريخُ الوصول المتوقَّع</Label>
            <Input id="expected" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </div>

          <Label>السطور</Label>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
              <Input
                placeholder="معرّفُ المتغيّر (variant_...)"
                value={l.variant_id}
                onChange={(e) => updateLine(i, { variant_id: e.target.value })}
              />
              <Input placeholder="الكمّية" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
              <Input placeholder="تكلفةُ الوحدة (ر.س)" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: e.target.value })} />
              <Button
                size="small"
                variant="secondary"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1}
              >
                حذف
              </Button>
            </div>
          ))}
          <div>
            <Button size="small" variant="secondary" onClick={() => setLines((ls) => [...ls, { variant_id: "", quantity: "", unit_cost: "" }])}>
              + سطر
            </Button>
          </div>

          <div>
            <Label htmlFor="note">ملاحظة</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Button onClick={create} disabled={busy === "create" || !supplierId || !locationId}>
              {busy === "create" ? "جارٍ الإنشاء…" : "إنشاءُ الأمر"}
            </Button>
          </div>
        </div>

        {message && (
          <Text style={{ marginTop: 12, maxWidth: 560 }} className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
            {message.ok ? "✅ " : "🔴 "}
            {message.text}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>
          القائمة
        </Heading>
        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle">لا أوامرَ بعد.</Text>}
        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>المعرّف</Table.HeaderCell>
                <Table.HeaderCell>الحالة</Table.HeaderCell>
                <Table.HeaderCell>الوصولُ المتوقَّع</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((o) => (
                <Table.Row key={o.id}>
                  <Table.Cell>
                    <code style={{ fontSize: 12 }}>{o.id.slice(0, 18)}…</code>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={STATE_TONE[o.status]}>{STATE_AR[o.status]}</Badge>
                  </Table.Cell>
                  <Table.Cell>{o.expected_at ? new Date(o.expected_at).toLocaleDateString("ar-SA") : "—"}</Table.Cell>
                  <Table.Cell>
                    <Button size="small" variant="secondary" onClick={() => openDetail(o.id)}>
                      تفاصيل
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {selected && (
          <div style={{ marginTop: 32, borderTop: "1px solid var(--border-base)", paddingTop: 16 }}>
            <Heading level="h2">
              تفاصيلُ الأمر {selected.slice(0, 14)}…
            </Heading>

            {!detail && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}

            {detail && (
              <>
                <Text size="small">
                  المورّد: {detail.supplier?.name ?? detail.purchase_order.supplier_id} · الإجمالي:{" "}
                  {riyals(detail.purchase_order.total_halalas)} ر.س ·{" "}
                  <Badge color={STATE_TONE[detail.purchase_order.status]}>{STATE_AR[detail.purchase_order.status]}</Badge>
                </Text>

                <Table style={{ marginTop: 12 }}>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>المتغيّر</Table.HeaderCell>
                      <Table.HeaderCell>مطلوب</Table.HeaderCell>
                      <Table.HeaderCell>مستلَم</Table.HeaderCell>
                      <Table.HeaderCell>تكلفةُ الوحدة</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {detail.lines.map((l) => (
                      <Table.Row key={l.id}>
                        <Table.Cell>
                          <code style={{ fontSize: 12 }}>{l.variant_id.slice(0, 18)}…</code>
                        </Table.Cell>
                        <Table.Cell>{l.quantity_ordered}</Table.Cell>
                        <Table.Cell>{l.quantity_received}</Table.Cell>
                        <Table.Cell>{riyals(l.unit_cost)} ر.س</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>

                {detail.purchase_order.status === "draft" && (
                  <div style={{ marginTop: 12 }}>
                    <Button disabled={busy === "place"} onClick={() => place(detail.purchase_order.id)}>
                      {busy === "place" ? "…" : "إرسالُ الأمر للمورّد"}
                    </Button>
                  </div>
                )}

                {(detail.purchase_order.status === "placed" || detail.purchase_order.status === "partially_received") && (
                  <div style={{ display: "grid", gap: 10, maxWidth: 420, marginTop: 16 }}>
                    <Heading level="h3">استلامُ بضاعة</Heading>
                    <div>
                      <Label htmlFor="rline">السطر</Label>
                      <Select value={receiveLineId} onValueChange={setReceiveLineId}>
                        <Select.Trigger id="rline">
                          <Select.Value placeholder="اختر سطراً" />
                        </Select.Trigger>
                        <Select.Content>
                          {detail.lines.map((l) => (
                            <Select.Item key={l.id} value={l.id}>
                              {l.variant_id.slice(0, 16)}… — بقي {l.quantity_ordered - l.quantity_received}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="rqty">الكمّية (سالبةٌ لتصحيح استلامٍ زائد)</Label>
                      <Input id="rqty" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} />
                    </div>
                    <div>
                      <Button disabled={busy === "receive" || !receiveLineId || !receiveQty} onClick={receive}>
                        {busy === "receive" ? "…" : "تسجيلُ الاستلام"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "أوامرُ الشراء" });

export default PurchaseOrdersPage;
