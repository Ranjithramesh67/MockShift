/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The preview environment reaches the dev server through *.monkeycode-ai.live
  // hosts; allow those origins plus local origins.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.monkeycode-ai.live'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3102/api/:path*',
      },
    ];
  },
};

export default nextConfig;
