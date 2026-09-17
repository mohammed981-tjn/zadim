import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Button, Switch, Table, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Phase = "inactive" | "upcoming" | "live" | "ended";

type FlashSale = {
  id: string;
  promotion_code: string;
  starts_at: string;
  ends_at: string;
  quantity_limit: number | null;
  per_customer_limit: number | null;
  is_active: boolean;
  claimed: number;
  remaining: number | null;
  state: { phase: Phase };
};

/**
 * التخفيضاتُ الخاطفة.
 *
 * ── ولماذا شاشةٌ فوق لوحة Medusa ─────────────────────────────────
 *
 * الخصمُ نفسُه عرضٌ في المحرّك ويُضبط هناك. وما يُضبط هنا **ما لا
 * يملكه المحرّك**: نافذةٌ يحرسها الخادم، وسقفُ قطعٍ للعرض، وحدٌّ لكل
 * عميل. وثلاثتُها كانت تُكتب بـ`psql` أو لا تُكتب أبداً.
 *
 * ── والمتبقّي يُعرض لأنه السؤالُ الذي يُسأل ─────────────────────
 *
 * «كم بقي من المئة؟» سؤالُ من يدير حملةً كلَّ دقيقة. وهو **محسوبٌ من
 * الدفتر** لا عدّاداً مخزَّناً — فلا يكذب.
 *
 * ⚠️ **والوقتُ المعروضُ هنا للقراءة لا للحكم**: الحكمُ من ساعة القاعدة
 * عند الإتمام. وساعةُ متصفّحٍ متأخّرةٌ تُظهر عرضاً جارياً وهو منتهٍ —
 * فيُكتب ذلك في الشاشة كي لا يُبنى عليه قرار.
 */

const PHASE: Record<Phase, { label: string; color: "green" | "orange" | "grey" | "red" }> = {
  live: { label: "جارٍ الآن", color: "green" },
  upcoming: { label: "لم يبدأ", color: "orange" },
  ended: { label: "انتهى", color: "grey" },
  inactive: { label: "موقوف", color: "red" },
};

/** للعرض في حقل `datetime-local` — والقيمةُ تُرسل بـISO. */
const forInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const FlashSalesPage = () => {
  const [rows, setRows] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [perCustomer, setPerCustomer] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminGet<{ flash_sales: FlashSale[] }>("/admin/flash-sales");
      setRows(data.flash_sales ?? []);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await adminPost("/admin/flash-sales", {
        promotion_code: code.trim(),
        starts_at: from ? new Date(from).toISOString() : null,
        ends_at: to ? new Date(to).toISOString() : null,
        // فارغٌ يعني **بلا حدّ** لا صفراً: والصفرُ إطفاءٌ يُقال بالإيقاف.
        quantity_limit: qty === "" ? null : Number(qty),
        per_customer_limit: perCustomer === "" ? null : Number(perCustomer),
      });
      setCode("");
      setFrom("");
      setTo("");
      setQty("");
      setPerCustomer("");
      setNotice("أُنشئ التخفيضُ الخاطف.");
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: FlashSale) => {
    setError(null);
    setNotice(null);
    try {
      const res = await adminPost<{ warning_ar?: string | null }>(`/admin/flash-sales/${row.id}`, {
        is_active: !row.is_active,
      });
      if (res?.warning_ar) setNotice(res.warning_ar);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <Rtl>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">التخفيضاتُ الخاطفة</Heading>
          <Text className="text-ui-fg-subtle mt-1">
            نافذةٌ وسقفُ كمّيةٍ وحدٌّ لكل عميل — **فوق** عرضٍ قائمٍ في لوحة Medusa. والخصمُ نفسُه
            يُضبط هناك.
          </Text>
          <Text size="small" className="text-ui-fg-muted mt-2">
            ⚠️ الوقتُ المعروضُ هنا بساعة جهازك وهو للقراءة. والحكمُ عند الإتمام من ساعة الخادم.
          </Text>
        </div>

        {error && (
          <div className="px-6 py-3">
            <Text className="text-ui-fg-error">{error}</Text>
          </div>
        )}
        {notice && (
          <div className="px-6 py-3">
            <Text className="text-ui-fg-subtle">{notice}</Text>
          </div>
        )}

        <div className="px-6 py-4 grid gap-3 md:grid-cols-5">
          <div>
            <Label size="small">رمزُ العرض</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUMMER50" />
          </div>
          <div>
            <Label size="small">يبدأ</Label>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label size="small">ينتهي</Label>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label size="small">سقفُ القطع (فارغ = بلا سقف)</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Label size="small">حدُّ العميل (فارغ = بلا حدّ)</Label>
            <Input
              type="number"
              min={1}
              value={perCustomer}
              onChange={(e) => setPerCustomer(e.target.value)}
            />
          </div>
          <div className="md:col-span-5">
            <Button onClick={create} isLoading={saving} disabled={!code.trim() || !from || !to}>
              إنشاء
            </Button>
          </div>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <Text className="text-ui-fg-subtle">يُحمَّل…</Text>
          ) : rows.length === 0 ? (
            <Text className="text-ui-fg-subtle">
              لا تخفيضاتٍ خاطفة. وهذه حالةٌ صحيحةٌ لا عطل — أنشئ عرضاً في لوحة Medusa ثم اربطه هنا.
            </Text>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الرمز</Table.HeaderCell>
                  <Table.HeaderCell>الحالة</Table.HeaderCell>
                  <Table.HeaderCell>النافذة</Table.HeaderCell>
                  <Table.HeaderCell>المطالَب / السقف</Table.HeaderCell>
                  <Table.HeaderCell>حدُّ العميل</Table.HeaderCell>
                  <Table.HeaderCell> </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell>{r.promotion_code}</Table.Cell>
                    <Table.Cell>
                      <Badge color={PHASE[r.state.phase].color}>{PHASE[r.state.phase].label}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">{forInput(r.starts_at).replace("T", " ")}</Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        ← {forInput(r.ends_at).replace("T", " ")}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {r.quantity_limit == null ? (
                        <Text size="small">{r.claimed} · بلا سقف</Text>
                      ) : (
                        <Text size="small">
                          {r.claimed} / {r.quantity_limit}
                          {r.remaining !== null && r.remaining <= 0 ? " — نفد" : ` · بقي ${r.remaining}`}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>{r.per_customer_limit ?? "بلا حدّ"}</Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <Switch checked={r.is_active} onCheckedChange={() => void toggle(r)} />
                        <Text size="small" className="text-ui-fg-subtle">
                          {r.is_active ? "مفعَّل" : "موقوف"}
                        </Text>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "التخفيضات الخاطفة" });

export default FlashSalesPage;
