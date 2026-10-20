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
            file_put_contents($tmp, base64_decode(explode(',', $image, 2)[1], true));
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
                                if (is_array($candidate) && !empty($candidate['items'])) $payload = $this->sanitize($candidate);
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                // Fall back to local OCR; never return provider diagnostics or credentials to the user.
            }
        }
        return ['text' => $text, 'payload' => $payload, 'status' => count($payload['items']) ? 'COMPLETED' : 'NEEDS_REVIEW'];
    }

    public function parseText(string $text): array
    {
        $items = [];
        foreach (preg_split('/\R/u', $text) as $line) {
            if (preg_match('/итог|всего|сумма|оплат|налич|безнал|скидк|сдача|ндс|терминал|касс|фиск|ИНН|ФН|ФД|ФП|TOTAL|CASH|VISA|MASTERCARD/ui', $line)) continue;
            // Only accept lines with a product name and an explicit price with two decimal digits.
            if (preg_match('/^\s*(.+?[\p{L}].*?)\s+(\d+[.,]\d{2})\s*(?:[A-ZА-Я])?\s*$/u', $line, $m)) {
                $name = trim($m[1]);
                $amount = (float) str_replace(',', '.', $m[2]);
                $qty = 1;
                $price = $amount;
                if (preg_match('/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*[xхХ*×]\s*(\d+[.,]\d{2})\s*$/u', $name, $q)) {
                    $name = trim($q[1]); $qty = (float) str_replace(',', '.', $q[2]); $price = (float) str_replace(',', '.', $q[3]);
                    if (abs(round($qty * $price, 2) - $amount) > 0.02) continue;
                }
                if ($amount > 0 && $qty > 0) $items[] = ['name' => mb_substr($name, 0, 255), 'qty' => $qty, 'price' => $price, 'category' => 'Покупки'];
            }
        }
        $date = null;
        if (preg_match('/\b(\d{2})[.\/](\d{2})[.\/](\d{4})\b/', $text, $m) && checkdate((int)$m[2], (int)$m[1], (int)$m[3])) $date = "$m[3]-$m[2]-$m[1]";
        $total = null;
        if (preg_match('/(?:итог|всего|TOTAL)\s*[:=]?\s*(\d+[.,]\d{2})/ui', $text, $m)) $total = (float) str_replace(',', '.', $m[1]);
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
