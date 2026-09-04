# Zadim store manager's guide

> Last updated: 2026-09-04 — nine new screens (invoicing · cash-on-
> delivery · stock adjustments · coupon policies · suppliers and
> purchase orders · alert thresholds · the stock ledger · warehouse
> profiles).
> It describes the panel **as it is today**, and anything that has no
> screen yet is listed plainly in its own table.

---

## 🔴 Read this first: what has a screen and what doesn't

A large part of what Zadim can do **is built and working, but has no
screen in the panel yet**. Those areas are used through a programmatic
route (an API) — that is, a request a developer sends.

This is written here so you don't hunt for a button that doesn't exist
and conclude the system is broken.

| Area | In the panel? |
|---|---|
| The numbers dashboard (orders · stock · picking · invoices) | ✅ `/app/zadim` |
| Bulk operations and undoing them | ✅ `/app/zadim/bulk` |
| ZATCA invoices and their chain | ✅ `/app/zadim/invoices` |
| Warehouse picking | ✅ `/app/zadim/picking` |
| E-invoicing (ZATCA) settings | ✅ `/app/zadim/zatca-settings` |
| Cash-on-delivery policy · refusals | ✅ `/app/zadim/cod-policy` |
| Stock adjustments (request/approve/apply) | ✅ `/app/zadim/adjustments` |
| Coupon policies (per-customer limit · discount cap) | ✅ `/app/zadim/coupon-policies` |
| Suppliers | ✅ `/app/zadim/suppliers` |
| Purchase orders (create/place/receive) | ✅ `/app/zadim/purchase-orders` |
| Low-stock alert thresholds and current breaches | ✅ `/app/zadim/alert-rules` |
| The stock movement ledger (read-only) | ✅ `/app/zadim/movements` |
| Warehouse profiles (which location ships) | ✅ `/app/zadim/warehouse-profiles` |
| Roles and who holds them | ✅ `/app/zadim/roles` |
| Audit log | ✅ `/app/zadim/audit` |
| Review moderation (publish/reject) | ✅ `/app/zadim/reviews` |
| Return policy · inspection records | ✅ `/app/zadim/returns-policy` |
| Notifications: log and retry policy | ✅ `/app/zadim/notifications` |
| Order statuses · event outbox | ✅ `/app/zadim/order-flow` |
| Attributes · SEO · redirects · synonyms · translations | ✅ `/app/zadim/catalog` |
| Home page sections (blocks) | ✅ `/app/zadim/cms-blocks` |
| Parcels (weight and dimensions) | ✅ `/app/zadim/parcels` |
| Products · prices · stock · orders · customers | ✅ Medusa's own screens |
| Marketing: segments and templates | ⚙️ API only |

⚙️ = ask a developer to run it, or wait for its screen. The capability
exists and is tested; what's missing is its interface.

---

## The numbers dashboard — `/app/zadim`

Six groups: orders and their revenue · stock (stocked · reserved ·
available · low) · pick lists by state · pending events · invoices and
whether their chain is intact · bulk operations.

**Every number here is computed the moment you open the page**, straight
from the database — it is not a counter refreshed on a schedule that
might lag. What you see is what's in the database now.

⚠️ Watch the **"invoice chain intact"** line: if it ever says otherwise,
that is the most serious thing this screen can show (see "Invoices").

---

## Products, prices and stock

Managed from Medusa's own screens.

**Stock is three numbers, not one:**

| Number | What it means |
|---|---|
| Stocked | What is physically on the shelf |
| Reserved | Sold but not yet shipped |
| **Available** | Stocked − reserved — **and this is what gets sold** |

🔴 "Available" is **computed, not written**: don't try to edit it
directly. Edit the stocked figure and available follows.

**And no more is ever sold than exists, however much demand collides.**
Tested with a hundred simultaneous orders against a stock of ten:
exactly ten succeeded.

---

## Suppliers — `/app/zadim/suppliers`

Who you buy from. Each supplier's id is copied from this screen to
create a purchase order against them.

- **The normalized name is guarded by a unique index** — a supplier
  with a duplicate name (even with a small spelling difference) is
  rejected instead of creating a second record that purchases later
  get split across.
- A suspended supplier stays visible in the list (their past orders
  still need an owner), but you can't order from them again.

---

## Purchase orders — `/app/zadim/purchase-orders`

Three steps, **by three different sets of eyes**: whoever creates the
order isn't necessarily who sends it to the supplier, and neither is
necessarily who receives the goods — permissions enforce this split on
their own.

