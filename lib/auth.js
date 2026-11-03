"use strict";
const crypto = require("node:crypto");
const argon2 = require("argon2");
const nodemailer = require("nodemailer");

const TOKEN_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;
const FRONTEND_ORIGIN = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function safeUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, emailVerified: Boolean(user.email_verified_at), createdAt: user.created_at };
}
function makeMailer() {
  if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000
  });
}
async function deliverToken({ pool, mailer, user, purpose }) {
  const token = randomToken();
  const ttlHours = purpose === "reset_password" ? RESET_TTL_HOURS : TOKEN_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1,$2,$3,$4)",
    [user.id, hashToken(token), purpose, expiresAt]
  );
  const path = purpose === "verify_email" ? "/?verify=" : "/?reset=";
  const link = `${FRONTEND_ORIGIN}${path}${encodeURIComponent(token)}`;
  if (!mailer) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured");
    console.info(JSON.stringify({ event: "development_email_link", purpose, email: user.email, link }));
    return;
  }
  const subject = purpose === "verify_email" ? "Verify your eduRoll email" : "Reset your eduRoll password";
  const action = purpose === "verify_email" ? "Verify email address" : "Reset password";
  await mailer.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject,
    text: `Hello ${user.display_name},\n\n${action}: ${link}\n\nThis link expires in ${ttlHours} hour(s). If you did not request this, you can ignore this email.`,
    html: `<p>Hello ${escapeHtml(user.display_name)},</p><p><a href="${link}">${action}</a></p><p>This link expires in ${ttlHours} hour(s). If you did not request this, you can ignore this email.</p>`
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

module.exports = { argon2, safeUser, makeMailer, deliverToken, hashToken, regenerateSession, saveSession };
