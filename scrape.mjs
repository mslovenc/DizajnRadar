// DizajnRadar Scraper — Fetches competitions from dizajn.hr and upserts to Supabase
// Usage: node scrape.mjs
// Env vars: SUPABASE_URL, SUPABASE_KEY (service role key for server-side writes)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://erimkexlkybipsdutsfd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SOURCE_URL = 'https://dizajn.hr/natjecaji/';

// Decode HTML entities like &#8211; → –
function decodeEntities(str) {
    const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&#8211;': '–', '&#8212;': '—', '&#8217;': "'", '&#8220;': '"', '&#8221;': '"', '&ndash;': '–', '&mdash;': '—' };
    return str.replace(/&#?\w+;/g, m => entities[m] || m);
}

// ── Fetch and parse dizajn.hr ──
async function scrapeCompetitions() {
    console.log(`📡 Fetching ${SOURCE_URL}...`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Failed to fetch dizajn.hr: ${res.status}`);
    const html = await res.text();

    // Parse <h2> blocks — each competition is an <h2> with a link, followed by description text
    // Pattern: <h2 ...><a href="LINK">TITLE</a></h2> ... description text ... <span class="cat-links">
    const competitions = [];
    const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const articles = html.match(articleRegex) || [];

    // Fallback: parse h2 + paragraphs if no <article> tags
    if (articles.length === 0) {
        // Parse by splitting on h2 tags
        const h2Regex = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/gi;
        let match;
        const entries = [];
        while ((match = h2Regex.exec(html)) !== null) {
            entries.push({ link: match[1], title: match[2].trim(), index: match.index });
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            // Get text between this h2 and the next h2
            const start = entry.index;
            const end = i + 1 < entries.length ? entries[i + 1].index : html.length;
            const block = html.substring(start, end);

            // Extract plain text description (strip HTML tags)
            const descriptionRaw = block
                .replace(/<h2[\s\S]*?<\/h2>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            // Take first 300 chars as description
            const description = descriptionRaw.substring(0, 300).trim();

            // Determine category from keywords
            const category = detectCategory(entry.title + ' ' + description);

            // Try to extract deadline from description
            const deadline = extractDeadline(description);

            // Determine status — check for result/finished keywords + deadline
            const status = detectStatus(entry.title + ' ' + description, deadline);

            // Extract organizer from description
            const org = extractOrg(description);

            // Extract prize from description
            const prize = extractPrize(description);

            competitions.push({
                title: decodeEntities(entry.title),
                link: entry.link,
                org: org || 'HDD / dizajn.hr',
                category,
                status,
                deadline,
                prize,
            });
        }
    } else {
        for (const article of articles) {
            const linkMatch = article.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
            const titleMatch = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
            if (!linkMatch || !titleMatch) continue;

            const plainText = article.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            competitions.push({
                title: decodeEntities(titleMatch[1].trim()),
                link: linkMatch[1],
                org: extractOrg(plainText) || 'HDD / dizajn.hr',
                category: detectCategory(plainText),
                status: detectStatus(plainText),
                deadline: extractDeadline(plainText),
                prize: extractPrize(plainText),
            });
        }
    }

    console.log(`✅ Found ${competitions.length} competitions`);
    return competitions;
}

// ── Helpers ──

function detectCategory(text) {
    const t = text.toLowerCase();
    if (t.includes('vizualni identitet') || t.includes('logotip') || t.includes('branding')) return 'Vizualni identitet';
    if (t.includes('ilustraci')) return 'Ilustracija';
    if (t.includes('knjig')) return 'Dizajn knjige';
    if (t.includes('ux') || t.includes('ui') || t.includes('web') || t.includes('digital')) return 'UX/UI dizajn';
    if (t.includes('plakat')) return 'Grafički dizajn';
    if (t.includes('modni') || t.includes('moda')) return 'Modni dizajn';
    if (t.includes('produkt') || t.includes('industrijski')) return 'Industrijski dizajn';
    return 'Grafički dizajn';
}

function detectStatus(text, deadline) {
    const t = text.toLowerCase();
    if (t.includes('rezultat') || t.includes('odabran') || t.includes('proglašen') || t.includes('završen')) return 'Završeno';
    // If deadline is more than 30 days in the past, mark as finished
    if (deadline) {
        const deadlineDate = new Date(deadline);
        const now = new Date();
        const diffDays = (now - deadlineDate) / (1000 * 60 * 60 * 24);
        if (diffDays > 30) return 'Završeno';
    }
    return 'Aktivno';
}

function extractDeadline(text) {
    // Try common Croatian date patterns
    // "do 25. siječnja 2026" or "do 5.12.2025" or "rok za prijavu je 10. prosinca"
    const months = {
        'siječnja': '01', 'veljače': '02', 'ožujka': '03', 'travnja': '04',
        'svibnja': '05', 'lipnja': '06', 'srpnja': '07', 'kolovoza': '08',
        'rujna': '09', 'listopada': '10', 'studenoga': '11', 'studenog': '11',
        'prosinca': '12',
        'januar': '01', 'februar': '02', 'mart': '03', 'april': '04',
        'maj': '05', 'jun': '06', 'juli': '07', 'jul': '07',
        'august': '08', 'septembar': '09', 'oktobar': '10',
        'novembar': '11', 'decembar': '12',
    };

    // Pattern: "25. siječnja 2026"
    const longDateRegex = /(\d{1,2})\.\s*(siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|studenog|prosinca)\s*(\d{4})/i;
    const longMatch = text.match(longDateRegex);
    if (longMatch) {
        const day = longMatch[1].padStart(2, '0');
        const month = months[longMatch[2].toLowerCase()];
        const year = longMatch[3];
        if (month) return `${year}-${month}-${day}`;
    }

    // Pattern: "5.12.2025" or "05.12.2025."
    const shortDateRegex = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;
    const shortMatch = text.match(shortDateRegex);
    if (shortMatch) {
        const day = shortMatch[1].padStart(2, '0');
        const month = shortMatch[2].padStart(2, '0');
        const year = shortMatch[3];
        return `${year}-${month}-${day}`;
    }

    return null;
}

function extractOrg(text) {
    // Try to find organization names using common patterns
    const patterns = [
        /(?:organizator|raspisivač|provoditelj)[:\s]+([A-ZČĆŽŠĐ][^\.,;]{3,40})/i,
        /(Grad\s+\w+)/i,
        /(HDD|HDLU|HAC|HAKOM|NSK|KGZ)/,
        /(Hrvatsko\s+\w+\s+\w+)/i,
        /(Knjižnice\s+grada\s+\w+)/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1].trim();
    }
    return null;
}

function extractPrize(text) {
    // Try to find prize/award amounts
    const prizeRegex = /(\d[\d.,]*)\s*(EUR|€|eura|kuna|HRK)/i;
    const match = text.match(prizeRegex);
    if (match) return `${match[1]} ${match[2].toUpperCase() === 'EURA' ? 'EUR' : match[2]}`;

    if (text.toLowerCase().includes('nagrada') || text.toLowerCase().includes('naknada')) {
        return 'Da (vidi detalje)';
    }
    return 'Nije navedeno';
}

// ── Upsert to Supabase ──
async function upsertToSupabase(competitions) {
    if (!SUPABASE_KEY) {
        console.log('⚠️  No SUPABASE_KEY set, printing results instead:');
        console.table(competitions.map(c => ({ title: c.title.substring(0, 50), status: c.status, deadline: c.deadline })));
        return;
    }

    console.log(`💾 Upserting ${competitions.length} competitions to Supabase...`);

    // First, clear old scraped data
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji?link=like.https://dizajn.hr/*`, {
        method: 'DELETE',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
        },
    });
    console.log(`  🗑️  Cleared old data: ${delRes.status}`);

    // Insert fresh data
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/natjecaji`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
        },
        body: JSON.stringify(competitions),
    });

    if (!insRes.ok) {
        const errText = await insRes.text();
        throw new Error(`Supabase insert failed: ${insRes.status} — ${errText}`);
    }

    const inserted = await insRes.json();
    console.log(`  ✅ Inserted ${inserted.length} competitions`);
}

// ── Main ──
async function main() {
    try {
        const competitions = await scrapeCompetitions();
        if (competitions.length === 0) {
            console.log('⚠️  No competitions found. Check if dizajn.hr structure changed.');
            process.exit(1);
        }
        await upsertToSupabase(competitions);
        console.log('🎯 Done!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