1. **Create** as a "draft": a supplier, a receiving location, and lines
   (a variant, quantity, and unit cost). The variant id is copied from
   its product screen in Medusa.
2. **Send to supplier** — freezes the lines: quantities and the agreed
   price no longer change after this.
3. **Receive** — from the order's detail view, line by line. **Only
   here does stock actually increase**, and the real cost is recorded
   for the margin calculation later.

🔴 **You cannot receive more than what was ordered** — the screen
shows "remaining" for each line, and the server rejects any excess. To
fix an accidental over-receipt, enter a **negative quantity** — it
writes a matching negative receipt, so the mistake stays in the ledger.

---

## Alert thresholds — `/app/zadim/alert-rules`

When you get warned that an item is about to run out.

- **With no general rule, there is no alert at all** — on purpose: an
  alert with a number nobody chose gets ignored within a week, then
  ignored the day it's actually true.
- A rule can be narrowed to a specific item, a location, or both — the
  more specific rule wins over the general one.
- At the bottom of the screen: **what has actually hit the threshold
  right now**, computed the moment the page opens, not from a saved
  table that might be stale.

---

## The stock movement ledger — `/app/zadim/movements`

**Read-only.** Every change to an item's balance — a sale, a receipt, an
adjustment, damage, a return — is written here automatically with its
reason and reference, and there is no way to write a row into it by
hand, ever.

Use it to answer "where did this balance go?" — filter by item or
location id to trace its history.

---

## Warehouse profiles — `/app/zadim/warehouse-profiles`

Decide **which location an order ships from** when stock is available
in more than one warehouse. The lower priority number is suggested
first, and turning off "ships from here" excludes a location from the
suggestion without deleting its profile.

---

## Home page sections ⚙️

The home page is **data, not code**: blocks with a type, a position and
a payload. The types are: hero · product grid · banner · categories ·
rich text.

🔴 **Changing the order needs no code release**: edit a block's position
and what the visitor sees changes within a minute. (Actually tested: a
text block was moved to the top by editing one row, and what the browser
drew changed with no build and no restart.)

⚠️ A block type the storefront doesn't recognise **draws nothing and
does not break the page**.

---

## English translation ⚙️

The store is bilingual, and **content is translated as data**: the
translation is written into a table, so a new product needs no code
release to appear in English.

**What can be translated:**

| Entity | Fields |
|---|---|
| Product | Title · subtitle · description · material |
| Product variant | Title |
| Category | Name · description |
| Collection | Title |
| Home page block | Title · subtitle · body · button label |

🔴 **Anything else is refused by the database itself** — not by the
screen. The link (`handle`), the publish state (`status`) and the
warehouse code (`sku`) are all just text as far as the database is
concerned, and translating them breaks the link or hides the product
from the store. So an attempt to translate them is rejected outright.

**Three rules govern translations:**

1. **One translation per (entity · field · language).** A second is
   rejected — it is not accepted and left for row order to decide which
   one shows.
2. **No empty value.** An empty one erases the original instead of
   replacing it, leaving the page with no title.
3. **Anything untranslated shows in its original Arabic.** That is
   deliberate: understandable Arabic beats a blank or an internal code.

⚠️ **Orders and invoices are never translated.** An order line carries
the product name as it was **on the day of purchase**, and translating
it today rewrites what happened. An invoice that has been issued is
not translated.

---

## Orders

Managed from Medusa's screens, with guards beneath them in the database:

- **A status only moves along a permitted transition.** A cancelled
  order is not revived, and a shipped one does not go back to "being
  prepared". The full matrix is tested.
- **Every transition is recorded** with who did it and when.

---

## Returns ⚙️

**The policy** is set by six things: whether it's enabled · the window
in days · excluded categories · whether opened items are accepted · a
minimum order total · and who pays return shipping.

⚠️ **No policy means no returns**: absence is an explicit refusal, not
implicit acceptance.

**The actual path:**

1. The return arrives and is received into a **quarantine location** —
   a location nothing is sold from.
2. A member of staff inspects it and records: the quantity · the
   outcome · **and a written reason**.
3. **What goes back on the shelf is what the inspection released** — not
   the quantity received.

🔴 **Inspection records cannot be edited or deleted**, even if you want
to: a correction is **a new line**, not an erasure of the old one. An
inspection is a certificate, not a note.

⚠️ There is no page yet for customers to request a return — requests
reach you by message.

---

