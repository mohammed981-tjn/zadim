import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Button, Table } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet } from "../../../lib/rtl";

type Movement = {
  id: string;
  inventory_item_id: string;
  location_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  actor_id: string | null;
  created_at: string;
};

const REASON_AR: Record<string, string> = {
  receipt: "استلامُ شراء",
  adjustment: "تسوية",
  stocktake: "جرد",
  fulfilment: "تنفيذُ طلب",
  return: "مرتجَع",
  transfer_in: "تحويلٌ وارد",
  transfer_out: "تحويلٌ صادر",
  damage: "تلف",
  correction: "تصحيح",
};

/**
 * دفترُ حركات المخزون — **قراءةٌ فقط**.
 *
 * يكتبه مُطلِقٌ في القاعدة عند كلّ تغيّرٍ في `stocked_quantity`، ولا
 * مسارَ كتابةٍ له من هنا بحال — فالسجلُّ الذي يُحتكم إليه في «من أين
 * نقصت هذه الثلاثون» لا يُملى بيدٍ.
 */
const MovementsPage = () => {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [itemFilter, setItemFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");

  const load = () => {
    const params = new URLSearchParams({ limit: "100" });
    if (itemFilter.trim()) params.set("inventory_item_id", itemFilter.trim());
    if (locFilter.trim()) params.set("location_id", locFilter.trim());
    adminGet<{ movements: Movement[]; count: number }>(`/admin/warehouse/movements?${params}`)
      .then((d) => {
        setRows(d.movements);
        setCount(d.count);
      })
      .catch((e) => setError(String(e.message)));
  };

  useEffect(load, []);

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">دفترُ حركات المخزون</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">دفترُ حركات المخزون</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          كلُّ تغيّرٍ في الرصيد بسببه ومرجعه — يُلحَق ولا يُعدَّل ولا يُحذف.
        </Text>

        <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 16, maxWidth: 560 }}>
          <div style={{ flex: 1 }}>
            <Label htmlFor="itemf">معرّفُ الصنف</Label>
            <Input id="itemf" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="iitem_..." />
          </div>
          <div style={{ flex: 1 }}>
            <Label htmlFor="locf">معرّفُ الموقع</Label>
            <Input id="locf" value={locFilter} onChange={(e) => setLocFilter(e.target.value)} placeholder="sloc_..." />
          </div>
          <Button variant="secondary" onClick={load}>
            تصفية
          </Button>
        </div>

        {!rows && <Text className="text-ui-fg-subtle" style={{ marginTop: 16 }}>جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle" style={{ marginTop: 16 }}>لا حركاتٍ بهذه التصفية.</Text>}
        {rows && rows.length > 0 && (
          <>
            <Text size="small" className="text-ui-fg-subtle" style={{ marginTop: 16 }}>
              {count} حركةً — أحدثُ ١٠٠ معروضة.
            </Text>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الصنف</Table.HeaderCell>
                  <Table.HeaderCell>الموقع</Table.HeaderCell>
                  <Table.HeaderCell>الفرق</Table.HeaderCell>
                  <Table.HeaderCell>الرصيدُ بعده</Table.HeaderCell>
                  <Table.HeaderCell>السبب</Table.HeaderCell>
                  <Table.HeaderCell>المرجع</Table.HeaderCell>
                  <Table.HeaderCell>الوقت</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((m) => (
                  <Table.Row key={m.id}>
                    <Table.Cell>
                      <code style={{ fontSize: 12 }}>{m.inventory_item_id.slice(0, 12)}…</code>
                    </Table.Cell>
                    <Table.Cell>
                      <code style={{ fontSize: 12 }}>{m.location_id.slice(0, 12)}…</code>
                    </Table.Cell>
                    <Table.Cell className={m.delta < 0 ? "text-ui-fg-error" : "text-ui-fg-subtle"}>
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </Table.Cell>
                    <Table.Cell>{m.balance_after}</Table.Cell>
                    <Table.Cell>{REASON_AR[m.reason] ?? m.reason}</Table.Cell>
                    <Table.Cell>
                      {m.reference_type ? `${m.reference_type} · ${m.reference_id?.slice(0, 10)}…` : "—"}
                    </Table.Cell>
                    <Table.Cell>{new Date(m.created_at).toLocaleString("ar-SA")}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "دفترُ حركات المخزون" });

export default MovementsPage;
