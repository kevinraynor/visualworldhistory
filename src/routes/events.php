<?php
use Slim\Routing\RouteCollectorProxy;
use WorldHistory\Models\Database;

return function (RouteCollectorProxy $group) {

    // GET /api/events - compact list for initial load
    $group->get('/events', function ($request, $response) {
        $db = Database::getConnection();

        $stmt = $db->query('SELECT id, name, year_start, year_end, lat, lng, dot_radius, category, granularity FROM events ORDER BY year_start');
        $events = $stmt->fetchAll();

        // Cast numeric fields
        foreach ($events as &$event) {
            $event['id'] = (int)$event['id'];
            $event['year_start'] = (int)$event['year_start'];
            $event['year_end'] = (int)$event['year_end'];
            $event['lat'] = (float)$event['lat'];
            $event['lng'] = (float)$event['lng'];
            $event['dot_radius'] = (int)$event['dot_radius'];
        }

        $response->getBody()->write(json_encode($events));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // GET /api/events/{id} - full event details
    $group->get('/events/{id:[0-9]+}', function ($request, $response, array $args) {
        $db = Database::getConnection();
        $id = (int)$args['id'];

        // Get event + details
        $stmt = $db->prepare('
            SELECT e.*, ed.summary, ed.wikipedia_url, ed.read_more_links, ed.territory_geojson, ed.images, ed.figures
            FROM events e
            LEFT JOIN event_details ed ON ed.event_id = e.id
            WHERE e.id = ?
        ');
        $stmt->execute([$id]);
        $event = $stmt->fetch();

        if (!$event) {
            $response->getBody()->write(json_encode(['error' => 'Event not found']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(404);
        }

        // Cast types
        $event['id'] = (int)$event['id'];
        $event['year_start'] = (int)$event['year_start'];
        $event['year_end'] = (int)$event['year_end'];
        $event['lat'] = (float)$event['lat'];
        $event['lng'] = (float)$event['lng'];
        $event['dot_radius'] = (int)$event['dot_radius'];

        // Parse JSON fields
        if ($event['read_more_links']) {
            $event['read_more_links'] = json_decode($event['read_more_links'], true);
        }
        if ($event['images']) {
            $event['images'] = json_decode($event['images'], true);
        }
        if ($event['figures']) {
            $event['figures'] = json_decode($event['figures'], true);
        }

        // Get phases if any
        $stmt = $db->prepare('SELECT * FROM event_phases WHERE event_id = ? ORDER BY phase_year_start');
        $stmt->execute([$id]);
        $event['phases'] = $stmt->fetchAll();

        // Get comments
        $stmt = $db->prepare('
            SELECT c.*, u.username
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.event_id = ?
            ORDER BY c.created_at ASC
        ');
        $stmt->execute([$id]);
        $event['comments'] = $stmt->fetchAll();

        // Check if user has favorited (if logged in)
        $event['is_favorited'] = false;
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        if (!empty($_SESSION['user_id'])) {
            $stmt = $db->prepare('SELECT COUNT(*) FROM favorites WHERE user_id = ? AND event_id = ?');
            $stmt->execute([$_SESSION['user_id'], $id]);
            $event['is_favorited'] = (bool)$stmt->fetchColumn();
        }

        $response->getBody()->write(json_encode($event));
        return $response->withHeader('Content-Type', 'application/json');
    });
};
