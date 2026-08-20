<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function writeFailure(string $path, string $message): void
{
    file_put_contents($path, gmdate(DATE_ATOM) . "\n" . $message . "\n", LOCK_EX);
    chmod($path, 0600);
    error_log('FMS deployment failed: ' . $message);
}

function removeTree(string $path): void
{
    if (!file_exists($path) && !is_link($path)) {
        return;
    }

    if (is_file($path) || is_link($path)) {
        if (!unlink($path)) {
            throw new RuntimeException('Unable to remove a deployment file.');
        }
        return;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );

    foreach ($iterator as $item) {
        $itemPath = $item->getPathname();
        if ($item->isLink() || $item->isFile()) {
            if (!unlink($itemPath)) {
                throw new RuntimeException('Unable to remove a deployment file.');
            }
        } elseif (!rmdir($itemPath)) {
            throw new RuntimeException('Unable to remove a deployment directory.');
        }
    }

    if (!rmdir($path)) {
        throw new RuntimeException('Unable to remove a deployment directory.');
    }
}

function isSafeArchivePath(string $path): bool
{
    $normalized = str_replace('\\', '/', $path);
    if ($normalized === '' || str_contains($normalized, "\0") || str_starts_with($normalized, '/')) {
        return false;
    }
    if (preg_match('/^[A-Za-z]:\//', $normalized) === 1) {
        return false;
    }

    foreach (explode('/', rtrim($normalized, '/')) as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..') {
            return false;
        }
    }

    return true;
}

function setTreePermissions(string $path): void
{
    chmod($path, 0755);
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST,
    );

    foreach ($iterator as $item) {
        chmod($item->getPathname(), $item->isDir() ? 0755 : 0644);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['status' => 'method_not_allowed']);
}

$siteRoot = '/home/u982351260/domains/fms.cmll.in';
$buildRoot = $siteRoot . '/.builds';
$tokenFile = $buildRoot . '/deploy-token';
$failureLog = $buildRoot . '/last-deploy-error.log';
$providedToken = $_SERVER['HTTP_X_DEPLOY_TOKEN'] ?? '';
$expectedToken = is_readable($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';

if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    respond(404, ['status' => 'not_found']);
}

ini_set('log_errors', '1');
ini_set('error_log', $failureLog);
register_shutdown_function(static function () use ($failureLog): void {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        file_put_contents($failureLog, gmdate(DATE_ATOM) . "\n" . $error['message'] . "\n", LOCK_EX);
        chmod($failureLog, 0600);
    }
});

$sourceSha = strtolower(trim($_SERVER['HTTP_X_DEPLOY_SHA'] ?? ''));
if (preg_match('/^[0-9a-f]{40}$/', $sourceSha) !== 1) {
    respond(400, ['status' => 'invalid_source']);
}

$maximumBundleBytes = 25 * 1024 * 1024;
$deleteBundleAfter = false;

