import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Select, Button, Badge, Table, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Adjustment = {
  id: string;
  inventory_item_id: string;
  location_id: string;
  delta: number;
  reason: string;
  state: "pending" | "approved" | "applied" | "rejected";
  needs_approval: boolean;
  requested_by: string;
  approved_by: string | null;
  applied_by: string | null;
  reject_reason: string | null;
  value_halalas: number | null;
  note: string | null;
  created_at: string;
};

type Policy = { threshold_quantity: number; threshold_value_halalas: number; is_enabled: boolean };

const STATE_TONE: Record<string, "green" | "orange" | "red" | "grey"> = {
  pending: "orange",
  approved: "orange",
  applied: "green",
  rejected: "red",
};

const STATE_AR: Record<string, string> = {
  pending: "بانتظار الموافقة",
  approved: "وُوفق — بانتظار التطبيق",
  applied: "طُبِّقت",
  rejected: "مرفوضة",
};

/**
 * تسوياتُ المخزون — **أربعُ عيونٍ فوق الحدّ**.
 *
 * لا أحد يوافق على تسويةِ نفسِه — والقاعدةُ تفرض هذا بقيدٍ، وهذه
 * الشاشةُ لا تحاول الالتفافَ عليه: زرُّ الموافقة يُتاح دائماً،
 * والرفضُ من القاعدة يترجَم إلى رسالةٍ مفهومة.
 */
