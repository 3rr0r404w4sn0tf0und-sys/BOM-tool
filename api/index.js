import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { bomsRouter } from "./routes/boms.js";
import { publicRouter } from "./routes/public.js";
import { internalRouter } from "./routes/internal.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/boms", bomsRouter);
app.use("/api/public", publicRouter); // BOM Clean / BOM Links, for Odoo etc.
app.use("/api/internal", internalRouter); // GitHub Actions scrape callback

const port = process.env.API_PORT || 4000;
app.listen(port, () => console.log(`BOM Tool API listening on :${port}`));
