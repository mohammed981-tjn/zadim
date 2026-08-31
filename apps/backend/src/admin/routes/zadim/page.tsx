import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, riyals } from "../../lib/rtl";

type Metrics = {
  computed_at: string;
  orders: { total: number; by_status: Record<string, number>; revenue_halalas: number };
  inventory: { stocked: number; reserved: number; available: number; low_stock: number; alert_rules: number };
  fulfilment: { pick_lists: number; by_state: Record<string, number> };
  events: { pending: number };
  invoices: { count: number; chain_ok: boolean };
  bulk: { total: number; by_status: Record<string, number> };
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
          <Cell label="الإيراد (ر.س)" value={riyals(data.orders.revenue_halalas)} />
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
