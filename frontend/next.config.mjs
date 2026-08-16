/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The preview environment reaches the dev server through *.monkeycode-ai.live
  // hosts; allow those origins plus the local test origins used by e2e runs.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.monkeycode-ai.live'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
    ];
  },
};

export default nextConfig;
