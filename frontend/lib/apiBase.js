// Static export has no server-side rewrites, so the Worker URL is baked
// in at build time via this env var. Set NEXT_PUBLIC_API_BASE in
// Cloudflare Pages' build settings to your deployed Worker URL, e.g.
// https://printed-parts-calc.<your-subdomain>.workers.dev
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8787";
