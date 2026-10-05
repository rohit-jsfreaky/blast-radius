# DESIGN-BRIEF.md — the look the band builds to

This file is a **factory input** (committed by Rohit before the run, named in the dispatch). It is not
code: the band writes every line of CSS and markup itself. It comes from Rohit's best UI so far, the
Cairn frontend (`hackathons/cairn/frontend`, live at cairnmcp.fun), adapted to the stage-2 brief:
*"a coherent, presentation-ready restaurant product, not a test harness with controls attached. Aim
for a warm, confident hospitality character."*

Part A is the visual system (works for any product). Part B applies it to the booking app. Part C
applies it to the wallet app (only for the generic run).

---

## Part A — the visual system

### Principles
1. **Opinionated and polished beats neutral and safe.** One clear voice, not a component-library default.
2. **Depth comes from light drawn inside the shape**, not from heavy drop shadows: a lit top edge and
   a hairline inside every card, with only a whisper of shadow underneath.
3. **Three inks, two grounds, one accent. Nothing else** — plus one signal colour used only for
   "uncertain".
4. Big, calm type. Generous space. One primary action per view, and it is unmistakable.

### Type (bundle both fonts in the image; never load them from the network)
| role | font | npm package (fetched at `docker build`) | use |
|---|---|---|---|
| display | **Shantell Sans** (variable) | `@fontsource-variable/shantell-sans` (OFL-1.1) | page titles, the hero line, big numbers, confirmation headline |
| body | **Hanken Grotesk** (variable) | `@fontsource-variable/hanken-grotesk` (OFL-1.1) | everything else |
| mono | system mono (`ui-monospace, Cascadia Code, SFMono-Regular, monospace`) | — | small uppercase labels, references, times in the grid |

Scale: hero line `clamp(34px, 5vw, 58px)`, weight 500, line-height 1.08, letter-spacing −0.01em ·
section titles `clamp(28px, 3.4vw, 44px)` display · lead text 20px / 1.45 at 65% ink · body 15–16px ·
labels 12–13px mono uppercase, letter-spacing 0.06em, muted. **Never** Inter, Roboto, Arial,
system-ui as the visible face.

### Colour tokens
| token | value | use |
|---|---|---|
| ink | `#0a0b0c` | text, primary buttons, selected state |
| muted | `#737373` | secondary text (4.7:1 on white — the lightest allowed for text) |
| faint | `#a1a1a1` | decoration and hatching only, **never text** |
| mist | `#f5f5f5` | wells, page bands |
| soft | `#fafafa` | quiet panels |
| white | `#ffffff` | page ground and surfaces |
| moss (the accent) | `#2e7d55` | success, links, the eyebrow, focus ring, available hover (5.0:1 on white) |
| sage (hero ground) | `#e7f0ea` | the hero card behind the search panel |
| honey (signal) | border/icon `#b07800`, text `#7a5200` | **only** the uncertain state |

