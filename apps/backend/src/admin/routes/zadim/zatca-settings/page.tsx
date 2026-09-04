import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Select, Switch, Button, Badge, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Settings = {
  id: string;
  seller_name: string;
  vat_number: string;
  address_street: string | null;
  address_district: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_building_number: string | null;
  commercial_registration: string | null;
  phase: "phase_1" | "phase_2";
  provider_id: string | null;
  is_enabled: boolean;
};

type Form = {
  seller_name: string;
  vat_number: string;
  address_street: string;
  address_district: string;
  address_city: string;
  address_postal_code: string;
  address_building_number: string;
  commercial_registration: string;
  phase: "phase_1" | "phase_2";
  is_enabled: boolean;
};

const EMPTY: Form = {
  seller_name: "",
  vat_number: "",
  address_street: "",
  address_district: "",
  address_city: "",
  address_postal_code: "",
  address_building_number: "",
  commercial_registration: "",
  phase: "phase_1",
  is_enabled: false,
};

/**
 * إعداداتُ الفوترة الإلكترونية — **أعجلُ ما ينتظر المالك**.
 *
 * ── ولماذا أعجل ──────────────────────────────────────────────────
 *
 * بدونها يبيع المتجرُ **بلا فاتورة**، **والفائتُ لا يدخل السلسلةَ
 * بأثرٍ رجعيّ أبداً** — بخلاف كلّ فجوةٍ أخرى في هذا المستودع. فكلُّ
 * يومٍ تبقى فيه هذه الشاشةُ فارغةً يومٌ لا يمكن تعويضُه لاحقاً.
 *
 * والحالُ في أعلى الشاشة **صريحةٌ لا مخمَّنة**: `not_configured` تعني
 * أن المتجر يبيع الآن بلا فاتورة، لا أن الإعداد اختياريّ.
 */
const ZatcaSettingsPage = () => {
  const [state, setState] = useState<"configured" | "not_configured" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminGet<{ settings: Settings | null; state: "configured" | "not_configured" }>(
      "/admin/zatca/settings"
    )
      .then((d) => {
        setState(d.state);
        if (d.settings) {
          setForm({
            seller_name: d.settings.seller_name,
            vat_number: d.settings.vat_number,
            address_street: d.settings.address_street ?? "",
            address_district: d.settings.address_district ?? "",
            address_city: d.settings.address_city ?? "",
            address_postal_code: d.settings.address_postal_code ?? "",
            address_building_number: d.settings.address_building_number ?? "",
            commercial_registration: d.settings.commercial_registration ?? "",
            phase: d.settings.phase,
            is_enabled: d.settings.is_enabled,
          });
        }
      })
      .catch((e) => setError(String(e.message)));
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost<{ settings: Settings }>("/admin/zatca/settings", {
        ...form,
        address_street: form.address_street || null,
        address_district: form.address_district || null,
        address_city: form.address_city || null,
        address_postal_code: form.address_postal_code || null,
        address_building_number: form.address_building_number || null,
        commercial_registration: form.commercial_registration || null,
      });
      setState(form.is_enabled ? "configured" : "not_configured");
      setMessage({ ok: true, text: "حُفظت الإعدادات." });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">إعداداتُ الفوترة</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Heading level="h1">إعداداتُ الفوترة الإلكترونية (ZATCA)</Heading>
          {state && (
            <Badge color={state === "configured" ? "green" : "red"}>
              {state === "configured" ? "مضبوطة" : "🔴 غيرُ مضبوطة"}
            </Badge>
          )}
        </div>

        {state === "not_configured" && (
          <Text className="text-ui-fg-error" size="small">
            المتجرُ يبيع الآن **بلا فاتورة**. وما لم يُصدَر خلال غياب الإعداد لا يدخل
            السلسلةَ بأثرٍ رجعيّ أبداً — فكلُّ يومٍ هنا لا يُعوَّض لاحقاً.
          </Text>
        )}

        <div style={{ display: "grid", gap: 16, maxWidth: 560, marginTop: 20 }}>
          <div>
            <Label htmlFor="seller_name">اسمُ البائع *</Label>
            <Input
              id="seller_name"
              value={form.seller_name}
              onChange={(e) => set("seller_name", e.target.value)}
              placeholder="الاسمُ التجاريّ كما في السجلّ"
            />
          </div>

          <div>
            <Label htmlFor="vat_number">الرقمُ الضريبيّ (VAT) *</Label>
            <Input
              id="vat_number"
              value={form.vat_number}
              onChange={(e) => set("vat_number", e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="١٥ رقماً"
              maxLength={15}
            />
            {form.vat_number && form.vat_number.length !== 15 && (
              <Text size="small" className="text-ui-fg-error">
                الرقمُ الضريبيّ خمسةَ عشرَ رقماً بالضبط ({form.vat_number.length} الآن).
              </Text>
            )}
          </div>

          <div>
            <Label htmlFor="cr">السجلُّ التجاريّ</Label>
            <Input
              id="cr"
              value={form.commercial_registration}
              onChange={(e) => set("commercial_registration", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="city">المدينة</Label>
              <Input id="city" value={form.address_city} onChange={(e) => set("address_city", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="district">الحيّ</Label>
              <Input id="district" value={form.address_district} onChange={(e) => set("address_district", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="street">الشارع</Label>
              <Input id="street" value={form.address_street} onChange={(e) => set("address_street", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="building">رقمُ المبنى</Label>
              <Input id="building" value={form.address_building_number} onChange={(e) => set("address_building_number", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="postal">الرمزُ البريديّ</Label>
              <Input id="postal" value={form.address_postal_code} onChange={(e) => set("address_postal_code", e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="phase">المرحلة</Label>
            <Select value={form.phase} onValueChange={(v) => set("phase", v as Form["phase"])}>
              <Select.Trigger id="phase">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="phase_1">المرحلةُ الأولى — فاتورةٌ ضريبيةٌ عادية</Select.Item>
                <Select.Item value="phase_2">المرحلةُ الثانية — الربطُ المباشر بالهيئة</Select.Item>
              </Select.Content>
            </Select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch
              id="enabled"
              checked={form.is_enabled}
              onCheckedChange={(v) => set("is_enabled", Boolean(v))}
            />
            <Label htmlFor="enabled">تفعيلُ إصدار الفواتير</Label>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            حفظُ البياناتِ لا يعني التفعيل — والمفتاحان منفصلان عمداً: قد تُدخل
            البياناتِ استعداداً ثمّ تُفعّل لاحقاً بعد التحقّق منها.
          </Text>

          <div>
            <Button onClick={save} disabled={busy || !form.seller_name || form.vat_number.length !== 15}>
              {busy ? "جارٍ الحفظ…" : "حفظُ الإعدادات"}
            </Button>
          </div>

          {message && (
            <Text className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
              {message.ok ? "✅ " : "🔴 "}
              {message.text}
            </Text>
          )}
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "إعداداتُ الفوترة (ZATCA)" });

export default ZatcaSettingsPage;
