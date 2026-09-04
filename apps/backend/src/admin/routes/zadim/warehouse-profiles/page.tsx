import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Switch, Button, Table } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Profile = {
  id: string;
  location_id: string;
  city: string | null;
  region_code: string | null;
  priority: number;
  is_fulfilment_enabled: boolean;
  display_name_ar: string | null;
};

/**
 * ملفّاتُ المستودعات — ما يقرّر **من أين يُشحن**.
 *
 * الحفظُ بالمعرّف: نداءٌ ثانٍ لنفس الموقع يعدّل ملفَّه لا ينشئ آخر.
 */
const WarehouseProfilesPage = () => {
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [regionCode, setRegionCode] = useState("");
  const [priority, setPriority] = useState("0");
  const [enabled, setEnabled] = useState(true);

  const load = () =>
    adminGet<{ profiles: Profile[] }>("/admin/warehouse/profiles")
      .then((d) => setRows(d.profiles))
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/warehouse/profiles", {
        location_id: locationId,
        display_name_ar: displayName || null,
        city: city || null,
        region_code: regionCode || null,
        priority: Number(priority) || 0,
        is_fulfilment_enabled: enabled,
      });
      setMessage({ ok: true, text: "حُفظ الملفّ." });
      setLocationId("");
      setDisplayName("");
      setCity("");
      setRegionCode("");
      setPriority("0");
      setEnabled(true);
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
          <Heading level="h1">ملفّاتُ المستودعات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">ملفّاتُ المستودعات</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          تُقرّر أيُّ مستودعٍ يُقترَح أوّلاً عند تجهيز طلب — الأولويةُ الأصغرُ تُقترَح أوّلاً.
        </Text>

        <Heading level="h2" style={{ marginTop: 24 }}>
          حفظُ ملفّ (إنشاءٌ أو تعديل)
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 480, marginTop: 12 }}>
          <div>
            <Label htmlFor="loc">معرّفُ الموقع *</Label>
            <Input id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="sloc_..." />
          </div>
          <div>
            <Label htmlFor="dname">الاسمُ المعروض</Label>
            <Input id="dname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="city">المدينة</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="region">رمزُ المنطقة</Label>
              <Input id="region" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="priority">الأولوية (الأصغرُ أوّلاً)</Label>
            <Input id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch id="enabled" checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
            <Label htmlFor="enabled">يُشحَن منه</Label>
          </div>
          <div>
            <Button onClick={save} disabled={busy || !locationId.trim()}>
              {busy ? "جارٍ الحفظ…" : "حفظُ الملفّ"}
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
          القائمة
        </Heading>
        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle">لا ملفّاتٍ بعد.</Text>}
        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>الاسم</Table.HeaderCell>
                <Table.HeaderCell>المدينة</Table.HeaderCell>
                <Table.HeaderCell>الأولوية</Table.HeaderCell>
                <Table.HeaderCell>يُشحَن منه؟</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell>{p.display_name_ar ?? p.location_id.slice(0, 16)}</Table.Cell>
                  <Table.Cell>{p.city ?? "—"}</Table.Cell>
                  <Table.Cell>{p.priority}</Table.Cell>
                  <Table.Cell>{p.is_fulfilment_enabled ? "نعم" : "لا"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "ملفّاتُ المستودعات" });

export default WarehouseProfilesPage;
