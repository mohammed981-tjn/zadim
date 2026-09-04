import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Input, Label, Button, Badge } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet } from "../../../lib/rtl";

type Log = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * سجلُّ التدقيق — **قراءةٌ فقط، ولا زرَّ يكتب فيه أو يمحو منه**.
 *
 * والمسارُ الخلفيُّ لا يملك `POST` ولا `DELETE` أصلاً: السجلُّ يُكتب من
 * طبقة الوسيط وحدها. وهذا ليس نقصاً في الشاشة بل هو معناها — دفترٌ
 * تستطيع اللوحةُ تعديلَه ليس دفترَ تدقيق، وأوّلُ من سيعدّله هو من
 * يريد إخفاءَ ما فعل.
 *
 * ── ولماذا مُرشِّحاتٌ لا قائمةٌ واحدةٌ طويلة ─────────────────────
 *
 * السجلُّ يُقرأ لسؤالٍ محدَّد: «من غيّر سعرَ هذا المنتج؟» أو «ماذا فعل
 * هذا المستخدم أمس؟». وقائمةٌ بلا مُرشِّحٍ تجعل الجوابَ تمريراً بالعين
 * في آلافِ الصفوف — أي أنها موجودةٌ ولا تُستعمل.
 */
const AuditPage = () => {
  const [rows, setRows] = useState<Log[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [entity, setEntity] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");

  const LIMIT = 50;

  const load = (nextOffset = offset) => {
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String(nextOffset) });
    if (entity) q.set("entity", entity);
    if (entityId) q.set("entity_id", entityId);
    if (actor) q.set("actor_id", actor);
    if (action) q.set("action", action);
    adminGet<{ audit_logs: Log[]; count: number }>(`/admin/access/audit?${q}`)
      .then((d) => {
        setRows(d.audit_logs);
        setCount(d.count);
      })
      .catch((e) => setError(String(e.message)));
  };

  useEffect(() => load(0), []);

  const search = () => {
    setOffset(0);
    load(0);
  };

  const page = (delta: number) => {
    const next = Math.max(0, offset + delta * LIMIT);
    setOffset(next);
    load(next);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">سجلّ التدقيق</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «قراءة التدقيق».</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">سجلّ التدقيق</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          يُلحَق ولا يُمسّ — لا هذه الشاشةُ ولا أيُّ مسارٍ في اللوحة يكتب
          فيه أو يمحو منه.
        </Text>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 16 }}>
          <div><Label size="small">الكيان</Label><Input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="order" /></div>
          <div><Label size="small">معرّفُ الكيان</Label><Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="order_…" /></div>
          <div><Label size="small">الفاعل</Label><Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="user_…" /></div>
          <div><Label size="small">الفعل</Label><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="update" /></div>
          <Button onClick={search}>بحث</Button>
        </div>

        <Text size="small" className="text-ui-fg-subtle" style={{ marginTop: 12 }}>
          {count} سطراً · يُعرض {offset + 1}–{Math.min(offset + LIMIT, count)}
        </Text>

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>الوقت</Table.HeaderCell>
              <Table.HeaderCell>الفاعل</Table.HeaderCell>
              <Table.HeaderCell>الفعل</Table.HeaderCell>
              <Table.HeaderCell>الكيان</Table.HeaderCell>
              <Table.HeaderCell>تفاصيل</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(rows ?? []).map((l) => (
              <Table.Row key={l.id}>
                <Table.Cell>{new Date(l.created_at).toLocaleString("ar-SA")}</Table.Cell>
                <Table.Cell>{l.actor_id ?? "—"}</Table.Cell>
                <Table.Cell><Badge size="2xsmall">{l.action}</Badge></Table.Cell>
                <Table.Cell>
                  {l.entity ?? "—"}
                  {l.entity_id && (
                    <Text size="small" className="text-ui-fg-subtle">{l.entity_id}</Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle" style={{ maxWidth: 380, wordBreak: "break-all" }}>
                    {l.metadata ? JSON.stringify(l.metadata) : "—"}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {rows?.length === 0 && (
          <Text className="text-ui-fg-subtle" style={{ marginTop: 12 }}>لا سطرَ يطابق البحث.</Text>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button variant="secondary" disabled={offset === 0} onClick={() => page(-1)}>السابق</Button>
          <Button variant="secondary" disabled={offset + LIMIT >= count} onClick={() => page(1)}>التالي</Button>
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "سجلّ التدقيق" });

export default AuditPage;
