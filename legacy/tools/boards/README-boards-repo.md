# NSEA Swim Boards

Static, self-contained HTML boards for nseaswimteam.com, hosted here via
GitHub Pages and embedded on the live site as `<iframe>`s. Each board's
*design* (this HTML/CSS/JS) is meant to stay put — only the small JSON file
it loads from `/data/` should change when new results come in.

## One-time setup

1. **Create the repo.** On GitHub, create a new repository (public — GitHub
   Pages is free for public repos; if you have GitHub Pro/a paid org you can
   use a private repo instead). Suggested name: `nsea-swim-boards`.
2. **Upload these files**, keeping the folder structure:
   ```
   index.html
   top10-performers-scy.html
   top10-performers-lcm.html
   top10-performances-scy.html
   top10-performances-lcm.html
   records.html
   records-traditional-scy.html
   records-traditional-lcm.html
   top5-relays-scy.html
   top5-relays-lcm.html
   records-relays-scy.html
   records-relays-lcm.html
   imx-imr-scy.html
   data/
     top10-performers-scy.json
     top10-performers-lcm.json
     top10-performances-scy.json
     top10-performances-lcm.json
     records.json
     records-traditional-scy.json
     records-traditional-lcm.json
     top5-relays-scy.json
     top5-relays-lcm.json
     records-relays-scy.json
     records-relays-lcm.json
     imx-imr-scy.json
   ```
   Easiest way if you're not comfortable with git command line: on the
   repo's GitHub page, use **Add file → Upload files** and drag the whole
   folder in.
3. **Enable GitHub Pages.** In the repo, go to **Settings → Pages**. Under
   "Build and deployment", set Source to **Deploy from a branch**, branch
   `main`, folder `/ (root)`. Save.
4. GitHub will give you a URL like:
   ```
   https://<your-github-username>.github.io/nsea-swim-boards/
   ```
   It can take a minute or two to go live the first time. Visit
   `.../index.html` to confirm the boards load. `index.html` links to every
   board and exists only to check the deploy; it isn't meant to be embedded.

## Embedding on nseaswimteam.com (BUILD)

On each corresponding page in the BUILD editor, add a Custom HTML widget
containing an iframe pointed at the matching board, e.g.:

```html
<iframe
  src="https://<your-github-username>.github.io/nsea-swim-boards/top10-performers-scy.html"
  style="width:100%; border:0; min-height:1400px;"
  loading="lazy">
</iframe>
```

