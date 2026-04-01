<?php
/**
 * Image Proxy for local development.
 * Fetches Wikimedia Commons images server-side to bypass ORB/CORS restrictions.
 * Only proxies upload.wikimedia.org URLs for security.
 */
use Slim\Routing\RouteCollectorProxy;

return function (RouteCollectorProxy $group) {

    $group->get('/image-proxy', function ($request, $response) {
        $params = $request->getQueryParams();
        $url = $params['url'] ?? '';

        // Only allow Wikimedia URLs
        if (!preg_match('#^https://upload\.wikimedia\.org/#', $url)) {
            $response->getBody()->write(json_encode(['error' => 'Only Wikimedia URLs allowed']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        // Build cache path
        $cacheDir = __DIR__ . '/../../storage/image-cache';
        if (!is_dir($cacheDir)) {
            mkdir($cacheDir, 0777, true);
        }
        $cacheKey = md5($url);
        $ext = pathinfo(parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION) ?: 'jpg';
        $ext = strtolower($ext);
        // Normalize unusual extensions
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff'])) {
            $ext = 'jpg';
        }
        $cachePath = "$cacheDir/$cacheKey.$ext";

        // Serve from cache if exists and fresh (24h)
        if (file_exists($cachePath) && (time() - filemtime($cachePath)) < 86400) {
            $data = file_get_contents($cachePath);
        } else {
            // Fetch from Wikimedia
            $context = stream_context_create([
                'http' => [
                    'header' => "User-Agent: WorldHistoryBot/1.0 (https://joeydevries.com; educational project)\r\n",
                    'timeout' => 15,
                ],
            ]);
            $data = @file_get_contents($url, false, $context);
            if ($data === false) {
                $response->getBody()->write('');
                return $response->withStatus(502);
            }
            // Cache it
            file_put_contents($cachePath, $data);
        }

        // Determine content type
        $mimeMap = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png', 'gif' => 'image/gif',
            'webp' => 'image/webp', 'tif' => 'image/tiff', 'tiff' => 'image/tiff',
        ];
        $contentType = $mimeMap[$ext] ?? 'image/jpeg';

        $response->getBody()->write($data);
        return $response
            ->withHeader('Content-Type', $contentType)
            ->withHeader('Cache-Control', 'public, max-age=86400')
            ->withHeader('Access-Control-Allow-Origin', '*');
    });
};
