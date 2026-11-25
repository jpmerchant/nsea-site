# Race Planner data

`public/embeds/race-planner.html` reads `public/embeds/race-planner-data.json`, which these scripts build from the
race-analysis files in `Documents/Swimming/04 Race Analysis & Pacing/Race Data` (not in this repo).

1. `python3 parse_reports.py "<Race Data folder>" data/swims.json`: reads the USA Swimming elite, 2010 Indiana
   Senior LCM Champs and 2012 AG Elite Camp report PDFs (needs `pdftotext`). Every swim must have splits that add
   up to its final time.
2. `python3 build_model.py`: writes `public/embeds/race-planner-data.json` (70 events, SCY and LCM, both sexes).
   It lists any swim it drops because its recorded splits are broken.

`data/ncaa2024_top8.json` was transcribed by hand from the 2024 NCAA top-8 PDFs (Russell Mark, ASCA), whose
numbers are images. `data/elite_refs.json` holds the USA Swimming dolphin-kick counts and breathing notes.

How a plan is calculated, and what each level contributes, is written out on the page itself ("Where the numbers
come from") and in the NSEA Swim project doc `claude/race-data-extracts.md`.
