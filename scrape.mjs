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
    return (new Date() - new Date(deadline)) / 864e5 > 180;
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
    if (/rezultat|odabran|proglašen|završen|winner|result|selected|awarded/i.test(t)) return 'Završeno';
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
// SOURCE 5: graphiccompetitions.com
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
        if (competitions.length >= 10) break;
    }
    console.log(`  ✅ [graphiccompetitions.com] ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 6: A' Design Award
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
// SOURCE 7: dezeen competitions
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
// SOURCE 8: ULUPUH (Croatian Applied Arts)
// ════════════════════════════════════════════
async function scrapeUlupuh() {
    console.log('📡 [ulupuh.hr] Fetching...');
    const html = await safeFetch('https://ulupuh.hr/natjecaji-i-izlozbe/');
    if (!html) { // Try alternative URL
        const html2 = await safeFetch('https://ulupuh.hr/');
        if (!html2) return [];
    }
    const re = /<a[^>]*href="(https?:\/\/[^"]*ulupuh[^"]*)"[^>]*>([^<]{10,100})<\/a>/gi;
    let m; const seen = new Set(); const competitions = [];
    const source = html || await safeFetch('https://ulupuh.hr/');
    if (!source) return [];
    while ((m = re.exec(source)) !== null) {
        const link = m[1]; const title = decode(m[2].trim());
        if (seen.has(link) || /kontakt|about|impresum/i.test(link)) continue;
        if (/natječaj|izložb|zgraf|poziv|award/i.test(title)) {
            seen.add(link);
            competitions.push({
                title, link, org: 'ULUPUH', category: detectCategory(title),
                status: 'Aktivno', deadline: null, prize: 'Vidi detalje',
            });
        }
        if (competitions.length >= 5) break;
    }
    console.log(`  ✅ [ulupuh.hr] ${competitions.length} competitions`);
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

    // Deduplicate by normalized title
    const seen = new Map();
    for (const c of competitions) {
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
// Main
// ════════════════════════════════════════════
async function main() {
    try {
        console.log('🎯 DizajnRadar Scraper v3 — Multi-source deep scrape\n');
        const results = await Promise.allSettled([
            scrapeDizajnHr(),
            scrapeContestWatchers(),
            scrapeBigSee(),
            scrapeEuropeanDesign(),
            scrapeGraphicCompetitions(),
            scrapeADesign(),
            scrapeDezeen(),
            scrapeUlupuh(),
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
