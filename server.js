"use strict";
require("dotenv").config();
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const { z } = require("zod");
const { argon2, safeUser, makeMailer, deliverToken, hashToken, regenerateSession, saveSession } = require("./lib/auth");
const { generateLearning } = require("./lib/learning");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const APP_ORIGIN = (process.env.APP_ORIGIN || `http://localhost:${PORT}`).replace(/\/$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || (isProduction ? "" : crypto.randomBytes(48).toString("hex"));
if (isProduction && SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
if (isProduction && new URL(APP_ORIGIN).protocol !== "https:") throw new Error("APP_ORIGIN must use HTTPS in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure a PostgreSQL database before starting eduRoll.");
if (isProduction && (!process.env.SMTP_HOST || !process.env.EMAIL_FROM)) throw new Error("SMTP_HOST and EMAIL_FROM are required in production for verification and password recovery.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000
});
const mailer = makeMailer();

app.disable("x-powered-by");
const trustProxy = Number(process.env.TRUST_PROXY || (isProduction ? 1 : 0));
if (trustProxy > 0) app.set("trust proxy", trustProxy);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));
app.use(compression());
app.use(express.json({ limit: "20kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  name: "eduroll.sid",
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true, pruneSessionInterval: 15 * 60 }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: Number(process.env.SESSION_MAX_AGE_DAYS || 14) * 24 * 60 * 60 * 1000,
    path: "/"
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many account attempts. Please wait and try again." } });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE || 8), standardHeaders: "draft-7", legacyHeaders: false, message: { error: "You've reached the search limit. Please wait a moment." } });
const branchLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.BRANCH_RATE_LIMIT_PER_MINUTE || 15), standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many elaborations. Please wait a moment." } });
const USER_DAILY_GENERATION_LIMIT = Number(process.env.USER_DAILY_GENERATION_LIMIT || 40);
const MAX_LEARNING_DEPTH = Number(process.env.MAX_LEARNING_DEPTH || 10);

function csrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}
function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = req.get("x-csrf-token");
  const expected = req.session?.csrfToken;
  if (!supplied || !expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: "Your session security token expired. Refresh the page and try again." });
  }
  next();
}
app.use((req, res, next) => { if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store"); next(); });
app.use(csrfGuard);

const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(128).refine(v => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), "Use at least 12 characters with upper-case, lower-case and a number."),
  displayName: z.string().trim().min(2).max(70),
  consent: z.literal(true),
  adultConfirmation: z.literal(true)
}).strict();
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128), adultConfirmation: z.literal(true), consent: z.literal(true) }).strict();
const searchSchema = z.object({ query: z.string().trim().min(2).max(180) }).strict();
const branchSchema = z.object({ parentNodeId: z.string().uuid(), prompt: z.string().trim().min(2).max(500) }).strict();
const followupSchema = z.object({ query: z.string().trim().min(2).max(180), contextNodeId: z.string().uuid().optional() }).strict();
const progressSchema = z.object({ journeyId: z.string().uuid(), currentNodeId: z.string().uuid().nullable().optional(), progressRatio: z.number().min(0).max(1) }).strict();

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "Sign in to save and continue your learning journeys." });
  pool.query("SELECT adult_confirmed_at FROM users WHERE id=$1", [req.session.userId])
    .then(result => {
      if (!result.rowCount) return req.session.destroy(() => res.status(401).json({ error: "Your account session is no longer valid. Please sign in again." }));
      if (!result.rows[0].adult_confirmed_at) return req.session.destroy(() => res.status(401).json({ error: "Please sign in again and confirm that you are 18 or older to continue." }));
      next();
    })
    .catch(next);
}
async function getUser(req) {
  const { rows } = await pool.query("SELECT id,email,display_name,email_verified_at,adult_confirmed_at,created_at FROM users WHERE id=$1", [req.session.userId]);
  return rows[0] || null;
}
function normalizeSources(citations) {
  const output = [];
  const seen = new Set();
  for (const citation of citations || []) {
    try {
      const url = new URL(citation.url);
      if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) continue;
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      output.push({ title: String(citation.title || url.hostname).slice(0, 240), url: normalized, domain: url.hostname.slice(0, 180) });
    } catch { /* Ignore malformed provider citations. */ }
  }
  return output.slice(0, 20);
}
async function persistJourney(userId, generated, query, parentJourneyId = null, parentNodeId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const journeyResult = await client.query(
      `INSERT INTO learning_journeys (user_id,parent_journey_id,parent_node_id,query,title,intent,introduction)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, parentJourneyId, parentNodeId, query, generated.title, generated.intent, generated.introduction]
    );
    const journey = journeyResult.rows[0];
    const createdNodes = [];
    for (let i = 0; i < generated.stages.length; i++) {
      const stage = generated.stages[i];
      const result = await client.query(
        `INSERT INTO learning_nodes (journey_id,node_type,order_index,depth,title,summary,content,elaborate_prompt,examples)
         VALUES ($1,'step',$2,1,$3,$4,$5,$6,$7) RETURNING *`,
        [journey.id, i, stage.title, stage.summary, stage.content, `Elaborate on: ${stage.title}`, JSON.stringify(stage.examples || [])]
      );
      const node = result.rows[0];
      createdNodes.push({ ...node, keyPoints: [] });
      for (let j = 0; j < stage.key_points.length; j++) {
        const point = stage.key_points[j];
        const child = await client.query(
          `INSERT INTO learning_nodes (journey_id,parent_node_id,node_type,order_index,depth,title,summary,content,elaborate_prompt)
           VALUES ($1,$2,'subtopic',$3,2,$4,$5,$5,$6) RETURNING *`,
          [journey.id, node.id, j, point.title, point.description, point.elaborate_prompt || `Explain ${point.title} in detail`]
        );
        createdNodes.at(-1).keyPoints.push(child.rows[0]);
      }
      createdNodes.at(-1).examples = stage.examples;
    }
    const sources = normalizeSources(generated.citations);
    for (const source of sources) {
      await client.query(
        `INSERT INTO source_references (journey_id,title,url,domain) VALUES ($1,$2,$3,$4) ON CONFLICT (journey_id,url) DO NOTHING`,
        [journey.id, source.title, source.url, source.domain]
      );
    }
    await client.query("COMMIT");
    return { ...journey, stages: createdNodes, sources };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function buildJourneyTree(journeyId) {
  const [journeyResult, nodesResult, sourcesResult] = await Promise.all([
    pool.query("SELECT * FROM learning_journeys WHERE id=$1", [journeyId]),
    pool.query("SELECT * FROM learning_nodes WHERE journey_id=$1 ORDER BY depth,order_index,created_at", [journeyId]),
    pool.query("SELECT id,title,url,domain FROM source_references WHERE journey_id=$1 ORDER BY created_at", [journeyId])
  ]);
  const journey = journeyResult.rows[0];
  if (!journey) return null;
  const map = new Map();
  for (const row of nodesResult.rows) map.set(row.id, { ...row, children: [] });
  const roots = [];
  for (const node of map.values()) {
    if (node.parent_node_id && map.has(node.parent_node_id)) map.get(node.parent_node_id).children.push(node);
    else roots.push(node);
  }
  return { ...journey, stages: roots, sources: sourcesResult.rows };
}
async function ensureOwnedJourney(journeyId, userId) {
  const { rows } = await pool.query("SELECT * FROM learning_journeys WHERE id=$1 AND user_id=$2", [journeyId, userId]);
  return rows[0] || null;
}
async function reserveAiUsage(userId, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
    const count = await client.query("SELECT COUNT(*)::int AS total FROM ai_usage_events WHERE user_id=$1 AND status IN ('pending','succeeded') AND created_at > NOW() - INTERVAL '24 hours'", [userId]);
    if (count.rows[0].total >= USER_DAILY_GENERATION_LIMIT) {
      await client.query("ROLLBACK");
      const error = new Error(`You've reached your daily learning-generation limit (${USER_DAILY_GENERATION_LIMIT}). Please come back later.`);
      error.status = 429;
      throw error;
    }
    const result = await client.query("INSERT INTO ai_usage_events (user_id,operation) VALUES ($1,$2) RETURNING id", [userId, operation]);
    await client.query("COMMIT");
    return result.rows[0].id;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Transaction may already be rolled back. */ }
    throw error;
  } finally { client.release(); }
}
async function finishAiUsage(id, succeeded) {
  await pool.query("UPDATE ai_usage_events SET status=$1,completed_at=NOW() WHERE id=$2", [succeeded ? "succeeded" : "failed", id]);
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", service: "eduRoll", database: "connected" });
}));
app.get("/api/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = csrfToken();
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: req.session.csrfToken });
});

