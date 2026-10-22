/*
 * Pull every page of the live BUILD site into one JSON file.
 *
 * HOW TO RUN (takes about a minute):
 *   1. Open https://www.nseaswimteam.com in Chrome.
 *   2. Open DevTools (Cmd/Ctrl+Shift+J), paste this whole file into the Console, press Enter.
 *   3. A file named nsea-build-pages.json downloads. Save it into this project's /legacy folder.
 *
 * It runs in your browser (same origin), so it reads exactly what visitors see.
 * For each page it saves the full HTML plus a best-guess "main content" HTML block,
 * the page title, and every iframe/embed URL found on the page.
 */
(async () => {
  const urls = ["/top-10-swims---scy","/records-set-in-2025---26","/2025---26-updates","/top-10-swims--lcm","/offerings","/check-my-time","/2023---2024","/","/top-times---lcm","/FAQ","/privacy-policy","/fee-structure","/shoulder-strength","/alumni","/2022---23-achievements","/books","/ejp-parking","/who-to-contact","/scy---relay-team-records","/top-5-relays---scy","/top-times","/power-points-explained","/captyn-message-archive","/2025---2026","/scholarships-and-financial-assistance","/glossary","/education","/fast-facts-on-water-safety","/coaching-staff","/practice-equipment","/general-practice-schedule","/practice-groups","/college-swimmers","/national--meet--qualifiers","/calendar","/opt-out---intent-information","/2024---2025","/about-us","/about-swim-meets","/time-standards","/practice-locations","/meet-pools","/safe-sport","/newsletters","/team-records---lcm","/imx-progress","/current","/lcm---relay-team-records","/top-5-relays---lcm","/nc-age-group-championships","/nc-senior-championships","/opt-out-of-meets","/opt-in-to-meets","/register-for-an-event","/team-records---scy","/team-record-holders","/tech-suit-info","/training-zone-cheat-sheet","/swim-suit-guide","/imr-/-imx-progress","/agility","/rpe-information","/caffeine---energy-drinks--a-quick-guide","/caffeine---energy-drinks--research","/mobility","/strength","/foam-rolling","/scy---comparison-by-age-group","/scy---comparison-all-ages","/pre-practice-mobility"];
  const out = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: 'same-origin' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const pick = ['main', '#main', '[role=main]', '.page-content', '.content', 'article']
        .map((s) => doc.querySelector(s)).find(Boolean);
      out.push({
        path: u,
        status: res.status,
        title: (doc.querySelector('h1') || doc.querySelector('title') || {}).textContent?.trim() || '',
        embeds: [...doc.querySelectorAll('iframe')].map((f) => f.src),
        mainHtml: pick ? pick.innerHTML : '',
        fullHtml: html,
      });
      console.log('ok', u);
    } catch (e) {
      out.push({ path: u, error: String(e) });
      console.warn('failed', u, e);
    }
    await new Promise((r) => setTimeout(r, 250)); // be gentle with the server
  }
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'nsea-build-pages.json' });
  document.body.appendChild(a); a.click(); a.remove();
  console.log('done', out.length, 'pages');
})();
