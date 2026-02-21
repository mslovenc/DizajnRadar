// DizajnRadar Scraper — Multi-source competition scraper
// Sources: dizajn.hr (Croatia), contestwatchers.com (International), bigsee.eu (Regional)
// Usage: node scrape.mjs
// Env: SUPABASE_URL, SUPABASE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://erimkexlkybipsdutsfd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Decode HTML entities
function decodeEntities(str) {
    const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&#8211;': '–', '&#8212;': '—', '&#8217;': "'", '&#8220;': '"', '&#8221;': '"', '&ndash;': '–', '&mdash;': '—', '&#038;': '&', '&nbsp;': ' ' };
    return str.replace(/&#?\w+;/g, m => entities[m] || m);
}

function stripHtml(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ════════════════════════════════════════════
// SOURCE 1: dizajn.hr (Croatian Designers Association)
// ════════════════════════════════════════════
async function scrapeDizajnHr() {
    console.log('📡 [dizajn.hr] Fetching...');
    const res = await fetch('https://dizajn.hr/natjecaji/');
    if (!res.ok) { console.error(`  ❌ HTTP ${res.status}`); return []; }
    const html = await res.text();

    const h2Regex = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/gi;
    let match;
    const entries = [];
    while ((match = h2Regex.exec(html)) !== null) {
        entries.push({ link: match[1], title: match[2].trim(), index: match.index });
    }

    const competitions = [];
    for (let i = 0; i < Math.min(entries.length, 20); i++) {
        const entry = entries[i];
        const start = entry.index;
        const end = i + 1 < entries.length ? entries[i + 1].index : html.length;
        const block = html.substring(start, end);
        const desc = stripHtml(block.replace(/<h2[\s\S]*?<\/h2>/gi, '')).substring(0, 400);

        const title = decodeEntities(entry.title);
        const deadline = extractDeadline(desc);
        const status = detectStatus(title + ' ' + desc, deadline);

        // Skip clearly old/irrelevant items
        if (deadline) {
            const diff = (new Date() - new Date(deadline)) / (1000 * 60 * 60 * 24);
            if (diff > 180) continue; // Skip if > 6 months old
        }

        competitions.push({
            title,
            link: entry.link, // dizajn.hr blog posts ARE the detail pages with all competition info
            org: extractOrg(desc) || 'HDD / dizajn.hr',
            category: detectCategory(title + ' ' + desc),
            status,
            deadline,
            prize: extractPrize(desc),
        });
    }
    console.log(`  ✅ [dizajn.hr] Found ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 2: contestwatchers.com (International graphic design)
// ════════════════════════════════════════════
async function scrapeContestWatchers() {
    console.log('📡 [contestwatchers.com] Fetching...');
    const url = 'https://www.contestwatchers.com/category/visual-arts/graphic-design/';
    const res = await fetch(url, { headers: { 'User-Agent': 'DizajnRadar/1.0' } });
    if (!res.ok) { console.error(`  ❌ HTTP ${res.status}`); return []; }
    const html = await res.text();

    const competitions = [];
    // Each contest is in an <article> or <h2>/<h3> with a link
    const entryRegex = /<h[23][^>]*>\s*<a[^>]*href="(https:\/\/www\.contestwatchers\.com\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = entryRegex.exec(html)) !== null) {
        const cwLink = match[1];
        const title = decodeEntities(match[2].trim());

        // Skip navigation/category links
        if (cwLink.includes('/category/') || cwLink.includes('/page/') || cwLink.includes('/feed/')) continue;

        // Get remaining time from nearby text
        const nearbyText = html.substring(match.index, match.index + 500);
        const timeMatch = nearbyText.match(/(\d+\+?\s*(?:days?|weeks?|months?)\s*remaining)/i);
        const isFree = nearbyText.includes('Free');

        competitions.push({
            title,
            link: cwLink, // Links to detail page with full info + external application link
            org: extractOrgFromTitle(title),
            category: detectCategory(title),
            status: 'Aktivno',
            deadline: estimateDeadlineFromRemaining(timeMatch ? timeMatch[1] : null),
            prize: isFree ? 'Besplatna prijava' : 'Vidi detalje',
        });
    }

    console.log(`  ✅ [contestwatchers.com] Found ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 3: bigsee.eu (BIG SEE — Southeast Europe)
// ════════════════════════════════════════════
async function scrapeBigSee() {
    console.log('📡 [bigsee.eu] Fetching...');
    const urls = [
        'https://bigsee.eu/big-see-architecture-award/',
        'https://bigsee.eu/big-see-product-design-award/',
        'https://bigsee.eu/big-see-visionaries/',
    ];

    const competitions = [];
    for (const url of urls) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'DizajnRadar/1.0' } });
            if (!res.ok) continue;
            const html = await res.text();

            // Extract page title + any call to action
            const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
            if (!titleMatch) continue;

            const title = decodeEntities(titleMatch[1].trim().replace(/\s*[-–|].*$/, ''));
            const deadlineMatch = html.match(/deadline[:\s]*([\w\s,]+\d{4})/i);

            competitions.push({
                title: title || 'BIG SEE Award',
                link: url,
                org: 'BIG SEE / Zavod Big',
                category: detectCategory(title + ' ' + url),
                status: 'Aktivno',
                deadline: deadlineMatch ? parseEnglishDate(deadlineMatch[1]) : null,
                prize: 'Međunarodna nagrada',
            });
        } catch (e) {
            console.error(`  ⚠️ [bigsee.eu] Error on ${url}: ${e.message}`);
        }
    }
    console.log(`  ✅ [bigsee.eu] Found ${competitions.length} competitions`);
    return competitions;
}

