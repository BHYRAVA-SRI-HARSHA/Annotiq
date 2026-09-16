# Table of Contents {#table-of-contents .TOC-Heading}

# OCR--KV Annotation Project: Master Guidance Document (LLM System Reference)

**Purpose of this document:** This is a living reference you (the LLM)
should use whenever you are asked to help with the OCR / Key-Value (KV)
annotation project --- writing instructions, answering "how do I
annotate X" questions, reviewing/auditing annotated assets, generating
QA feedback, onboarding new annotators, or reasoning about tool
behavior. It merges three source types the team maintains:

1.  **UI Screenshots** → how the annotation tool looks and behaves
    (layout, panels, labels, modes, shortcuts).
2.  **Rulebooks / SOPs (PDF & DOCX)** → the annotation rules that must
    be followed (OCR word/line rules, Key-Value SOP, Clickables SOP,
    Math/Equations rules).
3.  **Screen-recorded videos of real tasks** → how an annotator actually
    works through a document end-to-end inside the tool.

Treat Section 0 as your operating instructions. Treat the rest as the
knowledge base you should cite, apply, and reason from consistently.

# 0. How the LLM Should Use This Document

-   Act as an **OCR/KV Annotation SME (Subject Matter Expert) and QA
    Lead** for this project (Handigital ↔ AWS "textract" annotation
    pipeline).
