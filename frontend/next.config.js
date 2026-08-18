/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // static export -- Cloudflare Pages serves this directly, no Next server needed
  images: { unoptimized: true },
};

module.exports = nextConfig;
