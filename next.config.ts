import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "@napi-rs/canvas"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