app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check your account details." });
  const { email, password, displayName } = parsed.data;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");
    const created = await client.query(
      "INSERT INTO users (email,password_hash,display_name,email_verified_at,adult_confirmed_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id,email,display_name,email_verified_at,adult_confirmed_at,created_at",
      [email, passwordHash, displayName]
    );
    user = created.rows[0];
    await client.query("INSERT INTO user_consents (user_id,terms_version,privacy_version) VALUES ($1,'2026-11-03-adult-v1','2026-11-03-adult-v1')", [user.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    throw error;
  } finally { client.release(); }
  res.status(201).json({ message: "Account created successfully. You can now sign in." });
}));

app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [parsed.data.email]);
  const user = rows[0];
  const valid = user ? await argon2.verify(user.password_hash, parsed.data.password).catch(() => false) : false;
  if (!valid) return res.status(401).json({ error: "The email or password is incorrect." });
  await pool.query("UPDATE users SET adult_confirmed_at=NOW() WHERE id=$1", [user.id]);
  await pool.query(`INSERT INTO user_consents (user_id,terms_version,privacy_version) VALUES ($1,'2026-11-03-adult-v1','2026-11-03-adult-v1') ON CONFLICT (user_id) DO UPDATE SET terms_version=EXCLUDED.terms_version,privacy_version=EXCLUDED.privacy_version,accepted_at=NOW()`, [user.id]);
  user.adult_confirmed_at = new Date();
  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.csrfToken = csrfToken();
  await saveSession(req);
  res.json({ user: safeUser(user), csrfToken: req.session.csrfToken });
}));