Do this once per page:
- **Top 10 Performers - SCY** (each swimmer's single fastest swim per event; no swimmer occupies more than one of the 10 slots) → `top10-performers-scy.html`
- **Top 10 Performers - LCM** → `top10-performers-lcm.html`
- **Top 10 Performances - SCY** (every top-10 swim per event; a swimmer can occupy multiple slots, e.g. separate prelims/finals swims) → `top10-performances-scy.html`
- **Top 10 Performances - LCM** → `top10-performances-lcm.html`
- **Record Holders leaderboard** (ranked by # of records held, all courses combined) → `records.html`
- **Team Records - SCY** (classic per-event board: age group → event → holder) → `records-traditional-scy.html`
- **Team Records - LCM** (same, long course) → `records-traditional-lcm.html`
- **Top 5 Relays - SCY** (five fastest relays per event, by gender and age group, with all four swimmers listed) → `top5-relays-scy.html`
- **Top 5 Relays - LCM** → `top5-relays-lcm.html`
- **Relay Records - SCY** (the single fastest relay per event, by gender and age group) → `records-relays-scy.html`
- **Relay Records - LCM** → `records-relays-lcm.html`
- **IMX / IMR Progress - SCY** (IM Ready and IM Xtreme completion by swimmer and age bracket) → `imx-imr-scy.html`

A fixed `min-height` avoids a tiny/scrolling box; adjust it if a board looks
cramped after real data loads. If BUILD's widget strips the `style`
attribute, add `width="100%" height="1400" frameborder="0"` instead.

## Updating for a new season / new results

You should almost never need to touch the `.html` files again. To publish
new results:

1. Ask Claude to rebuild the board using the **nsea-swim-boards** skill,
   same as always — just tell it the output should be the JSON shape below
   instead of a full HTML file.
2. Replace the relevant file in `data/` (`top10-performers-scy.json`,
   `top10-performers-lcm.json`, `top10-performances-scy.json`,
   `top10-performances-lcm.json`, `records.json`,
   `records-traditional-scy.json`, `records-traditional-lcm.json`,
   `top5-relays-scy.json`, `top5-relays-lcm.json`,
   `records-relays-scy.json`, `records-relays-lcm.json`, or
   `imx-imr-scy.json`) with the new content,
   and push/upload it to GitHub.
3. That's it — the iframe on nseaswimteam.com picks up the new data
   automatically next time someone loads the page. No BUILD editing.

### Season window and highlights

Every board except IMX / IMR Progress reads these fields from its JSON to decide
which swims get the coral **NEW** flag: `cutoff_iso` / `cutoff_label` (season
start, e.g. 9/1) and, optionally, `cutoff_end_iso` / `cutoff_end_label`
(season end, e.g. 8/31) plus `season_label` (e.g. `"2026–27"`). A swim is NEW
when its date falls inside that window; with no end date, highlighting runs
to the present. At the start of each season, update these fields in every
board's JSON. The Top 10 and Top 5 boards also mark each event's rank-1 time
with a teal star.

### `data/top10-performers-scy.json` / `-lcm.json` and `data/top10-performances-scy.json` / `-lcm.json` shape

Both board types share the identical JSON shape below — the only difference
is what goes into each event's array: Performers caps each event/age/gender
group at 10 **distinct swimmers** (their single best swim), while
Performances caps at the 10 **fastest swims** regardless of swimmer, so the
same swimmer can occupy more than one slot (e.g. a prelims swim and a
separate finals swim).

```json
{
  "cutoff_iso": "2025-09-01",
  "cutoff_label": "9/1/2025",
  "disclaimer": "...",
  "footer": "...",
  "age_order": ["10 & Under", "11-12", "13-14", "15-16", "17-18"],
  "data": {
    "<Age Group>": {
      "Female": {
        "<Event Name>": [
          {"rank": 1, "time": "22.15", "first": "Jane", "last": "Smith",
           "age": 12, "meet": "Meet Name", "date": "2025-10-04", "points": 512}
        ]
      },
      "Male": { "...": "..." }
    }
  }
}
```

### `data/records.json` shape

```json
{
  "cutoff_iso": "2025-09-01",
  "cutoff_label": "9/1/2025",
  "subtitle": "...",
  "disclaimer": "...",
  "footer": "...",
  "swimmers": [
    {
      "name": "Jane Smith",
      "records": [
        {"course": "SCY", "event": "50 Free", "time": "22.15",
         "date": "2025-10-04", "meet": "Meet Name"}
      ]
    }
  ]
}
```

### `data/records-traditional-scy.json` / `data/records-traditional-lcm.json` shape

```json
{
  "cutoff_iso": "2025-09-01",
  "cutoff_label": "9/1/2025",
  "disclaimer": "...",
  "footer": "...",
  "genders": {
    "Female": {
      "ageGroups": [
        {
          "age": "10 & U",
          "events": [
            {"event": "50 Free", "time": "28.91", "date": "2023-02-17",
             "holder": "Gentry Witmer", "meet": "...", "noRecord": false},
            {"event": "500 Free", "noRecord": true}
          ]
        }
      ],
      "relays": [
        {"event": "10 & U 200 Free Relay", "time": "2:26.19", "date": "2021-11-12",
         "swimmers": "A. Petroff, E. Amin, N. Crowley, G. Witmer", "meet": "..."}
      ]
    },
    "Male": { "...": "..." }
  }
}
```

An age group with every event `noRecord: true` can be omitted entirely — the
page only renders age groups that have at least one real record.

### `data/top5-relays-scy.json` / `data/top5-relays-lcm.json` shape

Same season fields as above (`cutoff_*`, `season_label`), plus:

```json
{
  "disclaimer": "...",
  "footer": "...",
  "age_order": ["10 & Under", "11-12", "13-14", "15-16", "15-18", "17-18", "Open"],
  "data": {
    "<Age Group>": {
      "Female": {
        "200 Free Relay": [
          {"rank": 1, "time": "2:12.56",
           "swimmers": ["Eliza Amin", "Annderson Petroff", "Mikayla Coleman", "Gentry Witmer"],
           "meet": "Meet Name", "date": "2023-01-14"}
        ]
      },
      "Male": { "...": "..." },
      "Mixed": { "...": "..." }
    }
  }
}
```

Gender keys are `Female`, `Male` and `Mixed`; a tab only appears for a gender
that has data. Events are `200/400 Free Relay`, `200/400 Medley Relay` and
`800 Free Relay`. Ties share a rank. Age groups are listed exactly as they
appear in the source, so overlapping groups (15-16, 15-18, 17-18, Open) can
contain the same swim; they are not merged.

### `data/records-relays-scy.json` / `data/records-relays-lcm.json` shape

Same season fields as above, plus one record (the rank-1 relay) per event and
age group:

```json
{
  "disclaimer": "...",
  "footer": "...",
  "genders": {
    "Female": {
      "ageGroups": [
        {
          "age": "10 & Under",
          "events": [
            {"event": "200 Free Relay", "time": "2:12.56", "date": "2023-01-14",
             "swimmers": ["Eliza Amin", "Annderson Petroff", "Mikayla Coleman", "Gentry Witmer"],
             "meet": "Meet Name"}
          ]
        }
      ]
    },
    "Male": { "...": "..." },
    "Mixed": { "...": "..." }
  }
}
```

These are separate from the older `relays` section inside the
`records-traditional-*.json` files; the new relay boards are the source of
truth for relay records.

### `data/imx-imr-scy.json` shape

```json
{
  "course": "SCY",
  "season_label": "2026–27",
  "as_of": "2026-10-09",
  "meets": ["2026 Fall Frenzy BAC v NSEA Dual Meet (9/18/2026)"],
  "programs": {
    "IMR": {"10 & Under": ["100 Free", "50 Back", "50 Breast", "50 Fly", "100 IM"]},
    "IMX": {"10 & Under": ["200 Free", "100 Back", "100 Breast", "100 Fly", "200 IM"]}
  },
  "bracket_order": ["10 & Under", "11-12", "13-18"],
  "disclaimer": "...",
  "footer": "...",
  "swimmers": [
    {"name": "Jane Smith", "gender": "Female", "age": 9, "bracket": "10 & Under",
     "swims": {"50 Back": {"time": "1:13.78", "date": "2026-10-09", "meet": "Meet Name"}}}
  ]
}
```

`programs` lists the required events for each program and age bracket (the
`...` entries above are abbreviated; each program has every bracket). A
swimmer's completion is computed in the page from `swims`.

`date` fields in all shapes should be ISO format (`YYYY-MM-DD`) — the
pages compare them directly against the cutoff date in the browser.

## Why this setup

- The BUILD Custom HTML widget only needs to hold a two-line iframe, so
  there's no risk of its rich-text editor mangling a large pasted
  `<script>` block.
- Updating a board is a data-file swap, not a full rebuild-and-repaste —
  faster and much lower-risk mid-season.
- Everything here is plain static files; no build step, server, or paid
  hosting required.
