import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Select, Button, Badge, Table, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Rule = {
  id: string;
  scope: "global" | "item" | "location" | "item_location";
  inventory_item_id: string | null;
  location_id: string | null;
  threshold_quantity: number;
  is_active: boolean;
  note: string | null;
};

type Alert = { inventory_item_id: string; location_id: string; available: number; threshold: number };

const SCOPE_AR: Record<Rule["scope"], string> = {
  global: "عامّة (كلُّ المخزون)",
  item: "صنفٌ محدَّد",
  location: "موقعٌ محدَّد",
  item_location: "صنفٌ في موقع",
};

/**
 * حدودُ تنبيه النفاد — **بيانات لا كود**، ولا رقمَ افتراضيّ.
 *
 * متجرٌ بلا قاعدةٍ عامّة لا يُنبَّه — وهذا صحيح، فتنبيهٌ برقمٍ لم
 * يختره أحدٌ يُتجاهل بعد أسبوع.
 */
const AlertRulesPage = () => {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [alerts, setAlerts] = useState<{ list: Alert[]; rules_count: number; scanned: number; truncated: boolean; message_ar?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [scope, setScope] = useState<Rule["scope"]>("global");
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [threshold, setThreshold] = useState("5");
  const [note, setNote] = useState("");

  const load = () => {
    adminGet<{ rules: Rule[] }>("/admin/warehouse/alert-rules")
      .then((d) => setRules(d.rules))
      .catch((e) => setError(String(e.message)));
    adminGet<{ alerts: Alert[]; rules_count: number; scanned: number; truncated: boolean; message_ar?: string }>(
      "/admin/warehouse/alerts"
    )
      .then((d) => setAlerts({ ...d, list: d.alerts }))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/warehouse/alert-rules", {
        scope,
        inventory_item_id: scope === "item" || scope === "item_location" ? itemId : null,
        location_id: scope === "location" || scope === "item_location" ? locationId : null,
        threshold_quantity: Number(threshold),
        note: note || null,
      });
      setMessage({ ok: true, text: "أُنشئت القاعدة." });
      setItemId("");
      setLocationId("");
      setThreshold("5");
      setNote("");
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">حدودُ التنبيه</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">حدودُ تنبيه النفاد</Heading>

        <Heading level="h2" style={{ marginTop: 24 }}>
          قاعدةٌ جديدة
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 480, marginTop: 12 }}>
          <div>
            <Label htmlFor="scope">النطاق</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Rule["scope"])}>
              <Select.Trigger id="scope">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="global">عامّة — كلّ المخزون</Select.Item>
                <Select.Item value="item">صنفٌ محدَّد</Select.Item>
                <Select.Item value="location">موقعٌ محدَّد</Select.Item>
                <Select.Item value="item_location">صنفٌ في موقع</Select.Item>
              </Select.Content>
            </Select>
          </div>
          {(scope === "item" || scope === "item_location") && (
            <div>
              <Label htmlFor="item">معرّفُ صنف المخزون</Label>
              <Input id="item" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="iitem_..." />
            </div>
          )}
          {(scope === "location" || scope === "item_location") && (
            <div>
              <Label htmlFor="loc">معرّفُ الموقع</Label>
              <Input id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="sloc_..." />
            </div>
          )}
          <div>
            <Label htmlFor="threshold">حدُّ الكمّية</Label>
            <Input id="threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="note">ملاحظة</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Button
              onClick={create}
              disabled={
                busy ||
                ((scope === "item" || scope === "item_location") && !itemId) ||
                ((scope === "location" || scope === "item_location") && !locationId)
              }
            >
              {busy ? "جارٍ الإنشاء…" : "إنشاءُ القاعدة"}
            </Button>
          </div>
        </div>

        {message && (
          <Text style={{ marginTop: 12, maxWidth: 480 }} className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
            {message.ok ? "✅ " : "🔴 "}
            {message.text}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>
          القواعدُ الحالية
        </Heading>
        {!rules && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rules && rules.length === 0 && <Text className="text-ui-fg-subtle">لا قواعد بعد.</Text>}
        {rules && rules.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>النطاق</Table.HeaderCell>
                <Table.HeaderCell>الحدّ</Table.HeaderCell>
                <Table.HeaderCell>نشطة؟</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rules.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    {SCOPE_AR[r.scope]}
                    {r.inventory_item_id && ` · ${r.inventory_item_id.slice(0, 12)}…`}
                    {r.location_id && ` · ${r.location_id.slice(0, 12)}…`}
                  </Table.Cell>
                  <Table.Cell>{r.threshold_quantity}</Table.Cell>
                  <Table.Cell>
                    <Badge color={r.is_active ? "green" : "grey"}>{r.is_active ? "نعم" : "لا"}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>
          ما بلغ الحدَّ الآن
        </Heading>
        {!alerts && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {alerts?.message_ar && <Text className="text-ui-fg-subtle">{alerts.message_ar}</Text>}
        {alerts && !alerts.message_ar && (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              مُسِح {alerts.scanned} صفّاً{alerts.truncated ? " — والقائمة أكبر من سقف الفحص، فهذا جزءٌ منها لا كلُّها" : ""}.
            </Text>
            {alerts.list.length === 0 ? (
              <Text className="text-ui-fg-subtle">لا شيءَ بلغ الحدَّ الآن.</Text>
            ) : (
              <Table style={{ marginTop: 8 }}>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>الصنف</Table.HeaderCell>
                    <Table.HeaderCell>الموقع</Table.HeaderCell>
                    <Table.HeaderCell>المتاح</Table.HeaderCell>
                    <Table.HeaderCell>الحدّ</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {alerts.list.map((a, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>
                        <code style={{ fontSize: 12 }}>{a.inventory_item_id.slice(0, 14)}…</code>
                      </Table.Cell>
                      <Table.Cell>
                        <code style={{ fontSize: 12 }}>{a.location_id.slice(0, 14)}…</code>
                      </Table.Cell>
                      <Table.Cell className="text-ui-fg-error">{a.available}</Table.Cell>
                      <Table.Cell>{a.threshold}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "حدودُ التنبيه" });

export default AlertRulesPage;