-   When a user asks "how should I annotate X", find the most specific
    matching rule below before giving a general answer. Cite the rule
    number/section (e.g. "per Word Annotation Rule --- Symbols space
    rule").
-   When a rule conflicts (e.g. handwritten vs printed precedence),
    **printed rules take precedence** in mixed lines (see Sec. 4.3).
-   When something isn't covered here, say so explicitly and recommend
    it be raised in the next MOM (Minutes of Meeting) sync instead of
    guessing.
-   **Samples vs Templates matter everywhere** --- many rules (blank
    keys, blank values, clickables) have opposite behavior for samples
    (real filled documents) vs templates (blank forms). Always check
    which asset type is being discussed before answering.
-   This document should be **updated** every time: a new rule is
    clarified, a new MOM decision is logged, a new screenshot changes
    the UI, or a new task type is introduced. See Sec. 9 "How to Extend
    This Document."

# 1. Project Snapshot

-   **Client / vendor context:** Handigital annotators (login domain
    `@handigital.com`) work AWS/"textract" style OCR + Key-Value
    annotation tasks. Documents referenced in rulebooks are marked
    "Amazon Confidential."
-   **Annotation platform:** a browser-based task tool (internally
    referred to informally as the "Keys and Values" tool / task title
    format `textract-<batch>-<id> - <task_type>`).
-   **Task types observed in the Jobs queue:**
    -   `ocrkv` / `ocrkv_qa` --- OCR word/line annotation + Key-Value
        annotation, and its QA/verification pass.
    -   `tables_qa` --- table structure QA.
    -   `layout_qa` --- layout/segmentation QA.
    -   `segrect` --- segmentation + rectification.
    -   `transcription_consensus` --- multi-annotator transcription
        agreement pass.
-   **Document types seen:** Uniform Residential Loan Application
    (Fannie Mae Form 1003 / Freddie Mac Form 65), CMS-1500 Health
    Insurance Claim Form, IRS forms (990, 1099, etc.), ACORD insurance
    forms, W-2s, receipts, checks, shipping labels, and other structured
    business documents --- both **handwritten** and **printed**, and
    both **blank templates** and **filled samples**.
-   **Confidentiality banner:** every task screen footer reads "Treat
    the data in this task as confidential." --- always assume PII
    sensitivity in examples.

# 2. Tool UI Reference

> Update this section whenever the tool UI changes. Screenshot filenames
> are referenced loosely by content, not literal filenames, since those
> will change every time you upload new captures.

## 2.1 Login & Job Queue (pre-task)

-   **Login screen:** simple username/password form ("Sign in with your
    username and password"), username is an email like
    `KV12@handigital.com`.
-   **Job queue screen** (post-login):
    -   Header: "Hello, `<user>@handigital.com`" + **Log out** button.
    -   **Show instructions** toggle (top right) reveals a 4-step
        onboarding banner: **Get Started → Read Instructions → Work on
        labeling tasks → Take actions** (Select a job & Start working →
        Read instructions → Submit each task → Stop working to exit).
    -   **Jobs table** columns: `Task title`, `Customer ID`, `Status`
        (Available / Paused / etc.), `Creation time`. Sortable via
        column headers; searchable via the search box; paginated (page
        1, 2 ...).
    -   **Start working** button (top right, orange) launches the
        selected task.
    -   Task titles encode: `<pipeline>-<batch>-<variant> - <task_type>`
        e.g. `textract-hd-so-b3a-0826 - ocrkv_qa`,
        `textract-spt-kor-pilot-hd-rework - tables_qa`.

## 2.2 In-Task Header Bar

Present on every annotation screen:

-   Left: `Hello, <user>@handigital.com`
-   Center: `Customer ID: <redacted/partial>` ·
    `Task description: Annotate/verify the <stage>…` ·
    `Task time: <elapsed> of 7199 Min 59 Sec` (≈120 hours total task
    allotment/timer)
-   Right: **Decline task**, **Release task**, **Skip task**, **Stop and
    resume later** buttons
-   Below that, a second bar: current tool tab (e.g. **"Keys and
    Values"**), plus **Save**, **Submit** (primary blue button),
    **Shortcuts**, and a **Light/Dark** theme toggle. A "Saved Xs/Xm
    ago" autosave indicator sits near Save.

## 2.3 Main Canvas (center)

-   Renders the source document image at an adjustable zoom (`%`
    control, bottom-left of canvas) and a separate crosshair/lens
    magnification control (e.g. "3x").
-   Annotated elements are drawn as color-coded bounding boxes directly
    over the image (see Sec. 2.6 for the color legend).
-   While an image is loading: canvas shows literal text **"Loading
    image..."** --- treat this as a transient tool state, not an error.
-   Footer of every canvas view: **"Treat the data in this task as
    confidential."**

## 2.4 Left Panel --- Labels / Ontology

A vertical list of annotation **labels**, each with an eye icon
(show/hide) and a lock icon (lock/unlock editing), and a colored swatch.
Observed label set for the "Keys and Values" tool, **in this order**:

  -------------------------------------------------------------------------------------
  \#                Label                      Swatch color      Purpose
                                               (approx.)         
  ----------------- -------------------------- ----------------- ----------------------
  1                 GroupedContainer           brown/orange      Wraps multiple related
                                                                 KeyValueContainers
                                                                 (e.g. a full "section"
                                                                 of a form)

  2                 KeyValueContainer (KVC)    teal/mint         Wraps one Key + its
                                                                 Value(s) as a single
                                                                 logical pair

  3                 Key                        purple/magenta    The label/field-name
                                                                 bounding box

  4                 SubKey                     yellow/gold       A child key nested
                                                                 within a
                                                                 complex/indexed key

  5                 Value                      teal              The data bounding box
                                                                 associated with a Key

  6                 SubValue                   pink              A child value nested
                                                                 within a complex value
                                                                 (e.g. multiple
                                                                 sub-amounts)

  7                 ValueBBox                  yellow-green      A supplementary/looser
                                                                 value bounding region
                                                                 (e.g. maximal
                                                                 blank-value box)

  8                 ValueList                  blue              A value that is itself
                                                                 a list of sub-values

  9                 ClickableItemTrue          maroon/dark red   A checkbox/radio
                                                                 button that IS
                                                                 marked/checked

  10                ClickableItemFalse         green             A checkbox/radio
                                                                 button that is NOT
                                                                 marked (but still
                                                                 relevant/has a key)

  11                ClickableCircleItemTrue    blue              Circular/radio-style
                                                                 clickable, marked true

  12                ClickableCircleItemFalse   red               Circular/radio-style
                                                                 clickable, marked
                                                                 false

  13                Line                       green             Line-level grouping of
                                                                 words

  14                Word                       dark              Individual OCR word
                                               purple/indigo     bounding box (base
                                                                 unit)
  -------------------------------------------------------------------------------------

Below the label list:

-   **"Select a label to start drawing"** helper prompt.
-   **Box type selector**: `Bounding Box` vs `Polygon` (radio toggle)
    --- governs whether the next drawn shape is an axis-aligned/rotated
    rectangle or a free multi-point polygon.
-   Inline tool tip (varies by label selected), e.g. *"Drag around
    KeyValueContainer, Word --- the GroupedContainer box will tighten
    around them."*
-   **Select / Move** tool (keyboard shortcut `S`) --- default cursor
    mode for selecting/repositioning existing shapes.
-   **Show Parent → Child Links** toggle --- visualizes the hierarchy
    tree as connecting lines on canvas.
-   **Select for Group** --- multi-select tool to batch-assign elements
    into a parent container.

## 2.5 Right Panel --- Annotations List & Properties

-   Header: **Annotations (**`<count>`**)** with **Show all / Hide all**
    buttons and a **Search text or ID...** box.
-   **FILTER row:** two dropdowns ---
    -   First dropdown selects the *field* to filter/sort by:
        `Transcription`, `Language`, `skip transcription`,
        `skip reason`, `IsVertical`, `IsSignature`, `IsWatermark`,
        `WritingType`, `isMath`, `isLatex`, `isBoxForm`.
    -   Second dropdown selects the *condition*: `Filled`, `Empty`,
        `Equals`.
-   **Mode toggle:** switches the annotation tree between **Line mode**
    (groups by `Line → words`) and (implicitly) **Word mode** / KV-tree
    mode (groups by `KeyValueContainer → Key/Value → Word`). The colored
    dot next to "Mode:" reflects the active grouping color (e.g. green =
    Line mode).
-   **Tree list:** collapsible nodes per label showing element counts,
    e.g. `Word 27`, `KeyValueContainer 6`, `GroupedContainer 4`,
    `Line 87`. Expandable to show each child transcription text as a
    leaf row (e.g. `VI.`, `ASSETS`, `AND`, `LIABILITIES`, `(cont'd)`,
    `$`, `49.00` ...).
-   **Properties panel** (appears when an element is selected, or as a
    popup card on the canvas labeled `WORD word-<id>`):
    -   `Language` dropdown (e.g. English)
    -   `Transcription` text field, with inline **superscript (x²)** and
        **subscript (x₂)** buttons
    -   `Skip Transcription` toggle/checkbox
    -   `IsVertical` toggle
    -   `IsSignature` toggle
    -   `IsWatermark` toggle
    -   (Scrolled further) additional boolean flags matching the WORD
        COLOR legend: `skip_transcription`, `IsVertical`, `IsSignature`,
        `IsWatermark`, `WritingType: Handwritten`,
        `WritingType: Printed`, `isMath`, `isLatex`, `isBoxForm`.
-   **"Select an element to view its properties"** placeholder text when
    nothing is selected.

## 2.6 Word Color Legend (bottom-left, collapsible "WORD COLO..." panel)

Each has a swatch + eye-toggle to show/hide that overlay category on
canvas:

-   `skip_transcription` --- orange
-   `IsVertical` --- yellow-green
-   `IsSignature` --- green
-   `IsWatermark` --- bright green
-   `WritingType: Handwritten` --- teal/cyan
-   `WritingType: Printed` --- blue
-   `isMath` --- purple
-   `isLatex` --- magenta
-   `isBoxForm` --- red/pink
-   Caption at bottom: **"A word takes the topmost color whose attribute
    it has."** (i.e. this is a priority-ordered legend, not independent
    layers.)

## 2.7 File Info Panel

Accessible via an **(i) "View file info"** icon near the tab bar. Shows:

-   **FILE INFO:** Asset ID (hash), Batch
    (e.g. `textract-hd-so-b3a-0806`), Page number, Rework round.
-   **ELEMENT stats:** Created (newly added), Modified (co-ordinates
    modified), Deleted (removed) --- each with a count.
-   **CHARACTERISTICS stats:** Created (newly added), Modified
    (characteristics modified), Deleted (removed) --- each with a count.
-   **SESSION stats:** Total time, Active time, Idle time, Time "To
    first action", Save count, Undo/Redo count.

This panel is effectively the per-asset audit trail --- useful for
QA/manager review of annotator activity and rework diffs.

## 2.8 "Stop and Resume Later" Modal

Triggered by the **Stop and resume later** header button. Contains two
informational blocks:

1.  **NER, 3D point cloud, video object detection/tracking tasks:** Save
    first, then Confirm --- work is restored on resume.
2.  **⚠ Images, text classification, video clip classification tasks:**
    Confirming **without saving first loses all annotation work** on
    that task (can restart from scratch).

-   Checkbox: **"Don't show this message again"** (with an info
    tooltip).
-   Buttons: **Cancel** / **Confirm** (orange).
-   **Operational rule of thumb: always click Save (and confirm "Saved
    just now/Xs ago" appears) before using Stop and Resume, Release, or
    Skip.**

## 2.9 Keyboard Shortcuts (from the in-tool Shortcuts modal)

**Tools** \| Action \| Shortcut \| \|---\|---\| \| Select tool \| `S` \|
\| Draw Bounding box \| `W` \| \| Draw Table \| `T` \| \| Draw Polygon
\| `P` \| \| Draw Grid \| `G` \| \| Draw Relationship \| `R` \| \|
Select label 1--9 (current tab) \| `1`--`9` \| \| Select label 10--18
(current tab) \| `Shift 1`--`9` \| \| Select label 19--27 (current tab)
\| `Ctrl 1`--`9` \|

**Edit** \| Action \| Shortcut \| \|---\|---\| \| Undo \| `Ctrl Z` \| \|
Redo \| `Ctrl Shift Z` \| \| Merge selected cells \| `M` \| \| Unmerge
selected cell \| `U` \| \| Toggle grid direction \| `D` \|

**View / Navigation** \| Action \| Shortcut \| \|---\|---\| \| Toggle
magnification lens \| `L` \| \| Lens magnification down/up \| `[` / `]`
\| \| Toggle parent → child links \| `K` \| \| Zoom in / out \| `Ctrl =`
/ `Ctrl -` \| \| Reset zoom \| `Ctrl 0` \| \| Next / previous word
(reading order) \| `→` / `←` \| \| Close polygon / finish grid line \|
Double-click \| \| Cancel / clear selection \| `Esc` \|

**Text formatting** \| Action \| Shortcut \| \|---\|---\| \| Superscript
selected text (x²) \| `Ctrl Shift >` \| \| Subscript selected text (H₂O)
\| `Ctrl Shift <` \|

**Mouse** \| Action \| Control \| \|---\|---\| \| Pan vertically \|
Scroll \| \| Pan horizontally \| `Shift + Scroll` \| \| Zoom to cursor
\| `Ctrl/Cmd + Scroll` \|

## 2.10 Clickable-Only Tool ("Hieroglyph - Clickable" HIT variant)

A simplified single-purpose tool variant (Mechanical-Turk-style HIT)
used specifically for quick clickable QA:

-   Shows a strip of cropped checkbox images, each with a `?` "report if
    unsure" icon in the corner.
-   Annotator clicks each box where a cross-mark/tick-mark is actually
    present; the box turns **green** and gets a checkmark to confirm
    selection.
-   **Submit** button (bottom right) finalizes the HIT. Payment/reward
    and elapsed time shown in the HIT header bar.
-   Used for the audit workflow described in Sec. 7.6 (Checklist for
    Auditing Clickables).

## 2.11 Observed End-to-End Workflow (from screen recordings)

1.  Annotator logs in → lands on Job Queue → picks an `Available` task →
    **Start working**.
2.  Tool loads ("Loading annotation tool..." / "Loading image..."
    transient states) into the **Keys and Values** tab.
3.  Annotator works top-to-bottom / section-by-section over the
    document:
    -   Zooms in (seen up to \~1369% for fine word-level work on
        stamps/logos; \~200--500% for general table/field work).
    -   Selects a label (e.g. `Word`) → draws a bounding box → a
        `WORD word-<id>` property card pops up inline on canvas → sets
        Language, types Transcription, toggles
        Skip/Vertical/Signature/Watermark as needed → closes the card
        (×) or moves to next word.
    -   Switches to `Line` mode to verify/adjust line groupings (words
        within the 4-space rule grouped into one line box).
    -   Draws `KeyValueContainer` → `Key` → `Value` nesting for form
        fields; for indexed/complex forms, nests multiple
        `KeyValueContainer`s inside a `GroupedContainer` to represent
        Parent Key → Child KV pairs (Hierarchical KV / HKV).
    -   For checkboxes/radio buttons: uses **Add Clickable Item** to box
        the checkbox cell itself (not the checkmark) and marks
        True/False; where a matching Key exists, also draws a Value box
        linked to the same OCR word element.
4.  Periodically **Save**s (autosave indicator updates, e.g. "Saved 1m
    ago").
5.  On completion, clicks **Submit** --- this advances to the next task
    in queue.
6.  If needing to pause mid-task: **Save → Stop and resume later →
    Confirm** (never Confirm without Save first, per Sec. 2.8).

# 3. Annotation Object Model (What Each Label Means)

Use this as the canonical schema when explaining hierarchy questions.

    GroupedContainer                 (optional top wrapper for a whole section / repeated block)
     └─ KeyValueContainer (KVC)       (one logical Key+Value pairing — never overlaps another KVC)
         ├─ Key
         │   └─ SubKey (optional, for indexed/compound keys, e.g. "12a" + "Statutory Employee")
         │       └─ Word(s)
         ├─ Value
         │   ├─ SubValue (optional, for multi-part values, e.g. multiple % or $ sub-amounts)
         │   ├─ ValueBBox (a looser/maximal value region, e.g. blank fillable space)
         │   ├─ ValueList (a value made of an itemized list of sub-values)
         │   └─ Word(s)
         ├─ ClickableItemTrue / ClickableItemFalse      (checkbox/radio state, box drawn around the CELL not the mark)
         └─ ClickableCircleItemTrue / ClickableCircleItemFalse  (radio-style circular clickable variants)

    Line                              (OCR line grouping of Word elements; independent of KV hierarchy)
     └─ Word                          (atomic OCR unit — the only element with Transcription/Language/flags)

Key modeling rules:

-   **Word** is the atomic unit everywhere. Every Key, Value, SubKey,
    SubValue is ultimately composed of/linked to underlying Word
    elements (Guidance 6.1: "the relationship between Word and KV
    element needs to be annotated" --- a Word belonging to a Key must
    appear in that Key's children).
-   **KeyValueContainer (KVC)** = the container for exactly one
    Key+Value relationship (can be nested: a KVC can itself act as a
    child of a Parent-Key inside a GroupedContainer --- this is how
    Hierarchical KV / HKV is modeled).
-   **Complex/Hierarchical KV (HKV)** = a Parent-Key whose Parent-Value
    is made up of multiple Child KVCs (see Sec. 7 Rule 2.3--2.5, and
    Guidance 1.x clickable-nesting examples).
-   A **Value** can simultaneously be a **Clickable** target --- i.e. a
    Value box can wrap both an OCR word element and a Clickable box (see
    Sec. 7.4).

# 4. Word Annotation Rules (Segmentation & Word Level)

These come from the OCR Rule Book Sec. 1--3 and the internal
"General/Word Annotation Rules" doc. Apply in this priority order:
**explicit rule → printed-vs-handwritten precedence → annotator best
judgement.**

## 4.1 General Principles

-   **Overlap text** can be annotated (draw the box for the readable
    portion).
-   **Blurry text up to 50%** can still be annotated with a bounding
    box; if it crosses into unreadable, use the transcription skip
    reason (`Blurry` / `Unknown script`), not a skipped bounding box.
-   **Rotated text:** orientation must be followed; bounding box
    (rotated) is the default, not polygon.
-   **Bounding box is the default** annotation shape. **Polygon** is
    used only for: (a) curved text, (b) non-standard geometry text,
    or (c) text at the very edge of the document where a bounding box
    would error as "out of bounds."
-   **Polygon direction:** always plot points clockwise, starting from
    the top-left of the word/segment.
-   Consistency rule: if a text is annotated as polygon/box in **Word**,
    use the **same shape type** in **Line**.
-   **Watermarks CAN be annotated** (and are labeled
    `WritingType: Printed`).
-   **Trace marks CANNOT be annotated** (e.g. faint pen
    impressions/ghosting) --- skip entirely.
-   **Redacted content is NOT annotated.**
-   **Continuation dots / visual dividers are NOT annotated**
    (e.g. table-of-contents leader dots `.........`), nor are bullet
    points, nor pure layout dividers.
-   All bounding boxes (Line and KV) must stay **aligned to the
    underlying Word boundings** --- no drift.

## 4.2 Symbol & Punctuation Spacing Rules ("Space Rule")

These decide whether a symbol merges into the same Word box as an
adjacent word, or gets its own box.

**A. Right-side, single space, one symbol → merge (word + space +
symbol):** Symbols: `- ; : ? ! () <> [] {} . , '' ""` Examples: `Hi ;` /
`Hello :` / `Hi ?` / `Hi !`

**B. Two symbols on the right, each separated by ≤1 space (word +
symbol1 + space + symbol2) → merge as one box:**

-   Symbol 1 = `.` `'` `"`
-   Symbol 2 = `:` `;` `)` `?` `!` `-` `~`
-   Hyphen and minus are treated as the *same* symbol `-`.
-   **Exception:** inside a math equation, do **not** merge a
    hyphen/minus if there's a space around it. Examples: `Yes. :` /
    `We! ;` / `Did? .` / `It' !`

**C. Left-side, single space, one symbol → merge (symbol + space +
word):** Symbols: `() {} [] <>` Examples: `( cool` / `{ hot` / `[ up` /
`< down`

**D.** `#` **and** `:` **with 0 or 1 space between them → merge into one
box.**

**E. More than 1 space between word and symbol → always bound
separately.** Example: `(  04  )` / `Apple   -02`

**F. These symbols ALWAYS bound separately if any space is present:**
`@ # $ % ^ & + / = |` Examples: `Success &` / `Party ^`

**G. Pipe symbol** `|` **is always its own, separate word box** (unless
it is clearly a layout/text divider, in which case do not annotate it at
all).

**H. Copyright / Trademark symbols (© ™ ®):**

-   If directly attached to the word with no space → bound together with
    the word.
-   If there's a space between the copyright symbol and a following year
    → bound separately.

\*\*I. Stars / asterisks (\*):\*\*

-   Annotate a star only if it's inline with text (not part of a
    figure/decoration).
-   If spaced apart from surrounding text, bound separately.
-   If **\> 8 consecutive** asterisks/repeated symbols → **ignore
    entirely, do not annotate**.
-   If **≤ 8** consecutive with no space to the adjacent word → merge
    into one box.
-   If ≤ 8 repeated symbols **with** a space to the adjacent word →
    bound separately.
-   Currency boxes with trailing asterisks: bound
    `currency symbol + asterisks` as one box, `amount` as a separate
    box, if a space separates them.
-   Exception carve-out: ratings/receipt stars **can** be annotated even
    in repeated form (subject to the 8-symbol cap).

## 4.3 Currency & Numeric Symbol Rules

-   **Currency word-format + amount:** if the currency is spelled out as
    a word and directly touches the amount, treat as a single word box.
-   **Printed amount + printed currency symbol:** merge into one box if
    ≤1 space between them; if \>1 space, bound separately.
-   **Handwritten amount + handwritten currency symbol:** always merge
    into a single box, **regardless of spacing**.
-   **Printed currency + handwritten amount:** merge if \<4 spaces;
    bound separately if ≥4 spaces.
-   **Single-character symbols attached to numbers** (currency symbols,
    `+`, `-`, `%`) --- in addition to the above:
    -   Printed: merge if ≤1 space from either side.
    -   Handwritten: merge if ≤4 spaces from either side.
    -   Equation exception: don't merge a spaced hyphen/minus inside an
        equation.
-   **Mixed handwritten+printed numeric figures** (e.g. part of an
    amount typed, part handwritten in) → single bounding box.

## 4.4 Clickables & Radio Buttons (Word-level)

-   **Only annotate FILLED checkboxes/marks** as words --- empty
    checkboxes/radio buttons are not annotated at the Word level (they
    may still need a Clickable box, see Sec. 8).
-   The **word box wraps only the mark** (✓ / X / V / value), **never
    the surrounding box outline** --- this applies to both printed and
    handwritten cases.
-   **Handwriting ambiguity rule:** only transcribe `✓` when it is 100%
    unambiguously a checkmark. If ambiguous, transcribe as `\` or `/`
    instead.
-   **Bullets and radio-button glyphs (◆ ▲ ⟶ ● ⦿) are NOT annotated** as
    words *unless* they can be flagged with a clickable attribute ---
    then annotate them. `>` and `-` used as expand/collapse affordances
    for interactive text ARE annotated.
-   **Empty radio buttons are not annotated.**
-   If **characters/symbols appear without an accompanying checkbox
    shape**, bound just those characters.

## 4.5 Number Formats

-   **Printed phone/fax numbers:** if spaced, bound each number group
    separately.
-   **Handwritten phone numbers:** merge if ≤2 spaces between digit
    groups; separate if \>2 spaces.
-   **Alphanumeric meaningful IDs (SSN, employee #, policy #):**
    -   With a **gray/visual separator** between groups → bound each
        group as a separate word box.
    -   Without a separator → bound as one box, following the natural
        spacing in the document.
-   **Fractions:** numerator and denominator get **separate** word
    boxes.
-   **Box-form fields (individual character cells):** if no separator
    between boxes → merge the value into a single word box. If boxes are
    separated by a gap/dash/slash → bound each cell/segment separately.
    Transcription of the merged box-form value must have **no spaces**.
-   **Date formats DD/MM/YYYY (printed, single-space separated):** bound
    day/month/year **separately**.
-   **Handwritten dates:** can be bound together as a single box.
-   **MRZ codes (passports):** annotate the **entire string** as one
    word AND one line, **even if it exceeds the normal 8-repeat-symbol
    cap** --- this is a deliberate exception. Transcribe the full `<<<<`
    filler exactly as shown.
-   **E13B / MICR check fonts:** transcribe using the actual E13B glyphs
    `⑆ ⑈ ⑇ ⑉`. Include embedded asterisks up to 8 repeats. No space →
    transcribe no space; 1 or more spaces → transcribe as exactly 1
    space.

## 4.6 Vertical & Rotational Words

-   **Vertical words:** single bounding box per word by default,
    `IsVertical = True`. If letters have unusually large spacing,
    annotate each letter separately instead.
-   **Rotated words:** always use **bounding box** (rotated to match
    orientation), not polygon --- polygon is reserved for
    curved/non-standard-geometry/edge-of-document cases. When rotating
    the box, its orientation handle (white circle) must point in the
    same direction as the text's "up."
-   Rotated text is **not** the same as vertical text --- for rotated
    words `IsVertical = False`, but you must still capture/transcribe
    the rotation angle if the tool supports it, and set `TextAlignment`
    before transcribing if annotated via polygon.

## 4.7 Superscript / Subscript

-   Annotate super/subscript together with the word it touches (left or
    right neighbor --- in English, usually the word on the **left**).
-   If genuinely ambiguous whether to split or merge an inline equation
    term, **default to merging**.
-   Order in transcription: **superscript before subscript**, e.g. image
    `Word¹₂` → transcribe as `Word¹₂` (super first, then sub).

## 4.8 Things to Remember --- Word Annotation

-   Avoid cropping words.
-   Avoid loose boxes.
-   Avoid overly tight boxes.
-   Be precise.
-   Never leave a truncated word annotation.

# 5. Line Annotation Rules

## 5.1 Core Space & Structure Rules

-   **4-space rule:** words within 4 spaces of each other on the same
    visual row belong in **one** line box; beyond 4 spaces, start a
    **new** line box.
-   **Column rule:** in a multi-column layout, each column gets its own
    line(s), even if the horizontal gap between columns is \<4 spaces.
-   **Font-size rule:** if font size differs by ≥50% between two runs of
    text on the same row, split into separate line boxes --- **unless**
    it's a mixed printed+handwritten line (see below), in which case
    keep them in one line box regardless of size difference.
-   **Printed + handwritten mixed on the same row:** always treat as
    **one line**, within the 4-space rule, even if font-size differs
    \>50%.
-   **Rule-conflict precedence:** when handwritten and printed rules
    disagree for the same line, **printed rules win**.

## 5.2 Tables

-   **Every table cell gets its own line bounding box**, regardless of
    the 4-space rule, the 50% font rule, or the printed/handwritten rule
    --- those three rules only apply *within* a cell's own content, not
    across cell boundaries.
-   Separators between/inside box-form or currency cells (dash, slash,
    currency symbol) are bound separately from the numeric/text content
    unless they're specifically part of a designated box-form field.

## 5.3 Box Forms

-   If cell gaps are \<2 box-widths (with or without a small space),
    bind as a **single line**, for both printed and handwritten.
-   Box-form dates like `mm/dd/yyyy` presented as boxes → bound together
    as one line.

## 5.4 Checkboxes

-   Draw the checkbox's **line box** and the checkbox **word box**
    **separately**.
-   If the checkbox is wrapped inside required-annotation text symbols,
    contain and transcribe them as a single box (both word and line).

## 5.5 Currency in Lines

-   Printed amount + printed currency with **\>1 space** → separate line
    boxes.
-   Handwritten amount + handwritten currency → **always** single line
    box regardless of spacing.
-   Printed currency + handwritten amount, **≥4 spaces** → separate line
    boxes.
-   Digital and handwritten numeric parts of the same figure → single
    line box.

## 5.6 With/Without Column Headers

-   Whether or not a table has an explicit header row, if it functions
    as a logical table (visible or implicit dividers), each cell still
    gets its own bounding box.
-   Implicit column dividers (no visible line, but clear alignment)
    still count as column boundaries.

## 5.7 Color Differences

-   Even if text within a line has different colors, still apply the
    4-space rule normally --- color does not force a split.

## 5.8 Things to Remember --- Line Annotation

-   Avoid cropping.
-   Avoid loose/tight boxes.
-   Be precise.
-   No truncated lines.
-   Follow the correct space rule per document category.
-   No overlapping line boxes.

# 6. Word Properties (Attributes)

Every Word must be checked/tagged for:

  -----------------------------------------------------------------------
  Property                            Meaning / Rule
  ----------------------------------- -----------------------------------
  **WritingType: Handwritten**        Word is hand-written. If a document
                                      is otherwise printed but a word is
                                      filled in by hand, it is still
                                      `Handwritten`.

  **WritingType: Printed**            Includes normal printed text,
                                      figures, diagrams. **Watermarks,
                                      dotted lines, and stamps are also
                                      tagged Printed.**

  **IsSignature**                     Any signature --- mark regardless
                                      of handwritten/printed form. A
                                      printed signature is tagged
                                      `Printed` + `IsSignature`; a
                                      handwritten one is `Handwritten` +
                                      `IsSignature`.

  **IsVertical**                      Vertical-orientation words.

  **IsWatermark**                     Visible watermark text.

  **isBoxForm**                       Text that lives inside a box-form
                                      field structure.

  **isMath / isLatex**                Inline or display math content (see
                                      Sec. 10).

  **Skip Transcription**              Set when a word cannot/should not
                                      be transcribed (see Sec. 7 for skip
                                      reasons).
  -----------------------------------------------------------------------

# 7. Transcription Rules

## 7.1 General

-   Transcribe the **highlighted word exactly as shown**, including all
    punctuation
    (`. , : ; - & $ @ " ? ! ' [ ] { } # % ^ * + = _ \ | ~ < > € £ ¥ •`
    etc.).
-   If a character can't be typed, copy-paste it from an approved
    external source (see Unicode table in Sec. 7.5).
-   If a word is genuinely **not readable**, skip transcription (mark
    "Unknown Script" or similar skip reason) rather than guessing.
-   Rotated words are still transcribed normally (not vertical, but
    still fully transcribed) --- capture the rotation angle if the tool
    provides that field.
-   **Inverted text** → skip transcription, mark "Inverted text."
-   **Blurry text (unreadable)** → skip transcription, mark "Blurry."

## 7.2 Signatures

-   If a signature is **not legible** → transcribe as **Unreadable**.
-   If a signature **is legible** → transcribe the actual name shown,
    e.g. `"Donald Anderson"`.

## 7.3 Vertical Words

-   Vertical words are **mandatory** to transcribe --- do not skip. Also
    set `IsVertical = True` in the word-property panel.
-   For rotated (non-vertical) words at 90/180/270° or arbitrary angles:
    also transcribe fully (don't skip), `IsVertical = False`, and
    capture the angle.

## 7.4 Superscript / Subscript

-   Two allowed methods:
    1.  Use the tool's superscript/subscript buttons (or shortcuts
        `Ctrl Shift >` / `Ctrl Shift <`) to convert selected characters.
    2.  Copy-paste from the supported character sets:
        -   Superscript:
            `⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ`
        -   Subscript: `₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ`
-   If the specific super/subscript character isn't supported → **Skip
    transcription, reason = Unknown Script.** Never fake it by
    substituting a regular-size letter.
-   **Copyright/Trademark exception:** `® ™ ℠` are treated as
    superscript symbols but should always be transcribed (never
    skipped); the trademark symbol for subscript position can stay in
    regular (non-subscript) form.
-   Tip: when unsure if a sub/superscript character is upper- or
    lower-case, toggle it back to normal size to check, then re-apply
    the sub/superscript formatting.

## 7.5 Special Characters / Unicode

-   \~79 special ASCII characters are supported (accented Latin letters,
    currency signs, Greek letters used in math, √, ±, ÷, ≈, °, ² etc.)
    --- if a character isn't on the supported list, **skip
    transcription**.
-   Full reference table (ASCII code → glyph → description) should be
    kept as a lookup appendix; when in doubt, check whether the
    character exists in that approved list before typing/pasting it
    manually.
-   3 characters (₧, ª, º) may render with a different font family in
    the UI than their canonical glyph --- don't be alarmed if they look
    visually different in the tool vs. a reference table.

## 7.6 Characters --- Clickables

-   For clickable transcription: always use a **capital** `X`; for a
    genuine checkmark use `✓`; if it's clearly a `V` shape, transcribe
    as capital `V`.
-   Any star/asterisk shape is transcribed as `*` and treated under
    asterisk word-boxing rules.

## 7.7 E13B / MICR

-   Transcribe actual E13B glyphs `⑆ ⑈ ⑇ ⑉` where present, with digits
    typed normally around them. No-space vs any-space collapses to
    "transcribe exactly 1 space" when 1+ spaces are present.

## 7.8 Blurry / Struck-through

-   Too blurry to read → transcribe as **Unreadable**.
-   Struck-through but still legible → transcribe the actual word, and
    separately flag/label it as **"StrikeThrough."**

## 7.9 Rotated Text via Polygon

-   If a rotated word is annotated with a polygon, the **TextAlignment**
    angle must be set in the transcription step **before** typing the
    transcription.

# 8. Key-Value (KV) Annotation Rules

## 8.1 Definitions

-   **Key** = a unique identifier/label pointing to its value. Can span
    multiple words; draw one bounding box across all words forming the
    key.
-   **Value** = the data associated with a key. Can be text, a
    checkbox/radio state, or empty.
-   **Simple KV** = strict one-to-one Key↔Value relationship.
-   **Complex / Hierarchical KV (HKV)** = a Parent-Key whose
    Parent-Value is composed of multiple nested Child KV pairs (see Sec.
    8.6).
-   **Empty KV** = a Key exists but currently has no value content
    (still must be annotated per the Blank-Value rules, Sec. 8.7).
-   **KV pair is never detected inside dense prose/paragraph text** ---
    only in structured label:value relationships (Sec. 8.2 and Guidance
    11.1).

## 8.2 KV-in-Tables --- Base Definition

-   **2×N table with a header row, or N×2 table with a header column:**
    IS expected to be detected/annotated as KV pairs (one KV per
    row/column).
-   **General N×M table where each row/column still maps 1 key : 1
    value:** also detected as KV.
-   **Column (or row) with ONE header cell and MULTIPLE non-empty
    content cells:** is **NOT** KV --- that's a plain data column, not a
    key-value relationship (a key can't legitimately point to many
    different unrelated values at once).
-   **KV pairs living inside a single table cell:** annotate as KV as
    usual, nested inside that cell.
-   **Non-simple-grid tables (merged cells):** still annotate any
    legitimate KV relationships found within.
-   **3+ columns tables in general = NOT KV/HKV** (this is structural
    "Table" territory) --- **exception:** annotate the table's Title as
    Key and the table itself as Value **only if** the table has child KV
    pairs nested inside it (making it a true HKV). See Sec. 8.9 (Table
    exceptions) for the IRS/ACORD/Total-line carve-outs.

## 8.3 Core Rules

1.  If underlying OCR is single-bounded, follow normal KV rules and
    annotate Key/Value by selecting the relevant word(s).
2.  If the Key is only *implicit* and the Value can't be clearly
    judged/associated, **do not** treat it as a KV pair.
3.  **Templates and Samples must have matching HKV structure and Key
    sets** --- if a sample deviates unexpectedly from its template's key
    layout, flag it, don't silently improvise a different hierarchy.
4.  If a **sample**'s key has an empty value, mirror the **template**'s
    annotation as the reference structure. If a value exists but is
    logically positioned elsewhere/oddly, still identify the
    logically-matching Key and annotate accordingly (don't force
    positional-only matching).

## 8.4 Samples vs. Templates --- the Central Distinction

This shows up throughout the SOP and is the single most common source of
QA errors. Memorize this table:

  -----------------------------------------------------------------------
  Scenario                Template (blank form)   Sample (filled
                                                  document)
  ----------------------- ----------------------- -----------------------
  **Blank Key** (label    **Annotate** with a     **Do NOT annotate**
  with no matching key    maximal bounding box,   
  text visible,           same treatment as a     
  e.g. implicit form      blank value             
  field)                                          

  **Blank Value** (empty  **Must annotate** ---   Value box **snaps
  fillable space)         Value box covers the    tightly** to whatever
                          entire empty fillable   text/mark is actually
                          space (maximal box),    present; if truly empty
                          even if it              in the sample too,
                          overlaps/encompasses    cover the empty space
                          other nearby KV pairs   same as template

  **Empty Clickable,      Annotate Clickable      If clickable is
  matching blank Key**    **False** + Value box   empty/false with a real
                          (snapped to clickable   key → annotate both
                          box)                    Clickable + Value; if
                                                  no key at all →
                                                  Clickable only

  **Clickable with no     Still annotate as       **Do not** annotate as
  matching Key at all**   Clickable (per Guidance Value --- Clickable
                          1.2 "blank Keys" rule   only
                          for clickables); no     
                          Value                   
  -----------------------------------------------------------------------

## 8.5 Guidance Set 1 --- Clickables ↔ KV (full ruleset)

Also cross-reference the standalone **Key Value -- Clickables SOP**
(Sec. "Clickables Rulebook" summarized in Sec. 8.8 below) for the
general checkbox-drawing mechanics; this section covers how clickables
interact with KV pairing specifically.

**Core annotation elements for any clickable:**

-   **OCR bbox** (the checkmark/word itself, if present)
-   **Clickable bbox** (the checkbox/radio cell --- always around the
    *box*, never around just the mark)
-   **Value bbox** (links Value → OCR word element)

**Four possible scenarios:**

1.  **Clickable = True, and a KV pair exists:** annotate Clickable + KV
    (Key & Value) + OCR. The Value box must cover **both** the OCR
    checkmark and the Clickable box. If the checkmark sits flush with
    the clickable cell border, the Value annotation should match the
    Clickable annotation's size exactly.
2.  **Clickable = False, and a KV pair exists (a Key sits beside the
    box):** annotate both Value and Clickable; the Value box **snaps
    to** the Clickable box.
3.  **\[Template\] Blank clickable with a matching blank Key on the
    template:** annotate Clickable + Value box, Value snapped to
    Clickable.
4.  **\[Sample\] Clickable True/False but NO matching Key (no KV pair at
    all):** annotate **Clickable only** --- do not create a Value (per
    the blank Value/Key rule).

**Other clickable+KV situations:**

-   **Unclear/No-key checkbox:** still draw the Clickable bbox via "Add
    Clickable Item," even without any matching Key.
-   **Implicit empty Clickable on a template with several sub-clickables
    under one parent Key:** annotate Clickable **False** + a **maximal**
    Value box (to capture wherever the user might eventually
    write/mark), nested as Child-KVs of the shared
    Parent-Key/Parent-Value.
-   **Blank Keys with clickables:** all clickables that DO have a blank
    key on a template must be annotated as KV; on samples, clickables
    with genuinely no key stay Clickable-only.
-   **Bullets:** never annotate a bullet glyph as a Radio
    Button/Checkbox.
-   **Multiple clickables for one shared Key:** e.g. Left/Right/Both
    style repeated options --- each gets its own Clickable, but they
    nest as Child-Values under the same Parent Key **only if the
    table/structure semantics genuinely support one shared key**;
    otherwise treat as table cells (see Sec. 8.9 Exception 2).
-   **Y/N as text (not checkmark):** if a "checkbox" actually contains a
    typed `Y`/`N` letter rather than a physical checkmark, annotate it
    as **Value only --- not as a Clickable.**
-   **Circled/handwritten-overflow marks:** if a user circles the Y/N
    text or writes beyond the checkbox boundary, the Value box must
    expand to cover both the clickable box and the helper Y/N text.
    Genuinely ambiguous circled marks may need engineering
    post-processing / escalation.
-   **"If Yes/If No" nested clickables:** default to nesting the "If
    Yes" follow-up question as a **child** of the parent Yes/No question
    **when the form has explicit instruction text** telling the filler
    to answer #2 only if #1 = Yes. If there's **no such instruction**,
    treat all the clickables as **same-level siblings** under one shared
    Parent Key instead of forcing an artificial nesting.
-   **Tabular Yes/No batches (e.g. IRS Form 990 Sec. 7a--7h):** to avoid
    overcomplicating the hierarchy, annotate each row's Yes/No as
    **same-level Child KVs**, even though the form text says "If Yes."
-   **Splitter case** (Key--Value on one end, Clickable on the other end
    of the same line): the Key+Value pair forms a Child-KVC, which then
    becomes the **Parent-Key** to the Clickable as **Parent-Value.**

## 8.6 Guidance Set 2 --- Key Annotation

-   **Multiple words forming one key:** bound as a single Key box; don't
    include extra whitespace unless a real structural divider (cell
    border, underline) exists.
-   **Key without Value:** if 2+ keys share no direct value (or vice
    versa), club the like-elements together (all "keys w/o value" into
    one Key group, all "values w/o key" into one Value group), both
    nested under the same KV Container.
-   **Parent Key with multiple Child KV pairs ("itemize:" pattern):**
    e.g. a numbered "Expenses recorded on books (itemize): a) ... b)
    ... c) ..." --- parent Key = the itemize instruction, parent Value =
    all the lettered sub-items + their sub-values. Each lettered line
    becomes its own Child-Key/Child-Value UNLESS an item has a logically
    independent Key (then it should be a separate top-level Key, not
    folded into the itemize group).
-   **KV pair nested within a Key:** bound the inner KV Container first,
    then bound the outer Key/Value around it.
-   **Multiple Keys, single shared Value:** bound each key individually,
    then wrap all keys + the one value inside a common KV Container.
-   **Blank Keys --- see Sec. 8.4 table** (templates: annotate maximal;
    samples: skip).
-   **Symbol as Key (e.g. **`#`**):** if a `#` precedes a set of related
    labels (Type/Description/Manufacturer), annotate `#` as the Parent
    Key and bind the labels together as a single Value box.
-   **Indexed Key (e.g. "12c", "12d"):** bound the index number **and**
    its label text together as one Key.
-   **Index directly tied to the next word(s) with no other logical
    association** (e.g. "B Check if applicable"): treat `index + words`
    as a single Key.
-   **Index tied to a whole section** (e.g. "C" → Name, DBA, Street,
    Room/Suite): annotate the index as a standalone HKV Key, with a
    larger Value box encompassing all the KV pairs logically nested in
    that section.

## 8.7 Guidance Set 3 --- Value Annotation

-   **Multiple words in one value:** bound together, no extra padding
    unless real structural dividers exist.
-   **Value without Key:** club unassociated values together similarly
    to "Key without Value," both under one KV Container.
-   **KV pair nested within a Value:** annotate inner KV first, then
    outer.
-   **Words in parentheses:** treated as ordinary content of whichever
    Key/Value they belong to --- don't split them out separately.
-   **Multiple sub-values, single Key:** bound each sub-value
    individually, and wrap the group in the parent Value's KV Container.
-   **Blank Values (generic rule):** bound each individual blank value,
    wrapped inside the KV Container --- even inside dense-looking
    paragraphs, annotate the Key and its fillable empty space(s) as
    Value.
-   **Blank Values --- Sample vs Template (see also Sec. 8.4):**
    -   Template: value bbox must be **maximal** --- cover the *entire*
        empty writable space, since a real user could write anywhere in
        it, even overlapping the key text. Exception: if the form
        explicitly states something like *"No explanation needed,"* skip
        the maximal-value annotation --- no writable space is implied.
    -   A static symbol that's genuinely part of the template (e.g. a
        printed `$`) still gets a maximal Value box.
    -   Sample: if filled with text/`NA`/a symbol, snap the Value box
        tightly to just that content.
-   **Value bounding box size (general looseness rule):** don't create
    loose boxes on samples --- snap to actual content; on templates,
    intentionally go maximal for writable space.
-   `%` **symbol values:** value box should extend to cover the full
    empty space (a handwritten value could exceed/overwrite the `%`
    symbol). Multiple `%` sub-values under one parent Key get bound
    individually as SubValues, wrapped in one parent Value box.
-   `$` **symbol values:** whether `$` is part of the Key or the Value
    depends on the form's semantic intent (case-by-case) --- but the
    general default is that `$` + the writable amount space is the
    **Value**, and the label word (e.g. "AMT") is the **Key**, even if
    there's a visible gap between them.
-   **MM/YY or MM/DD helper text:** if the field genuinely has separate
    helper text (like "MO/YR") near an empty value that matches the
    Key's own instruction, that helper text can be **excluded** from the
    Value box.

## 8.8 Guidance Set 4 --- Key-Value Container (KVC)

-   **Single KVC:** one Key + its Value(s), never overlapping another
    KVC's boundary.
-   **Multiple/Nested KVCs:** an outer KVC can contain inner KVCs (this
    is how HKV/complex structures are built) --- annotate inner KVC(s)
    first, then the outer wrapper.
-   **KVC for Tables:** when a KV pair sits at a table header/structure
    boundary, the KVC bounding box should extend to match the **table's
    own border lines** --- this exception only applies to genuine
    table-header-to-table KV relationships, not general KV boxes.

## 8.9 Guidance Set 5--6 --- Multiple Keys/Values, and OCR↔KV Linkage

-   **Multiple keys and multiple values on the same line/row:** annotate
    each Key and each Value individually, then wrap the full set inside
    one shared KV Container.
-   **OCR↔KV linkage requirement:** every Key/Value element must be
    transcribed at the *text* level too, and the Word↔KV relationship
    must be captured (a Word that belongs to a Key must show up in that
    Key's children list, and same for Values).
-   **OCR/KV bounding-box conflicts:** resolve using document
    semantics/spacing --- e.g. if two characters have zero gap
    (`I-Tax`), treat as one OCR word, but the surrounding phrase
    (`Part I-Tax Computation`) may still form a single multi-word Key.
-   **Text → GT (ground truth) annotation:** each Word gets exactly
    **one** text annotation (not multiple conflicting "gt" entries). For
    illegible sample values, it's fine to leave text un-transcribed
    (`skipped = True`); for non-value/template text, cross-check the
    reference template to fill in the correct ground truth text.

## 8.10 Table-Specific KV Exceptions (Use Case: Table Structures)

-   **2-Column / 2-Row tables with strict 1:1 mapping** → annotate as KV
    pairs normally.
-   **3+ column tables → generally NOT KV/HKV** (treat as pure Table
    structure) **except:**
    -   **Exception 1 (IRS tax / ACORD health forms only):** two Values
        can be bound under a single Value box when they're logically
        related, each individual number becoming a SubValue. These forms
        get annotated with **both** KV-in-table pairs **and** general
        table structure.
    -   **Exception 2 (single-cell KV pair):** if a KV pair (e.g. "From
        -- Date", "To -- Date") lives entirely inside one table cell,
        annotate it as KV regardless of how many columns the table has.
        Also annotate the Table's Title as Key + the whole table as
        Value, since child KVs now exist inside it (making it a
        qualifying HKV).
    -   **Exception 3 (Total/Tax/Subtotal 1:1 lines):** in 2--3 column
        tables, a Total/Tax/Subtotal row with exactly one blank + one
        `$`-amount (not two `$`-amounts, unless IRS/Anthem-form
        exception) qualifies as KV --- bind the blank + `$`-amount
        together as SubValues under one Value box tied to the
        Total/Tax/Subtotal Key.
-   **Negative scenario --- single Key, multiple non-adjacent Values
    across rows:** e.g. a "Low" row value appearing on both sides of a
    shared Key with no direct 1:1 adjacency → **do not** annotate as KV
    (fails the 1:1 rule).
    -   **1099-series exception:** serial-numbered lines (10a, 10b,
        11...) with 1 Key and 2 SubValues **are** annotated (1 Value box
        holding 2 SubValues). If one SubValue is blank, annotate it
        maximally and snap the overall Value box to match.
-   **Key in the middle of a table's value columns:** still annotate
    normally per the established row pattern.
-   **Grey/shaded value cells:** annotate identically to white cells ---
    maximal Value box regardless of shading, since a customer could
    still write there.
-   **Table with empty values generally:** annotate with a maximal Value
    box, same as any other blank-value rule.
-   **ACORD "CO#"/"POL#" style table cells:** template → maximal
    empty-space Value; sample → snap tightly to the entered text.

## 8.11 Use-Case Quick Reference (condensed)

  -----------------------------------------------------------------------
  UC                                  Rule
  ----------------------------------- -----------------------------------
  Headers/Footers                     Can be annotated as KV pairs.

  Arithmetic operators (`+ − × ÷`)    Ignore them entirely --- don't
  between KV pairs                    merge into a Value/Key. If multiple
                                      values are separated by operators,
                                      bind the string as one Value with
                                      each number as a SubValue;
                                      operators sandwiched between
                                      numbers are ignored.

  College/Driver's-license IDs        "Student"/Index+static-text is Key;
                                      full name/static label text is
                                      Value.

  Forms with separate input boxes     Each individual input box = its own
                                      Value container.

  Dense forms with numbered lines +   Numbered static text = Child Key;
  Y/N                                 clarification text below = Child
                                      Value; Y/N beside it = a **Value**,
                                      not a Clickable (Y/N is textual,
                                      not a checkmark). Blank Value still
                                      needs a maximal bbox.

  Utility bills                       Skip mid-document rate math (kWh ×
                                      rate); annotate simple "Energy
                                      Charge -- Rate" style Key→`$amount`
                                      Value; skip section headers like
                                      "Supplier"/"Delivery" (not real KV
                                      pairs).

  Signatures without the literal word Use the person's name/role as Key,
  "Signature"                         and the signature mark itself as
                                      Value.

  Signature block                     Sample: snap Value tightly to the
  (Signature/Date/Title)              actual signature/date/title text
                                      above each key. Template: Value
                                      bbox must cover the *entire* empty
                                      space including the key text itself
                                      (a handwritten signature could
                                      sprawl over the printed label).

  Disclaimers / Applicant signature   Question text = meaningful Key; its
  blocks (ACORD)                      answer = Value; serial numbers +
                                      adjoining phrase = sub-keys forming
                                      the parent Key; nested KV pairs
                                      roll up into the parent Value.

  Dense static/prose text (no real    Do **not** annotate --- it's prose,
  KV)                                 not a KV pair, even if repeated
                                      across many form instances.

  Non-dense instructional text with   Can still be annotated as KV even
  real code:meaning pairs             if it reads like a paragraph.

  "Please note:" text blocks          Annotate normally as KV if the
                                      content isn't dense prose.

  Instructional prompts ("Sign Here", Annotate the instruction itself as
  "Type or Print")                    a **Parent Key**.

  Parking-lot tickets w/ no proper    Do not force a KV annotation if
  key                                 there's no legitimate Key.

  Website info on bills               Annotate only if an explicit KV
                                      relationship exists (e.g. "Go to:"
                                      → URL). A bare phone number with no
                                      explicit Key label should not be
                                      annotated.

  Receiver/Payer Account \# + Address Full "Payer Account #" phrase =
                                      Key; account number/address =
                                      Value, annotated per the specific
                                      field's own label context.

  Date fields formatted               Helper format text stays part of
  "(MM/DD/YYYY)" as helper text       the Key; the date itself (or empty
  within the Key                      field) is the Value.

  Rotated Key/Value text              Still gets annotated normally,
                                      following the rotation rules from
                                      Sec. 4.6.

  Phone numbers with Home/Bus/Cell    Parent Key = "Primary Phone
  options (ACORD)                     Number"; Child-Keys = Home/Bus/Cell
                                      with Clickable Child-Values; an
                                      independent phone number typed
                                      elsewhere on the line is its own
                                      independent Child-Value; Parent
                                      Value = all of the above combined.

  Page/Sheet numbers that can be      Annotate as KV ("Page" Key →
  edited                              page-number Value).
  -----------------------------------------------------------------------

# 9. Math Symbols & Equations Rules

Applies to inline and display equations in OCR word annotation.

## 9.1 Not Currently Supported --- Skip These

-   **Mixed multi-line equations** that are not true display equations
    (i.e. any single equation term spanning more than one visual line).
-   **Matrix formulations.**

## 9.2 General Transcription

-   If a word carries **both** superscript and subscript, transcribe
    **superscript first, then subscript** (e.g. `Word¹₂`).

## 9.3 Inline Equations (math terms embedded in a normal text line)

-   Treat inline equations like regular text as much as possible ---
    same OCR rules apply.
-   **Superscripts/subscripts:** single box, merged with the touching
    word (left or right --- usually left in English).
-   **When in doubt whether to split or merge part of an inline
    equation:** default to **merge**.
-   **Math/comparison operators** (`= + > < ∩ ∃ ∪ ∍ ≪` and more, plus
    short arrows) --- **except hyphen/minus** --- merge as a single word
    together with the word on the **left and right**, up to 1 space gap
    tolerated on each side.
-   **Arrow symbols:**
    -   Annotate if the arrow spans ≤2 characters in width and is
        adjacent to text ("short arrows").
    -   Do **not** annotate if longer than 2 characters, or not near
        text.
    -   If an arrow functions as an operator between two math terms,
        merge with both left and right terms (same rule as short
        arrows).
    -   Never annotate arrows that are actually bullet marks or diagram
        arrows.

## 9.4 Display Equations (equations with dedicated whitespace, no directly preceding/following text)

-   Merge math terms together more liberally --- up to **1 space**
    tolerance between merged terms.
-   **English words inside a display equation are still broken out into
    separate word boxes** (don't merge English words into the
    surrounding math symbols).
-   Skip equations combining single-line and multi-line terms (same as
    Sec. 9.1).
-   **Fraction marks in display equations must be combined into a single
    box** (numerator, bar, and denominator together --- this is the
    display-equation-specific exception to the normal fractions rule in
    Sec. 4.5, which splits numerator/denominator for plain numeric
    fractions).

# 10. Segmentation & Rectification (Segrect) Rules

*(Applies to the* `segrect` *task type --- establishing the document
boundary and grid alignment before word/KV work begins.)*

## 10.1 Segmentation

-   Annotate using **polygon (multi-point)** annotation.
-   No hard limit on number of points, as long as the polygon includes
    the full document.
-   Minor background inclusion is acceptable in small amounts.
-   **Scanned image where the doc fills the frame:** segmentation should
    include the **entire scanned image**, not just the visible document
    edges --- *unless* document edges are clearly visible within a
    larger background, in which case segment only the document.
-   **Folded paper:** include the folded portion in the segmentation.
-   **Watermark over a receipt:** include the entire document;
    rectification should prioritize the **majority of the text** even if
    that distorts the watermark/title area.
-   **Content on the same 3D plane as the main document** (e.g. adjacent
    printed text on the same surface): include it.
-   **Text inside a map:** annotate it.
-   **Secondary labels/text like "Message", "Today"**: include as part
    of segrect; align the rectification grid to the document's own text
    while still covering all image text.
-   **"Shot on \[phone model\]" style camera watermark text:** include
    as part of segrect; ensure receipt words/lines are axis-aligned
    during rectification.
-   **Document containing only a short number (e.g. 4 digits):** still
    annotate normally.
-   **Scanned body/health imagery:** annotate under the "healthcare"
    dataset category.
-   **Background text on a different plane than the primary doc:**
    exclude it, keep only the primary document.
-   **A few stray letters outside the main document:** still follow
    standard segrect practice (crop to the document itself; the few
    outside letters don't need separate treatment).
-   **Document + unrelated object with no text on it:** ignore the
    object, segment only the document.
-   **Multi-orientation text within one document is allowed** as long as
    rotations are cardinal (0/90/180/270°) ± 10°, and the
    rectification/orientation follows the **majority** of the text (or,
    if equal split, pick one dominant orientation consistently).

## 10.2 Documents to DECLINE (exclude from the dataset entirely)

-   Non-document objects (e.g. a product photographed next to a
    receipt).
-   Two documents on clearly different physical planes.
-   Documents where most words sit at wildly inconsistent angles (beyond
    the ±10° cardinal-rotation tolerance) --- a handful of odd-angle
    handwriting is fine, majority-orientation chaos is not.
-   Multiple distinct documents bundled into a single asset.
-   Documents in an unsupported foreign language (per current project
    scope).
-   Documents with prepopulated, non-editable annotation overlays.
-   Documents that are mostly a photo of a person/patient rather than
    document content.
-   Documents that are **mirror text only.**

## 10.3 Coarse Rectification

-   Find the best 4 grid-aligning points (they can lie outside the
    visible image) such that:
    -   Same-row letters align horizontally on the grid.
    -   Same-column letters (across different rows/lines) align exactly
        vertically.
    -   The full document is enclosed.
-   Point order: **top-left → top-right → bottom-right → bottom-left.**
-   If 4 points were already chosen during Segmentation, they
    pre-populate as the Rectification starting points.
-   **Common mistake to avoid:** aligning horizontally but not
    vertically (columns not stacking) --- always check both axes.

# 11. Clickables Rulebook --- General Mechanics (Standalone)

*(Cross-reference with Sec. 8.5 for how clickables interact with the KV
hierarchy --- this section is pure checkbox/radio mechanics.)*

## 11.1 General Guidelines

1.  Identify all Radio Buttons and Check Boxes on the page.
2.  Draw a bounding box around **each** one using **"Add Clickable
    Item."**
3.  **The clickable box wraps the box/cell itself (checkbox, radio
    button outline), never just the checkmark/X inside it.**

## 11.2 Correct vs Incorrect Examples

-   **Incorrect:** bounding box drawn tightly around just the checkmark,
    ignoring the checkbox cell.
-   **Correct:** both Clickable-True and Clickable-False boxes drawn
    around the full checkbox cell area, sized to the cell/box outline
    (not the mark).

## 11.3 Checkboxes Inside Tables

-   Still draw a bounding box for every radio button/checkbox even when
    it's embedded inside a table layout.
-   Table bullets are never annotated as radio buttons/checkboxes.
-   Annotate clickables **even if they have no corresponding Key**
    (still use "Add Clickable Item").

## 11.4 No/Unclear Checkbox Boundary

-   If the expected position for a checkbox/radio button has **no
    visible border** (implied position only), still draw the clickable
    bounding box at the logically expected location using "Add Clickable
    Item."

## 11.5 Clickable as a Table Cell Itself

-   If a table **cell itself functions as the checkbox** (the cell
    border defines the clickable area), treat it as a Clickable and mark
    True/False accordingly.
    -   Convention used in reference materials: **Red border = Clickable
        True**, **Green border = Clickable False** (verify current color
        convention against the live label legend in Sec. 2.4 before
        applying, since ClickableItemTrue/False colors may differ by
        tool version).
-   If a cell-as-checkbox has **no defined grid border on one side**,
    the clickable bounding box should still logically terminate where
    the table grid *would* end.
-   **Only fill out rows that actually have data** --- do not add
    clickable annotations to trailing empty template rows that were
    never filled in.

## 11.6 Not-a-Clickable Scenarios

-   **Letters written inside a box (e.g. "Y"/"N" typed into a box) are
    NOT clickables_true/false** --- these are text-value fields, not
    checkmark fields. Annotate as plain OCR/Value text instead (see also
    Sec. 8.5 "Y/N as text").

## 11.7 Checklist for Auditing Clickables

1.  Confirm every radio button / checkbox on the page has been
    annotated.
2.  Confirm that any checked/marked box is tagged **"Clickable True"**
    and renders **green** in the visualizer (verify current color
    convention live).

## 11.8 Manual QA Steps (DA Team)

1.  Go to the internal "Thunder" page and search for the dataset name.
2.  Switch the Gallery view to **Table view.**
3.  Search for the specific Asset ID to QA.
4.  Select the **Clickable item** label to review all checkbox/radio
    annotations.
5.  Select the **Clickable item true** label specifically to review all
    marked/checked instances.
6.  Run through the Checklist above (Sec. 11.7) while auditing.

# 12. Label ID Annotation (Field IDs / Document IDs)

-   Bounding box required regardless of Handwritten / Printed /
    Signature / Vertical / Watermark status.
-   **Handwritten:** if written by hand, even on an otherwise printed
    document, tag `Handwritten`.
-   **Printed:** includes normal text, figures, and diagrams;
    watermarks/dotted lines/stamps also count as Printed.
-   **Signature:** any signature, printed or handwritten, tagged
    accordingly plus `IsSignature`.
-   **Vertical:** vertically-oriented words tagged `Vertical`.
-   **Watermark:** any visible watermark text tagged `Watermark`.

# 13. Foreign Language Documents

-   Multi-language annotation guidance is currently **TBD** (not
    finalized as of the last rulebook revision) --- flag any
    foreign-language asset for manager/lead review rather than guessing
    at rules, and check Sec. 10.2 (documents in unsupported languages
    may need to be declined outright depending on current project
    scope).

# 14. QA / Audit Playbook

Use this when reviewing another annotator's completed task, or when
asked "is this annotation correct?"

1.  **Check the File Info panel first** (Sec. 2.7) --- look at
    Created/Modified/Deleted counts and session stats to understand what
    changed in this rework round.
2.  **Word level:**
    -   Are boxes tight (not loose, not cropped)?
    -   Is Bounding Box vs Polygon used correctly (polygon only for
        curved/non-standard/edge-of-doc cases)?
    -   Are the space/symbol merge rules (Sec. 4.2--Sec. 4.3) applied
        consistently?
    -   Are WritingType, IsSignature, IsVertical, IsWatermark flags all
        set correctly?
    -   Is transcription exact, including punctuation, with correct
        skip-reason usage for unreadable/blurry/inverted content?
3.  **Line level:**
    -   4-space rule respected? Table-cell-per-line rule respected?
        Printed-precedence rule respected on mixed lines?
4.  **KV level:**
    -   Is Sample vs Template treated correctly per Sec. 8.4 (this is
        the #1 QA failure point)?
    -   Do Parent/Child nesting choices match the documented HKV
        patterns in Sec. 8.5--Sec. 8.6, or is there over-/under-nesting?
    -   Are 3+ column tables correctly *not* forced into KV/HKV, except
        under the documented exceptions (Sec. 8.10)?
    -   Do Clickable/Value pairings follow the 4 scenarios in Sec. 8.5?
5.  **Clickables:**
    -   Every checkbox/radio button boxed (even with no key)?
    -   Box wraps the cell, not the mark?
    -   Only filled rows in repeated table structures annotated?
    -   Y/N-as-text correctly excluded from Clickable treatment?
6.  **Segrect (if applicable):**
    -   Correct 4-point rectification order, both-axis grid alignment,
        and correct in/exclusion of watermarks, folds, and secondary
        text per Sec. 10.1.
7.  **Math (if applicable):**
    -   Correct handling of inline vs display equation merge rules,
        fraction combination, and skip-worthy multi-line/matrix content.
8.  Log any newly-clarified edge case back into Sec. 15 (MOM Decisions
    Log) below, and flag it to the team so this master doc can be
    updated at the source.

# 15. MOM (Minutes of Meeting) Decisions Log

> **Keep this section updated after every sync.** These are the most
> authoritative, most recent overrides --- if anything here conflicts
> with an older section above, the MOM entry wins until the main rule
> text is updated to match.

  ----------------------------------------------------------------------------------------
  Date                    Attendees               Decision
  ----------------------- ----------------------- ----------------------------------------
  2026-09-17              AWS: Anil Kumar,        1\. **Signatures** should be bounded
                          Rajeev, Rachana ·       using a **normal bounding box** format
                          Handigital: Bharani     (confirmed). 2. **Logical tables must
                          Kumar, Sai Sowmya,      never be annotated as KV/HKV**
                          Ankita, Aditi           (confirmed --- reinforces Sec. 8.2/Sec.
                                                  8.10 "3+ columns = Table, not KV"
                                                  default). 3. **Clarified
                                                  clickable:false-with-no-explicit-Value
                                                  scenario:** e.g. on a form listing "son
                                                  / wife / daughter" as relationship
                                                  options --- **"son"** should be bound as
                                                  a KV pair with `clickable:true`, while
                                                  **"wife"** and **"daughter"** should be
                                                  bound as KV pairs with
                                                  `clickable:false`. All three
                                                  collectively function as the shared Key
                                                  for their associated Value.

  ----------------------------------------------------------------------------------------

*(Add new rows here as new MOMs happen --- date, attendees, decision
text, and which section it overrides/refines.)*

# 16. Video-Derived Workflow Observations

*(From reviewing actual screen-recorded annotation sessions.)*

-   Annotators frequently zoom to **200--500%** for general field-level
    word/KV work, and up to **\~1300%+** for fine detail on small text
    (stamps, tiny logos, dense codes).
-   The **Word property popup card** appears inline, docked near the
    drawn box, and includes
    Language/Transcription/Skip/IsVertical/IsSignature/IsWatermark ---
    annotators fill this immediately after drawing each box rather than
    batching it for later.
-   The right-side **Annotation tree** is actively used mid-task (not
    just for review) --- annotators expand `KeyValueContainer` nodes to
    double check nesting (e.g. confirming `Key - Province:` sits
    correctly under `KeyValueContainer - OHIO, P…`) while building the
    hierarchy.
-   **Empty/unfilled checkboxes are visibly skipped** during live word
    annotation passes (e.g. "Prepaid / Cheque / Master Card / Visa Card"
    option rows on a payment form show empty checkbox glyphs with no
    clickable/word box drawn on any of them) --- consistent with Sec.
    4.4 and Sec. 11.6.
-   On dense multi-field claim forms (e.g. CMS-1500 style), the
    annotation tree accumulates deeply indexed KVC nodes
    (`KeyValueContainer - 20., OUTSIDE…`, `- 5., PATIENT'S…`,
    `- 7., INSURED`, `- 25., FEDERAL…`) confirming the **Indexed Key**
    pattern from Sec. 8.6 is used pervasively on numbered
    government/insurance forms.
-   Filled checkboxes on those same forms (e.g. an `X` inside the
    "Medicaid #" box) are boxed tightly around just the `X` mark per
    Sec. 4.4, while the surrounding cell/table structure is separately
    captured through Line/KV annotation.
-   Task timer format (`Task time: HH:MM:SS of 7199 Min 59 Sec`) and
    autosave cadence (roughly every 30s--2min based on activity) are
    consistent across all observed sessions and tool themes (both Light
    and Dark mode).

# 17. How to Extend This Document

When new material comes in, route it like this:

1.  **New screenshots of the tool UI** → update **Sec. 2** (labels,
    panels, shortcuts, workflow). If a brand-new task type or tool tab
    appears, add it to Sec. 1's task-type list and give it its own
    subsection under Sec. 2 if its layout differs meaningfully from
    "Keys and Values."
2.  **New rulebook / SOP pages (PDF/DOCX)** → merge into the matching
    numbered section (Sec. 4 Word, Sec. 5 Line, Sec. 7 Transcription,
    Sec. 8 KV, Sec. 9 Math, Sec. 10 Segrect, Sec. 11 Clickables) rather
    than appending a new disconnected section --- cross-check for
    conflicts with existing rules and prefer the newer document unless
    it's explicitly marked as superseded.
3.  **New MOM notes / meeting decisions** → always append as a new row
    to **Sec. 15**, dated, and add a short note in the relevant rule
    section if it changes existing guidance materially.
4.  **New task-recording videos** → skim for (a) any UI element not yet
    documented in Sec. 2, (b) any workflow step ordering not yet
    captured in Sec. 2.11/Sec. 16, and (c) any edge case being handled
    live that isn't already written down --- add it to Sec. 16 or the
    relevant rule section.
5.  Keep **Sec. 0 (LLM operating instructions)** and **Sec. 8.4 (Sample
    vs Template table)** untouched unless the fundamental project
    methodology changes --- these are the highest-leverage, most
    load-bearing sections.

*End of document. Treat all example data referenced from source
screenshots/videos as confidential per the tool's own on-screen notice.*
