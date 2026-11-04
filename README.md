# eduRoll

**Explore knowledge, one scroll at a time.**

eduRoll is a progressive learning platform. A search begins with a simple explanation, then unfolds into increasingly detailed stages. Any stage or subtopic can be elaborated into a deeper branch, and users can launch contextual follow-up searches at every level. Learning paths, expanded branches and reading progress are saved to the signed-in user's account.

## What is implemented

- Responsive eduRoll interface and scroll-linked visual experience.
- Account registration, sign-in, sign-out, password reset, server-side sessions, CSRF protection and Argon2id password hashing.
- PostgreSQL persistence for accounts, learning journeys, recursive learning nodes, source references, consent records and progress.
- Learning generation through Groq's OpenAI-compatible Chat Completions API using GPT-OSS 20B and strict JSON Schema Structured Outputs.
- Separate built-in browser-search requests for queries detected as time-sensitive. Browser search and structured outputs are deliberately performed in separate calls because Groq documents that they cannot be combined in one request.
- Query-aware learning structures (concepts, tutorials, comparisons, timelines and general topics), recursive Elaborate actions, contextual follow-up search, learning history, resume progress, and account data export/deletion.
- Server-side secrets, Helmet security headers/CSP, request validation, per-route rate limits, body limits, and no API response caching.
- PWA shell caching for static assets only. API/account/learning responses are not cached by the service worker.
- Draft Terms and Privacy pages. These are not legal advice.

## Learning provider: Groq free tier

The learning adapter now uses Groq instead of OpenAI. The default model is `openai/gpt-oss-20b`. A Groq API key is still required, but the free tier can be used without adding OpenAI credits or enabling OpenAI billing.

1. Create a Groq account at https://console.groq.com/.
2. Create an API key at https://console.groq.com/keys.
3. Add the key to the Render web service as `GROQ_API_KEY`.
4. Keep `GROQ_MODEL` unset or set it to `openai/gpt-oss-20b`.

Groq free usage is limited by requests and tokens, with limits applied at the organization level. Limits can change and the exact values for your account are shown in the Groq console. A free tier is suitable for development and light testing, not a guarantee of unlimited or production-scale availability. See the official [rate limits](https://console.groq.com/docs/rate-limits), [browser search](https://console.groq.com/docs/tool-use/built-in-tools/browser-search), and [structured outputs](https://console.groq.com/docs/structured-outputs) documentation.

## Safety and launch limitations

The provider switch removes the OpenAI API key and OpenAI ZDR environment gate. It does **not** establish legal compliance, age assurance, or safety certification. eduRoll is currently restricted to adults through self-attestation; this is not independent age verification.

The Groq adapter does not currently reproduce the previous OpenAI moderation endpoint's input/output screening. Prompt instructions and schema validation are not equivalent to moderation. Before a public launch, add and test dedicated input/output moderation, abuse reporting and escalation, privacy/data-transfer review, and jurisdiction-specific legal review. Do not enter personal or sensitive information into learning prompts. The platform's Terms and Privacy pages are drafts and require professional review.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- Groq API key (free tier available, subject to rate and token limits)
- SMTP credentials for production password-reset email

## Local setup

1. Create a PostgreSQL database. With Docker Compose installed, run:

   ```bash
   docker compose up -d db
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, `GROQ_API_KEY`, and local SMTP settings. Keep secrets out of source control.
3. Install dependencies and start:

   ```bash
   npm install
   npm run check
   npm test
   npm start
   ```

4. Open `http://localhost:3000`.

The server applies the idempotent SQL schema at startup. `npm run db:migrate` can also be run separately.

## Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port, default `3000` |
| `APP_ORIGIN` | Canonical public origin used in email links |
| `TRUST_PROXY` | Trusted proxy hop count |
| `SESSION_SECRET` | Random secret of at least 32 characters in production |
| `DATABASE_URL` | PostgreSQL connection string |
| `PGSSL` | Set `true` if the database requires TLS |
| `PGSSL_REJECT_UNAUTHORIZED` | Keep `true` unless your database provider explicitly requires otherwise |
| `GROQ_API_KEY` | Server-side Groq API key; never expose it to browser code |
| `GROQ_MODEL` | Groq model ID, default `openai/gpt-oss-20b` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Transactional email configuration |
| `EMAIL_FROM` | Sender address |
| `SESSION_MAX_AGE_DAYS` | Session lifetime, default 14 days |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Per-IP learning search limit |
| `BRANCH_RATE_LIMIT_PER_MINUTE` | Per-IP elaboration limit |
| `USER_DAILY_GENERATION_LIMIT` | Per-account generation reservation limit per rolling 24 hours, default 40 |
| `MAX_LEARNING_DEPTH` | Maximum recursive branch depth, default 10 |

## Architecture

- `server.js` — Express app, authentication/session routes, ownership checks, learning APIs, progress and account data rights.
- `lib/auth.js` — Argon2id password hashing helpers, email token delivery and session helpers.
- `lib/learning.js` — query-aware learning prompt, Groq API adapter, optional browser research, source URL extraction and structured-output validation.
- `db/schema.sql` — PostgreSQL schema.
- `public/app.js` — client-side UI, recursive learning tree, contextual search, progress saving and scroll-linked visual behavior.
- `public/styles.css` — eduRoll visual system and reduced-motion behavior.

## Known limitations before launch

- Free-tier availability and limits can change; the service may return rate-limit errors during busy periods.
- Dedicated input/output moderation, claim-level citations, safety escalation workflows, and legal/privacy review remain outstanding.
- Citation URLs from browser research are shown as a source list, not attached to individual factual claims.
- The Terms and Privacy pages are drafts, not approved legal documents.
- Full browser, integration, load, accessibility and independent security testing remain required.
