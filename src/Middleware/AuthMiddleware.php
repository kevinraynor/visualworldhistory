<?php
namespace WorldHistory\Middleware;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;

class AuthMiddleware implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        if (empty($_SESSION['user_id'])) {
            $response = new Response();
            $response->getBody()->write(json_encode(['error' => 'Authentication required']));
            return $response
                ->withHeader('Content-Type', 'application/json')
                ->withStatus(401);
        }

        // Add user info to request attributes
        $request = $request->withAttribute('user_id', $_SESSION['user_id']);
        $request = $request->withAttribute('username', $_SESSION['username'] ?? '');

        return $handler->handle($request);
    }
}
