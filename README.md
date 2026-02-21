# DizajnRadar 🎯

Svi natječaji za vizualni identitet, grafički dizajn i ilustraciju u Hrvatskoj — na jednom mjestu.

## Pokretanje

Ovo je statična web aplikacija (jedan `index.html`). Otvori `index.html` u pregledniku ili koristi lokalni server:

```bash
npx serve .
```

## Konfiguracija

U `index.html` zamijeni Supabase podatke:

```js
const SUPABASE_URL = 'https://tvoj-projekt.supabase.co';
const SUPABASE_ANON_KEY = 'tvoj-anon-public-kljuc';
```

Anon ključ nađi u: **Supabase Dashboard → Settings → API → anon public**.

## Tehnologije

- HTML + JavaScript (vanilla)
- [Tailwind CSS](https://tailwindcss.com/) (CDN)
- [Supabase](https://supabase.com/) (baza podataka)
