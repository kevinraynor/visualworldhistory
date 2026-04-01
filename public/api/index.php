<?php
// WorldHistory API Entry Point (Slim 4)

require __DIR__ . '/../../vendor/autoload.php';

use Slim\Factory\AppFactory;
use Slim\Routing\RouteCollectorProxy;

// Start session
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('worldhistory_session');
session_start();

$app = AppFactory::create();

// Parse JSON bodies
$app->addBodyParsingMiddleware();

// CORS for local development
$app->add(function ($request, $handler) {
    $response = $handler->handle($request);
    return $response
        ->withHeader('Access-Control-Allow-Origin', '*')
        ->withHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
});

// Handle preflight
$app->options('/{routes:.+}', function ($request, $response) {
    return $response;
});

// API routes
$app->group('/api', function (RouteCollectorProxy $group) {
    // Event routes
    $eventRoutes = require __DIR__ . '/../../src/routes/events.php';
    $eventRoutes($group);

    // Auth routes
    $authRoutes = require __DIR__ . '/../../src/routes/auth.php';
    $authRoutes($group);

    // Comment routes
    $commentRoutes = require __DIR__ . '/../../src/routes/comments.php';
    $commentRoutes($group);

    // Favorite routes
    $favoriteRoutes = require __DIR__ . '/../../src/routes/favorites.php';
    $favoriteRoutes($group);

    // Settings routes
    $settingsRoutes = require __DIR__ . '/../../src/routes/settings.php';
    $settingsRoutes($group);

    // Image proxy (dev only - bypasses ORB for Wikimedia images)
    $imageProxyRoutes = require __DIR__ . '/../../src/routes/imageproxy.php';
    $imageProxyRoutes($group);
});

// Set base path for subdirectory deployment
$app->setBasePath('');

$app->addErrorMiddleware(true, true, true);

$app->run();
