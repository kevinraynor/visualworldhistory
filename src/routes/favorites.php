<?php
use Slim\Routing\RouteCollectorProxy;
use WorldHistory\Models\Database;
use WorldHistory\Middleware\AuthMiddleware;
use WorldHistory\Middleware\CsrfMiddleware;

return function (RouteCollectorProxy $group) {

    // GET /api/favorites - get user's favorites
    $group->get('/favorites', function ($request, $response) {
        $userId = $request->getAttribute('user_id');
        $db = Database::getConnection();

        $stmt = $db->prepare('
            SELECT e.id, e.name, e.year_start, e.year_end, e.category, f.created_at as favorited_at
            FROM favorites f
            JOIN events e ON e.id = f.event_id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
        ');
        $stmt->execute([$userId]);

        $response->getBody()->write(json_encode($stmt->fetchAll()));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new AuthMiddleware());

    // POST /api/favorites - toggle favorite
    $group->post('/favorites', function ($request, $response) {
        $userId = $request->getAttribute('user_id');
        $data = $request->getParsedBody();
        $eventId = (int)($data['event_id'] ?? 0);

        if ($eventId <= 0) {
            $response->getBody()->write(json_encode(['error' => 'Invalid event_id']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        $db = Database::getConnection();

        // Check if already favorited
        $stmt = $db->prepare('SELECT id FROM favorites WHERE user_id = ? AND event_id = ?');
        $stmt->execute([$userId, $eventId]);

        if ($stmt->fetch()) {
            // Remove favorite
            $db->prepare('DELETE FROM favorites WHERE user_id = ? AND event_id = ?')
                ->execute([$userId, $eventId]);
            $action = 'removed';
        } else {
            // Add favorite
            $db->prepare('INSERT INTO favorites (user_id, event_id) VALUES (?, ?)')
                ->execute([$userId, $eventId]);
            $action = 'added';
        }

        $response->getBody()->write(json_encode(['action' => $action, 'is_favorited' => $action === 'added']));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new CsrfMiddleware())->add(new AuthMiddleware());
};
