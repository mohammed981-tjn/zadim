import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Switch, Button, Badge, Table, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Policy = {
  id: string;
  is_enabled: boolean;
  max_order_total: number | null;
  min_order_total: number | null;
  refusals_before_block: number | null;
  excluded_cities: string[] | null;
  note: string | null;
};

type Refusal = {
  id: string;
  customer_key: string;
  order_id: string | null;
  reason_ar: string | null;
  created_at: string;
};

type Form = {
  is_enabled: boolean;
  max_order_total: string;
  min_order_total: string;
  refusals_before_block: string;
  excluded_cities: string;
  note: string;
};

const EMPTY: Form = {
  is_enabled: true,
  max_order_total: "",
  min_order_total: "",
  refusals_before_block: "",
  excluded_cities: "",
  note: "",
};

/**
 * سياسةُ الدفع عند الاستلام — **موازنةٌ بين بيعٍ وشحنتين قد تُخسران**.
 *
 * ولا قيمةَ افتراضيةً لأيّ حدّ: `not_configured` تعني **COD ممنوعٌ
 * الآن**، لا أن الإعداد اختياريّ ويُترك لاحقاً.
 */
const CodPolicyPage = () => {
  const [state, setState] = useState<"configured" | "not_configured" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [refusals, setRefusals] = useState<Refusal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    adminGet<{ policy: Policy | null; state: "configured" | "not_configured" }>(
      "/admin/payments/cod-policy"
    )
      .then((d) => {
        setState(d.state);
        if (d.policy) {
          setForm({
            is_enabled: d.policy.is_enabled,
            max_order_total: d.policy.max_order_total === null ? "" : String(d.policy.max_order_total / 100),
            min_order_total: d.policy.min_order_total === null ? "" : String(d.policy.min_order_total / 100),
            refusals_before_block:
              d.policy.refusals_before_block === null ? "" : String(d.policy.refusals_before_block),
            excluded_cities: (d.policy.excluded_cities ?? []).join("، "),
            note: d.policy.note ?? "",
          });
        }
      })
      .catch((e) => setError(String(e.message)));
    adminGet<{ refusals: Refusal[] }>("/admin/payments/cod-refusals?limit=30")
      .then((d) => setRefusals(d.refusals))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toHalalas = (v: string): number | null => {
    const n = Number(v.trim());
    if (!v.trim() || !Number.isFinite(n)) return null;
    return Math.round(n * 100);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/payments/cod-policy", {
        is_enabled: form.is_enabled,
        max_order_total: toHalalas(form.max_order_total),
        min_order_total: toHalalas(form.min_order_total),
        refusals_before_block: form.refusals_before_block.trim()
          ? Number(form.refusals_before_block)
          : null,
        excluded_cities: form.excluded_cities.trim()
          ? form.excluded_cities.split(/[،,]/).map((s) => s.trim()).filter(Boolean)
          : null,
        note: form.note || null,
      });
      setState("configured");
      setMessage({ ok: true, text: "حُفظت السياسة." });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">سياسةُ الدفع عند الاستلام</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Heading level="h1">سياسةُ الدفع عند الاستلام (COD)</Heading>
          {state && (
            <Badge color={state === "configured" ? "green" : "red"}>
              {state === "configured" ? "مضبوطة" : "🔴 COD ممنوعٌ الآن"}
            </Badge>
          )}
        </div>

        <div style={{ display: "grid", gap: 16, maxWidth: 520, marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch id="enabled" checked={form.is_enabled} onCheckedChange={(v) => set("is_enabled", Boolean(v))} />
            <Label htmlFor="enabled">السماحُ بالدفع عند الاستلام</Label>
          </div>

          <div>
            <Label htmlFor="max">أعلى قيمةِ طلبٍ (ر.س) — فارغٌ = بلا حدّ</Label>
            <Input id="max" value={form.max_order_total} onChange={(e) => set("max_order_total", e.target.value)} placeholder="مثلاً 500" />
          </div>
          <div>
            <Label htmlFor="min">أدنى قيمةِ طلبٍ (ر.س) — فارغٌ = بلا حدّ</Label>
            <Input id="min" value={form.min_order_total} onChange={(e) => set("min_order_total", e.target.value)} placeholder="مثلاً 30" />
          </div>
          <div>
            <Label htmlFor="refusals">عددُ الرفضات قبل منع العميل — فارغٌ = لا منع</Label>
            <Input id="refusals" value={form.refusals_before_block} onChange={(e) => set("refusals_before_block", e.target.value)} placeholder="مثلاً 3" />
          </div>
          <div>
            <Label htmlFor="cities">مدنٌ مستثناة (افصل بفاصلة)</Label>
            <Input id="cities" value={form.excluded_cities} onChange={(e) => set("excluded_cities", e.target.value)} placeholder="مثلاً: بيشة، شرورة" />
          </div>
          <div>
            <Label htmlFor="note">ملاحظة</Label>
            <Textarea id="note" value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>

          <div>
            <Button onClick={save} disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "حفظُ السياسة"}
            </Button>
          </div>

          {message && (
            <Text className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
              {message.ok ? "✅ " : "🔴 "}
              {message.text}
            </Text>
          )}
        </div>

        <Heading level="h2" style={{ marginTop: 32 }}>
          سجلُّ الرفضات عند الباب
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          يُقيَّد ولا يُمحى — والصفحُ عن عميلٍ يكون برفع العتبة أعلاه لا بحذف واقعة.
        </Text>

        {!refusals && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {refusals && refusals.length === 0 && <Text className="text-ui-fg-subtle">لا رفضاتٍ مسجَّلة.</Text>}
        {refusals && refusals.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>العميل</Table.HeaderCell>
                <Table.HeaderCell>الطلب</Table.HeaderCell>
                <Table.HeaderCell>السبب</Table.HeaderCell>
                <Table.HeaderCell>التاريخ</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {refusals.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>{r.customer_key}</Table.Cell>
                  <Table.Cell>{r.order_id ? `${r.order_id.slice(0, 14)}…` : "—"}</Table.Cell>
                  <Table.Cell>{r.reason_ar ?? "—"}</Table.Cell>
                  <Table.Cell>{new Date(r.created_at).toLocaleString("ar-SA")}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الدفعُ عند الاستلام" });

export default CodPolicyPage;
