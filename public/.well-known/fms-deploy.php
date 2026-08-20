<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['status' => 'method_not_allowed']);
    exit;
}

$tokenFile = '/home/u982351260/domains/fms.cmll.in/.builds/deploy-token';
$deployScript = '/home/u982351260/domains/fms.cmll.in/.builds/hostinger-deploy.sh';
$providedToken = $_SERVER['HTTP_X_DEPLOY_TOKEN'] ?? '';
$expectedToken = is_readable($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';

if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    http_response_code(404);
    echo json_encode(['status' => 'not_found']);
    exit;
}

set_time_limit(180);
$output = [];
$exitCode = 1;
exec('/usr/bin/env bash ' . escapeshellarg($deployScript) . ' 2>&1', $output, $exitCode);

if ($exitCode === 75) {
    http_response_code(409);
    echo json_encode(['status' => 'deployment_in_progress']);
    exit;
}

if ($exitCode !== 0) {
    error_log('FMS deployment failed: ' . implode("\n", $output));
    http_response_code(500);
    echo json_encode(['status' => 'deployment_failed']);
    exit;
}

$lastLine = $output === [] ? '' : (string) end($output);
echo json_encode(['status' => 'deployed', 'result' => $lastLine]);
