import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Button, Switch, Select, Textarea, Table, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost, riyals } from "../../../lib/rtl";

type Policy = {
  id: string;
  is_enabled: boolean;
  window_days: number | null;
  accepts_opened: boolean;
  min_order_total: number | null;
  who_pays_shipping: "store" | "customer";
  note: string | null;
};

type Inspection = {
  id: string;
  quantity: number;
  outcome: "resellable" | "damaged" | "missing" | "wrong_item";
  reason_ar: string;
  actor_id: string | null;
  created_at: string;
};

/**
 * سياسةُ الإرجاع وفحصُ المرتجعات.
 *
 * ── لماذا السياسةُ صفٌّ لا كود (بند ٤٨) ───────────────────────────
 *
 * نافذةُ الإرجاع قرارُ تاجرٍ يتغيّر بالموسم: أضيقُ في التخفيضات،
 * وتصنيفٌ يُستثنى. ولو كانت كوداً لصار تضييقُها يوماً واحداً **نشرةَ
 * إصدار**.
 *
 * ── و«غيرُ مضبوطة» تُقال صراحةً ───────────────────────────────────
 *
 * الخادمُ يردّ `is_configured: false` لا كائناً فارغاً، وهذه الشاشةُ
 * تقولها. فنموذجٌ بحقولٍ خاليةٍ يظنّه المديرُ سياسةً قائمةً هو أسوأُ
 * من لا شيء: يظنّ أن الإرجاعَ مضبوطٌ وهو معطَّل.
 *
 * ── والفحصُ يُلحَق ولا يُعدَّل ────────────────────────────────────
 *
 * لا زرَّ تعديلٍ لسطرِ فحصٍ هنا، لأن المسارَ لا يملكه: الفحصُ حكمٌ
 * بتاريخه وفاعله، وتصحيحُه **سطرٌ جديد**. والفاعلُ يؤخذ من الجلسة لا
 * من الشاشة — فلا يُكتب حكمٌ باسم غيرِ صاحبه.
 */
