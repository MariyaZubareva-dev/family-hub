<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Process\Process;

class ReceiptRecognizer
{
    public function recognize(string $image): array
    {
        $text = '';
        $tmp = tempnam(sys_get_temp_dir(), 'receipt_');
        try {
            $bytes = base64_decode(explode(',', $image, 2)[1], true);
            file_put_contents($tmp, $bytes);
            $this->prepareOcrImage($tmp, $bytes);
            $process = new Process(['tesseract', $tmp, 'stdout', '-l', 'rus+eng', '--psm', '6']);
            $process->setTimeout(25);
            $process->run();
            if ($process->isSuccessful()) $text = trim($process->getOutput());
        } catch (\Throwable $e) {
            // Manual review remains available if OCR is unavailable or the image is unreadable.
        } finally {
            @unlink($tmp);
        }
        $payload = $this->parseText($text);
        if (config('services.openai.key')) {
            try {
                $response = Http::withToken(config('services.openai.key'))->timeout(45)->post('https://api.openai.com/v1/responses', [
                    'model' => config('services.openai.model'),
                    'input' => [['role' => 'user', 'content' => [
                        ['type' => 'input_text', 'text' => 'Распознай чек. Верни только JSON: {"merchant":null,"date":null,"total":null,"currency":"RUB","items":[{"name":"Товар","qty":1,"price":100,"category":"Покупки"}]}. price — цена одной единицы, qty — количество. Не придумывай позиции или значения. Неизвестные поля оставь null. date в формате YYYY-MM-DD.'],
                        ['type' => 'input_image', 'image_url' => $image],
                    ]]],
                ]);
                if ($response->successful()) {
                    foreach ($response->json('output', []) as $output) {
                        foreach ($output['content'] ?? [] as $content) {
                            if (preg_match('/\{.*\}/s', $content['text'] ?? '', $match)) {
                                $candidate = json_decode($match[0], true);
                                if (is_array($candidate) && !empty($candidate['items'])) {
                                    $candidate = $this->sanitize($candidate);
                                    // Keep a verified OCR result if the provider returns inconsistent arithmetic.
                                    if (!$this->isBalanced($payload) || $this->isBalanced($candidate) && abs(($payload['total'] ?? $candidate['total']) - $candidate['total']) <= 0.02) $payload = $candidate;
                                }
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                // Fall back to local OCR; never return provider diagnostics or credentials to the user.
            }
        }
        $payload['recognizer_version'] = 'numbered-v2';
        $payload['receipt_total'] = $payload['total'];
        return ['text' => $text, 'payload' => $payload, 'status' => $this->isBalanced($payload) ? 'COMPLETED' : 'NEEDS_REVIEW'];
    }

    private function prepareOcrImage(string $path, string $bytes): void
    {
        if (!function_exists('imagecreatefromstring')) return;
        $source = @imagecreatefromstring($bytes);
        if (!$source) return;
        try {
            $width = imagesx($source); $height = imagesy($source);
            $scale = min(2, 3200 / max($width, $height));
            if ($scale <= 1) return;
            // Small receipt fonts lose digits at their original size. Upscale without JPEG recompression.
            $scaled = imagescale($source, (int) round($width * $scale), (int) round($height * $scale), IMG_BICUBIC_FIXED);
            if ($scaled) { imagepng($scaled, $path); imagedestroy($scaled); }
        } finally { imagedestroy($source); }
    }

    private function isBalanced(array $payload): bool
    {
        if (empty($payload['items']) || !isset($payload['total']) || $payload['total'] <= 0) return false;
        $sum = 0;
        foreach ($payload['items'] as $item) {
            if (!empty($item['needs_review']) || $item['qty'] <= 0 || $item['price'] <= 0) return false;
            $sum += round($item['qty'] * $item['price'], 2);
        }
        return abs(round($sum, 2) - $payload['total']) <= 0.02;
    }

    public function parseText(string $text): array
    {
        $lines = preg_split('/\R/u', str_replace(["\u{00A0}", "\u{202F}"], ' ', $text));
        $money = '(\d+(?: \d{3})*(?:[.,]\d{2}))';
        $number = fn(string $s): float => (float) str_replace([' ', ','], ['', '.'], $s);
        $items = []; $block = null; $total = null;
        $structured = (bool) preg_match('/^\s*\d{1,3}\s*[:)]\s*\p{L}/um', $text);
        $finish = function () use (&$block, &$items): void {
            if ($block === null) return;
            $item = ['name' => mb_substr(trim($block['name']), 0, 255), 'qty' => $block['qty'] ?? 0, 'price' => $block['price'] ?? 0, 'category' => 'Покупки'];
            if ($item['qty'] <= 0 || $item['price'] <= 0 || isset($block['amount']) && abs(round($item['qty'] * $item['price'], 2) - $block['amount']) > 0.02) $item['needs_review'] = true;
            $items[] = $item; $block = null;
        };
        foreach ($lines as $raw) {
            $line = preg_replace('/^[\s\x{0027}\x{0022}\x{0060}\x{2018}\x{2019}\x{201C}\x{201D}]+|[\s\x{0027}\x{0022}\x{0060}\x{2018}\x{2019}\x{201C}\x{201D}]+$/u', '', $raw);
            if (preg_match('/^(?:ИТОГ(?:О)?|ВСЕГО|TOTAL)\s*[=:]?\s*(\d+(?: \d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?$/ui', $line, $m)) {
                $finish(); $total = $number($m[1]); break;
            }
            if ($structured) {
                if (preg_match('/^\d{1,3}\s*[:)]\s*(\p{L}.+)$/u', $line, $m)) { $finish(); $block = ['name' => $m[1]]; continue; }
                if ($block === null || $line === '') continue;
                if (preg_match('/^(\d+(?:[.,]\d+)?)\s*(?:[\p{L}.]{0,6})\s*[xхХ×*]\s*'.$money.'(?:\s*=\s*'.$money.')?\s*$/u', $line, $m)) {
                    $block['qty'] = $number($m[1]); $block['price'] = $number($m[2]);
                    if (isset($m[3]) && $m[3] !== '') $block['amount'] = $number($m[3]);
                    continue;
                }
                if (preg_match('/стоимость позиции.*?'.$money.'\s*$/ui', $line, $m)) { $block['amount'] = $number($m[1]); continue; }
                if (!isset($block['qty']) && !preg_match('/стоимость|ставка|НДС|расч[её]т|признак|поставщик|ИНН/ui', $line)) $block['name'] .= ' '.$line;
                continue;
            }
            if (preg_match('/итог|всего|сумма|оплат|налич|безнал|скидк|сдача|ндс|терминал|касс|фиск|ИНН|ФН|ФД|ФП|TOTAL|CASH|VISA|MASTERCARD/ui', $line)) continue;
            if (preg_match('/^(.+?\p{L}.*?)\s+'.$money.'\s*(?:[A-ZА-Я])?$/u', $line, $m)) {
                $name = trim($m[1]); $amount = $number($m[2]); $qty = 1; $price = $amount;
                if (preg_match('/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*[xхХ*×]\s*'.$money.'\s*$/u', $name, $q)) {
                    $name = trim($q[1]); $qty = $number($q[2]); $price = $number($q[3]);
                    if (abs(round($qty * $price, 2) - $amount) > 0.02) continue;
                }
                if (preg_match('/^\d*\s*(?:шт|кг|л|м|уп)\.?\s*[xх×*]/ui', $name) || str_contains($name, '=')) continue;
                if ($amount > 0 && $qty > 0) $items[] = ['name' => mb_substr($name, 0, 255), 'qty' => $qty, 'price' => $price, 'category' => 'Покупки'];
            }
        }
        $finish();
        $date = null;
        if (preg_match('/\b(\d{2})[.\/](\d{2})[.\/](\d{4})\b/', $text, $m) && checkdate((int)$m[2], (int)$m[1], (int)$m[3])) $date = "$m[3]-$m[2]-$m[1]";
        return ['merchant' => null, 'date' => $date, 'total' => $total, 'currency' => 'RUB', 'items' => $items];
    }

    private function sanitize(array $data): array
    {
        $items = [];
        foreach ((array)($data['items'] ?? []) as $item) {
            if (!is_array($item) || !is_string($item['name'] ?? null) || !is_numeric($item['price'] ?? null) || !is_numeric($item['qty'] ?? null)) continue;
            $price = (float)$item['price']; $qty = (float)$item['qty'];
            if (!is_finite($price) || !is_finite($qty) || $price <= 0 || $qty <= 0) continue;
            $items[] = ['name' => mb_substr($item['name'], 0, 255), 'qty' => $qty, 'price' => round($price, 2), 'category' => 'Покупки'];
        }
        $date = $data['date'] ?? null;
        if (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !checkdate((int)substr($date,5,2), (int)substr($date,8,2), (int)substr($date,0,4))) $date = null;
        return ['merchant' => is_string($data['merchant'] ?? null) ? mb_substr($data['merchant'],0,255) : null, 'date' => $date, 'total' => is_numeric($data['total'] ?? null) ? (float)$data['total'] : null, 'currency' => 'RUB', 'items' => $items];
    }
}
