import { Hono } from "hono";
import { cors } from "hono/cors";
import uploadRoutes from "./routes/upload.js";
import priceRoutes from "./routes/price.js";
import calcRoutes from "./routes/calc.js";

const app = new Hono().basePath("/api");

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/", uploadRoutes);
app.route("/", priceRoutes);
app.route("/", calcRoutes);

export default app;
