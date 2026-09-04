import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input, Label, Select } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Review = {
  id: string;
  product_id: string;
  customer_id: string;
  rating: number;
  body: string | null;
  status: "pending" | "published" | "rejected";
  moderation_note: string | null;
  created_at: string;
};

/**
 * مراجعةُ التقييمات (بند ٢٣).
 *
 * ── لماذا هذه الشاشةُ أعجلُ ممّا تبدو ──────────────────────────────
 *
 * التقييمُ يبدأ `pending` بقصد — صفحةُ منتجٍ تُفهرَس ونصٌّ يكتبه
 * الجمهور. **فبلا مراجعةٍ لا يُنشر شيءٌ أبداً**: يكتب العملاءُ ولا يرى
 * أحدٌ تقييماً واحداً، ولا شيءَ يشكو ولا خطأَ في سجلّ.
 *
 * وسببُ الرفض إلزاميٌّ في الشاشة وإن قبله الخادمُ فارغاً: «رُفض» بلا
 * سبب تجعل الدعمَ يخمّن حين يسأل صاحبُه، والمراجعَ التالي يعيد الحكمَ
 * من الصفر.
 */
const ReviewsPage = () => {
  const [rows, setRows] = useState<Review[] | null>(null);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = (s = status) =>
    adminGet<{ reviews: Review[]; count: number }>(`/admin/reviews?status=${s}&limit=100`)
      .then((d) => {
        setRows(d.reviews);
        setCount(d.count);
      })
      .catch((e) => setError(String(e.message)));

  useEffect(() => {
    load(status);
  }, [status]);

  const judge = async (r: Review, next: "published" | "rejected") => {
    if (next === "rejected" && !(notes[r.id] ?? "").trim()) {
      setMessage({ ok: false, text: "الرفضُ يحتاج سبباً — صاحبُه سيسأل عنه." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await adminPost(`/admin/reviews/${r.id}`, {
        status: next,
        moderation_note: notes[r.id] ?? null,
      });
      setMessage({ ok: true, text: next === "published" ? "نُشر التقييم." : "رُفض التقييم." });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">التقييمات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «إدارة المحتوى».</Text>
        </Container>
      </Rtl>
    );
  }

  const tone = (s: Review["status"]) =>
    s === "published" ? "green" : s === "rejected" ? "red" : "orange";

  return (
    <Rtl>
      <Container>
        <Heading level="h1">التقييمات</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          التقييمُ لا يظهر على صفحة المنتج حتى يُنشر هنا — فالمعلَّقُ
          مكتوبٌ ولا يراه أحد.
        </Text>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 16 }}>
          <div style={{ minWidth: 200 }}>
            <Label size="small">الحالة</Label>
            <Select value={status} onValueChange={setStatus}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>
                <Select.Item value="pending">تنتظر المراجعة</Select.Item>
                <Select.Item value="published">منشورة</Select.Item>
                <Select.Item value="rejected">مرفوضة</Select.Item>
                <Select.Item value="all">الكلّ</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <Text size="small" className="text-ui-fg-subtle">{count} تقييماً</Text>
        </div>

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>التقييم</Table.HeaderCell>
              <Table.HeaderCell>النصّ</Table.HeaderCell>
              <Table.HeaderCell>المنتج</Table.HeaderCell>
              <Table.HeaderCell>الحالة</Table.HeaderCell>
              <Table.HeaderCell>الحكم</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(rows ?? []).map((r) => (
              <Table.Row key={r.id}>
                <Table.Cell>
                  <Text weight="plus">{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {new Date(r.created_at).toLocaleDateString("ar-SA")}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                    {r.body || "—"}
                  </Text>
                  {r.moderation_note && (
                    <Text size="small" className="text-ui-fg-subtle">سببُ الحكم: {r.moderation_note}</Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">{r.product_id}</Text>
                </Table.Cell>
                <Table.Cell><Badge color={tone(r.status) as any}>{r.status}</Badge></Table.Cell>
                <Table.Cell>
                  <div style={{ display: "flex", gap: 6, flexDirection: "column", minWidth: 220 }}>
                    <Input
                      placeholder="سببُ الرفض"
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="small" disabled={busy || r.status === "published"} onClick={() => judge(r, "published")}>
                        نشر
                      </Button>
                      <Button size="small" variant="danger" disabled={busy || r.status === "rejected"} onClick={() => judge(r, "rejected")}>
                        رفض
                      </Button>
                    </div>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {rows?.length === 0 && (
          <Text className="text-ui-fg-subtle" style={{ marginTop: 12 }}>لا تقييمَ في هذه الحالة.</Text>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "التقييمات" });

export default ReviewsPage;