const ReturnsPolicyPage = () => {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [windowDays, setWindowDays] = useState("");
  const [opened, setOpened] = useState(true);
  const [minTotal, setMinTotal] = useState("");
  const [payer, setPayer] = useState<"store" | "customer">("customer");
  const [note, setNote] = useState("");

  // فحصُ مرتجعٍ بعينه — والمعرّفُ يُكتب لأن قائمةَ المرتجعات تعيش في
  // شاشات Medusa نفسِها، ونسخُ معرّفٍ منها أصدقُ من قائمةٍ ثانيةٍ هنا
  // قد تفترق عنها.
  const [returnId, setReturnId] = useState("");
  const [inspections, setInspections] = useState<Inspection[] | null>(null);
  const [releasable, setReleasable] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [outcome, setOutcome] = useState<Inspection["outcome"]>("resellable");
  const [reason, setReason] = useState("");

  const load = () =>
    adminGet<{ is_configured: boolean; policy: Policy | null }>("/admin/returns-flow/policy")
      .then((d) => {
        setConfigured(d.is_configured);
        setPolicy(d.policy);
        if (d.policy) {
          setEnabled(d.policy.is_enabled);
          setWindowDays(d.policy.window_days == null ? "" : String(d.policy.window_days));
          setOpened(d.policy.accepts_opened);
          setMinTotal(d.policy.min_order_total == null ? "" : String(d.policy.min_order_total / 100));
          setPayer(d.policy.who_pays_shipping);
          setNote(d.policy.note ?? "");
        }
      })
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/returns-flow/policy", {
        is_enabled: enabled,
        window_days: windowDays === "" ? null : Number(windowDays),
        accepts_opened: opened,
        // المالُ بالهللات صحيحةً (ADR-008) — والشاشةُ تعرض ريالاتٍ
        // وتحوّل عند الإرسال، ولا تُرسل عائماً.
        min_order_total: minTotal === "" ? null : Math.round(Number(minTotal) * 100),
        who_pays_shipping: payer,
        note: note || null,
      });
      setMessage({ ok: true, text: "حُفظت السياسة." });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  const loadInspections = async () => {
    setMessage(null);
    try {
      const d = await adminGet<{ inspections: Inspection[]; releasable: number }>(
        `/admin/returns-flow/inspections?return_id=${encodeURIComponent(returnId)}`
      );
      setInspections(d.inspections);
      setReleasable(d.releasable);
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
  };

  const inspect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/returns-flow/inspections", {
        return_id: returnId,
        quantity: Number(qty),
        outcome,
        reason_ar: reason,
      });
      setMessage({ ok: true, text: "سُجّل الفحص." });
      setQty("");
      setReason("");
      loadInspections();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">الإرجاع</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الإرجاع — السياسةُ والفحص</Heading>

        {configured === false && (
          <Text className="text-ui-fg-error" style={{ marginTop: 8 }}>
            ⚠️ لا سياسةَ إرجاعٍ مضبوطةٌ بعد — والحقولُ أدناه فارغةٌ لأنها
            لم تُملأ قطّ، لا لأنها صفر.
          </Text>
        )}

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end", marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={enabled} onCheckedChange={setEnabled} id="ret-enabled" />
            <Label htmlFor="ret-enabled">الإرجاع مفعَّل</Label>
          </div>
          <div>
            <Label size="small">نافذةُ الإرجاع (يوماً — فارغٌ = بلا حدّ)</Label>
            <Input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} placeholder="14" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={opened} onCheckedChange={setOpened} id="ret-opened" />
            <Label htmlFor="ret-opened">يُقبل المفتوح</Label>
          </div>
          <div>
            <Label size="small">أدنى إجماليٍّ للطلب (ر.س)</Label>
            <Input value={minTotal} onChange={(e) => setMinTotal(e.target.value)} placeholder="0" />
          </div>
          <div style={{ minWidth: 180 }}>
            <Label size="small">من يدفع الشحن</Label>
            <Select value={payer} onValueChange={(v) => setPayer(v as any)}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>
                <Select.Item value="customer">العميل</Select.Item>
                <Select.Item value="store">المتجر</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>

        <div style={{ marginTop: 12, maxWidth: 560 }}>
          <Label size="small">ملاحظة</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>

        <Button onClick={save} disabled={busy} style={{ marginTop: 12 }}>حفظُ السياسة</Button>

        {policy && (
          <Text size="small" className="text-ui-fg-subtle" style={{ marginTop: 8 }}>
            المحفوظُ الآن: {policy.is_enabled ? "مفعَّل" : "معطَّل"}
            {policy.window_days != null && ` · ${policy.window_days} يوماً`}
            {policy.min_order_total != null && ` · أدنى ${riyals(policy.min_order_total)} ر.س`}
            {` · الشحن على ${policy.who_pays_shipping === "store" ? "المتجر" : "العميل"}`}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>فحصُ مرتجَع</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          الفحصُ يُلحَق ولا يُعدَّل — والتصحيحُ سطرٌ جديد. والفاعلُ يؤخذ من
          جلستك لا من هذه الشاشة.
        </Text>

        <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 12 }}>
          <div style={{ minWidth: 260 }}>
            <Label size="small">معرّفُ المرتجع</Label>
            <Input value={returnId} onChange={(e) => setReturnId(e.target.value)} placeholder="ret_…" />
          </div>
          <Button variant="secondary" onClick={loadInspections} disabled={!returnId}>عرضُ الفحوص</Button>
        </div>

        {inspections && (
          <>
            <Text size="small" style={{ marginTop: 12 }}>
              القابلُ للإطلاق إلى الرفّ الآن: <strong>{releasable ?? 0}</strong>
            </Text>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الكمّية</Table.HeaderCell>
                  <Table.HeaderCell>النتيجة</Table.HeaderCell>
                  <Table.HeaderCell>السبب</Table.HeaderCell>
                  <Table.HeaderCell>الفاحص</Table.HeaderCell>
                  <Table.HeaderCell>الوقت</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {inspections.map((i) => (
                  <Table.Row key={i.id}>
                    <Table.Cell>{i.quantity}</Table.Cell>
                    <Table.Cell>
                      <Badge color={i.outcome === "resellable" ? "green" : "red"}>{i.outcome}</Badge>
                    </Table.Cell>
                    <Table.Cell>{i.reason_ar}</Table.Cell>
                    <Table.Cell>{i.actor_id ?? "—"}</Table.Cell>
                    <Table.Cell>{new Date(i.created_at).toLocaleString("ar-SA")}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            {inspections.length === 0 && (
              <Text className="text-ui-fg-subtle" style={{ marginTop: 8 }}>لا فحصَ لهذا المرتجع بعد.</Text>
            )}

            <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ width: 120 }}>
                <Label size="small">الكمّية</Label>
                <Input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" />
              </div>
              <div style={{ minWidth: 180 }}>
                <Label size="small">النتيجة</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as any)}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="resellable">صالحٌ للبيع</Select.Item>
                    <Select.Item value="damaged">تالف</Select.Item>
                    <Select.Item value="missing">ناقص</Select.Item>
                    <Select.Item value="wrong_item">صنفٌ خاطئ</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div style={{ minWidth: 280 }}>
                <Label size="small">السبب (إلزاميّ)</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button onClick={inspect} disabled={busy || !qty || !reason.trim()}>تسجيلُ الفحص</Button>
            </div>
          </>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الإرجاع" });

export default ReturnsPolicyPage;
