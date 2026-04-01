<?php
use Slim\Routing\RouteCollectorProxy;
use WorldHistory\Models\Database;

return function (RouteCollectorProxy $group) {

    // POST /api/auth/register
    $group->post('/auth/register', function ($request, $response) {
        $data = $request->getParsedBody();
        $username = trim($data['username'] ?? '');
        $email = trim($data['email'] ?? '');
        $password = $data['password'] ?? '';

        // Validation
        if (strlen($username) < 3 || strlen($username) > 50) {
            $response->getBody()->write(json_encode(['error' => 'Username must be 3-50 characters']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $response->getBody()->write(json_encode(['error' => 'Invalid email address']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }
        if (strlen($password) < 8) {
            $response->getBody()->write(json_encode(['error' => 'Password must be at least 8 characters']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        $db = Database::getConnection();

        // Check uniqueness
        $stmt = $db->prepare('SELECT id FROM users WHERE username = ? OR email = ?');
        $stmt->execute([$username, $email]);
        if ($stmt->fetch()) {
            $response->getBody()->write(json_encode(['error' => 'Username or email already taken']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(409);
        }

        // Create user
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $db->prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
        $stmt->execute([$username, $email, $hash]);
        $userId = (int)$db->lastInsertId();

        // Create default settings
        $stmt = $db->prepare('INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)');
        $stmt->execute([$userId, '{}']);

        // Auto-login
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['username'] = $username;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $response->getBody()->write(json_encode([
            'user' => ['id' => $userId, 'username' => $username],
            'csrf_token' => $_SESSION['csrf_token'],
        ]));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(201);
    });

    // POST /api/auth/login
    $group->post('/auth/login', function ($request, $response) {
        $data = $request->getParsedBody();
        $username = trim($data['username'] ?? '');
        $password = $data['password'] ?? '';

        $db = Database::getConnection();
        $stmt = $db->prepare('SELECT id, username, password_hash FROM users WHERE username = ? OR email = ?');
        $stmt->execute([$username, $username]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            $response->getBody()->write(json_encode(['error' => 'Invalid credentials']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
        }

        // Update last login
        $stmt = $db->prepare('UPDATE users SET last_login = NOW() WHERE id = ?');
        $stmt->execute([$user['id']]);

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $response->getBody()->write(json_encode([
            'user' => ['id' => (int)$user['id'], 'username' => $user['username']],
            'csrf_token' => $_SESSION['csrf_token'],
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // POST /api/auth/logout
    $group->post('/auth/logout', function ($request, $response) {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();

        $response->getBody()->write(json_encode(['success' => true]));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // POST /api/auth/change-password
    $group->post('/auth/change-password', function ($request, $response) {
        if (empty($_SESSION['user_id'])) {
            $response->getBody()->write(json_encode(['error' => 'Not authenticated']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
        }

        $data = $request->getParsedBody();
        $currentPassword = $data['current_password'] ?? '';
        $newPassword = $data['new_password'] ?? '';

        if (strlen($newPassword) < 8) {
            $response->getBody()->write(json_encode(['error' => 'New password must be at least 8 characters']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
            $response->getBody()->write(json_encode(['error' => 'Current password is incorrect']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(403);
        }

        $hash = password_hash($newPassword, PASSWORD_DEFAULT);
        $stmt = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$hash, $_SESSION['user_id']]);

        $response->getBody()->write(json_encode(['success' => true]));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // DELETE /api/auth/account
    $group->delete('/auth/account', function ($request, $response) {
        if (empty($_SESSION['user_id'])) {
            $response->getBody()->write(json_encode(['error' => 'Not authenticated']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
        }

        $data = $request->getParsedBody();
        $password = $data['password'] ?? '';

        $db = Database::getConnection();
        $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            $response->getBody()->write(json_encode(['error' => 'Password is incorrect']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(403);
        }

        // Delete user (cascades to settings, favorites, comments, votes)
        $stmt = $db->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);

        // Destroy session
        $_SESSION = [];
        session_destroy();

        $response->getBody()->write(json_encode(['success' => true]));
        return $response->withHeader('Content-Type', 'application/json');
    });

    // GET /api/auth/me - check current session
    $group->get('/auth/me', function ($request, $response) {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        if (empty($_SESSION['user_id'])) {
            $response->getBody()->write(json_encode(['user' => null]));
            return $response->withHeader('Content-Type', 'application/json');
        }

        // Ensure CSRF token exists
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        $response->getBody()->write(json_encode([
            'user' => [
                'id' => $_SESSION['user_id'],
                'username' => $_SESSION['username'],
            ],
            'csrf_token' => $_SESSION['csrf_token'],
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    });
};