if (isset($_FILES['bundle']) && is_array($_FILES['bundle'])) {
    $bundle = $_FILES['bundle'];
    if (($bundle['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        respond(400, ['status' => 'bundle_upload_failed']);
    }

    $bundlePath = (string) ($bundle['tmp_name'] ?? '');
    $bundleSize = (int) ($bundle['size'] ?? 0);
    if (!is_uploaded_file($bundlePath) || $bundleSize <= 0 || $bundleSize > $maximumBundleBytes) {
        respond(400, ['status' => 'invalid_bundle']);
    }
} else {
    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength <= 0 || $contentLength > $maximumBundleBytes) {
        respond(400, ['status' => 'invalid_bundle']);
    }

    $bundlePath = tempnam($buildRoot, 'upload-');
    $inputHandle = fopen('php://input', 'rb');
    $bundleHandle = $bundlePath === false ? false : fopen($bundlePath, 'wb');
    if ($bundlePath === false || $inputHandle === false || $bundleHandle === false) {
        respond(500, ['status' => 'deployment_unavailable']);
    }

    $bundleSize = stream_copy_to_stream($inputHandle, $bundleHandle, $maximumBundleBytes + 1);
    fclose($inputHandle);
    fclose($bundleHandle);
    chmod($bundlePath, 0600);
    $deleteBundleAfter = true;
    if ($bundleSize === false || $bundleSize <= 0 || $bundleSize > $maximumBundleBytes) {
        @unlink($bundlePath);
        respond(400, ['status' => 'invalid_bundle']);
    }
}

if (!class_exists(ZipArchive::class)) {
    writeFailure($failureLog, 'PHP ZipArchive is unavailable.');
    respond(500, ['status' => 'deployment_unavailable']);
}

$lockHandle = fopen($buildRoot . '/github-production.lock', 'c');
if ($lockHandle === false || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
    respond(409, ['status' => 'deployment_in_progress']);
}

set_time_limit(180);
$stagingRoot = $buildRoot . '/release-' . $sourceSha . '-' . bin2hex(random_bytes(6));
$publicRoot = $siteRoot . '/public_html';
$backupRoot = $buildRoot . '/previous-production';
$zip = new ZipArchive();

try {
    if ($zip->open($bundlePath) !== true) {
        throw new RuntimeException('Unable to open the deployment archive.');
    }

    if ($zip->numFiles <= 0 || $zip->numFiles > 5000) {
        throw new RuntimeException('The deployment archive has an invalid file count.');
    }

    $uncompressedBytes = 0;
    for ($index = 0; $index < $zip->numFiles; $index++) {
        $entry = $zip->statIndex($index);
        if ($entry === false || !isSafeArchivePath((string) $entry['name'])) {
            throw new RuntimeException('The deployment archive contains an unsafe path.');
        }

        $entrySize = (int) ($entry['size'] ?? 0);
        $uncompressedBytes += $entrySize;
        if ($entrySize > 25 * 1024 * 1024 || $uncompressedBytes > 100 * 1024 * 1024) {
            throw new RuntimeException('The deployment archive exceeds the extraction limit.');
        }

        $operatingSystem = 0;
        $externalAttributes = 0;
        if ($zip->getExternalAttributesIndex($index, $operatingSystem, $externalAttributes)) {
            $fileType = ($externalAttributes >> 16) & 0xF000;
            if ($fileType === 0xA000) {
                throw new RuntimeException('The deployment archive contains a symbolic link.');
            }
        }
    }

    if (!mkdir($stagingRoot, 0700, true) || !$zip->extractTo($stagingRoot)) {
        throw new RuntimeException('Unable to extract the deployment archive.');
    }
    $zip->close();

    if (!is_file($stagingRoot . '/index.html') || !is_file($stagingRoot . '/.well-known/fms-deploy.php')) {
        throw new RuntimeException('The deployment archive is missing required production files.');
    }

    setTreePermissions($stagingRoot);

    removeTree($backupRoot);
    if (!rename($publicRoot, $backupRoot)) {
        throw new RuntimeException('Unable to preserve the current production release.');
    }

    if (!rename($stagingRoot, $publicRoot)) {
        rename($backupRoot, $publicRoot);
        throw new RuntimeException('Unable to activate the new production release.');
    }

    file_put_contents($buildRoot . '/last-deployed-sha', $sourceSha . "\n", LOCK_EX);
    chmod($buildRoot . '/last-deployed-sha', 0600);
    @unlink($failureLog);
} catch (Throwable $error) {
    if ($zip->status === ZipArchive::ER_OK) {
        $zip->close();
    }
    if (is_dir($stagingRoot)) {
        try {
            removeTree($stagingRoot);
        } catch (Throwable) {
            // Preserve the original deployment error.
        }
    }
    writeFailure($failureLog, $error->getMessage());
    if ($deleteBundleAfter) {
        @unlink($bundlePath);
    }
    respond(500, ['status' => 'deployment_failed']);
} finally {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    if ($deleteBundleAfter) {
        @unlink($bundlePath);
    }
}

respond(200, ['status' => 'deployed', 'sha' => $sourceSha]);