## Invoices — `/app/zadim/invoices`

Invoices compliant with the Zakat, Tax and Customs Authority,
**sequenced by a cryptographic chain**: each invoice carries a trace of
the one before it.

🔴 **The chain cannot be repaired retroactively.** A break today is a
gap you explain to the Authority tomorrow, and it cannot be patched
later. Watch its indicator on the dashboard, and if it breaks, stop
everything and report it immediately.

---

## Payments — cash-on-delivery policy `/app/zadim/cod-policy`

Payment today is **cash on delivery**, exclusively.

- **Capture happens after shipping, not before.** No amount is recorded
  for something not yet delivered.
- **The cash-on-delivery policy** sets its ceiling, the permitted
  cities, and how many refusals block a customer — from this screen,
  no developer needed.
- **Refusals are logged and never deleted**, and show on this same
  screen under the policy — they are what the blocking decision is
  built on. Forgiving a customer means raising the threshold, not
  erasing a record.

🔴 **No policy means COD is blocked entirely**, not allowed without
limits. If the screen shows "COD blocked now", set the policy first.

⚠️ The other methods (mada · Apple Pay · Tabby · Tamara) are waiting on
merchant accounts with the providers.

---

## E-invoicing (ZATCA) settings — `/app/zadim/zatca-settings`

🔴 **The most urgent thing the owner is waiting on.** Without the
seller name and VAT number set, the store sells **with no invoice**,
and whatever was missed during that gap **can never be backfilled** —
unlike every other gap in this guide, this one is not recoverable later.

- **Saving the data does not mean issuing is on.** The two switches are
  separate on purpose: you can enter the data ahead of time, then turn
  issuing on later once it's verified. The badge at the top of the
  screen (configured / 🔴 not configured) reflects the **issuing**
  switch.
- **The VAT number must be exactly fifteen digits** — the screen
  rejects anything else before saving.

---

## Stock adjustments — `/app/zadim/adjustments`

A manual correction to stock: a stocktake found a difference, or
damage, or fixing an earlier mistake.

🔴 **Above a threshold the manager sets (by quantity or by value,
whichever hits first) a second person's approval is required.** The
stock only changes after it's applied — not at the request, not at the
approval. Whoever requested it cannot approve it themselves, **and the
screen blocks that exactly as the database does.**

- The list filters by state: pending · approved · applied · rejected.
- The "apply" button only shows once the effect is actually possible.

---

## Coupon policies — `/app/zadim/coupon-policies`

On top of what Medusa's promotion engine already does: a **per-customer
limit**, a **discount cap in riyals**, and **restricting a coupon to a
first order**.

- The code, status and percentage are set in Medusa's promotions
  screen; this screen is our policy layered **on top of it**, and needs
  the promotion's id (`promotion_id`) from there.
- 🔴 **A discount cap on a percentage promotion works by rejection, not
  by clipping** — a cart whose discount exceeds the cap is refused with
  a message, not clipped down to the cap. The screen warns you of this
  the moment you enter a cap. For a cap that actually clips, use a
  **fixed-amount** coupon instead.
- Deleting a policy does not erase customers' past redemptions — those
  are a separate ledger.

---

## Marketing ⚙️

Four events are captured **at the moment they happen**: a price drop ·
a return to stock · an abandoned cart · and order events.

- **A price increase produces no event** — only a drop.
- **Back in stock means crossing zero into positive** only; 5 ⇒ 8 is not
  a return to stock.
- 🔴 **An abandoned cart is one reminder per cart**, whose due time is
  pushed back with every change. Ten additions do **not** mean ten
  messages.
- **A segment with no rules matches nobody** — not everybody.

⚠️ 🔴 **No messages are actually sent today.** There is no SMS account
and no email connected, and the default provider **logs and does not
send**. So don't rely on a campaign having arrived.

---

## Bulk operations — `/app/zadim/bulk`

Price rises or mass edits.

🔴 **All of them can be undone**: the previous value of every row is
saved before the change runs, and the undo button restores it. A mistake
in a file of a thousand items is not a catastrophe.

---

## Roles and assignment — `/app/zadim/roles`

Who can do what, and who holds it.

- **Permissions are read here, not edited.** Granting a role a new
  permission is an architectural decision that goes through code review,
  not a late-night click in a panel.
- **What you can tune is the limit**: an amount ceiling, a number of
  times, or "needs a second approval". Raise it when you trust, lower it
  when you doubt.
