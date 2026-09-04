import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, riyals } from "../../lib/rtl";

type Metrics = {
  computed_at: string;
  orders: { total: number; by_status: Record<string, number>; gmv_halalas: number };
  inventory: { stocked: number; reserved: number; available: number; low_stock: number; alert_rules: number };
  fulfilment: { pick_lists: number; by_state: Record<string, number> };
  events: { pending: number };
  invoices: { count: number; chain_ok: boolean };
  bulk: { total: number; by_status: Record<string, number> };
  business: {
    gmv_halalas: number;
    net_sales_halalas: number;
    orders_count: number;
    aov_halalas: number | null;
    returns_count: number;
    refunded_halalas: number;
    canceled_count: number;
    cancel_rate_bp: number;
    customers_count: number;
    guest_orders: number;
    repeat_customers: number;
    discount_halalas: number;
    tax_halalas: number;
    shipping_halalas: number;
    items_net_halalas: number;
    inventory_value_halalas: number;
    inventory_costed_items: number;
    inventory_total_items: number;
    contribution_margin_halalas: number;
    margin_covered_lines: number;
    margin_total_lines: number;
  };
};

/**
 * لوحةُ زادم.
 *
 * وكلُّ رقمٍ هنا يأتي من `/admin/dashboard/metrics` **محسوباً عند
 * الطلب**، وبوّابةُ المرحلة ٨ تُعيد حسابَه بـSQL خام وتقارن. فما تراه
 * هذه الشاشةُ هو ما في القاعدة، لا عدّادٌ يتأخّر.
 */
const Cell = ({ label, value, tone }: { label: string; value: string; tone?: "danger" | "ok" }) => (
  <div style={{ padding: "12px 16px", minWidth: 160 }}>
    <Text size="small" className="text-ui-fg-subtle">{label}</Text>
    <Heading level="h2" className={tone === "danger" ? "text-ui-fg-error" : undefined}>
      {value}
    </Heading>
  </div>
);

