# Zadim store manager's guide

> Last updated: 2026-09-04 — four new screens (invoicing · cash-on-
> delivery · stock adjustments · coupon policies).
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
| Products · prices · stock · orders · customers | ✅ Medusa's own screens |
| Home page sections (blocks) | ⚙️ API only |
| **English translation of content** | ⚙️ API only |
| Return policy · inspection records | ⚙️ API only |
| Marketing: segments and templates | ⚙️ API only |
| Roles and permissions · audit log | ⚙️ API only |
| Warehouse profiles · alert rules | ⚙️ API only |
| Search synonyms · SEO and redirects | ⚙️ API only |

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