const AdjustmentsPage = () => {
  const [rows, setRows] = useState<Adjustment[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"adjustment" | "stocktake" | "damage" | "correction">("adjustment");
  const [note, setNote] = useState("");

  const load = () => {
    const q = filter === "all" ? "" : `&state=${filter}`;
    adminGet<{ adjustments: Adjustment[]; policy: Policy }>(`/admin/warehouse/adjustments?limit=100${q}`)
      .then((d) => {
        setRows(d.adjustments);
        setPolicy(d.policy);
      })
      .catch((e) => setError(String(e.message)));
  };

  useEffect(load, [filter]);

  const request = async () => {
    setBusy("request");
    setMessage(null);
    try {
      const d = Number(delta);
      if (!Number.isInteger(d) || d === 0) throw new Error("الفرقُ عددٌ صحيحٌ غيرُ صفر.");
      const out = await adminPost<{ needs_approval: boolean }>("/admin/warehouse/adjustments", {
        inventory_item_id: itemId,
        location_id: locationId,
        delta: d,
        reason,
        note: note || null,
      });
      setMessage({
        ok: true,
        text: out.needs_approval
          ? "سُجّلت التسويةُ — تجاوزت الحدَّ وتنتظر موافقةَ شخصٍ ثانٍ."
          : "سُجّلت التسويةُ — تحت الحدّ، طبِّقها من القائمة.",
      });
      setItemId("");
      setLocationId("");
      setDelta("");
      setNote("");
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
  };

  const act = async (id: string, action: "approve" | "reject" | "apply") => {
    setBusy(id + action);
    setMessage(null);
    try {
      if (action === "apply") {
        await adminPost(`/admin/warehouse/adjustments/${id}/apply`);
        setMessage({ ok: true, text: "طُبِّقت التسويةُ — تغيّر الرصيد." });
      } else {
        await adminPost(`/admin/warehouse/adjustments/${id}/approve`, action === "reject" ? { reject: true, reason: "من اللوحة" } : {});
        setMessage({ ok: true, text: action === "approve" ? "وُوفق عليها." : "رُفضت." });
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(null);
    load();
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">تسوياتُ المخزون</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">تسوياتُ المخزون</Heading>
        {policy && (
          <Text size="small" className="text-ui-fg-subtle">
            الحدُّ الذي يستوجب موافقةً ثانية: {policy.threshold_quantity} قطعة، أو{" "}
            {(policy.threshold_value_halalas / 100).toLocaleString("ar-SA")} ر.س — أيُّهما وقع أوّلاً.
            {!policy.is_enabled && " ⚠️ التسويةُ اليدويةُ موقوفةٌ حالياً."}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 24 }}>
          طلبُ تسوية
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 520, marginTop: 12 }}>
          <div>
            <Label htmlFor="item">معرّفُ صنف المخزون (inventory_item_id)</Label>
            <Input id="item" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="iitem_..." />
          </div>
          <div>
            <Label htmlFor="loc">معرّفُ الموقع (location_id)</Label>
            <Input id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="sloc_..." />
          </div>
          <div>
            <Label htmlFor="delta">الفرق — موجبٌ يزيد وسالبٌ ينقص</Label>
            <Input id="delta" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="مثلاً -3" />
          </div>
          <div>
            <Label htmlFor="reason">السبب</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
              <Select.Trigger id="reason">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="adjustment">تسويةٌ عامّة</Select.Item>
                <Select.Item value="stocktake">جردٌ</Select.Item>
                <Select.Item value="damage">تلف</Select.Item>
                <Select.Item value="correction">تصحيح</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label htmlFor="note">ملاحظة</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Button onClick={request} disabled={busy === "request" || !itemId || !locationId || !delta}>
              {busy === "request" ? "جارٍ الطلب…" : "طلبُ التسوية"}
            </Button>
          </div>
        </div>

        {message && (
          <Text style={{ marginTop: 12 }} className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
            {message.ok ? "✅ " : "🔴 "}
            {message.text}
          </Text>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 32 }}>
          <Heading level="h2">القائمة</Heading>
          <Select value={filter} onValueChange={setFilter}>
            <Select.Trigger style={{ width: 220 }}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="pending">بانتظار الموافقة</Select.Item>
              <Select.Item value="approved">وُوفق — بانتظار التطبيق</Select.Item>
              <Select.Item value="applied">طُبِّقت</Select.Item>
              <Select.Item value="rejected">مرفوضة</Select.Item>
              <Select.Item value="all">الكلّ</Select.Item>
            </Select.Content>
          </Select>
        </div>

        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle">لا تسوياتٍ بهذه الحالة.</Text>}
        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>الصنف</Table.HeaderCell>
                <Table.HeaderCell>الفرق</Table.HeaderCell>
                <Table.HeaderCell>السبب</Table.HeaderCell>
                <Table.HeaderCell>الحال</Table.HeaderCell>
                <Table.HeaderCell>الطالب</Table.HeaderCell>
                <Table.HeaderCell>الموافِق</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell title={r.inventory_item_id}>{r.inventory_item_id.slice(0, 14)}…</Table.Cell>
                  <Table.Cell className={r.delta < 0 ? "text-ui-fg-error" : undefined}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </Table.Cell>
                  <Table.Cell>{r.reason}</Table.Cell>
                  <Table.Cell>
                    <Badge color={STATE_TONE[r.state]}>{STATE_AR[r.state]}</Badge>
                  </Table.Cell>
                  <Table.Cell>{r.requested_by.slice(0, 10)}…</Table.Cell>
                  <Table.Cell>{r.approved_by ? `${r.approved_by.slice(0, 10)}…` : "—"}</Table.Cell>
                  <Table.Cell>
                    <div style={{ display: "flex", gap: 6 }}>
                      {r.state === "pending" && (
                        <>
                          <Button size="small" disabled={busy === r.id + "approve"} onClick={() => act(r.id, "approve")}>
                            {busy === r.id + "approve" ? "…" : "موافقة"}
                          </Button>
                          <Button size="small" variant="danger" disabled={busy === r.id + "reject"} onClick={() => act(r.id, "reject")}>
                            {busy === r.id + "reject" ? "…" : "رفض"}
                          </Button>
                        </>
                      )}
                      {(r.state === "approved" || (r.state === "pending" && !r.needs_approval)) && (
                        <Button size="small" variant="secondary" disabled={busy === r.id + "apply"} onClick={() => act(r.id, "apply")}>
                          {busy === r.id + "apply" ? "…" : "تطبيق"}
                        </Button>
                      )}
                    </div>
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

export const config = defineRouteConfig({ label: "تسوياتُ المخزون" });

export default AdjustmentsPage;
