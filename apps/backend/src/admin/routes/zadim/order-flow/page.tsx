import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Switch, Label } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet } from "../../../lib/rtl";

type OutboxEvent = {
  id: string;
  aggregate_id: string;
  event: string;
  occurred_at: string;
  delivered_at: string | null;
  payload: Record<string, unknown> | null;
};

type Transitions = {
  statuses: string[];
  terminal: string[];
  by_status: Record<string, string[]>;
};

/**
 * آلةُ حالات الطلب وصندوقُ الأحداث.
 *
 * ── لماذا الاثنان في شاشةٍ واحدة ──────────────────────────────────
 *
 * لأن السؤالَ الذي يُفتحان لأجله واحد: **«لماذا لم يصل هذا الإشعار؟»**
 * وجوابُه إمّا أن الحالةَ لم تنتقل (فلا حدثَ أصلاً)، وإمّا أنها انتقلت
 * والحدثُ في الصندوق لم يُسلَّم. وشاشتان تجعلان المشخِّصَ يقفز بينهما.
 *
 * ── والانتقالاتُ تُقرأ ولا تُكتب ──────────────────────────────────
 *
 * جدولُ الانتقالات **آلةُ الحالات نفسُها**، لا قرارُ تاجر. وتغييرُه
 * تغييرٌ في المنطق يمرّ بهجرةٍ تُراجَع — والمسارُ الخلفيُّ لا يملك
 * `POST` أصلاً. وهذا الفرقُ عن سياسة الإرجاع مقصودٌ ومكتوبٌ في
 * مسارَيهما.
 */
const OrderFlowPage = () => {
  const [events, setEvents] = useState<OutboxEvent[] | null>(null);
  const [count, setCount] = useState(0);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [rules, setRules] = useState<Transitions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (pending = pendingOnly) => {
    const q = pending ? "?pending=true&limit=100" : "?limit=100";
    adminGet<{ events: OutboxEvent[]; count: number }>(`/admin/order-flow/outbox${q}`)
      .then((d) => {
        setEvents(d.events);
        setCount(d.count);
      })
      .catch((e) => setError(String(e.message)));
  };

  useEffect(() => {
    load(pendingOnly);
  }, [pendingOnly]);

  useEffect(() => {
    adminGet<Transitions>("/admin/order-flow/transitions").then(setRules).catch(() => setRules(null));
  }, []);

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">مسارُ الطلب</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «قراءة الطلبات».</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">مسارُ الطلب — الحالاتُ وصندوقُ الأحداث</Heading>

        <Heading level="h2" style={{ marginTop: 24 }}>صندوقُ الأحداث</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          حدثٌ **لم يُسلَّم** يعني أن ما يتبعه لم يقع: لا إشعارَ ولا تحديثَ
          مخزونٍ ولا فاتورة. فالقائمةُ الفارغةُ هنا هي الحالُ السليمة.
        </Text>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <Switch checked={pendingOnly} onCheckedChange={setPendingOnly} id="pending-only" />
          <Label htmlFor="pending-only">ما لم يُسلَّم فقط</Label>
          <Button variant="secondary" size="small" onClick={() => load()}>تحديث</Button>
          <Text size="small" className="text-ui-fg-subtle">{count} حدثاً</Text>
        </div>

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>الحدث</Table.HeaderCell>
              <Table.HeaderCell>الطلب</Table.HeaderCell>
              <Table.HeaderCell>وقعَ</Table.HeaderCell>
              <Table.HeaderCell>سُلّم</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(events ?? []).map((e) => (
              <Table.Row key={e.id}>
                <Table.Cell><Badge size="2xsmall">{e.event}</Badge></Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">{e.aggregate_id}</Text>
                </Table.Cell>
                <Table.Cell>{new Date(e.occurred_at).toLocaleString("ar-SA")}</Table.Cell>
                <Table.Cell>
                  {e.delivered_at ? (
                    new Date(e.delivered_at).toLocaleString("ar-SA")
                  ) : (
                    <Badge color="red">لم يُسلَّم</Badge>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {events?.length === 0 && (
          <Text className="text-ui-fg-subtle" style={{ marginTop: 8 }}>
            {pendingOnly ? "لا حدثَ معلَّقاً — الصندوقُ مصرَّفٌ بالكامل." : "لا حدثَ في الصندوق."}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>الانتقالاتُ المسموحة</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          تُقرأ ولا تُكتب — هذه آلةُ الحالات نفسُها، وتغييرُها يمرّ بهجرةٍ
          تُراجَع لا بنداءٍ من لوحة.
        </Text>
        {rules && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>من</Table.HeaderCell>
                <Table.HeaderCell>إلى</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rules.statuses.map((s) => (
                <Table.Row key={s}>
                  <Table.Cell>
                    {s}
                    {rules.terminal.includes(s) && <Badge size="2xsmall" style={{ marginRight: 6 }}>نهائيّة</Badge>}
                  </Table.Cell>
                  <Table.Cell>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(rules.by_status[s] ?? []).length === 0 ? (
                        <Text size="small" className="text-ui-fg-subtle">— لا مخرجَ منها</Text>
                      ) : (
                        (rules.by_status[s] ?? []).map((t) => <Badge key={t} size="2xsmall">{t}</Badge>)
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "مسارُ الطلب" });

export default OrderFlowPage;
