import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
import uploadPlugin from './vite-plugin-upload.js';
import { playwright } from '@vitest/browser-playwright';
import { execSync } from 'child_process';

function proxyAudioPlugin() {
    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.url?.startsWith('/saavn-api/')) {
                    const targetUrl = 'https://www.jiosaavn.com' + req.url.replace(/^\/saavn-api/, '');
                    try {
                        const apiRes = await fetch(targetUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                                Referer: 'https://www.jiosaavn.com/',
                            },
                        });
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        const body = await apiRes.text();
                        res.end(body);
                        return;
                    } catch (e) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: (e as Error).message }));
                        return;
                    }
                }
                if (req.url?.startsWith('/saavn-audio/')) {
                    const targetUrl = 'https://aac.saavncdn.com' + req.url.replace(/^\/saavn-audio/, '');
                    try {
                        const audioRes = await fetch(targetUrl);
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Headers', '*');
                        res.setHeader('Content-Type', 'audio/mp4');
                        const arrayBuffer = await audioRes.arrayBuffer();
                        res.end(Buffer.from(arrayBuffer));
                        return;
                    } catch (e) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: (e as Error).message }));
                        return;
                    }
                }
                next();
            });
        },
    };
}

function getGitCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'unknown';
    }
}

const decrypterVersion = '2026-08-06-crossfade-v10';

export default defineConfig(({ mode }) => {
    const commitHash = getGitCommitHash();
    const isDev = mode === 'development';

    return {
        test: {
            // https://vitest.dev/guide/browser/
            browser: {
                enabled: true,
                provider: playwright(),
                headless: !!process.env.HEADLESS,
                instances: [{ browser: 'chromium' }],
            },
        },
        base: './',
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __VITEST__: !!process.env.VITEST,
        },
        worker: {
            format: 'es',
        },
        resolve: {
            alias: {
                '!lucide': '/node_modules/lucide-static/icons',
                '!simpleicons': '/node_modules/simple-icons/icons',
                '!': '/node_modules',

                events: '/node_modules/events/events.js',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
                stream: path.resolve(__dirname, 'stream-stub.js'), // Stub for stream module
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
        },
        server: {
            proxy: {
                '/saavn-api': {
                    target: 'https://www.jiosaavn.com',
                    changeOrigin: true,
                    secure: false,
                    rewrite: (path) => path.replace(/^\/saavn-api/, ''),
                    configure: (proxy) => {
                        proxy.on('proxyRes', (proxyRes) => {
                            proxyRes.headers['access-control-allow-origin'] = '*';
                            proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
                        });
                    },
                },
                '/saavn-audio': {
                    target: 'https://aac.saavncdn.com',
                    changeOrigin: true,
                    secure: false,
                    rewrite: (path) => path.replace(/^\/saavn-audio/, ''),
                    configure: (proxy) => {
                        proxy.on('proxyRes', (proxyRes) => {
                            proxyRes.headers['access-control-allow-origin'] = '*';
                            proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
                        });
                    },
                },
            },
            fs: {
                allow: ['.', 'node_modules'],
                // host: true,
                // allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
            },
        },
        // preview: {
        //     host: true,
        //     allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
        // },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: false,
            minify: 'esbuild',
            reportCompressedSize: false,
            rollupOptions: {
                treeshake: true,
            },
        },
        plugins: [
            proxyAudioPlugin(),
            authGatePlugin(),
            uploadPlugin(),
            blobAssetPlugin(),
            svgUse(),
            VitePWA({
                registerType: 'prompt',
                devOptions: {
                    enabled: true,
                    type: 'classic',
                    disableRuntimeConfig: true,
                    suppressWarnings: true,
                },
                workbox: {
                    importScripts: [`sw-decrypter.js?v=${decrypterVersion}`],
                    skipWaiting: true,
                    clientsClaim: true,
                    globPatterns: ['index.html', 'manifest.json'],
                    cleanupOutdatedCaches: true,
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
                    // Define runtime caching strategies
                    runtimeCaching: [
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'script' || request.destination === 'worker',
                            handler: isDev ? 'NetworkFirst' : 'CacheFirst',
                            options: {
                                cacheName: 'scripts',
                                expiration: {
                                    maxEntries: 200,
                                    maxAgeSeconds: 60 * 24 * 60 * 60,
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'style' || request.destination === 'font',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'static-resources',
                                expiration: {
                                    maxEntries: 60,
                                    maxAgeSeconds: 60 * 24 * 60 * 60,
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) => request.destination === 'image',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'images',
                                expiration: {
                                    maxEntries: 100,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'audio' || request.destination === 'video',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'media',
                                expiration: {
                                    maxEntries: 50,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                                rangeRequests: true, // Support scrubbing
                            },
                        },
                    ],
                },
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
