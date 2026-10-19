import type { NextConfig } from 'next'

const apiOrigin = (
  process.env.API_INTERNAL_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? '3001'}`
).replace(/\/$/, '')

if (process.env.NODE_ENV === 'production' && apiOrigin !== 'http://127.0.0.1:3001') {
  throw new Error('Production API must use http://127.0.0.1:3001 at build and runtime')
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]
  },
}

export default nextConfig