app.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie("eduroll.sid", { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" });
  res.json({ message: "Signed out." });
}));

app.post("/api/auth/password-reset/request", authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
  const { rows } = await pool.query("SELECT id,email,display_name FROM users WHERE email=$1", [parsed.data.email]);
  if (rows[0]) {
    try { await deliverToken({ pool, mailer, user: rows[0], purpose: "reset_password" }); }
    catch (error) { console.error(JSON.stringify({ event: "password_reset_email_failed", message: error.message })); }
  }
  res.json({ message: "If an account exists for that email, password-reset instructions will be sent." });
}));

app.post("/api/auth/password-reset/complete", authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ token: z.string().min(20).max(200), password: registerSchema.shape.password }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid password reset request." });
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,user_id FROM email_tokens WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [hashToken(parsed.data.token)]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "This password-reset link is invalid or expired." }); }
    await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2", [passwordHash, result.rows[0].user_id]);
    await client.query("UPDATE email_tokens SET consumed_at=NOW() WHERE user_id=$1 AND purpose='reset_password' AND consumed_at IS NULL", [result.rows[0].user_id]);
    await client.query("DELETE FROM user_sessions WHERE sess::jsonb->>'userId'=$1", [result.rows[0].user_id]);
    await client.query("COMMIT");
    res.json({ message: "Password updated. You can now sign in." });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}));

app.get("/api/auth/me", asyncRoute(async (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = await getUser(req);
  if (!user || !user.adult_confirmed_at) { req.session.destroy(() => {}); return res.json({ user: null, adultConfirmationRequired: true }); }
  res.set("Cache-Control", "no-store");
  res.json({ user: safeUser(user) });
}));