Hard bans (Rohit's taste rules): no cream, beige or paper backgrounds; no rust/terracotta; **no red at
all** (refusal is shown with ink, a hatch and an icon, not red); no indigo or violet; no purple
gradients.

### Shape — squircle corners on a concentric scale
Radius steps: xs 6 · sm 10 · md 14 · lg 18 · xl 24 · 2xl 32 · 3xl 40 px. Nested boxes follow the
concentric rule: **inner radius = outer radius − the padding between them**. Where supported, use
`corner-shape: squircle` on every rounded box (true pills keep round corners). Buttons are full pills.

### Surfaces (the depth recipe — write it as CSS yourselves)
| surface | layers |
|---|---|
| surface | inset 0 1px 0 white 90% · inset 0 0 0 1px ink 6% · 0 1px 2px ink 3% |
| surface-raised | the three above (hairline 7%, under-shadow 4%) + 0 10px 20px −12px ink 10% + 0 30px 60px −30px ink 22% |
| surface-floating | inset top light · inset hairline ink 8% · 0 2px 4px ink 4% · 0 16px 32px −16px ink 14% · 0 48px 90px −40px ink 32% |
| well (pressed in) | inset 0 1px 2px ink 6% · inset 0 0 0 1px ink 4% |
| hairline | a 1px bottom line at ink 6% |

### Controls
- **Primary button:** ink pill, white 15px medium text, padding 12/24, hover = 85% opacity, focus =
  2px moss ring with 2px white offset. One per view.
- **Secondary button:** white/70% pill with ink 75% text and a 1px ink-5% ring; hover → white + ink.
- **Inputs:** visible label above (13px mono uppercase muted), field in a `well` with radius md,
  16px text (no zoom on phones), focus = moss ring. Errors sit under the field in ink with an icon.
- **Eyebrow:** 16px medium moss text followed by a faint `›`.
- **Icons:** Phosphor (`@phosphor-icons/core` raw SVGs or `@phosphor-icons/web`, MIT), regular weight,
  inlined or bundled. Never Lucide or Material.

### Motion
CSS only: 150–250 ms ease-out on colour, opacity and transform. A short fade-up for results and the
confirmation. Respect `prefers-reduced-motion` (no motion at all). Nothing loops forever except a
loading shimmer.

### Accessibility floor (the verifier checks these in a real browser)
Every input has a visible label · focus is always visible (moss ring) · text contrast ≥ 4.5:1 ·
controls ≥ 44px tall on phones · no horizontal page scroll at 375 px and at 1280 px · every state is
told apart by **shape or icon as well as colour**.

---

## Part B — the booking app (tablekeeper)

### Character
A neighbourhood restaurant's own booking page on a good evening: calm, confident, a little playful in
the headlines (Shantell Sans), precise in the details (mono times, clear tables). The warmth comes
from the words, the display type and the sage hero — not from cream or orange.

Voice: plain and friendly, contractions, no jargon. "Pick a table", "You're booked", "Someone just
took that table — here's what's still free", "We couldn't confirm that yet — try again, it's safe."
Never show raw ids, codes or JSON. Show table **labels** ("Table 4 · window") and local times.

### Layout
- **Top bar** (same on every route): the restaurant-app name in display type on the left; links to
  Search, Find a booking, and Log in / Sign up — or, when signed in, the diner's name and Log out.
- **`/` Search:** a big rounded **hero card** (radius 2xl→3xl, sage ground) holding the hero line
  ("Where are we eating tonight?") and one floating search panel (surface-floating) with restaurant,
  date and party size side by side on desktop, stacked on phones, and the primary Search pill.
  Below it, the **availability grid** in a white surface-raised card: one row per table (label +
  capacity as "seats 4"), one column per time; combined tables appear as their own rows, written as
  "Tables 1 + 2 · seats 6", grouped under a small "Joined tables" label. On phones the grid becomes
  a list of time chips per table (no sideways page scroll; the chips wrap).
- **Booking form:** opens beside the grid on desktop (a floating card) and as a bottom sheet on
  phones. It names the table(s) and the local time in plain words, has the party size, and one
  primary "Book this table" pill.
- **Confirmation:** a moss-check badge, a display headline ("You're booked"), the reference in a
  large mono pill with a copy button, then restaurant, table(s) and time.
- **`/lookup`:** one centred card: the reference field, a Find pill; the result shows status as a
  pill, the details, and a quiet secondary "Cancel booking" button with a confirm step.
- **`/login`, `/signup`:** one centred surface-raised card each, display title, labelled fields.

### The seven states — each must look different from every other (shape/icon + colour)
| state | look |
|---|---|
| available | white surface pill, ink text, hover → moss hairline ring + moss text |
| unavailable | `well` (pressed in), muted text, faint diagonal hatch, `not-allowed` cursor, no hover |
| selected | solid ink pill, white text, check icon |
| loading | grid cells and form become soft shimmering placeholders (mist → soft); the Search pill shows a small spinner and says "Searching…"; no layout jump |
| successful | moss filled badge with check, confirmation card fades up |
| refused | ink-bordered card with a left 3px ink bar and a Phosphor "prohibit" or "x-circle" icon; plain sentence why; the form and its inputs stay as they were; the grid refreshes |
| uncertain | honey dashed border, honey clock/arrows icon, honey text "We couldn't confirm that yet. Your booking might have gone through — tap Try again, it's safe and won't book twice."; no error colour, no confirmation |

### Empty, loading and error states (considered, not blank)
- No search yet: the hero line and a small line drawing of a set table (ink lines + one moss detail),
  drawn in SVG by the band.
- A closed day / no free slots: a friendly sentence + "Try another date" secondary pill.
- Network/server error on search: an ink card with a retry pill.
- Lookup not found: "We can't find that reference. Check the letters and try again."

---

## Part C — the wallet app (pocketful, generic run only)

Same Part A system. Character: a calm, trustworthy money app between friends. Hero line in display
type ("Settle up, simply."); balances as big display numbers; amounts in mono with the currency; sent
vs received shown by an arrow icon and a +/− sign, never by red/green alone (green moss for received
is fine, ink for sent). Refused = ink card with icon; uncertain = honey dashed card. Same accessibility
floor.