- ⚠️ **A limit on a misspelled permission is rejected** — accepted, it
  would look like a ceiling in your panel and guard nothing, and you'd
  only find out after a large refund went through.
- 🔴 **The last super admin cannot be revoked**: a system with no super
  admin cannot repair itself — nobody can grant roles afterwards. Assign
  the role to someone else first.

---

## Audit log — `/app/zadim/audit`

Who did what, and when. **Read-only** — neither this screen nor any panel
route writes to it or deletes from it. A ledger the panel can edit is not
an audit ledger.

Filter by entity, entity id, actor or action — the log is read to answer a
specific question, not to be scrolled.

---

## Reviews — `/app/zadim/reviews`

🔴 **A review does not appear on the product page until you publish it
here.** It starts as "awaiting moderation" by design: it is public text on
an indexed page.

- **Publish** what is fine, **reject** what is not — **and a rejection
  needs a reason**: its author will ask, and without one the next
  moderator starts the judgement over.

---

## Returns — `/app/zadim/returns-policy`

Two halves: the **policy** (day window · are opened items accepted? ·
minimum order total · who pays return shipping) and the **inspection**
(what came back, and in what condition).

- If no policy has been set yet the screen says so plainly — empty fields
  are not zeros, they were never filled.
- **Inspections are append-only**, and a correction is a new row. The
  inspector is taken from your session, not typed into the screen — so no
  judgement is ever recorded under someone else's name.
- Only inspected goods return to the shelf: "releasable" is a number the
  server computes.

---

## Notifications — `/app/zadim/notifications`

⚠️ **"Queued" means "never sent", not "on its way"** — no messaging
provider is connected yet. The number becomes meaningful the day one is.

- **"Dead"** means: attempts exhausted, it will never be retried.
- The recipient is **masked** on purpose — this is a diagnostic log, not
  an address book.
- **Turning off draining is a valve, not an off switch**: the day the
  provider goes down, stop hammering it until it recovers. Messages wait;
  they are not lost.

---

## Order flow — `/app/zadim/order-flow`

Opened for one question: **"why didn't that notification arrive?"**

- **Event outbox**: an undelivered event means everything downstream of it
  did not happen — no notification, no stock update, no invoice. **An
  empty list here is the healthy state.**
- **Allowed transitions**: read-only. This is the state machine itself,
  and changing it goes through a reviewed migration — unlike the return
  policy, which is a merchant's decision.

---

## Catalog — `/app/zadim/catalog`

Five sections in one screen: **attributes · SEO · redirects · synonyms ·
translations**.

- **Synonyms** make someone searching "jawwal" find "phone".
- **Redirects** are sorted by hit count — the most-hit one is the broken
  link that actually costs you.
- **There is no delete button here** because the backend route has none —
  and a button that promises what it cannot do is worse than no button.

---

## Page blocks — `/app/zadim/cms-blocks`

What the customer sees on the home page, in order. **One call changes it —
no build, no deploy.**

- Reorder with the ↑↓ arrows.
- **Hidden blocks are shown too**: a block you cannot see in the panel
  will never be switched back on.
- The payload is JSON — malformed text is rejected before it is sent.

---

## Parcels — `/app/zadim/parcels`

Weight and dimensions **after the parcel is sealed and labelled** — the
weight of an open box is not the weight of what ships.

- Weight in whole grams (like halalas): the carrier prices by weight, and
  a float is rounded in one place and truncated in another.
- **Barcodes are unique**: two parcels sharing one means a waybill
  pointing at a different parcel — and the shipment reaches the wrong
  person.

---

## Permissions and the audit log ⚙️

- **Anything without a permission rule is refused.** So a new route
  forgotten in the map is closed, not opened to everyone. Forgetting
  shuts the door rather than opening it.
- **Every change is recorded**: who · what · when · and from which
  address. **The log is appended to, never edited or deleted.**
- **Attempted overreach is logged too** — and it is the part most worth
  reading.

---

## Common mistakes — and how to avoid them

| The mistake | What happens |
|---|---|
| Editing "available" directly | Not accepted — edit "stocked" |
| Translating the link (`handle`) | Refused — and a broken link loses the product's page in Google |
| Expecting marketing messages to arrive | No provider is connected yet; they are logged, not sent |
| Putting goods back on the shelf without inspection | There is no way to — only what a person inspected is released |
| Ignoring the invoice chain indicator | A break cannot be repaired later |
| Waiting for a screen in a ⚙️ area | See the "what has a screen" table above |
