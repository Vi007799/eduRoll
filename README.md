# eduRoll

**Explore knowledge, one scroll at a time.**

eduRoll is a progressive learning platform. A search begins with a simple explanation, then unfolds into increasingly detailed stages. Any stage or subtopic can be elaborated into a deeper branch, and users can launch contextual follow-up searches at every level. Learning paths, expanded branches and reading progress are saved to the signed-in user's account.

## What is implemented in this codebase

- Original eduRoll identity and responsive editorial-style interface.
- Native browser scrolling with a restrained 3D perspective response tied to scroll position. The app does not intercept `wheel`, `pointermove`, or touchpad gestures. On a laptop, the browser/OS handles two-finger touchpad scrolling; ordinary pointer movement does not move the 3D scene. Reduced-motion preferences disable the 3D transforms.
- Account registration, email verification, sign-in, sign-out, password reset, secure server-side sessions, CSRF tokens, and password hashing with Argon2id.
- PostgreSQL persistence for accounts, email tokens, learning journeys, recursive learning nodes, source references, consent records and progress.
- Learning generation through Groq's OpenAI-compatible Chat Completions API, GPT-OSS 20B structured outputs, and optional built-in browser research for time-sensitive queries.
- Query-aware learning structures (concepts, tutorials, comparisons, timelines and general topics).
- Recursive Elaborate actions, contextual follow-up search at every node, learning history, resume progress, and account data export/deletion.
- Server-side secrets, Helmet security headers/CSP, request validation, per-route rate limits, body limits, generic upstream errors, and no API response caching.
- PWA shell manifest and a service worker that caches only static assets. API/account/learning responses are never cached by the service worker.
- Draft Terms and Privacy pages. These are intentionally marked as launch drafts and are not legal advice.

## Important: this is an engineering foundation, not a certified global launch

A codebase cannot be called globally launch-ready until the production provider terms, age requirements, privacy/data-transfer obligations, billing, legal entity, domain, email delivery, hosting, backups, monitoring, accessibility and security testing have been reviewed and configured.

### OpenAI provider and under-18 safeguards

The Gemini integration has been removed. The learning adapter now uses the OpenAI Responses API with built-in web search, JSON Schema Structured Outputs, moderation checks on both user queries and generated learning content, and `store: false` on Responses API calls.

OpenAI publishes specific guidance for applications serving minors. This product must implement age-appropriate disclosures, content filters, monitoring/reporting and escalation, and any required age assurance. OpenAI's guidance also says developers should not use its services to process personal data of children under 13 or below the applicable age of digital consent without first implementing Zero Data Retention (ZDR) in the API. See https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance.

**Fail-closed provider gate:** generation is disabled unless `OPENAI_ZERO_DATA_RETENTION_CONFIRMED=true`. Set this only after OpenAI has explicitly confirmed ZDR for the exact organization/project and the deployment's data flows have been reviewed. This environment flag is an operator acknowledgement, not proof of enrollment. `store: false` alone is not ZDR. Do not enable the gate based on assumption.

This provider change is not a legal or safety certification. Before serving minors, complete jurisdiction-specific child privacy/consent review, age-appropriate product disclosures, sensitive-topic policies, moderation escalation and reporting, privacy/data minimization, and independent legal review. For users below the applicable age of digital consent, do not send personal data to OpenAI unless the required ZDR arrangement is active. Avoid collecting unnecessary birth dates or other sensitive information.

The web-search tool returns source annotations, which this starter extracts into a source list. A source list is not claim-level attribution or proof that each sentence is supported. Improve claim-level citations and source-quality evaluation before launch.

Official provider references:
- https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/resources/responses/methods/create

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A Groq API key (free tier available; subject to published rate and token limits)
- SMTP credentials for production email verification and password recovery

## Local setup

1. Create a PostgreSQL database. With Docker Compose installed, run:

   ```bash
   docker compose up -d db
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, `GROQ_API_KEY`, and local SMTP settings. For local development, SMTP can be left blank; verification/reset links are logged to the server console.
3. Install dependencies and start:

   ```bash
   npm install
   npm run check
   npm test
   npm start
   ```
4. Open `http://localhost:3000`.
5. Register an account. In development, copy the verification URL printed in the server console and open it in your browser.

The server applies the idempotent SQL schema at startup. `npm run db:migrate` can also be run separately.

## Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port, default `3000` |
| `APP_ORIGIN` | Canonical public origin used in email links |
| `TRUST_PROXY` | Exact trusted proxy hop count; configure to match your hosting topology |
| `SESSION_SECRET` | Random secret of at least 32 characters in production |
| `DATABASE_URL` | PostgreSQL connection string |
| `PGSSL` | Set `true` if the database requires TLS |
| `PGSSL_REJECT_UNAUTHORIZED` | Keep `true` unless your database provider explicitly requires another configuration |
| `OPENAI_API_KEY` | Server-side OpenAI API key; never expose it to the browser |
| `OPENAI_MODEL` | Responses API model name, default `gpt-5.4`; verify model availability for your project |
| `OPENAI_MODERATION_MODEL` | Moderation model, default `omni-moderation-latest` |
| `OPENAI_ZERO_DATA_RETENTION_CONFIRMED` | Must remain `false` until OpenAI confirms ZDR for the exact organization/project; required for under-13/applicable digital-consent-age personal-data handling |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Transactional email provider configuration |
| `EMAIL_FROM` | Verified sender address |
| `SESSION_MAX_AGE_DAYS` | Session lifetime, default 14 days |
| `SEARCH_RATE_LIMIT_PER_MINUTE` | Per-IP learning search limit |
| `BRANCH_RATE_LIMIT_PER_MINUTE` | Per-IP elaboration limit |
| `USER_DAILY_GENERATION_LIMIT` | Per-account generation reservation limit per rolling 24 hours, default 40 |
| `MAX_LEARNING_DEPTH` | Maximum recursive branch depth, default 10 |

## Production deployment checklist

- Review Groq's current free-tier limits, acceptable-use terms, data handling, and the safety/privacy limitations above before enabling production traffic.
- Use a managed PostgreSQL service with TLS, automated backups, restore testing, monitoring and a documented retention policy.
- Set a unique `SESSION_SECRET`, `APP_ORIGIN` to the canonical HTTPS origin, `NODE_ENV=production`, correct `TRUST_PROXY`, `PGSSL=true` where required, and all provider/SMTP secrets in the hosting secret manager.
- Configure transactional email SPF, DKIM and DMARC; test delivery, bounce and abuse handling.
- Restrict API keys, configure provider budgets/quotas, add cost alerts and abuse monitoring.
- Add centralized error tracking, metrics, uptime monitoring, structured log retention and on-call ownership.
- Add claim-level citations, source quality controls, editorial review for high-risk topics, and policy for medical/legal/financial/safety queries.
- Have Terms, Privacy, cookie/session disclosures, data processing agreements, international transfers, age requirements and accessibility reviewed by qualified professionals.
- Run dependency/security scans, SAST, DAST, penetration testing, load testing, cross-browser/device testing, and accessibility audits before launch.
- Configure a CDN/WAF and denial-of-service protection at the edge. Do not cache authenticated API responses.
- Test account verification, password reset, session revocation, data export/deletion, backup restoration and progress recovery end-to-end.

## Architecture

- `server.js` — Express app, authentication/session routes, ownership checks, learning APIs, progress and account data rights.
- `lib/auth.js` — Argon2id password hashing helpers, email token delivery and session helpers.
- `lib/learning.js` — query-aware learning prompt, Groq API adapter, optional browser research, source URL extraction and structured-output validation.
- `db/schema.sql` — PostgreSQL schema.
- `public/app.js` — client-side UI, recursive learning tree, contextual search, progress saving and scroll-linked 3D transforms.
- `public/styles.css` — original eduRoll visual system and reduced-motion behavior.

## Interaction note: touchpad and 3D scrolling

The browser's native scroll handling is deliberately preserved. No wheel or pointer-motion event is hijacked. On standard laptop touchpads, two-finger movement scrolls the document and the 3D transforms respond to scroll position. One-finger pointer movement only moves the cursor. This behavior depends on the operating system/browser's standard gesture configuration and cannot be forced identically on every device. On touchscreens, normal one-finger page scrolling remains available.

## Known limitations to close before launch

- Groq free-tier limits can change and are not guaranteed production capacity. Dedicated input/output moderation, claim-level citations, child-safety escalation workflows and legal review remain outstanding.
- Citation metadata is currently displayed as a source list, not attached to each individual factual claim.
- The Terms and Privacy pages are launch drafts, not approved legal documents.
- No production OAuth/social login, MFA, support console, moderation dashboard, subscription/billing, organization accounts, localization or formal analytics pipeline yet.
- Automated unit tests cover schema/adapter parsing only; full browser, integration, load, accessibility and security tests remain required.
- This code has not undergone independent security review or penetration testing.
