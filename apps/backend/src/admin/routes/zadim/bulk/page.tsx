import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Operation = {
  id: string;
  kind: string;
  entity_type: string;
  status: string;
  item_count: number;
  applied_count: number;
  reverted_count: number;
  skipped_count: number;
  created_at: string;
};

/**
 * سجلُّ الدفعات — **وزرُّ التراجع بجانب كل واحدة**.
 *
 * والتراجعُ يُعلن نتيجتَه كاملةً: كم أُعيد **وكم تُخطّي**. ودفعةٌ تقول
 * «تمّ التراجع» وقد تخطّت ثلاثين صنفاً تغيّرت بعدها تُوهم المديرَ أن
 * كلَّ شيءٍ عاد — وهو ما لم يقع.
 */
const BulkPage = () => {
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    adminGet<{ operations: Operation[] }>("/admin/bulk?limit=50")
      .then((d) => setOps(d.operations))
      .catch((e) => setError(String(e.message)));

  useEffect(() => {
    load();
  }, []);

  const revert = async (id: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const r = await adminPost<any>(`/admin/bulk/${id}/revert`);
      setMessage(`✅ ${r.message_ar}`);
    } catch (e: any) {
      setMessage(`🔴 ${e.message}`);
    }
    setBusy(null);
    load();
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">الدفعات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الدفعات</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          القيمُ القديمة محفوظةٌ قبل الكتابة — والتراجعُ لا يمحو تعديلاً وقع بعد الدفعة.
        </Text>

        {!ops && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {ops && ops.length === 0 && <Text className="text-ui-fg-subtle">لا دفعاتٍ بعد.</Text>}

        {ops && ops.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>النوع</Table.HeaderCell>
                <Table.HeaderCell>الأصناف</Table.HeaderCell>
                <Table.HeaderCell>الحال</Table.HeaderCell>
                <Table.HeaderCell>أُعيد / تُخطّي</Table.HeaderCell>
                <Table.HeaderCell>التاريخ</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {ops.map((o) => (
                <Table.Row key={o.id}>
                  <Table.Cell>{o.kind}</Table.Cell>
                  <Table.Cell>{o.item_count}</Table.Cell>
                  <Table.Cell>
                    <Badge color={o.status === "applied" ? "orange" : o.status === "reverted" ? "grey" : "green"}>
                      {o.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {o.status === "reverted" ? `${o.reverted_count} / ${o.skipped_count}` : "—"}
                  </Table.Cell>
                  <Table.Cell>{new Date(o.created_at).toLocaleString("ar-SA")}</Table.Cell>
                  <Table.Cell>
                    {o.status === "applied" && (
                      <Button
                        size="small"
                        variant="danger"
                        disabled={busy === o.id}
                        onClick={() => revert(o.id)}
                      >
                        {busy === o.id ? "…" : "تراجَع"}
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {message && <Text style={{ marginTop: 12 }}>{message}</Text>}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الدفعات" });

export default BulkPage;