// ════════════════════════════════════════════
// SOURCE 4: European Design Awards
// ════════════════════════════════════════════
async function scrapeEuropeanDesign() {
    console.log('📡 [europeandesign.org] Fetching...');
    try {
        const res = await fetch('https://europeandesign.org/', { headers: { 'User-Agent': 'DizajnRadar/1.0' } });
        if (!res.ok) { console.error(`  ❌ HTTP ${res.status}`); return []; }
        const html = await res.text();

        const competitions = [];
        // Look for any open call / submit links
        const submitMatch = html.match(/(?:submit|enter|call for entries|open call)[^<]*<\/a>/gi);
        const deadlineMatch = html.match(/deadline[:\s]*([\w\s,]+\d{4})/i);

        competitions.push({
            title: 'European Design Awards 2026',
            link: 'https://europeandesign.org/',
            org: 'European Design Awards',
            category: 'Grafički dizajn',
            status: 'Aktivno',
            deadline: deadlineMatch ? parseEnglishDate(deadlineMatch[1]) : null,
            prize: 'Europska nagrada za dizajn',
        });

        console.log(`  ✅ [europeandesign.org] Found ${competitions.length} competitions`);
        return competitions;
    } catch (e) {
        console.error(`  ⚠️ [europeandesign.org] Error: ${e.message}`);
        return [];
    }
}

// ════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════

function detectCategory(text) {
    const t = text.toLowerCase();
    if (t.includes('vizualni identitet') || t.includes('visual identity') || t.includes('logotip') || t.includes('brand')) return 'Vizualni identitet';
    if (t.includes('ilustraci') || t.includes('illustrat')) return 'Ilustracija';
    if (t.includes('knjig') || t.includes('book')) return 'Dizajn knjige';
    if (t.includes('ux') || t.includes('ui') || t.includes('web') || t.includes('digital') || t.includes('interaction')) return 'UX/UI dizajn';
    if (t.includes('plakat') || t.includes('poster')) return 'Grafički dizajn';
    if (t.includes('modni') || t.includes('fashion') || t.includes('moda')) return 'Modni dizajn';
    if (t.includes('produkt') || t.includes('product') || t.includes('industrijski') || t.includes('industrial')) return 'Industrijski dizajn';
    if (t.includes('architectur') || t.includes('arhitektur') || t.includes('interior')) return 'Arhitektura';
    if (t.includes('typograph') || t.includes('tipografi') || t.includes('type') || t.includes('font')) return 'Tipografija';
    if (t.includes('packaging') || t.includes('package') || t.includes('ambalaž')) return 'Dizajn ambalaže';
    return 'Grafički dizajn';
}

function detectStatus(text, deadline) {
    const t = text.toLowerCase();
    if (t.includes('rezultat') || t.includes('odabran') || t.includes('proglašen') || t.includes('završen') || t.includes('winner') || t.includes('results')) return 'Završeno';
    if (deadline) {
        const diff = (new Date() - new Date(deadline)) / (1000 * 60 * 60 * 24);
        if (diff > 30) return 'Završeno';
    }
    return 'Aktivno';
}

const CRO_MONTHS = {
    'siječnja': '01', 'veljače': '02', 'ožujka': '03', 'travnja': '04',
    'svibnja': '05', 'lipnja': '06', 'srpnja': '07', 'kolovoza': '08',
    'rujna': '09', 'listopada': '10', 'studenoga': '11', 'studenog': '11', 'prosinca': '12',
};

function extractDeadline(text) {
    const longMatch = text.match(/(\d{1,2})\.\s*(siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|studenog|prosinca)\s*(\d{4})/i);
    if (longMatch) {
        const m = CRO_MONTHS[longMatch[2].toLowerCase()];
        if (m) return `${longMatch[3]}-${m}-${longMatch[1].padStart(2, '0')}`;
    }
    const shortMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (shortMatch) return `${shortMatch[3]}-${shortMatch[2].padStart(2, '0')}-${shortMatch[1].padStart(2, '0')}`;
    return null;
}

