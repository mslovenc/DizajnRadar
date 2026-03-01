// DizajnRadar Scraper v3 — Multi-source with deep deadline extraction
// Sources: dizajn.hr, contestwatchers.com, bigsee.eu, europeandesign.org,
//          graphiccompetitions.com, a]designaward.com, dezeen.com
// Usage: node scrape.mjs
// Env: SUPABASE_URL, SUPABASE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ FATAL: SUPABASE_URL and SUPABASE_KEY environment variables must be set.');
    process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (like Gecko) Chrome/131.0 Safari/537.36';
const SCRAPED_AT = new Date().toISOString();

// ── Utils ──
function decode(str) {
    const e = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#8211;': '–', '&#8212;': '—', '&#8217;': "'", '&#8220;': '"', '&#8221;': '"', '&ndash;': '–', '&mdash;': '—', '&#038;': '&', '&nbsp;': ' ', '&apos;': "'" };
    return str.replace(/&#?\w+;/g, m => e[m] || m);
}
function strip(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

async function safeFetch(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
            if (r.ok) return await r.text();
            console.warn(`  ⚠️  [${r.status}] ${url}`);
            return null;
        } catch (e) {
            if (i === retries - 1) {
                console.warn(`  ❌ Fetch failed: ${url} (${e.message})`);
                return null;
            }
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

// ── Date extraction (Croatian + English) ──
const CRO = { 'siječnja': '01', 'veljače': '02', 'ožujka': '03', 'travnja': '04', 'svibnja': '05', 'lipnja': '06', 'srpnja': '07', 'kolovoza': '08', 'rujna': '09', 'listopada': '10', 'studenoga': '11', 'studenog': '11', 'prosinca': '12' };
const ENG = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12', jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function extractDateFromText(t) {
    let m = t.match(/(\d{1,2})\.\s*(siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|studenog|prosinca)\s*(\d{4})/i);
    if (m && CRO[m[2].toLowerCase()]) return `${m[3]}-${CRO[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = t.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/i);
    if (m && ENG[m[1].toLowerCase()]) return `${m[3]}-${ENG[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
    m = t.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (m && ENG[m[2].toLowerCase()]) return `${m[3]}-${ENG[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return null;
}

function findDate(text) {
    if (!text) return null;
    const kwMatch = text.match(/(?:rok|deadline|closing|closes?|expires?|do|prijav[ae]\s+do)[:\s]+(.{0,50})/i);
    if (kwMatch) {
        const d = extractDateFromText(kwMatch[1]);
        if (d) return d;
    }
    return extractDateFromText(text);
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

// ── Extract publication / posting date from HTML and URL ──
function findPublishedDate(html, url) {
    if (!html && !url) return null;
    // 1. Try URL path: /2026/02/15/ or /2026-02-15/
    if (url) {
        const urlM = url.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\/?/);
        if (urlM) return `${urlM[1]}-${urlM[2]}-${urlM[3]}`;
    }
    if (!html) return null;
    // 2. <meta property="article:published_time" content="2026-02-15T...">
    const metaM = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i)
        || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="article:published_time"/i);
    if (metaM) { const d = metaM[1].substring(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
    // 3. <time datetime="2026-02-15...">
    const timeM = html.match(/<time[^>]*datetime="([^"]+)"/i);
    if (timeM) { const d = timeM[1].substring(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
    // 4. <meta property="og:article:published_time">
    const ogM = html.match(/<meta[^>]*property="og:article:published_time"[^>]*content="([^"]+)"/i);
    if (ogM) { const d = ogM[1].substring(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
    return null;
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
    if (/vizualni identitet|visual identity|logotip|brand/.test(t)) return 'Vizualni identitet';
    if (/ilustraci|illustrat/.test(t)) return 'Ilustracija';
    if (/knjig|book/.test(t)) return 'Dizajn knjige';
    if (/\bux\b|\bui\b|web|digital|interaction/.test(t)) return 'UX/UI dizajn';
    if (/plakat|poster/.test(t)) return 'Grafički dizajn';
    if (/modn|fashion/.test(t)) return 'Modni dizajn';
    if (/produkt|product|industrijski|industrial/.test(t)) return 'Industrijski dizajn';
    if (/architectur|arhitektur|interior/.test(t)) return 'Arhitektura';
    if (/typograph|tipografi|type design|font/.test(t)) return 'Tipografija';
    if (/packaging|package|ambalaž/.test(t)) return 'Dizajn ambalaže';
    if (/communicat|komunikaci/.test(t)) return 'Komunikacijski dizajn';
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
// SOURCE 1: dizajn.hr — RSS Feed parsing
// ════════════════════════════════════════════
async function scrapeDizajnHr() {
    console.log('📡 [dizajn.hr] Fetching RSS feed...');
    const xml = await safeFetch('https://dizajn.hr/feed/');
    if (!xml) return [];

    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m; const competitions = [];

    while ((m = itemRe.exec(xml)) !== null) {
        const itemXml = m[1];

        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
        const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
        const contentMatch = itemXml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i) || itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || itemXml.match(/<description>([\s\S]*?)<\/description>/i);
        const cats = [...itemXml.matchAll(/<category><!\[CDATA\[(.*?)\]\]><\/category>/gi)].map(c => c[1].toLowerCase());

        if (!titleMatch || !linkMatch) continue;

        const title = decode(titleMatch[1].trim());
        const link = linkMatch[1].trim();
        // Since the main RSS feed has everything, filter strictly for competitions
        const isNatjecaj = cats.includes('natječaji') || /natječaj|poziv|prijav/i.test(title);
        if (!isNatjecaj) continue;

        const fullText = strip(contentMatch ? contentMatch[1] : title);
        const deadline = findDate(fullText);
        const status = detectStatus(title + ' ' + fullText, deadline);
        if (isStale(deadline) || isOldByTitle(title)) continue;

        let published_date = null;
        if (pubDateMatch) {
            const d = new Date(pubDateMatch[1]);
            if (!isNaN(d)) published_date = d.toISOString().split('T')[0];
        }

        competitions.push({
            title, link,
            org: extractOrg(fullText) || 'HDD / dizajn.hr',
            category: detectCategory(title + ' ' + fullText),
            status, deadline, prize: extractPrize(fullText),
            published_date, scraped_at: SCRAPED_AT,
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

        const published_date = findPublishedDate(pageHtml, e.link);
        competitions.push({
            title: e.title, link: externalLink,
            org: e.title.replace(/\s*\d{4}.*$/, '').replace(/\s*[-–:].*$/, '').substring(0, 50) || 'Međunarodni natječaj',
            category: detectCategory(e.title),
            status: detectStatus(e.title, deadline), deadline,
            prize: e.free ? 'Besplatna prijava' : 'Vidi detalje',
            published_date, scraped_at: SCRAPED_AT,
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
        const published_date = findPublishedDate(html, urls[i].url);
        competitions.push({
            title, link: urls[i].url, org: 'BIG SEE / Zavod Big',
            category: urls[i].cat, status: detectStatus(text, deadline),
            deadline, prize: 'Međunarodna nagrada',
            published_date, scraped_at: SCRAPED_AT,
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
    const published_date = findPublishedDate(html, 'https://europeandesign.org/');
    return [{
        title: `European Design Awards ${new Date().getFullYear()}`, link: 'https://europeandesign.org/',
        org: 'European Design Awards', category: 'Grafički dizajn',
        status: detectStatus(text, deadline), deadline,
        prize: 'Europska nagrada za dizajn',
        published_date, scraped_at: SCRAPED_AT,
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
    const published_date = findPublishedDate(html, 'https://competition.adesignaward.com/registration.html');
    return [{
        title: `A' Design Award & Competition ${new Date().getFullYear()}`, link: 'https://competition.adesignaward.com/registration.html',
        org: "A' Design Award", category: 'Grafički dizajn',
        status: detectStatus('', deadline), deadline,
        prize: 'Međunarodna nagrada + promocija',
        published_date, scraped_at: SCRAPED_AT,
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
    let m; const seen = new Set(); const entries = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link)) continue;
        if (!/natječaj|poziv|izložb|salon|online natječaj|open call/i.test(title)) continue;
        seen.add(link);
        entries.push({ link, title });
        /* removed limit */
    }

    // Fetch detail pages in parallel
    const pages = await Promise.allSettled(entries.map(e => safeFetch(e.link)));
    const competitions = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const page = pages[i].status === 'fulfilled' ? pages[i].value : null;
        let deadline = null;
        if (page) {
            const og = page.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
            const fullText = (og ? decode(og[1]) : '') + ' ' + strip(page).substring(0, 2000);
            deadline = findDate(fullText);
        }
        const published_date = findPublishedDate(page, entry.link);
        competitions.push({
            title: entry.title, link: entry.link, org: 'HDLU',
            category: detectCategory(entry.title), status: detectStatus(entry.title, deadline),
            deadline, prize: 'Vidi detalje',
            published_date, scraped_at: SCRAPED_AT,
        });
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

        // Pogon doesn't have explicit published dates on listing, use null
        competitions.push({
            title, link, org: 'POGON Zagreb',
            category: detectCategory(title), status: 'Aktivno',
            deadline, prize: 'Vidi detalje',
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
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
        const brumenPub = findPublishedDate(brumenHtml, 'https://brumen.org/');
        competitions.push({
            title: 'Brumen Biennial — Slovenian Design Awards', link: 'https://brumen.org/',
            org: 'Brumen Foundation', category: 'Grafički dizajn',
            status: detectStatus(text, deadline), deadline,
            prize: 'Nacionalna nagrada za dizajn (Slovenija)',
            published_date: brumenPub, scraped_at: SCRAPED_AT,
        });
    }

    // TAM-TAM Plaktivat
    const tamHtml = await safeFetch('https://tam-tam.si/plaktivat/');
    if (tamHtml) {
        const text = strip(tamHtml);
        const deadline = findDate(text);
        const tamPub = findPublishedDate(tamHtml, 'https://tam-tam.si/plaktivat/');
        competitions.push({
            title: 'Plaktivat — International Poster Design Competition', link: 'https://tam-tam.si/plaktivat/',
            org: 'TAM-TAM Institute', category: 'Grafički dizajn',
            status: detectStatus(text, deadline), deadline,
            prize: 'Izložba na javnim površinama u Sloveniji',
            published_date: tamPub, scraped_at: SCRAPED_AT,
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
    const deadline = findDate(text);
    const published_date = findPublishedDate(html, 'https://www.euipo.europa.eu/en/designeuropa-awards');
    return [{
        title: `DesignEuropa Awards ${new Date().getFullYear()} (Ljubljana)`, link: 'https://www.euipo.europa.eu/en/designeuropa-awards',
        org: 'EUIPO / European Commission', category: 'Industrijski dizajn',
        status: detectStatus(text, deadline), deadline,
        prize: 'Europska nagrada za dizajn',
        published_date, scraped_at: SCRAPED_AT,
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
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
    }
    // Fallback: add a generic entry if nothing was scraped
    if (competitions.length === 0) {
        competitions.push({
            title: 'O3ONE Open Call — Exhibitions',
            link: 'https://o3one.rs/', org: 'O3ONE Art Space, Beograd',
            category: 'Grafički dizajn', status: 'Aktivno',
            deadline: null, prize: 'Izložba u Beogradu',
            published_date: null, scraped_at: SCRAPED_AT,
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
    const year = new Date().getFullYear();
    const html = await safeFetch(`https://www.contestwatchers.com/fluid-regional-awards-for-young-designers-${year}/`);
    let deadline = null;
    if (html) {
        const text = strip(html);
        deadline = findDate(text);
    }
    if (isStale(deadline)) return [];
    const published_date = findPublishedDate(html, `https://www.contestwatchers.com/fluid-regional-awards-for-young-designers-${year}/`);
    return [{
        title: `FLUID — Regional Awards for Young Designers ${year}`,
        link: `https://www.contestwatchers.com/fluid-regional-awards-for-young-designers-${year}/`,
        org: 'FLUID', category: 'Grafički dizajn', status: deadline ? detectStatus('', deadline) : 'Aktivno',
        deadline, prize: 'Besplatna prijava — nagrada za mlade dizajnere',
        published_date, scraped_at: SCRAPED_AT,
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
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
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
        const published_date = findPublishedDate(null, link); // Pass null for html as we don't fetch detail page
        competitions.push({
            title, link, org: 'Dezeen', category: detectCategory(title),
            status: 'Aktivno', deadline: null, prize: 'Vidi detalje',
            published_date, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
    }
    console.log(`  ✅ [dezeen.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 14: Vizkultura.hr — RSS feed parsing
// ════════════════════════════════════════════
async function scrapeVizkultura() {
    console.log('📡 [vizkultura.hr] Fetching RSS feed...');
    const xml = await safeFetch('https://vizkultura.hr/feed/');
    if (!xml) return [];

    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m; const seen = new Set(); const competitions = [];

    while ((m = itemRe.exec(xml)) !== null) {
        const itemXml = m[1];

        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/i);
        const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/i);
        const contentMatch = itemXml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i) || itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || itemXml.match(/<description>([\s\S]*?)<\/description>/i);
        const cats = [...itemXml.matchAll(/<category><!\[CDATA\[(.*?)\]\]><\/category>/gi)].map(c => c[1].toLowerCase());

        if (!titleMatch || !linkMatch) continue;

        const title = decode(titleMatch[1].trim());
        const link = linkMatch[1].trim();
        if (seen.has(link)) continue;

        const isNatjecaj = cats.some(c => c.includes('natječaji')) || /natječaj|rezultat|prijav|poziv|nagrada|izložba|zgraf|erste|salon/i.test(title);
        if (!isNatjecaj) continue;
        seen.add(link);

        const fullText = strip(contentMatch ? contentMatch[1] : title);
        const deadline = findDate(fullText);
        const status = detectStatus(title, deadline);
        if (isStale(deadline) || isOldByTitle(title)) continue;

        let published_date = null;
        if (pubDateMatch) {
            const d = new Date(pubDateMatch[1]);
            if (!isNaN(d)) published_date = d.toISOString().split('T')[0];
        }

        competitions.push({
            title, link, org: 'Vizkultura',
            category: detectCategory(title), status,
            deadline, prize: 'Vidi detalje',
            published_date, scraped_at: SCRAPED_AT,
        });
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
                published_date: null, scraped_at: SCRAPED_AT,
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
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
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
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
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
            published_date: null, scraped_at: SCRAPED_AT,
        },
        {
            title: 'DesignCrowd — Logo & Identity Contests',
            link: 'https://www.designcrowd.com/design-contests', org: 'DesignCrowd',
            category: 'Vizualni identitet', status: 'Aktivno',
            deadline: null, prize: 'Novčana nagrada po natječaju',
            published_date: null, scraped_at: SCRAPED_AT,
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
                published_date: null, scraped_at: SCRAPED_AT,
            });
            /* removed limit */
        }
    }
    console.log(`  ✅ [city portals] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 20: CzK — Center za kreativnost (Slovenia)
// Scrapes /en/opportunities/ page which has explicit deadlines
// ════════════════════════════════════════════
async function scrapeCzk() {
    console.log('📡 [czk.si] Fetching...');
    const competitions = [];

    // Scrape opportunities page (has explicit deadlines in <h6>)
    const oppHtml = await safeFetch('https://czk.si/en/opportunities/');
    if (oppHtml) {
        // Pattern: <a href="..." title="Permanent Link to TITLE">...<h6>Deadline: <span>DATE</span></h6>
        const re = /<a[^>]*href="(https?:\/\/czk\.si\/en\/opportunities\/[^"]+)"[^>]*title="Permanent Link to ([^"]+)"/gi;
        let m; const seen = new Set();
        while ((m = re.exec(oppHtml)) !== null) {
            const link = m[1]; const title = decode(m[2].trim());
            if (seen.has(link)) continue;
            seen.add(link);

            // Extract deadline from <h6>Deadline: <span>DATE</span></h6> nearby
            const nearEnd = Math.min(m.index + 800, oppHtml.length);
            const nearby = oppHtml.substring(m.index, nearEnd);
            const dlMatch = nearby.match(/<h6[^>]*>\s*Deadline:\s*<span>([^<]+)<\/span>/i);
            let deadline = dlMatch ? findDate(dlMatch[1]) : findDate(strip(nearby));

            if (isStale(deadline)) continue;
            if (isOldByTitle(title)) continue;

            competitions.push({
                title, link, org: 'Center za kreativnost / MAO',
                category: detectCategory(title),
                status: detectStatus(title + ' ' + strip(nearby), deadline),
                deadline, prize: 'Vidi detalje',
                published_date: null, scraped_at: SCRAPED_AT,
            });
            /* removed limit */
        }
    }

    // Also scrape news page for open calls
    const newsHtml = await safeFetch('https://czk.si/en/news/');
    if (newsHtml) {
        const re = /<a[^>]*href="(https?:\/\/czk\.si\/en\/news\/[^"]+)"[^>]*title="Permanent Link to ([^"]+)"/gi;
        let m; const seen = new Set(competitions.map(c => c.link));
        while ((m = re.exec(newsHtml)) !== null) {
            const link = m[1]; const title = decode(m[2].trim());
            if (seen.has(link)) continue;
            if (!/open call|call for|biennial|bio \d|award|competition|selection|mark of excellence/i.test(title)) continue;
            seen.add(link);

            const nearEnd = Math.min(m.index + 800, newsHtml.length);
            const nearby = newsHtml.substring(m.index, nearEnd);
            const nearText = strip(nearby);
            let deadline = findDate(nearText);

            if (isStale(deadline)) continue;
            if (isOldByTitle(title)) continue;

            competitions.push({
                title, link, org: 'Center za kreativnost / MAO',
                category: detectCategory(title),
                status: detectStatus(title + ' ' + nearText, deadline),
                deadline, prize: 'Vidi detalje',
                published_date: null, scraped_at: SCRAPED_AT,
            });
            /* removed limit */
        }
    }

    console.log(`  ✅ [czk.si] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 21: HULU Split — Croatian Association of Visual Artists
// ════════════════════════════════════════════
async function scrapeHuluSplit() {
    console.log('📡 [hulu-split.hr] Fetching...');
    const html = await safeFetch('https://hulu-split.hr');
    if (!html) return [];

    // Use the title attribute pattern (WordPress uses title= on links)
    const re = /<a[^>]*href="(https?:\/\/hulu-split\.hr\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    while ((m = re.exec(html)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link) || /kontakt|o-nama|about|english|izlozbe\/?$/i.test(link)) continue;
        // Strict filter: only real competition/call keywords, exclude exhibition invitations
        if (/pozivnica/i.test(title)) continue;
        if (!/natječaj|javni poziv|open call|prijav[ae]|konkurs|rezidencij/i.test(title)) continue;
        seen.add(link);

        // Extract date from nearby HTML
        const nearby = html.substring(Math.max(0, m.index - 200), m.index + 500);
        const nearText = strip(nearby);
        let deadline = findDate(nearText);

        if (isStale(deadline)) continue;
        if (isOldByTitle(title)) continue;

        competitions.push({
            title, link, org: 'HULU Split',
            category: detectCategory(title),
            status: detectStatus(title, deadline),
            deadline, prize: 'Vidi detalje',
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
    }
    console.log(`  ✅ [hulu-split.hr] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 22: Dexigner — Global design competition directory
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
            published_date: null, scraped_at: SCRAPED_AT,
        });
        /* removed limit */
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

    // Fetch existing entries to preserve original scraped_at
    let existingMap = new Map();
    try {
        const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?select=title,scraped_at`, { headers });
        if (existingRes.ok) {
            const existingData = await existingRes.json();
            for (const item of existingData) {
                if (!item.title) continue;
                const key = item.title.toLowerCase().replace(/[^a-zčćžšđ0-9]/g, '').substring(0, 40);
                existingMap.set(key, item.scraped_at);
            }
        }
    } catch (e) {
        console.error('  ⚠️  Could not fetch existing data to preserve scraped_at:', e);
    }

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
        if (existingMap.has(key)) {
            c.scraped_at = existingMap.get(key) || c.scraped_at;
        }
        if (!seen.has(key) || (c.deadline && !seen.get(key).deadline)) seen.set(key, c);
    }
    const unique = [...seen.values()];

    // Fetch all existing IDs to clean up later
    let oldIds = [];
    try {
        const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?select=id`, { headers });
        if (existingRes.ok) {
            const existingData = await existingRes.json();
            oldIds = existingData.map(item => item.id);
        }
    } catch (e) {
        console.error('  ⚠️  Could not fetch existing IDs for cleanup:', e);
    }

    // Insert all new data directly to the main table
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji`, {
        method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(unique),
    });

    if (!insertRes.ok) throw new Error(`Insert failed: ${insertRes.status} — ${await insertRes.text()}`);

    const inserted = await insertRes.json();
    console.log(`  ✅ Inserted ${inserted.length} competitions`);

    // Only delete the old ones if insert succeeded
    if (oldIds.length > 0) {
        console.log(`  🗑️ Cleaning up ${oldIds.length} old entries...`);
        for (let i = 0; i < oldIds.length; i += 100) {
            const chunk = oldIds.slice(i, i + 100);
            await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?id=in.(${chunk.join(',')})`, { method: 'DELETE', headers });
        }
    }
}

// ════════════════════════════════════════════
// Main — 22 sources
// ════════════════════════════════════════════
async function runScraper(name, fn) {
    const start = Date.now();
    try {
        const value = await fn();
        const duration = Date.now() - start;
        console.log(`  ⏱️ [${name}] completed in ${duration}ms`);
        return { status: 'fulfilled', value };
    } catch (err) {
        const duration = Date.now() - start;
        console.log(`  ⏱️ [${name}] failed in ${duration}ms`);
        return { status: 'rejected', reason: err };
    }
}

async function main() {
    try {
        console.log('🎯 DizajnRadar Scraper v6 — 22 sources, deep scrape\n');

        const sources = [
            { name: 'HDD', fn: scrapeDizajnHr },
            { name: 'HDLU', fn: scrapeHdlu },
            { name: 'Pogon', fn: scrapePogon },
            { name: 'Vizkultura', fn: scrapeVizkultura },
            { name: 'HURA', fn: scrapeHura },
            { name: 'Gradovi', fn: scrapeCityPortals },
            { name: 'Brumen', fn: scrapeBrumen },
            { name: 'DOS', fn: scrapeDos },
            { name: 'O3ONE', fn: scrapeO3one },
            { name: 'BIG SEE', fn: scrapeBigSee },
            { name: 'FLUID', fn: scrapeFluid },
            { name: 'DesignEuropa', fn: scrapeDesignEuropa },
            { name: 'ContestWatchers', fn: scrapeContestWatchers },
            { name: "A' Design", fn: scrapeADesign },
            { name: 'GraphicCompet', fn: scrapeGraphicCompetitions },
            { name: 'Dezeen', fn: scrapeDezeen },
            { name: 'EuroDesign', fn: scrapeEuropeanDesign },
            { name: 'Dexigner', fn: scrapeDexigner },
            { name: 'Crowdsourcing', fn: scrapeCrowdsourcing },
            { name: 'CzK', fn: scrapeCzk },
            { name: 'HULU Split', fn: scrapeHuluSplit },
            { name: 'Dizajn Zona', fn: scrapeDizajnZona },
        ];

        const results = [];
        const BATCH_SIZE = 4;
        for (let i = 0; i < sources.length; i += BATCH_SIZE) {
            const batch = sources.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(s => runScraper(s.name, s.fn)));
            results.push(...batchResults);
        }

        const all = [];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === 'fulfilled') all.push(...r.value);
            else console.error(`  ❌ Source ${sources[i].name} failed:`, r.reason?.message);
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

