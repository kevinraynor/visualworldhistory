<?php
// WorldHistory Configuration
// Local overrides: create config.local.php (gitignored) to override any values.

$defaults = [
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'worldhistory',
        'user' => 'root',
        'pass' => '',           // XAMPP default has no password
        'charset' => 'utf8mb4',
    ],
    'session' => [
        'name' => 'worldhistory_session',
        'lifetime' => 86400 * 7, // 7 days
    ],
    'csrf' => [
        'token_name' => 'csrf_token',
    ],
];

// Merge local overrides if config.local.php exists
$localConfigPath = __DIR__ . '/config.local.php';
if (file_exists($localConfigPath)) {
    $local = require $localConfigPath;
    $defaults['db'] = array_merge($defaults['db'], $local['db'] ?? []);
    $defaults['session'] = array_merge($defaults['session'], $local['session'] ?? []);
    $defaults['csrf'] = array_merge($defaults['csrf'], $local['csrf'] ?? []);
}

return $defaults;
