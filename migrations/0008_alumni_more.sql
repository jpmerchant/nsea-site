-- More alumni, plus two columns: roster_slug pins a roster page name that differs from the display name (Madi / madison-joy);
-- swimcloud_url is just the link the school's own page shows (nothing is read from SwimCloud).
-- All start with consent = 0, so nothing shows publicly until ticked in the admin console.
ALTER TABLE alumni ADD COLUMN roster_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE alumni ADD COLUMN swimcloud_url TEXT NOT NULL DEFAULT '';
INSERT INTO alumni (slug, name, school, class_year, base_url, sport_path, roster_url, roster_slug) VALUES
 ('madison-joy', 'Madi Joy', 'East Carolina University', 2024, 'https://ecupirates.com', 'womens-swimming-and-diving', 'https://ecupirates.com/sports/womens-swimming-and-diving/roster/madison-joy/14436', 'madison-joy'),
 ('abby-forbes', 'Abby Forbes', 'Mount St. Mary''s', 2024, 'https://mountathletics.com', 'womens-swimming-and-diving', 'https://mountathletics.com/sports/womens-swimming-and-diving/roster/abby-forbes/10926', ''),
 ('keener-witmer', 'Keener Witmer', 'Washington & Lee', 2024, 'https://generalssports.com', 'womens-swimming-and-diving', 'https://generalssports.com/sports/womens-swimming-and-diving/roster/keener-witmer/17966', ''),
 ('laith-ausband', 'Laith Ausband', 'Northern Kentucky University', 2025, 'https://nkunorse.com', 'mens-swimming', 'https://nkunorse.com/sports/mens-swimming/roster/laith-ausband/7379', ''),
 ('clem-camacho', 'Clem Camacho', 'Florida State University', 2025, 'https://seminoles.com', 'mens-swimming-and-diving', 'https://seminoles.com/sports/mens-swimming-and-diving/roster/clem-camacho/9038', ''),
 ('ryker-eder', 'Ryker Eder', 'Salisbury University', 2026, 'https://suseagulls.com', 'mens-swimming', '', ''),
 ('evan-sevast', 'Evan Sevast', 'Long Island University', 2026, 'https://www.liuathletics.com', 'mens-swimming-diving', '', ''),
 ('bryson-edwards', 'Bryson Edwards', 'Montclair State University', 2026, 'https://montclairathletics.com', 'mens-swimming-and-diving', '', '');
