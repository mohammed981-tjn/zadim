# Warehouse staff guide

> Last updated: 2026-09-01 — matches phase 11b.
> It describes what you do with your hands on the screen, not how the
> system was built.

Your job is three things: **you pick**, **you pack**, and **you receive
returns**. This guide covers each in turn, then what to do when the
screen stops you.

---

## First: picking — `/app/zadim/picking`

The screen lists pick lists, and every list has a **state**:

| State | What it means | What you do |
|---|---|---|
| **Pending** | Ready, nobody has started it | Start it |
| **Picking** | Someone is working on it now | Finish it if it's yours |
| **Picked** | All its items are complete | Move it to packing |
| 🔴 **Blocked** | Something is stopping completion | **Read the written reason** |
| **Cancelled** | No work to do | Leave it |

### The walk

The list is **ordered by walking route**, not by order line: you walk
the warehouse once and never double back down an aisle you've already
passed. Follow the order exactly as shown — changing it only lengthens
your walk for nothing.

Each line carries **its shelf location**, the quantity required and the
quantity picked.

### Scanning

Scan the item's barcode into the field provided. The result is
immediate:

**✅ Accepted** — the picked count goes up, and you see the name and
`picked / required`. Move to the next line.

**⛔ Rejected** — the barcode is not from this list. When that happens:

🔴 **The list stops, and the reason is written into it**: "barcode not
on this list: …", showing you the code you scanned.

**Why stop rather than ignore the scan?** Because a barcode that isn't
on the list usually means you're at **the wrong shelf** or holding **the
wrong item**. A system that silently ignores the scan lets you carry on
and ship the customer something they didn't order — and that mistake is
discovered at their door, not at your shelf.

**What to do when it stops:**

1. Read the reason on screen — the scanned code is in it.
2. Check you're at the right location with the right item.
3. If the item is right and its barcode still isn't accepted, the
   problem is in the **product data**, not with you: report the scanned
   code and the list number to your supervisor.

⚠️ **Don't try to finish a blocked list** — the system blocks picking on
it and will tell you "picking is not allowed on this list right now".

### Shortfalls

If you can't find the full quantity on the shelf, don't complete the
list as though it were done. The system knows the difference between
required and picked and shows the shortfall. Report it.

---

## Second: packing

Once picking is complete the order is packed into a **parcel** with:

- **Its own barcode** — never shared with another parcel.
- **Its weight in grams**, and its dimensions where needed.
- **The name of whoever packed it.**

⚠️ **The weight is not a field to fill in casually**: the carrier's
charge is calculated from it. A wrong weight means a wrong shipping
invoice, discovered a month later.

**And the shipping charge is neither calculated here nor estimated by
hand** — the system computes it from the carrier's own data. Don't type
in a number of your own.

---

## Third: receiving returns

### 🔴 First rule: a return never lands on a selling shelf

Returned goods are received into a **quarantine location** — a location
flagged in the system as a returns location, and **nothing is sold from
it**.

**Why a separate location rather than a "status" on the item?** Because
a status is forgotten and changed with a morning click, while a place is
not forgotten: as long as the item is there it is out of sale, even if
everyone forgets about it.

⚠️ One location cannot be both a quarantine location and a shipping
location — the system refuses that.

### Then the inspection

Every return is inspected, and the inspection is recorded:

| Field | What you write |
|---|---|
| Quantity | How many you inspected |
| **Outcome** | `resellable` · `damaged` · `missing` · `wrong item` |
| 🔴 **Reason** | **A sentence** describing what you saw — mandatory |
| **Released quantity** | How many pieces go back to the selling shelf |

**The reason is not a formality.** Six months later someone asks: why
was this piece put back on the shelf and that one written off? "Damaged"
alone doesn't answer. Write what you saw: "deep scratch across the front
cover" · "packaging opened and accessories missing" · "the size returned
is not the size sold".

### 🔴 The most important thing in this guide

**Not one piece goes back to a selling shelf without an inspection
signed by a person.**

There is no button that returns stock automatically, and no route that
does it. **What comes back is the "released quantity" on the
inspection** — not the quantity that was received.

So if you receive 5 and on inspection find 3 sound and 2 damaged, you
write **3** as released. The other two stay in quarantine. If you wrote
5, you would have sold a customer the damaged ones.

### And the inspection record is never erased

🔴 **What you wrote in an inspection cannot be edited or deleted** —
not by you and not by a manager. If you made a mistake, the correction
is **a new inspection line** explaining what is right, and the old one
stays visible.

**Why?** Because an inspection is a certificate, not a note. A record
that can be rewritten testifies to nothing.

---

## What to do when the screen stops you

| What you see | What it means | What you do |
|---|---|---|
| "barcode not on this list: …" | The item isn't from this list | Check location and item; then report the code |
| "picking is not allowed on this list right now" | The list is blocked or sealed | Don't finish it — check its state |
| "no list with this id" | The list was deleted, or the link is stale | Go back to the list of lists |
| Short on the shelf | Stock doesn't match reality | Don't complete it as done — report it |

**In every case**: the system stops you deliberately when it is
unsure. A stop costs seconds; a wrong parcel costs a day.

---

## Summary in a few lines

1. Follow the walking order exactly as given.
2. Scan every item — never complete by hand.
3. If the list stops, **read the reason** and don't work around it.
4. A parcel's weight is a real number, not an estimate.
5. Returns land in **quarantine**, not on the shelf.
6. Write a **real reason** on every inspection.
7. And **released is what you inspected as sound** — not what you
   received.
