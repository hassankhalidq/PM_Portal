/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // This app is never meant to be framed by another site.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // A real Content-Security-Policy is deliberately not added here yet:
          // Next's own inline theme-init script and hydration payloads need
          // either 'unsafe-inline' (weak) or a per-request nonce wired through
          // middleware (a real change, not a config tweak) to avoid breaking
          // the app. Worth doing properly as a follow-up, not bolted on here.
        ],
      },
    ];
  },
};
export default nextConfig;