app.get("/api/learning/history", requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,parent_journey_id,query,title,intent,progress_ratio,last_opened_at,created_at FROM learning_journeys WHERE user_id=$1 ORDER BY last_opened_at DESC LIMIT 40`,
    [req.session.userId]
  );
  res.json({ journeys: rows });
}));

app.post("/api/learning/search", requireAuth, searchLimiter, asyncRoute(async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a topic between 2 and 180 characters." });
  const usageId = await reserveAiUsage(req.session.userId, "search");
  try {
    const generated = await generateLearning({ query: parsed.data.query });
    const journey = await persistJourney(req.session.userId, generated, parsed.data.query);
    await finishAiUsage(usageId, true).catch(error => console.error(JSON.stringify({ event: "usage_status_update_failed", message: error.message })));
    res.status(201).json({ journey });
  } catch (error) { await finishAiUsage(usageId, false).catch(() => {}); throw error; }
}));

app.post("/api/learning/:journeyId/share", requireAuth, asyncRoute(async (req, res) => {
  const journey = await ensureOwnedJourney(req.params.journeyId, req.session.userId);
  if (!journey) return res.status(404).json({ error: "Learning roll not found." });
  const token = journey.share_token || crypto.randomBytes(32).toString("base64url");
  await pool.query("UPDATE learning_journeys SET share_token=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3", [token, journey.id, req.session.userId]);
  res.json({ url: `${APP_ORIGIN}/share/${encodeURIComponent(token)}` });
}));

app.get("/api/shared/:token", asyncRoute(async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(404).json({ error: "This shared roll is unavailable." });
  const { rows } = await pool.query("SELECT id,title,query,intent,introduction FROM learning_journeys WHERE share_token=$1", [token]);
  if (!rows[0]) return res.status(404).json({ error: "This shared roll is unavailable or its owner has stopped sharing it." });
  const tree = await buildJourneyTree(rows[0].id);
  res.set("Cache-Control", "no-store");
  res.json({ journey: {
    id: tree.id, title: tree.title, query: tree.query, intent: tree.intent,
    introduction: tree.introduction, stages: tree.stages, sources: tree.sources,
    parent_journey_id: null, progress_ratio: 0
  } });
}));

app.delete("/api/learning/:journeyId", requireAuth, asyncRoute(async (req, res) => {
  const journey = await ensureOwnedJourney(req.params.journeyId, req.session.userId);
  if (!journey) return res.status(404).json({ error: "Learning roll not found." });
  await pool.query(
    `WITH RECURSIVE roll_tree AS (
       SELECT id FROM learning_journeys WHERE id=$1 AND user_id=$2
       UNION ALL
       SELECT child.id FROM learning_journeys child
       JOIN roll_tree parent ON child.parent_journey_id=parent.id
       WHERE child.user_id=$2
     )
     DELETE FROM learning_journeys WHERE id IN (SELECT id FROM roll_tree) AND user_id=$2`,
    [journey.id, req.session.userId]
  );
  res.json({ deleted: true });
}));

app.get("/api/learning/:journeyId", requireAuth, asyncRoute(async (req, res) => {
  const journey = await ensureOwnedJourney(req.params.journeyId, req.session.userId);
  if (!journey) return res.status(404).json({ error: "Learning journey not found." });
  const tree = await buildJourneyTree(journey.id);
  res.set("Cache-Control", "no-store");
  res.json({ journey: tree });
}));

app.post("/api/learning/:journeyId/branches", requireAuth, branchLimiter, asyncRoute(async (req, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid topic to elaborate." });
  const journey = await ensureOwnedJourney(req.params.journeyId, req.session.userId);
  if (!journey) return res.status(404).json({ error: "Learning journey not found." });
  const { rows } = await pool.query("SELECT * FROM learning_nodes WHERE id=$1 AND journey_id=$2", [parsed.data.parentNodeId, journey.id]);
  const parent = rows[0];
  if (!parent) return res.status(404).json({ error: "The selected learning step was not found." });
  if (parent.depth >= MAX_LEARNING_DEPTH) return res.status(409).json({ error: `This branch has reached the maximum depth of ${MAX_LEARNING_DEPTH}. Start a contextual follow-up search to explore a related direction.` });
  const { rows: ancestorRows } = await pool.query(
    `WITH RECURSIVE ancestors AS (SELECT id,parent_node_id,title,content,depth FROM learning_nodes WHERE id=$1 UNION ALL SELECT n.id,n.parent_node_id,n.title,n.content,n.depth FROM learning_nodes n JOIN ancestors a ON n.id=a.parent_node_id) SELECT title,content FROM ancestors ORDER BY depth`,
    [parent.id]
  );
  const context = [`Original topic: ${journey.query}`, ...ancestorRows.map(item => `${item.title}: ${item.content.slice(0, 800)}`)].join("\n");
  const usageId = await reserveAiUsage(req.session.userId, "elaborate");
  let generated;
  try { generated = await generateLearning({ query: parsed.data.prompt, context, branch: true }); }
  catch (error) { await finishAiUsage(usageId, false).catch(() => {}); throw error; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const newNodes = [];
    const childDepth = parent.depth + 1;
    for (let i = 0; i < generated.stages.length; i++) {
      const stage = generated.stages[i];
      const inserted = await client.query(
        `INSERT INTO learning_nodes (journey_id,parent_node_id,node_type,order_index,depth,title,summary,content,elaborate_prompt,examples)
         VALUES ($1,$2,'subtopic',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [journey.id, parent.id, i, childDepth, stage.title, stage.summary, stage.content, `Elaborate on: ${stage.title}`, JSON.stringify(stage.examples || [])]
      );
      const node = inserted.rows[0];
      newNodes.push({ ...node, children: [] });
      for (let j = 0; j < stage.key_points.length; j++) {
        const point = stage.key_points[j];
        const child = await client.query(
          `INSERT INTO learning_nodes (journey_id,parent_node_id,node_type,order_index,depth,title,summary,content,elaborate_prompt)
           VALUES ($1,$2,'subtopic',$3,$4,$5,$6,$6,$7) RETURNING *`,
          [journey.id, node.id, j, childDepth + 1, point.title, point.description, point.elaborate_prompt]
        );
        newNodes.at(-1).children.push(child.rows[0]);
      }
    }
    await client.query("UPDATE learning_nodes SET elaborated=TRUE WHERE id=$1", [parent.id]);
    const sources = normalizeSources(generated.citations);
    for (const source of sources) {
      await client.query("INSERT INTO source_references (journey_id,node_id,title,url,domain) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (journey_id,url) DO NOTHING", [journey.id, parent.id, source.title, source.url, source.domain]);
    }
    await client.query("UPDATE learning_journeys SET updated_at=NOW(),last_opened_at=NOW() WHERE id=$1", [journey.id]);
    await client.query("COMMIT");
    await finishAiUsage(usageId, true).catch(error => console.error(JSON.stringify({ event: "usage_status_update_failed", message: error.message })));
    res.status(201).json({ nodes: newNodes, sources });
  } catch (error) { await client.query("ROLLBACK"); await finishAiUsage(usageId, false).catch(() => {}); throw error; }
  finally { client.release(); }
}));

