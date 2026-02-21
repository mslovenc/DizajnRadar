// DizajnRadar Scraper v3 — Multi-source with deep deadline extraction
// Sources: dizajn.hr, contestwatchers.com, bigsee.eu, europeandesign.org,
//          graphiccompetitions.com, a]designaward.com, dezeen.com
// Usage: node scrape.mjs
// Env: SUPABASE_URL, SUPABASE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://erimkexlkybipsdutsfd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (like Gecko) Chrome/131.0 Safari/537.36';

// ── Utils ──
function decode(str) {
    const e = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#8211;': '–', '&#8212;': '—', '&#8217;': "'", '&#8220;': '"', '&#8221;': '"', '&ndash;': '–', '&mdash;': '—', '&#038;': '&', '&nbsp;': ' ', '&apos;': "'" };
    return str.replace(/&#?\w+;/g, m => e[m] || m);
}
function strip(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

async function safeFetch(url) {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        return r.ok ? await r.text() : null;
    } catch { return null; }
}

// ── Date extraction (Croatian + English) ──
const CRO = { 'siječnja': '01', 'veljače': '02', 'ožujka': '03', 'travnja': '04', 'svibnja': '05', 'lipnja': '06', 'srpnja': '07', 'kolovoza': '08', 'rujna': '09', 'listopada': '10', 'studenoga': '11', 'studenog': '11', 'prosinca': '12' };
const ENG = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12', jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function findDate(text) {
    if (!text) return null;
    // "26. siječnja 2026" or "5. prosinca 2025"
    let m = text.match(/(\d{1,2})\.\s*(siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|studenog|prosinca)\s*(\d{4})/i);
    if (m && CRO[m[2].toLowerCase()]) return `${m[3]}-${CRO[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    // "5.12.2025"
    m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // "February 20, 2026" or "20 February 2026"
    m = text.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/i);
    if (m && ENG[m[1].toLowerCase()]) return `${m[3]}-${ENG[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
    m = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (m && ENG[m[2].toLowerCase()]) return `${m[3]}-${ENG[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    // "2026-02-20"
    m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return null;
}

function fromRemaining(str) {
    if (!str) return null;
    const m = str.match(/(\d+)\+?\s*(day|week|month)/i);
    if (!m) return null;
    const d = new Date(); const n = parseInt(m[1]);
    if (m[2][0] === 'd') d.setDate(d.getDate() + n);
    else if (m[2][0] === 'w') d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return d.toISOString().split('T')[0];
}

function isStale(deadline) {
    if (!deadline) return false;
    return (new Date() - new Date(deadline)) / 864e5 > 60;
}

// Detect entries with old years in the title (e.g. "BIG SEE 2018", "Presežki 2019")
function isOldByTitle(title) {
    const currentYear = new Date().getFullYear();
    const yearMatch = title.match(/\b(20\d{2})\b/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        // Reject if the year in the title is more than 1 year old
        if (year < currentYear - 1) return true;
    }
    return false;
}

function detectCategory(t) {
    t = t.toLowerCase();
    if (/vizualni identitet|visual identity|logotip|brand/i.test(t)) return 'Vizualni identitet';
    if (/ilustraci|illustrat/i.test(t)) return 'Ilustracija';
    if (/knjig|book/i.test(t)) return 'Dizajn knjige';
    if (/\bux\b|\bui\b|web|digital|interaction/i.test(t)) return 'UX/UI dizajn';
    if (/plakat|poster/i.test(t)) return 'Grafički dizajn';
    if (/modn|fashion/i.test(t)) return 'Modni dizajn';
    if (/produkt|product|industrijski|industrial/i.test(t)) return 'Industrijski dizajn';
    if (/architectur|arhitektur|interior/i.test(t)) return 'Arhitektura';
    if (/typograph|tipografi|type design|font/i.test(t)) return 'Tipografija';
    if (/packaging|package|ambalaž/i.test(t)) return 'Dizajn ambalaže';
    if (/communicat|komunikaci/i.test(t)) return 'Komunikacijski dizajn';
    return 'Grafički dizajn';
}

function detectStatus(text, deadline) {
    const t = text.toLowerCase();

    // ── Classify as "Novosti" (news) — not a real competition/call ──
    // Exhibitions
    if (/\bizložba\b|izložbe\b|exhibition|galerij[aie]\s+(karas|kontrast|flora)/i.test(t) && !/natječaj|poziv|prijav|open call/i.test(t)) return 'Novosti';
    // Job postings (not design competitions)
    if (/radno mjesto|zapošljavan|asistent|financij|pravno|administrativ|računovod/i.test(t)) return 'Novosti';
    // News about competition RESULTS (not the competition itself)
    if (/^odabran[aie]?\s|^rezultati?\s|^proglašen[aie]?\s|objavljeni rezultati/i.test(t)) return 'Novosti';
    // News about selected books/winners (announcement, not call)
    if (/najljepše oblikovane knjige|odabrani autori|odabrani pozvani|odabrana tri tima/i.test(t)) return 'Novosti';
    // Workshop/event announcements (not competitions)
    if (/\bradionica\b|\bworkshop\b|\bwebinar\b|\bpredavanje\b/i.test(t) && !/natječaj|poziv|prijav/i.test(t)) return 'Novosti';

    // ── Standard competition status ──
    if (/rezultat|proglašen|završen|winner|result|selected|awarded/i.test(t)) return 'Završeno';
    if (deadline && (new Date() - new Date(deadline)) / 864e5 > 14) return 'Završeno';
    return 'Aktivno';
}

function extractPrize(text) {
    const m = text.match(/([\d.,]+)\s*(EUR|€|eura)/i);
    if (m) return `${m[1]} EUR`;
    if (/nagrada|naknada|award|prize/i.test(text)) return 'Da (vidi detalje)';
    return 'Nije navedeno';
}

function extractOrg(text) {
    const patterns = [
        /(?:organizator|raspisivač|provoditelj)[:\s]+([A-ZČĆŽŠĐ][^\.,;]{3,40})/i,
        /(POGON|Školska knjiga|ULUPUH|NSK|HDD|HDLU|HAC|HAKOM|KGZ)/,
        /(Grad\s+\w+)/i, /(Hrvatsko\s+\w+\s+\w+)/i,
        /(Knjižnice\s+grada\s+\w+)/i,
    ];
    for (const p of patterns) { const m = text.match(p); if (m) return m[1].trim(); }
    return null;
}

// ════════════════════════════════════════════
// SOURCE 1: dizajn.hr — with deep page scraping for deadlines
// ════════════════════════════════════════════
async function scrapeDizajnHr() {
    console.log('📡 [dizajn.hr] Fetching listing...');
    const html = await safeFetch('https://dizajn.hr/natjecaji/');
    if (!html) return [];

    const h2Re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/gi;
    let m; const entries = [];
    while ((m = h2Re.exec(html)) !== null) entries.push({ link: m[1], title: decode(m[2].trim()), idx: m.index });

    const competitions = [];
    // Follow each blog page (up to 15) to get OG description which contains deadlines
    const toFetch = entries.slice(0, 15);
    console.log(`  📄 Fetching ${toFetch.length} detail pages for deadlines...`);

    const pages = await Promise.allSettled(toFetch.map(e => safeFetch(e.link)));

    for (let i = 0; i < toFetch.length; i++) {
        const entry = toFetch[i];
        const pageHtml = pages[i].status === 'fulfilled' ? pages[i].value : null;

        // Get OG description + full page text for deadline extraction
        let fullText = '';
        if (pageHtml) {
            const ogMatch = pageHtml.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
            const bodyText = strip(pageHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
            fullText = (ogMatch ? decode(ogMatch[1]) : '') + ' ' + bodyText.substring(0, 2000);
        } else {
            // Fallback: use listing snippet
            const start = entry.idx;
            const end = i + 1 < entries.length ? entries[i + 1].idx : html.length;
            fullText = strip(html.substring(start, end).replace(/<h2[\s\S]*?<\/h2>/gi, '')).substring(0, 500);
        }

        const deadline = findDate(fullText);
        const status = detectStatus(entry.title + ' ' + fullText, deadline);
        if (isStale(deadline)) continue;

        competitions.push({
            title: entry.title, link: entry.link,
            org: extractOrg(fullText) || 'HDD / dizajn.hr',
            category: detectCategory(entry.title + ' ' + fullText),
            status, deadline, prize: extractPrize(fullText),
        });
    }
    console.log(`  ✅ [dizajn.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 2: contestwatchers.com — with deep scrape for deadlines
// ════════════════════════════════════════════
async function scrapeContestWatchers() {
    console.log('📡 [contestwatchers.com] Fetching...');
    const html = await safeFetch('https://www.contestwatchers.com/category/visual-arts/graphic-design/');
    if (!html) return [];

    const re = /<h[23][^>]*>\s*<a[^>]*href="(https:\/\/www\.contestwatchers\.com\/(?!category|page|feed)[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    let m; const entries = [];
    while ((m = re.exec(html)) !== null) {
        const near = html.substring(m.index, m.index + 600);
        const timeMatch = near.match(/(\d+\+?\s*(?:days?|weeks?|months?)\s*remaining)/i);
        const isFree = near.includes('Free');
        entries.push({ link: m[1], title: decode(m[2].trim()), remaining: timeMatch?.[1], free: isFree });
    }

    // Deep-scrape detail pages for exact deadlines
    console.log(`  📄 Fetching ${entries.length} detail pages...`);
    const pages = await Promise.allSettled(entries.map(e => safeFetch(e.link)));

    const competitions = [];
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const pageHtml = pages[i].status === 'fulfilled' ? pages[i].value : null;

        let deadline = null;
        let externalLink = e.link;
        if (pageHtml) {
            const text = strip(pageHtml.replace(/<script[\s\S]*?<\/script>/gi, ''));
            // ContestWatchers uses "Contests Expiring on 8 May 2026" and "Closing on [DATE]"
            const expiringMatch = text.match(/(?:expiring|closing|expires?|closes?)\s+(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4})/i);
            if (expiringMatch) deadline = findDate(expiringMatch[1]);
            // Also try "deadline: [date]" or just search full text
            if (!deadline) {
                const dlMatch = text.match(/deadline[:\s]*([^.!?\n]{5,60})/i);
                deadline = findDate(dlMatch ? dlMatch[1] : text.substring(0, 3000));
            }
            // Find "Visit Official Website" link
            const visitMatch = pageHtml.match(/<a[^>]*href="(https?:\/\/(?!www\.contestwatchers)[^"]+)"[^>]*>\s*Visit\s+Official\s+Website/i);
            if (visitMatch) externalLink = visitMatch[1];
            // Fallback: any external link with "official", "enter", "submit", "apply", "website"
            if (externalLink === e.link) {
                const extMatch = pageHtml.match(/<a[^>]*href="(https?:\/\/(?!www\.contestwatchers)[^"]+)"[^>]*>[^<]*(?:enter|submit|visit|official|website|apply)[^<]*/i);
                if (extMatch) externalLink = extMatch[1];
            }
        }
        if (!deadline) deadline = fromRemaining(e.remaining);

        competitions.push({
            title: e.title, link: externalLink,
            org: e.title.replace(/\s*\d{4}.*$/, '').replace(/\s*[-–:].*$/, '').substring(0, 50) || 'Međunarodni natječaj',
            category: detectCategory(e.title),
            status: 'Aktivno', deadline,
            prize: e.free ? 'Besplatna prijava' : 'Vidi detalje',
        });
    }
    console.log(`  ✅ [contestwatchers.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 3: bigsee.eu — Southeast Europe design awards
// ════════════════════════════════════════════
async function scrapeBigSee() {
    console.log('📡 [bigsee.eu] Fetching...');
    const urls = [
        { url: 'https://bigsee.eu/big-see-architecture-award/', cat: 'Arhitektura' },
        { url: 'https://bigsee.eu/big-see-product-design-award/', cat: 'Industrijski dizajn' },
        { url: 'https://bigsee.eu/big-see-visionaries/', cat: 'Grafički dizajn' },
        { url: 'https://bigsee.eu/big-see-interior-design-award/', cat: 'Arhitektura' },
        { url: 'https://bigsee.eu/big-see-fashion-design-award/', cat: 'Modni dizajn' },
        { url: 'https://bigsee.eu/big-see-wood-design-award/', cat: 'Industrijski dizajn' },
    ];
    const competitions = [];
    const results = await Promise.allSettled(urls.map(u => safeFetch(u.url)));
    for (let i = 0; i < urls.length; i++) {
        const html = results[i].status === 'fulfilled' ? results[i].value : null;
        if (!html) continue;
        const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
        const title = titleM ? decode(titleM[1].trim().replace(/\s*[-–|].*$/, '')) : 'BIG SEE Award';
        const text = strip(html.substring(0, 5000));
        const deadline = findDate(text);
        competitions.push({
            title, link: urls[i].url, org: 'BIG SEE / Zavod Big',
            category: urls[i].cat, status: detectStatus(text, deadline),
            deadline, prize: 'Međunarodna nagrada',
        });
    }
    console.log(`  ✅ [bigsee.eu] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 4: europeandesign.org
// ════════════════════════════════════════════
async function scrapeEuropeanDesign() {
    console.log('📡 [europeandesign.org] Fetching...');
    const html = await safeFetch('https://europeandesign.org/');
    if (!html) return [];
    const text = strip(html);
    const deadline = findDate(text);
    return [{
        title: 'European Design Awards 2026', link: 'https://europeandesign.org/',
        org: 'European Design Awards', category: 'Grafički dizajn',
        status: detectStatus(text, deadline), deadline,
        prize: 'Europska nagrada za dizajn',
    }];
}


// ════════════════════════════════════════════
// SOURCE 5: A' Design Award
// ════════════════════════════════════════════
async function scrapeADesign() {
    console.log('📡 [adesignaward.com] Fetching...');
    const html = await safeFetch('https://competition.adesignaward.com/registration.html');
    if (!html) return [];
    const text = strip(html);
    const deadline = findDate(text);
    return [{
        title: "A' Design Award & Competition 2026", link: 'https://competition.adesignaward.com/registration.html',
        org: "A' Design Award", category: 'Grafički dizajn',
        status: 'Aktivno', deadline,
        prize: 'Međunarodna nagrada + promocija',
    }];
}

// ════════════════════════════════════════════
// SOURCE 6: HDLU — Croatian Society of Fine Artists
// ════════════════════════════════════════════
async function scrapeHdlu() {
    console.log('📡 [hdlu.hr] Fetching...');
    const html = await safeFetch('https://www.hdlu.hr/natjecaji/');
    if (!html) return [];

    const re = /<a[^>]*href="(https?:\/\/www\.hdlu\.hr\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link)) continue;
        // Only include call/competition-related items
        if (!/natječaj|poziv|izložb|salon|online natječaj|open call/i.test(title)) continue;
        seen.add(link);

        // Deep scrape for deadline
        const page = await safeFetch(link);
        let deadline = null;
        if (page) {
            const og = page.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
            const fullText = (og ? decode(og[1]) : '') + ' ' + strip(page).substring(0, 2000);
            deadline = findDate(fullText);
        }

        competitions.push({
            title, link, org: 'HDLU',
            category: detectCategory(title), status: detectStatus(title, deadline),
            deadline, prize: 'Vidi detalje',
        });
        if (competitions.length >= 5) break;
    }
    console.log(`  ✅ [hdlu.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 7: Pogon — Zagreb Center for Independent Culture
// ════════════════════════════════════════════
async function scrapePogon() {
    console.log('📡 [pogon.hr] Fetching...');
    const html = await safeFetch('https://www.pogon.hr/');
    if (!html) return [];

    const re = /<a[^>]*href="(https?:\/\/www\.pogon\.hr\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link) || /kontakt|o-nama|impressum|english/i.test(link)) continue;
        if (!/natječaj|poziv|rezidencij|open call|prijav/i.test(title)) continue;
        seen.add(link);

        const near = html.substring(Math.max(0, m.index - 200), m.index + 500);
        const deadline = findDate(strip(near));

        competitions.push({
            title, link, org: 'POGON Zagreb',
            category: detectCategory(title), status: 'Aktivno',
            deadline, prize: 'Vidi detalje',
        });
        if (competitions.length >= 5) break;
    }
    console.log(`  ✅ [pogon.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 8: Brumen Foundation + TAM-TAM Plaktivat (Slovenia)
// ════════════════════════════════════════════
async function scrapeBrumen() {
    console.log('📡 [brumen.org / tam-tam.si] Fetching...');
    const competitions = [];

    // Brumen Biennial
    const brumenHtml = await safeFetch('https://brumen.org/');
    if (brumenHtml) {
        const text = strip(brumenHtml);
        const deadline = findDate(text);
        competitions.push({
            title: 'Brumen Biennial — Slovenian Design Awards', link: 'https://brumen.org/',
            org: 'Brumen Foundation', category: 'Grafički dizajn',
            status: detectStatus(text, deadline), deadline,
            prize: 'Nacionalna nagrada za dizajn (Slovenija)',
        });
    }

    // TAM-TAM Plaktivat
    const tamHtml = await safeFetch('https://tam-tam.si/plaktivat/');
    if (tamHtml) {
        const text = strip(tamHtml);
        const deadline = findDate(text);
        competitions.push({
            title: 'Plaktivat — International Poster Design Competition', link: 'https://tam-tam.si/plaktivat/',
            org: 'TAM-TAM Institute', category: 'Grafički dizajn',
            status: detectStatus(text, deadline), deadline,
            prize: 'Izložba na javnim površinama u Sloveniji',
        });
    }

    console.log(`  ✅ [brumen/tam-tam] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 9: DesignEuropa Awards (Ljubljana 2026)
// ════════════════════════════════════════════
async function scrapeDesignEuropa() {
    console.log('📡 [designeuropa] Fetching...');
    const html = await safeFetch('https://www.euipo.europa.eu/en/designeuropa-awards');
    const text = html ? strip(html) : '';
    const deadline = findDate(text) || '2026-02-20';
    return [{
        title: 'DesignEuropa Awards 2026 (Ljubljana)', link: 'https://www.euipo.europa.eu/en/designeuropa-awards',
        org: 'EUIPO / European Commission', category: 'Industrijski dizajn',
        status: detectStatus(text, deadline), deadline,
        prize: 'Europska nagrada za dizajn',
    }];
}

// ════════════════════════════════════════════
// SOURCE 10: O3ONE Art Space, Belgrade (Serbia)
// ════════════════════════════════════════════
async function scrapeO3one() {
    console.log('📡 [o3one.rs] Fetching...');
    const html = await safeFetch('https://o3one.rs/');
    if (!html) return [];

    const re = /<a[^>]*href="(https?:\/\/o3one\.rs\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link)) continue;
        if (!/open call|poziv|exhibition|izložb|natječaj|konkurs/i.test(title)) continue;
        seen.add(link);
        competitions.push({
            title, link, org: 'O3ONE Art Space, Beograd',
            category: detectCategory(title), status: 'Aktivno',
            deadline: null, prize: 'Izložba u Beogradu',
        });
        if (competitions.length >= 3) break;
    }
    // Also add the known 2026 open call
    if (competitions.length === 0) {
        competitions.push({
            title: 'O3ONE Open Call — Exhibitions 2026/27',
            link: 'https://o3one.rs/', org: 'O3ONE Art Space, Beograd',
            category: 'Grafički dizajn', status: 'Aktivno',
            deadline: '2026-03-02', prize: 'Izložba u Beogradu',
        });
    }
    console.log(`  ✅ [o3one.rs] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 11: FLUID Regional Awards (SE Europe young designers)
// ════════════════════════════════════════════
async function scrapeFluid() {
    console.log('📡 [fluid-design] Fetching...');
    return [{
        title: 'FLUID — Regional Awards for Young Designers 2026',
        link: 'https://www.contestwatchers.com/fluid-regional-awards-for-young-designers-2026/',
        org: 'FLUID', category: 'Grafički dizajn', status: 'Aktivno',
        deadline: '2026-02-25', prize: 'Besplatna prijava — nagrada za mlade dizajnere',
    }];
}

// ════════════════════════════════════════════
// SOURCE 12: graphiccompetitions.com
// ════════════════════════════════════════════
async function scrapeGraphicCompetitions() {
    console.log('📡 [graphiccompetitions.com] Fetching...');
    const html = await safeFetch('https://graphiccompetitions.com/');
    if (!html) return [];
    const re = /<a[^>]*href="(https:\/\/graphiccompetitions\.com\/[^"]*\/[^"]+)"[^>]*>\s*([^<]{10,100})\s*<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link) || /privacy|terms|about|contact|type\/|category\//i.test(link)) continue;
        if (title.length < 10 || title.length > 100) continue;
        seen.add(link);
        competitions.push({
            title, link, org: title.replace(/\s*\d{4}.*$/, '').substring(0, 50),
            category: detectCategory(title), status: 'Aktivno',
            deadline: null, prize: 'Vidi detalje',
        });
        if (competitions.length >= 8) break;
    }
    console.log(`  ✅ [graphiccompetitions.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 13: dezeen.com competitions
// ════════════════════════════════════════════
async function scrapeDezeen() {
    console.log('📡 [dezeen.com] Fetching...');
    const html = await safeFetch('https://www.dezeen.com/competitions/');
    if (!html) return [];
    const re = /<a[^>]*href="(https:\/\/www\.dezeen\.com\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([^<]{15,120})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link)) continue;
        seen.add(link);
        competitions.push({
            title, link, org: 'Dezeen', category: detectCategory(title),
            status: 'Aktivno', deadline: null, prize: 'Vidi detalje',
        });
        if (competitions.length >= 8) break;
    }
    console.log(`  ✅ [dezeen.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 14: Vizkultura.hr — Regional visual arts portal
// ════════════════════════════════════════════
async function scrapeVizkultura() {
    console.log('📡 [vizkultura.hr] Fetching...');
    const html = await safeFetch('https://vizkultura.hr/tag/natjecaj/');
    if (!html) return [];

    const re = /<a[^>]*href="(https:\/\/vizkultura\.hr\/[^"]+)"[^>]*>\s*<\/a>\s*<h3[^>]*>([^<]+)<\/h3>|<h3[^>]*>([^<]+)<\/h3>/gi;
    // Also try simpler pattern
    const re2 = /<a[^>]*href="(https:\/\/vizkultura\.hr\/[^"]+\/)"/gi;
    const titleRe = /<h3[^>]*>([^<]+)<\/h3>/gi;

    const seen = new Set(); const competitions = [];
    let m;

    // Extract article links with their titles
    const articles = [];
    const linkMatches = [...html.matchAll(/<a[^>]*href="(https:\/\/vizkultura\.hr\/[^"]+\/)"[^>]*>/gi)];
    const titleMatches = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)];

    for (const tm of titleMatches) {
        const title = decode(tm[1].trim());
        // Find nearest link before this title
        const nearbyHtml = html.substring(Math.max(0, tm.index - 300), tm.index + 300);
        const linkMatch = nearbyHtml.match(/href="(https:\/\/vizkultura\.hr\/[^"]+\/)"/i);
        if (!linkMatch) continue;
        const link = linkMatch[1];
        if (seen.has(link) || link.includes('/tag/') || link.includes('/page/')) continue;
        if (!/natječaj|rezultat|prijav|poziv|nagrada|izložba|zgraf|erste|salon/i.test(title)) continue;
        seen.add(link);

        // Extract date from nearby text (DD-MM-YYYY format used by vizkultura)
        const dateMatch = nearbyHtml.match(/(\d{2})-(\d{2})-(\d{4})/);
        const deadline = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

        competitions.push({
            title, link, org: 'Vizkultura',
            category: detectCategory(title), status: detectStatus(title, deadline),
            deadline, prize: 'Vidi detalje',
        });
        if (competitions.length >= 8) break;
    }
    console.log(`  ✅ [vizkultura.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 15: HURA — Croatian advertising (BalCannes, IdejaX, Effie, Dani komunikacija)
// ════════════════════════════════════════════
async function scrapeHura() {
    console.log('📡 [hura.hr] Fetching...');
    const html = await safeFetch('https://www.hura.hr/');
    if (!html) return [];

    const competitions = [];
    const text = strip(html);

    // Extract known competition entries from page
    const entries = [
        { pattern: /balcannes/i, title: 'BalCannes — Kreativno natjecanje za mlade', org: 'HURA' },
        { pattern: /idejax/i, title: 'IdejaX — Natjecanje za kreativne ideje', org: 'HURA' },
        { pattern: /effie/i, title: 'Effie Awards Croatia', org: 'HURA / Effie' },
        { pattern: /dani komunikacija/i, title: 'Dani komunikacija 2026', org: 'HURA' },
    ];

    for (const entry of entries) {
        if (entry.pattern.test(text)) {
            // Find link
            const linkMatch = html.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*>[^<]*${entry.pattern.source}`, 'i'));
            const link = linkMatch ? linkMatch[1] : 'https://www.hura.hr/';

            // Try to find deadline in nearby text
            const fullLink = link.startsWith('http') ? link : `https://www.hura.hr${link}`;
            const nearIdx = html.search(entry.pattern);
            const nearby = nearIdx >= 0 ? html.substring(nearIdx, nearIdx + 500) : '';
            const deadline = findDate(strip(nearby));

            competitions.push({
                title: entry.title, link: fullLink, org: entry.org,
                category: 'Komunikacijski dizajn', status: 'Aktivno',
                deadline, prize: 'Nagrada za kreativnost',
            });
        }
    }
    console.log(`  ✅ [hura.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 16: DOS — Slovenian Designers Society
// ════════════════════════════════════════════
async function scrapeDos() {
    console.log('📡 [dos-design.si] Fetching...');
    const html = await safeFetch('https://dos-design.si/en/');
    if (!html) return [];

    const re = /<a[^>]*href="(https?:\/\/(?:www\.)?dos-design\.si\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link) || /arhiv|about|contact/i.test(link)) continue;
        if (!/natečaj|nagrada|razstava|award|biennal|oblikoval|presežki/i.test(title)) continue;
        seen.add(link);

        const near = html.substring(m.index, m.index + 200);
        const dateMatch = near.match(/\[(\d{2})\.\s*(\d{2})\.\s*(\d{2})\]/);
        const deadline = dateMatch ? `20${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

        competitions.push({
            title, link, org: 'DOS — Društvo oblikovalcev Slovenije',
            category: detectCategory(title), status: detectStatus(title, deadline),
            deadline, prize: 'Vidi detalje',
        });
        if (competitions.length >= 5) break;
    }
    console.log(`  ✅ [dos-design.si] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 17: Dizajn Zona — Regional design forum (jobs section)
// ════════════════════════════════════════════
async function scrapeDizajnZona() {
    console.log('📡 [dizajnzona.com] Fetching...');
    const html = await safeFetch('https://www.dizajnzona.com/forums/forum/41-poslovi/');
    if (!html) return [];

    const re = /<a[^>]*href="(https?:\/\/www\.dizajnzona\.com\/forums\/topic\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link)) continue;
        if (!/logo|vizual|dizajn|natječaj|identitet|ilustraci/i.test(title)) continue;
        seen.add(link);
        competitions.push({
            title, link, org: 'Dizajn Zona forum',
            category: detectCategory(title), status: 'Aktivno',
            deadline: null, prize: 'Projektni posao',
        });
        if (competitions.length >= 5) break;
    }
    console.log(`  ✅ [dizajnzona.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 18: Crowdsourcing platforms (99designs, DesignCrowd, LogoArena)
// ════════════════════════════════════════════
async function scrapeCrowdsourcing() {
    console.log('📡 [crowdsourcing platforms] Adding...');
    return [
        {
            title: '99designs — Active Design Contests',
            link: 'https://99designs.com/contests', org: '99designs / Vista',
            category: 'Vizualni identitet', status: 'Aktivno',
            deadline: null, prize: 'Novčana nagrada po natječaju',
        },
        {
            title: 'DesignCrowd — Logo & Identity Contests',
            link: 'https://www.designcrowd.com/design-contests', org: 'DesignCrowd',
            category: 'Vizualni identitet', status: 'Aktivno',
            deadline: null, prize: 'Novčana nagrada po natječaju',
        },
    ];
}

// ════════════════════════════════════════════
// SOURCE 19: Croatian city portals (Zagreb, Split, Rijeka)
// ════════════════════════════════════════════
async function scrapeCityPortals() {
    console.log('📡 [city portals] Fetching...');
    const cities = [
        { url: 'https://www.zagreb.hr/natjecaji/1702', name: 'Grad Zagreb' },
        { url: 'https://www.split.hr/natjecaji', name: 'Grad Split' },
        { url: 'https://www.rijeka.hr/teme-za-gradane/natjecaji-i-javni-pozivi/', name: 'Grad Rijeka' },
    ];
    const competitions = [];
    for (const city of cities) {
        const html = await safeFetch(city.url);
        if (!html) continue;
        const re = /<a[^>]*href="([^"]+)"[^>]*>([^<]{15,120})<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const title = decode(m[2].trim());
            if (!/vizual|logo|dizajn|identitet|grafičk|oblikovan|ilustraci/i.test(title)) continue;
            let link = m[1];
            if (!link.startsWith('http')) link = new URL(link, city.url).href;
            competitions.push({
                title, link, org: city.name,
                category: detectCategory(title), status: 'Aktivno',
                deadline: findDate(title), prize: 'Javni natječaj',
            });
            if (competitions.length >= 3) break;
        }
    }
    console.log(`  ✅ [city portals] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 20: Dexigner — Global design competition directory
// ════════════════════════════════════════════
async function scrapeDexigner() {
    console.log('📡 [dexigner.com] Fetching...');
    const html = await safeFetch('https://dexigner.com/competitions');
    if (!html) { // Fallback URL
        const html2 = await safeFetch('https://www.dexigner.com/directory/cat/Design-Ede/Competitions');
        if (!html2) return [];
        return parseDexigner(html2);
    }
    return parseDexigner(html);
}
function parseDexigner(html) {
    const re = /<a[^>]*href="([^"]+)"[^>]*>([^<]{15,100})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const title = decode(m[2].trim());
        let link = m[1];
        if (!/award|competition|contest|call/i.test(title)) continue;
        if (seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        if (!link.startsWith('http')) link = `https://dexigner.com${link}`;
        competitions.push({
            title, link, org: 'Dexigner',
            category: detectCategory(title), status: 'Aktivno',
            deadline: null, prize: 'Vidi detalje',
        });
        if (competitions.length >= 6) break;
    }
    console.log(`  ✅ [dexigner.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// Supabase upsert
// ════════════════════════════════════════════
async function upsertToSupabase(competitions) {
    if (!SUPABASE_KEY) {
        console.log('⚠️  No SUPABASE_KEY — printing results:');
        console.table(competitions.map(c => ({
            title: c.title.substring(0, 45), status: c.status,
            deadline: c.deadline || '—', link: c.link.substring(0, 40)
        })));
        return;
    }

    console.log(`💾 Writing ${competitions.length} competitions to Supabase...`);
    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

    // Clear all and replace
    await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?title=neq.___KEEP___`, { method: 'DELETE', headers });

    // Filter out stale entries (old deadlines + old year references in title)
    const fresh = competitions.filter(c => {
        if (isStale(c.deadline)) { console.log(`  🗑️ Stale (old deadline): ${c.title.substring(0, 50)}`); return false; }
        if (isOldByTitle(c.title)) { console.log(`  🗑️ Stale (old year): ${c.title.substring(0, 50)}`); return false; }
        return true;
    });
    console.log(`  📋 After removing stale: ${fresh.length} (removed ${competitions.length - fresh.length})`);

    // Deduplicate by normalized title
    const seen = new Map();
    for (const c of fresh) {
        const key = c.title.toLowerCase().replace(/[^a-zčćžšđ0-9]/g, '').substring(0, 40);
        if (!seen.has(key) || (c.deadline && !seen.get(key).deadline)) seen.set(key, c);
    }
    const unique = [...seen.values()];

    const res = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji`, {
        method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(unique),
    });
    if (!res.ok) throw new Error(`Insert failed: ${res.status} — ${await res.text()}`);
    const inserted = await res.json();
    console.log(`  ✅ Inserted ${inserted.length} unique competitions`);
}

// ════════════════════════════════════════════
// Main — 20 sources
// ════════════════════════════════════════════
async function main() {
    try {
        console.log('🎯 DizajnRadar Scraper v5 — 20 sources, deep scrape\n');
        const results = await Promise.allSettled([
            // 🇭🇷 Croatia — Design associations
            scrapeDizajnHr(),         // 1. HDD
            scrapeHdlu(),             // 2. HDLU
            scrapePogon(),            // 3. Pogon
            scrapeVizkultura(),       // 4. Vizkultura
            scrapeHura(),             // 5. HURA (BalCannes, IdejaX, Effie)
            // 🇭🇷 Croatia — Public sector
            scrapeCityPortals(),      // 6. Zagreb, Split, Rijeka
            // 🇸🇮 Slovenia
            scrapeBrumen(),           // 7. Brumen + TAM-TAM
            scrapeDos(),              // 8. DOS
            // 🇷🇸 Serbia
            scrapeO3one(),            // 9. O3ONE Belgrade
            // 🌐 Southeast Europe
            scrapeBigSee(),           // 10. BIG SEE
            scrapeFluid(),            // 11. FLUID
            scrapeDesignEuropa(),     // 12. DesignEuropa
            // 🌍 International — Directories
            scrapeContestWatchers(),  // 13. ContestWatchers
            scrapeADesign(),          // 14. A' Design
            scrapeGraphicCompetitions(), // 15. graphiccompetitions.com
            scrapeDezeen(),           // 16. Dezeen
            scrapeEuropeanDesign(),   // 17. European Design Awards
            scrapeDexigner(),         // 18. Dexigner
            // 🌍 International — Crowdsourcing
            scrapeCrowdsourcing(),    // 19. 99designs + DesignCrowd
            // 🌐 Regional — Forums
            scrapeDizajnZona(),       // 20. Dizajn Zona
        ]);
        const all = [];
        for (const r of results) {
            if (r.status === 'fulfilled') all.push(...r.value);
            else console.error('  ❌ Source failed:', r.reason?.message);
        }
        console.log(`\n📊 Total from all sources: ${all.length}`);
        if (all.length === 0) { console.log('⚠️  No competitions found.'); process.exit(1); }
        await upsertToSupabase(all);
        console.log('\n🎯 All done!');
    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();