const ZadimDashboard = () => {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGet<Metrics>("/admin/dashboard/metrics").then(setData).catch((e) => setError(String(e.message)));
  }, []);

  // ثلاثُ حالاتٍ لا واحدة: تحميلٌ وفشلٌ وفراغ. وشاشةٌ تعرض دوّامةً
  // أبديةً عند الفشل هي أسوأُ ما في اللوحات (البوّابة العامّة).
  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">لوحة زادم</Heading>
          <Text className="text-ui-fg-error">
            تعذّر جلبُ الأرقام ({error}). تحقّق من صلاحية «تقارير المبيعات».
          </Text>
        </Container>
      </Rtl>
    );
  }

  if (!data) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">لوحة زادم</Heading>
          <Text className="text-ui-fg-subtle">جارٍ الحساب…</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">لوحة زادم</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          محسوبةٌ عند الطلب — {new Date(data.computed_at).toLocaleString("ar-SA")}
        </Text>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          <Cell label="الطلبات" value={String(data.orders.total)} />
          {/*
            🔴 «إجمالي المبيعات» لا «الإيراد» — والتسميةُ هي التصحيح.
            الرقمُ يشمل الضريبةَ والشحنَ وما سيُرتجَع، فهو أكبرُ من
            الإيراد بنحو الخُمس. وقارئُه «إيراداً» يقرّر على رقمٍ لا
            يعنيه، ولا شيءَ في الشاشة كان يقول له ذلك.
          */}
          <Cell label="إجمالي المبيعات GMV (ر.س)" value={riyals(data.orders.gmv_halalas)} />
          <Cell label="المتاح في المخزون" value={String(data.inventory.available)} />
          <Cell
            label="أصنافٌ بلغت حدَّ التنبيه"
            value={String(data.inventory.low_stock)}
            tone={data.inventory.low_stock > 0 ? "danger" : undefined}
          />
          <Cell
            label="أحداثٌ لم تُسلَّم"
            value={String(data.events.pending)}
            tone={data.events.pending > 0 ? "danger" : undefined}
          />
          <Cell label="قوائمُ اللقط" value={String(data.fulfilment.pick_lists)} />
        </div>

        {/*
          ── أرقامُ العمل — ولكلٍّ تعريفٌ في docs/business-rules.md ──

          ⚠️ **والتعريفُ الموجزُ يسافر مع الرقم على الشاشة نفسِها**، لا
          في وثيقةٍ يقرؤها من يبحث عنها. فمن يقرأ «صافي المبيعات»
          ويظنّه ربحاً لن يفتح ملفَّ توثيق ليكتشف خطأه.
        */}
        <Heading level="h2" style={{ marginTop: 24 }}>أرقامُ العمل</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          GMV ليس إيراداً · وصافي المبيعات ليس ربحاً · وهامشُ المساهمة ليس
          صافيَ الربح (لا رواتبَ ولا إيجار). والتعريفاتُ في
          docs/business-rules.md
        </Text>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <Cell
            label="صافي المبيعات (بعد المستردّ)"
            value={riyals(data.business.net_sales_halalas)}
          />
          <Cell
            label="متوسّط قيمة الطلب"
            value={
              data.business.aov_halalas === null
                ? "—"
                : riyals(data.business.aov_halalas)
            }
          />
          <Cell label="مبيعاتُ الأصناف (قبل الضريبة)" value={riyals(data.business.items_net_halalas)} />
          <Cell label="الضريبة (مالُ الدولة)" value={riyals(data.business.tax_halalas)} />
          <Cell label="الشحن (بضريبته)" value={riyals(data.business.shipping_halalas)} />
          <Cell label="الخصومات" value={riyals(data.business.discount_halalas)} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <Cell label="العملاء (بلا الضيوف)" value={String(data.business.customers_count)} />
          <Cell label="طلباتُ الضيوف" value={String(data.business.guest_orders)} />
          <Cell label="المتكرّرون (طلبان فأكثر)" value={String(data.business.repeat_customers)} />
          <Cell label="طلباتُ الإرجاع" value={String(data.business.returns_count)} />
          <Cell label="المستردُّ فعلاً" value={riyals(data.business.refunded_halalas)} />
          <Cell
            label="نسبةُ الإلغاء"
            value={`${(data.business.cancel_rate_bp / 100).toFixed(2)}٪`}
            tone={data.business.cancel_rate_bp > 1000 ? "danger" : undefined}
          />
        </div>

        {/*
          🔴 **ولا رقمَ تكلفةٍ بلا تغطيته على الشاشة نفسِها.**

          صنفٌ بلا تكلفةٍ مسجَّلةٍ لو عُدَّت تكلفتُه صفراً لصار ربحاً
          كاملاً — فيرتفع الهامشُ كلَّما ساء التسجيل، وهو أسوأُ اتّجاهٍ
          يمكن أن يحمله رقم. فيُستثنى، **ويُقال كم استُثني**.
        */}
        <Heading level="h2" style={{ marginTop: 24 }}>التكلفةُ والهامش</Heading>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <Cell
            label="قيمةُ المخزون"
            value={riyals(data.business.inventory_value_halalas)}
          />
          <Cell
            label="هامشُ المساهمة"
            value={riyals(data.business.contribution_margin_halalas)}
          />
        </div>
        <Text
          size="small"
          className={
            data.business.margin_covered_lines < data.business.margin_total_lines
              ? "text-ui-fg-error"
              : "text-ui-fg-subtle"
          }
          style={{ marginTop: 8 }}
        >
          {`الهامشُ محسوبٌ على ${data.business.margin_covered_lines} سطراً من ${data.business.margin_total_lines}` +
            ` · وقيمةُ المخزون على ${data.business.inventory_costed_items} صنفاً من ${data.business.inventory_total_items}` +
            (data.business.margin_covered_lines < data.business.margin_total_lines
              ? " — والباقي بلا تكلفةٍ مسجَّلة، فخرج من الحساب ولم يُحسب بصفر."
              : " — التغطيةُ كاملة.")}
        </Text>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(data.orders.by_status).map(([k, v]) => (
            <Badge key={k}>{`${k}: ${v}`}</Badge>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <Text size="small">
            الفواتير الصادرة: {data.invoices.count} —{" "}
            {data.invoices.chain_ok ? "السلسلةُ متّصلة ✅" : "🔴 السلسلةُ منقطعة"}
          </Text>
          {data.inventory.alert_rules === 0 && (
            <Text size="small" className="text-ui-fg-subtle">
              لا قاعدةَ تنبيهٍ نشطة — لا حدَّ يُقاس عليه، فلا تنبيهات.
            </Text>
          )}
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "لوحة زادم", icon: ChartBar });

export default ZadimDashboard;
