<?php
use Slim\Routing\RouteCollectorProxy;
use WorldHistory\Models\Database;
use WorldHistory\Middleware\AuthMiddleware;
use WorldHistory\Middleware\CsrfMiddleware;

return function (RouteCollectorProxy $group) {

    // GET /api/settings
    $group->get('/settings', function ($request, $response) {
        $userId = $request->getAttribute('user_id');
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT settings_json FROM user_settings WHERE user_id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();

        $settings = $row ? json_decode($row['settings_json'], true) : [];

        $response->getBody()->write(json_encode($settings));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new AuthMiddleware());

    // PUT /api/settings
    $group->put('/settings', function ($request, $response) {
        $userId = $request->getAttribute('user_id');
        $data = $request->getParsedBody();
        $db = Database::getConnection();

        // Allowed settings keys
        $allowedKeys = ['show_borders', 'default_zoom', 'default_lat', 'default_lng', 'default_year', 'theme'];
        $settings = [];
        foreach ($allowedKeys as $key) {
            if (isset($data[$key])) {
                $settings[$key] = $data[$key];
            }
        }

        $json = json_encode($settings);
        $stmt = $db->prepare('INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings_json = ?');
        $stmt->execute([$userId, $json, $json]);

        $response->getBody()->write(json_encode($settings));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new CsrfMiddleware())->add(new AuthMiddleware());
};
