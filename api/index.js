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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none"],
      frameAncestors: ["'none"],
      baseUri: ["'none"],
      formAction: ["'self"],
    },
  },
  referrerPolicy: { policy: "no-referrer" },
}));

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
}));
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
app.get("/health", (req, res) => res.json({ ok: true }));

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