app.post("/api/learning/:journeyId/follow-up", requireAuth, searchLimiter, asyncRoute(async (req, res) => {
  const parsed = followupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a follow-up topic." });
  const parentJourney = await ensureOwnedJourney(req.params.journeyId, req.session.userId);
  if (!parentJourney) return res.status(404).json({ error: "Learning journey not found." });
  let context = `Related to the learning journey: ${parentJourney.query}`;
  if (parsed.data.contextNodeId) {
    const { rows } = await pool.query("SELECT title,content FROM learning_nodes WHERE id=$1 AND journey_id=$2", [parsed.data.contextNodeId, parentJourney.id]);
    if (!rows[0]) return res.status(404).json({ error: "The learning context was not found." });
    context += `\nCurrent learning step: ${rows[0].title}\n${rows[0].content.slice(0, 1000)}`;
  }
  const usageId = await reserveAiUsage(req.session.userId, "follow_up");
  try {
    const generated = await generateLearning({ query: parsed.data.query, context });
    const journey = await persistJourney(req.session.userId, generated, parsed.data.query, parentJourney.id, parsed.data.contextNodeId || null);
    await finishAiUsage(usageId, true).catch(error => console.error(JSON.stringify({ event: "usage_status_update_failed", message: error.message })));
    res.status(201).json({ journey });
  } catch (error) { await finishAiUsage(usageId, false).catch(() => {}); throw error; }
}));

