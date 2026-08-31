import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type PickList = {
  id: string;
  order_id: string | null;
  location_id: string;
  state: string;
  blocked_reason: string | null;
};

const TONE: Record<string, "green" | "orange" | "red" | "grey"> = {
  picked: "green",
  picking: "orange",
  blocked: "red",
  pending: "grey",
  cancelled: "grey",
};

/**
 * شاشةُ اللقط.
 *
 * ── ولماذا سببُ التوقّف بارزٌ لا مخفيّ ─────────────────────────
 *
 * الملقّطُ يقف أمام رفٍّ وبيده صنف. فحين تتوقّف القائمةُ يجب أن يقرأ
 * **لماذا** في اللحظة نفسِها — لا أن يفتح تفاصيلَ ولا يسأل أحداً.
 * وشاشةٌ تقول «متوقّفة» بلا سببٍ تُنتج مكالمةً هاتفية لكل خطأِ مسح.
 */
const PickingPage = () => {
  const [lists, setLists] = useState<PickList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    adminGet<{ pick_lists: PickList[] }>("/admin/fulfilment/pick-lists?limit=50")
      .then((d) => setLists(d.pick_lists))
      .catch((e) => setError(String(e.message)));

  useEffect(() => {
    load();
  }, []);

  const scan = async (id: string) => {
    setMessage(null);
    try {
      const r = await adminPost<any>(`/admin/fulfilment/pick-lists/${id}/scan`, { barcode });
      setMessage(`✅ ${r.title}: ${r.picked_quantity}/${r.quantity}`);
    } catch (e: any) {
      setMessage(`🔴 ${e.message}`);
    }
    setBarcode("");
    load();
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">اللقط</Heading>
          <Text className="text-ui-fg-error">
            تعذّر الجلب ({error}). تحقّق من صلاحية «اللقط».
          </Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">قوائمُ اللقط</Heading>

        {!lists && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {lists && lists.length === 0 && (
          <Text className="text-ui-fg-subtle">لا قوائمَ الآن.</Text>
        )}

        {lists && lists.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>القائمة</Table.HeaderCell>
                <Table.HeaderCell>الطلب</Table.HeaderCell>
                <Table.HeaderCell>الحال</Table.HeaderCell>
                <Table.HeaderCell>سببُ التوقّف</Table.HeaderCell>
                <Table.HeaderCell>مسح</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {lists.map((l) => (
                <Table.Row key={l.id}>
                  <Table.Cell>{l.id.slice(0, 14)}…</Table.Cell>
                  <Table.Cell>{l.order_id ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={TONE[l.state] ?? "grey"}>{l.state}</Badge>
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-error">{l.blocked_reason ?? ""}</Table.Cell>
                  <Table.Cell>
                    {l.state === "picking" ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <Input
                          size="small"
                          placeholder="امسح الباركود"
                          value={target === l.id ? barcode : ""}
                          onFocus={() => setTarget(l.id)}
                          onChange={(e) => setBarcode(e.target.value)}
                        />
                        <Button size="small" onClick={() => scan(l.id)}>
                          مسح
                        </Button>
                      </div>
                    ) : (
                      <Text size="small" className="text-ui-fg-subtle">
                        {l.state === "blocked" ? "راجع الرفّ ثم استأنف" : "—"}
                      </Text>
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

export const config = defineRouteConfig({ label: "اللقط" });

export default PickingPage;
