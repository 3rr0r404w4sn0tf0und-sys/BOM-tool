import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { bomsRouter } from "./routes/boms.js";
import { publicRouter } from "./routes/public.js";
import { internalRouter } from "./routes/internal.js";
import { requireAllowedOrigin } from "./middleware/auth.js";
import { auditMutations } from "./middleware/audit.js";

const app = express();
app.set("trust proxy", 1);

// Refuse to boot in production with missing/weak/placeholder secrets --
// far better to fail loudly at deploy time than to silently run with a
// short JWT_SECRET or a leftover "changeme" value that makes sessions,
// CSRF tokens, or encrypted Apify credentials trivially forgeable.
function validateProductionSecrets() {
  if (process.env.NODE_ENV !== "production") return;

  const DEV_LOOKING = /^(dev|test|change ?me|placeholder|secret|password|example)$/i;
  const problems = [];

  function checkSecret(name, { minLength = 32 } = {}) {
    const value = process.env[name];
    if (!value) { problems.push(`${name} is not set`); return; }
    if (value.length < minLength) problems.push(`${name} is too short (need >= ${minLength} chars)`);
    if (DEV_LOOKING.test(value.trim())) problems.push(`${name} looks like a placeholder/dev value`);
  }

  checkSecret("JWT_SECRET");
  checkSecret("SECRET_ENCRYPTION_KEY");
  checkSecret("INTERNAL_SCRAPE_SECRET");
  // GITHUB_DISPATCH_TOKEN/GITHUB_OAUTH_CLIENT_SECRET/email creds are only
  // required if those features are actually wired up -- don't force every
  // deployment to configure OAuth/GitHub dispatch/email just to boot.
  if (process.env.GITHUB_DISPATCH_TOKEN) checkSecret("GITHUB_DISPATCH_TOKEN", { minLength: 16 });
  if (process.env.GITHUB_OAUTH_CLIENT_ID) checkSecret("GITHUB_OAUTH_CLIENT_SECRET", { minLength: 16 });

  const frontendUrl = process.env.FRONTEND_URL || "";
  const apiPublicUrl = process.env.API_PUBLIC_URL || "";
  if (!frontendUrl || /localhost|127\.0\.0\.1/.test(frontendUrl)) {
    problems.push("FRONTEND_URL is unset or points at localhost in production");
  }
  if (!apiPublicUrl || /localhost|127\.0\.0\.1/.test(apiPublicUrl)) {
    problems.push("API_PUBLIC_URL is unset or points at localhost in production");
  }

  if (problems.length) {
    console.error("Refusing to start: invalid production configuration:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
}
validateProductionSecrets();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
  },
  referrerPolicy: { policy: "no-referrer" },
}));

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const openCors = cors({ origin: true, credentials: false });
const strictCors = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
});

// The public, api_key-authenticated routes (/api/public/*) are meant to
// be called from anywhere -- Odoo, Google Sheets, a customer's own
// scripts, etc. -- so they get an open CORS policy with no credentials.
// The security boundary there is the api_key itself, not the browser's
// origin, so restricting Access-Control-Allow-Origin buys nothing except
// breaking legitimate third-party integrations. Every other route stays
// on the strict FRONTEND_URL allowlist since those rely on the session
// cookie, which does need the origin lock.
//
// NOTE: app.use() runs every middleware whose path matches, not just the
// first one -- app.use("/api/public", openCors) followed by a separate
// app.use(strictCors) would run BOTH for /api/public requests (the
// second has no path filter, so it matches everything), and the strict
// one would still reject the origin. Branching inside a single
// middleware, so exactly one cors policy ever runs per request.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/public")) return openCors(req, res, next);
  return strictCors(req, res, next);
});
app.use(cookieParser());
app.use(requireAllowedOrigin);
app.use(auditMutations);
app.use(express.json({ limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication requests. Try again later." },
});
// Tighter than the general auth limiter above -- login specifically is
// the route credential-stuffing/brute-force tools actually hit, so it
// gets a stricter per-IP cap on top of the general one.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});
app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/boms", bomsRouter);
app.use("/api/public", publicRouter); // BOM Clean / BOM Links, for Odoo etc.
app.use("/api/internal", internalRouter); // GitHub Actions scrape callback

// Global error handler. Express 4 does NOT catch errors thrown/rejected
// inside async route handlers on its own -- without this (and without
// every route being wrapped in asyncHandler), a thrown error just hangs
// the request forever with no response ever sent. This was the cause of
// "clicking a BOM just loads forever" -- some query/logic threw for that
// BOM's data and the client never got so much as a 500 back.
// Must be registered last, after all routers.
app.use((err, req, res, next) => {
  console.error("Unhandled route error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.API_PORT || 4000;
app.listen(port, () => console.log(`BOM Tool API listening on :${port}`));