const ENG_MONTHS = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
    'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06', 'jul': '07',
    'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
};

function parseEnglishDate(str) {
    if (!str) return null;
    const m = str.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/i);
    if (m) {
        const month = ENG_MONTHS[m[1].toLowerCase()];
        if (month) return `${m[3]}-${month}-${m[2].padStart(2, '0')}`;
    }
    const m2 = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (m2) {
        const month = ENG_MONTHS[m2[2].toLowerCase()];
        if (month) return `${m2[3]}-${month}-${m2[1].padStart(2, '0')}`;
    }
    return null;
}

function estimateDeadlineFromRemaining(remainingStr) {
    if (!remainingStr) return null;
    const now = new Date();
    const m = remainingStr.match(/(\d+)\+?\s*(day|week|month)/i);
    if (!m) return null;
    const n = parseInt(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('day')) now.setDate(now.getDate() + n);
    else if (unit.startsWith('week')) now.setDate(now.getDate() + n * 7);
    else if (unit.startsWith('month')) now.setMonth(now.getMonth() + n);
    return now.toISOString().split('T')[0];
}

function extractOrg(text) {
    const patterns = [
        /(?:organizator|raspisivač|provoditelj)[:\s]+([A-ZČĆŽŠĐ][^\.,;]{3,40})/i,
        /(Grad\s+\w+)/i, /(HDD|HDLU|HAC|HAKOM|NSK|KGZ)/, /(Hrvatsko\s+\w+\s+\w+)/i,
        /(Knjižnice\s+grada\s+\w+)/i, /(POGON|Školska knjiga|ULUPUH)/i,
    ];
    for (const p of patterns) { const m = text.match(p); if (m) return m[1].trim(); }
    return null;
}

function extractOrgFromTitle(title) {
    const m = title.match(/^([^–—:-]+(?:Award|Competition|Contest|Awards))/i);
    return m ? m[1].trim() : null;
}

function extractPrize(text) {
    const m = text.match(/(\d[\d.,]*)\s*(EUR|€|eura|kuna|HRK)/i);
    if (m) return `${m[1]} ${m[2].toUpperCase() === 'EURA' ? 'EUR' : m[2]}`;
    if (text.toLowerCase().includes('nagrada') || text.toLowerCase().includes('naknada')) return 'Da (vidi detalje)';
    return 'Nije navedeno';
}

// ════════════════════════════════════════════
// Supabase upsert
// ════════════════════════════════════════════
async function upsertToSupabase(competitions) {
    if (!SUPABASE_KEY) {
        console.log('⚠️  No SUPABASE_KEY — printing results:');
        console.table(competitions.map(c => ({ title: c.title.substring(0, 50), status: c.status, deadline: c.deadline, link: c.link.substring(0, 50) })));
        return;
    }

    console.log(`💾 Writing ${competitions.length} competitions to Supabase...`);
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
    };

    // Clear ALL old data and replace with fresh scrape
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?title=neq.___KEEP___`, {
        method: 'DELETE', headers,
    });
    console.log(`  🗑️  Cleared old data: ${delRes.status}`);

    // Deduplicate by title (prefer entries with deadlines)
    const seen = new Map();
    for (const c of competitions) {
        const key = c.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!seen.has(key) || (c.deadline && !seen.get(key).deadline)) {
            seen.set(key, c);
        }
    }
    const unique = [...seen.values()];

    // Insert
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji`, {
        method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(unique),
    });

    if (!insRes.ok) {
        const errText = await insRes.text();
        throw new Error(`Insert failed: ${insRes.status} — ${errText}`);
    }

    const inserted = await insRes.json();
    console.log(`  ✅ Inserted ${inserted.length} unique competitions`);
}

// ════════════════════════════════════════════
// Main
// ════════════════════════════════════════════
async function main() {
    try {
        console.log('🎯 DizajnRadar Scraper — Starting multi-source scrape...\n');

        const results = await Promise.allSettled([
            scrapeDizajnHr(),
            scrapeContestWatchers(),
            scrapeBigSee(),
            scrapeEuropeanDesign(),
        ]);

        const all = [];
        for (const r of results) {
            if (r.status === 'fulfilled') all.push(...r.value);
            else console.error('  ❌ Source failed:', r.reason.message);
        }

        console.log(`\n📊 Total from all sources: ${all.length}`);

        if (all.length === 0) {
            console.log('⚠️  No competitions found from any source.');
            process.exit(1);
        }

        await upsertToSupabase(all);
        console.log('\n🎯 All done!');
    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