app.post("/api/progress", requireAuth, asyncRoute(async (req, res) => {
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid progress update." });
  const journey = await ensureOwnedJourney(parsed.data.journeyId, req.session.userId);
  if (!journey) return res.status(404).json({ error: "Learning journey not found." });
  if (parsed.data.currentNodeId) {
    const { rowCount } = await pool.query("SELECT 1 FROM learning_nodes WHERE id=$1 AND journey_id=$2", [parsed.data.currentNodeId, journey.id]);
    if (!rowCount) return res.status(400).json({ error: "Progress node does not belong to this journey." });
  }
  await pool.query(
    "UPDATE learning_journeys SET progress_node_id=$1,progress_ratio=$2,last_opened_at=NOW(),updated_at=NOW() WHERE id=$3 AND user_id=$4",
    [parsed.data.currentNodeId || null, parsed.data.progressRatio, journey.id, req.session.userId]
  );
  res.json({ saved: true });
}));

app.get("/api/account/export", requireAuth, asyncRoute(async (req, res) => {
  const user = await getUser(req);
  const journeys = await pool.query("SELECT * FROM learning_journeys WHERE user_id=$1 ORDER BY created_at", [user.id]);
  const journeyIds = journeys.rows.map(j => j.id);
  const nodes = journeyIds.length ? await pool.query("SELECT * FROM learning_nodes WHERE journey_id=ANY($1::uuid[]) ORDER BY journey_id,depth,order_index", [journeyIds]) : { rows: [] };
  const sources = journeyIds.length ? await pool.query("SELECT * FROM source_references WHERE journey_id=ANY($1::uuid[])", [journeyIds]) : { rows: [] };
  const usage = await pool.query("SELECT operation,status,created_at,completed_at FROM ai_usage_events WHERE user_id=$1 ORDER BY created_at", [user.id]);
  res.set("Content-Disposition", "attachment; filename=eduroll-account-export.json");
  res.json({ exportedAt: new Date().toISOString(), user: safeUser(user), journeys: journeys.rows, nodes: nodes.rows, sources: sources.rows, usage: usage.rows });
}));

app.delete("/api/account", requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your password to confirm account deletion." });
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.session.userId]);
  const valid = rows[0] && await argon2.verify(rows[0].password_hash, parsed.data.password).catch(() => false);
  if (!valid) return res.status(401).json({ error: "Password is incorrect." });
  const userId = req.session.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_sessions WHERE sess::jsonb->>'userId'=$1", [userId]);
    await client.query("DELETE FROM users WHERE id=$1", [userId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await new Promise(resolve => req.session.destroy(() => resolve()));
  res.clearCookie("eduroll.sid", { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" });
  res.json({ deleted: true });
}));

app.get("/share/:token", (req, res) => {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(req.params.token || ""))) return res.status(404).send("This shared roll link is invalid.");
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "shared.html"));
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: isProduction ? "1h" : 0, etag: true }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(JSON.stringify({ event: "request_error", status, message: error.message, name: error.name }));
  const publicMessage = status >= 500
    ? (status === 502 || status === 503 || status === 504 ? error.message : "The server could not complete this request. Please try again.")
    : error.message;
  res.status(status).json({ error: publicMessage });
});

pool.on("error", error => console.error(JSON.stringify({ event: "database_pool_error", message: error.message })));

async function start() {
  await pool.query("SELECT 1");
  const fs = require("node:fs");
  const schema = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query("BEGIN");
    await migrationClient.query("SELECT pg_advisory_xact_lock(hashtext('eduroll-schema-migration'))");
    await migrationClient.query(schema);
    await migrationClient.query("COMMIT");
  } catch (error) {
    await migrationClient.query("ROLLBACK");
    throw error;
  } finally { migrationClient.release(); }
  const server = app.listen(PORT, "0.0.0.0", () => console.log(`eduRoll listening on port ${PORT}`));
  const shutdown = async signal => {
    console.info(JSON.stringify({ event: "shutdown", signal }));
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
start().catch(error => { console.error("Startup failed:", error.message); process.exit(1); });
