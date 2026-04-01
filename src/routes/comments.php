<?php
use Slim\Routing\RouteCollectorProxy;
use WorldHistory\Models\Database;
use WorldHistory\Middleware\AuthMiddleware;
use WorldHistory\Middleware\CsrfMiddleware;

return function (RouteCollectorProxy $group) {

    // POST /api/comments - create comment
    $group->post('/comments', function ($request, $response) {
        $data = $request->getParsedBody();
        $userId = $request->getAttribute('user_id');
        $eventId = (int)($data['event_id'] ?? 0);
        $parentId = !empty($data['parent_comment_id']) ? (int)$data['parent_comment_id'] : null;
        $body = trim($data['body'] ?? '');

        if ($eventId <= 0) {
            $response->getBody()->write(json_encode(['error' => 'Invalid event_id']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }
        if (strlen($body) < 10 || strlen($body) > 2000) {
            $response->getBody()->write(json_encode(['error' => 'Comment must be 10-2000 characters']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        $db = Database::getConnection();

        // Rate limit: max 5 comments per minute
        $stmt = $db->prepare('SELECT COUNT(*) FROM comments WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
        $stmt->execute([$userId]);
        if ($stmt->fetchColumn() >= 5) {
            $response->getBody()->write(json_encode(['error' => 'Rate limit exceeded. Please wait before commenting again.']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(429);
        }

        $stmt = $db->prepare('INSERT INTO comments (event_id, user_id, parent_comment_id, body) VALUES (?, ?, ?, ?)');
        $stmt->execute([$eventId, $userId, $parentId, $body]);
        $commentId = (int)$db->lastInsertId();

        // Return the new comment with username
        $stmt = $db->prepare('
            SELECT c.*, u.username FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = ?
        ');
        $stmt->execute([$commentId]);
        $comment = $stmt->fetch();

        $response->getBody()->write(json_encode($comment));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(201);
    })->add(new CsrfMiddleware())->add(new AuthMiddleware());

    // POST /api/comments/{id}/vote - upvote a comment
    $group->post('/comments/{id:[0-9]+}/vote', function ($request, $response, array $args) {
        $userId = $request->getAttribute('user_id');
        $commentId = (int)$args['id'];
        $db = Database::getConnection();

        // Check if already voted
        $stmt = $db->prepare('SELECT id FROM comment_votes WHERE comment_id = ? AND user_id = ?');
        $stmt->execute([$commentId, $userId]);

        if ($stmt->fetch()) {
            // Remove vote (toggle)
            $db->prepare('DELETE FROM comment_votes WHERE comment_id = ? AND user_id = ?')
                ->execute([$commentId, $userId]);
            $db->prepare('UPDATE comments SET upvotes = upvotes - 1 WHERE id = ?')
                ->execute([$commentId]);
            $action = 'removed';
        } else {
            // Add vote
            $db->prepare('INSERT INTO comment_votes (comment_id, user_id, vote) VALUES (?, ?, 1)')
                ->execute([$commentId, $userId]);
            $db->prepare('UPDATE comments SET upvotes = upvotes + 1 WHERE id = ?')
                ->execute([$commentId]);
            $action = 'added';
        }

        // Get updated count
        $stmt = $db->prepare('SELECT upvotes FROM comments WHERE id = ?');
        $stmt->execute([$commentId]);
        $upvotes = (int)$stmt->fetchColumn();

        $response->getBody()->write(json_encode(['action' => $action, 'upvotes' => $upvotes]));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new CsrfMiddleware())->add(new AuthMiddleware());

    // DELETE /api/comments/{id} - delete own comment
    $group->delete('/comments/{id:[0-9]+}', function ($request, $response, array $args) {
        $userId = $request->getAttribute('user_id');
        $commentId = (int)$args['id'];
        $db = Database::getConnection();

        $stmt = $db->prepare('SELECT user_id FROM comments WHERE id = ?');
        $stmt->execute([$commentId]);
        $comment = $stmt->fetch();

        if (!$comment || (int)$comment['user_id'] !== $userId) {
            $response->getBody()->write(json_encode(['error' => 'Not authorized']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(403);
        }

        $db->prepare('DELETE FROM comments WHERE id = ?')->execute([$commentId]);

        $response->getBody()->write(json_encode(['success' => true]));
        return $response->withHeader('Content-Type', 'application/json');
    })->add(new CsrfMiddleware())->add(new AuthMiddleware());
};
