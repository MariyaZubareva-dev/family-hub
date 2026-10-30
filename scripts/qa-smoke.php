<?php
// Read-only checks against the real running API, never a mocked response.
function request(string $path, ?string $user = null): array {
    $headers = "Accept: application/json\r\n";
    if ($user !== null) $headers .= "X-Dev-Telegram-User-Id: $user\r\n";
    $context = stream_context_create(['http' => ['header' => $headers, 'ignore_errors' => true, 'timeout' => 15]]);
    $body = file_get_contents('http://127.0.0.1:8000/api/v1' . $path, false, $context);
    preg_match('/\s(\d{3})\s/', $http_response_header[0] ?? '', $match);
    return [(int) ($match[1] ?? 0), json_decode($body ?: '', true)];
}
function ensure(bool $ok, string $message): void {
    if (!$ok) { fwrite(STDERR, "FAIL: $message\n"); exit(1); }
    echo "OK: $message\n";
}
ensure(request('/health')[0] === 200, 'API health');
ensure(request('/me')[0] === 401, 'No user header is rejected');
ensure(request('/me', '999099')[0] === 401, 'Unknown test user is rejected');
$personal = [];
foreach (['999001' => 'ADMIN', '999002' => 'USER'] as $id => $role) {
    [$status, $me] = request('/me', (string) $id);
    ensure($status === 200 && ($me['data']['family']['role'] ?? null) === $role, "User $id role $role");
    [$status, $data] = request('/finance/personal', (string) $id);
    ensure($status === 200 && is_array($data['data']['pots'] ?? null), "Personal finance for $id");
    foreach ($data['data']['pots'] as $pot) ensure($pot['user_id'] === $me['data']['id'], 'Returned pot belongs to current user');
    $personal[] = $data['data'];
}
ensure((float) $personal[0]['available'] === (float) $personal[1]['available'], 'Both users see the same available family balance');
[$status, $history] = request('/finance/savings-history', '999001');
ensure($status === 200 && is_array($history['data'] ?? null), 'Shared savings history is readable');
foreach ($history['data'] as $row) {
    ensure(!array_intersect(['pot_id', 'destination_id', 'name', 'note'], array_keys($row)), 'Shared history omits private pot fields');
}
echo "Smoke checks passed. These checks do not replace the full user scenario audit.\n";
