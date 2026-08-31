import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, riyals } from "../../../lib/rtl";

type Invoice = {
  id: string;
  sequence: number;
  order_id: string;
  issued_at: string;
  total: number;
  vat_total: number;
  status: string;
};

/**
 * الفواتيرُ الإلكترونية — **وحالُ السلسلة في أعلى الشاشة**.
 *
 * فالسلسلةُ إمّا متّصلةٌ أو منقطعة، ولا حالَ ثالثة. وانقطاعُها يعني
 * فجوةً تُفسَّر للهيئة — **ولا يُترك خبرٌ كهذا في تقريرٍ يُفتح شهرياً**.
 */
const InvoicesPage = () => {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; count: number; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGet<{ invoices: Invoice[] }>("/admin/zatca/invoices?limit=50")
      .then((d) => setRows(d.invoices))
      .catch((e) => setError(String(e.message)));
    adminGet<{ chain: any }>("/admin/zatca/invoices?verify=true")
      .then((d) => setChain(d.chain))
      .catch(() => undefined);
  }, []);

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">الفواتير</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الفواتيرُ الإلكترونية</Heading>

        {chain && (
          <Text className={chain.ok ? undefined : "text-ui-fg-error"}>
            {chain.ok
              ? `السلسلةُ متّصلةٌ عبر ${chain.count} فاتورة ✅`
              : `🔴 السلسلةُ منقطعةٌ عند ${(chain as any).broken_at}: ${chain.reason}`}
          </Text>
        )}

        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && (
          <Text className="text-ui-fg-subtle">
            لا فواتيرَ بعد — تُصدَر بعد ضبط إعدادات الفوترة.
          </Text>
        )}

        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>التسلسل</Table.HeaderCell>
                <Table.HeaderCell>الطلب</Table.HeaderCell>
                <Table.HeaderCell>الإجمالي</Table.HeaderCell>
                <Table.HeaderCell>الضريبة</Table.HeaderCell>
                <Table.HeaderCell>الحال</Table.HeaderCell>
                <Table.HeaderCell>التاريخ</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>{r.sequence}</Table.Cell>
                  <Table.Cell>{r.order_id.slice(0, 16)}…</Table.Cell>
                  <Table.Cell>{riyals(r.total)}</Table.Cell>
                  <Table.Cell>{riyals(r.vat_total)}</Table.Cell>
                  <Table.Cell>
                    <Badge color={r.status === "issued" ? "orange" : "green"}>{r.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>{new Date(r.issued_at).toLocaleString("ar-SA")}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الفواتير" });

export default InvoicesPage;
