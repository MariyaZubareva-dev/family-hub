<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Process\Process;

class ReceiptRecognizer
{
    public function recognize(string $image, ?array $knownQr=null, bool $qrAlreadyDecoded=false): array
    {
        $qr = $qrAlreadyDecoded ? $knownQr : ($knownQr ?? app(FiscalQr::class)->decode($image));
        $lookup = $qr ? app(QrReceiptProvider::class)->fetch($qr) : null;
        if ($qr && $qr['n'] !== '1') $lookup = ['state'=>'UNSUPPORTED'];
        if ($qr && $lookup['state'] !== 'NOT_CONFIGURED') {
            $payload = $lookup['payload'] ?? app(FiscalQr::class)->payload($qr);
            $payload['recognizer_version'] = 'qr-v1';
            return ['text'=>'', 'payload'=>$payload, 'qr_data'=>$qr, 'qr_state'=>$lookup['state'],
                'status'=>$lookup['state']==='WAITING'?'AWAITING_DATA':($this->isBalanced($payload)?'COMPLETED':'NEEDS_REVIEW')];
        }
        $text = '';
        $payload = $this->parseText('');
        $tmp = tempnam(sys_get_temp_dir(), 'receipt_');
        try {
            $bytes = base64_decode(explode(',', $image, 2)[1], true);
            file_put_contents($tmp, $bytes);
            $photo = app(ReceiptPhoto::class)->prepare($tmp, $bytes);
            if (($photo['review_reason']??null)==='MULTIPLE_RECEIPTS') {
                $payload['review_reason']='MULTIPLE_RECEIPTS';
                $payload['recognition_source']='OCR'; $payload['recognizer_version']='table-v3';
                return ['text'=>'','payload'=>$payload,'qr_data'=>$qr,'qr_state'=>$lookup['state']??null,'status'=>'NEEDS_REVIEW'];
            }
            $deadline=microtime(true)+25;
            foreach (['6','4','11'] as $mode) {
                if (microtime(true)>=$deadline) break;
                $process = new Process(['tesseract', $tmp, 'stdout', '-l', 'rus+eng', '--psm', $mode]);
                $process->setTimeout(max(0.1,min(15,$deadline-microtime(true))));
                try { $process->run(); }
                catch (\Symfony\Component\Process\Exception\ProcessTimedOutException $e) { continue; }
                if (!$process->isSuccessful()) continue;
                $candidateText=trim($process->getOutput());
                $candidate=$this->parseText($candidateText);
                if (!empty($candidate['review_reason'])) { $text=$candidateText; $payload=$candidate; break; }
                if ($this->ocrScore($candidate)>$this->ocrScore($payload)) { $text=$candidateText; $payload=$candidate; }
                if ($this->isBalanced($payload)) break;
            }
        } catch (\Throwable $e) {
            // Manual review remains available if OCR is unavailable or the image is unreadable.
        } finally {
            @unlink($tmp);
        }
        if (empty($payload['review_reason']) && config('services.openai.key')) {
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
        $payload['recognizer_version'] = 'table-v3';
        $payload['receipt_total'] = $payload['total'];
        $payload['recognition_source'] = 'OCR';
        if ($qr) {
            // The QR amount and calendar date are exact even when an API token is not configured.
            $fiscal = app(FiscalQr::class)->payload($qr);
            $payload['total'] = $fiscal['total']; $payload['receipt_total'] = $fiscal['total']; $payload['date'] = $fiscal['date'];
        }
        return ['text' => $text, 'payload' => $payload, 'status' => $this->isBalanced($payload) ? 'COMPLETED' : 'NEEDS_REVIEW', 'qr_data'=>$qr, 'qr_state'=>$lookup['state'] ?? null];
    }

    private function ocrScore(array $payload): float
    {
        if ($this->isBalanced($payload)) return 10000;
        $valid=count(array_filter($payload['items']??[],fn($item)=>empty($item['needs_review'])));
        return ($payload['total']>0?100:0)+min(100,$valid)*10+min(100,count($payload['items']??[]));
    }

    private function isBalanced(array $payload): bool
    {
        if (!empty($payload['review_reason']) || empty($payload['items']) || !isset($payload['total']) || $payload['total'] <= 0) return false;
        $sum = 0;
        foreach ($payload['items'] as $item) {
            if (!empty($item['needs_review']) || $item['qty'] <= 0 || $item['price'] <= 0) return false;
            $sum += round($item['qty'] * $item['price'], 2);
        }
        return abs(round($sum, 2) - $payload['total']) <= 0.02;
    }

    public function parseText(string $text): array
    {
        $lines = array_values(array_filter(array_map('trim',preg_split('/\R/u', str_replace(["\u{00A0}", "\u{202F}"], ' ', $text))),fn($line)=>$line!==''));
        $money = '(\d+(?: \d{3})*(?:[.,]\d{2}))';
        $number = fn(string $s): float => (float) str_replace([' ', ','], ['', '.'], $s);
        $items = []; $block = null; $total = null; $ended=false; $pendingTotal=false; $totals=[];
        $numberedCount=preg_match_all('/^\s*(\d{1,3})\s*[:)]\s*\p{L}/um',$text,$numbered);
        $structured=$numberedCount>0 && (int)$numbered[1][0]===1 && ($numberedCount>1 ||
            preg_match('/^\s*\d+(?:[.,]\d+)?\s*[\p{L}.]{0,6}\s*[xхХ×*]\s*'.$money.'(?:\s*=\s*'.$money.')?\s*$/um',$text));
        $finish = function () use (&$block, &$items): void {
            if ($block === null) return;
            $item = ['name' => mb_substr(trim($block['name']), 0, 255), 'qty' => $block['qty'] ?? 0, 'price' => $block['price'] ?? 0, 'category' => 'Покупки'];
            if ($item['qty'] <= 0 || $item['price'] <= 0 || isset($block['amount']) && abs(round($item['qty'] * $item['price'], 2) - $block['amount']) > 0.02) $item['needs_review'] = true;
            $items[] = $item; $block = null;
        };
        $skipUntil=-1;
        foreach ($lines as $index=>$raw) {
            if ($index<=$skipUntil) continue;
            $line = preg_replace('/^[\s\x{0027}\x{0022}\x{0060}\x{2018}\x{2019}\x{201C}\x{201D}]+|[\s\x{0027}\x{0022}\x{0060}\x{2018}\x{2019}\x{201C}\x{201D}]+$/u', '', $raw);
            $totalLabel='(?:ИТОГ(?:О)?|ВСЕГО|TOTAL)(?:\s+[КK]\s+[ОO][ПPпnN][ЛLлnN][АA][ТT][ЕE])?';
            if (preg_match('/^'.$totalLabel.'\s*[=:\s]*(\d+(?: \d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?$/ui', $line, $m) ||
                $pendingTotal && preg_match('/^[=:\s]*(\d+(?: \d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?$/ui',$line,$m)) {
                $finish(); $value=$number($m[1]); $totals[]=$value; $total??=$value; $ended=true; $pendingTotal=false; continue;
            }
            $pendingTotal=(bool)preg_match('/^'.$totalLabel.'\s*[=:\s]*$/ui',$line);
            if ($pendingTotal) { $finish(); $ended=true; continue; }
            if ($ended) continue;
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
            // Sparse OCR may return the four columns as consecutive text blocks.
            // Rejoin only an explicit price / multiplier / line-total sequence.
            $sparseRow=false;
            if (isset($lines[$index+3]) && preg_match('/\p{L}/u',$line) &&
                preg_match('/^'.$money.'$/u',$lines[$index+1]) &&
                preg_match('/^[xXхХ×*#жЖмМ%«]\s*[\d.,}\]]+$/u',$lines[$index+2]) &&
                preg_match('/^=\s*'.$money.'(?:\s|$)/u',$lines[$index+3])) {
                $line.=' '.$lines[$index+1].' '.$lines[$index+2].' '.$lines[$index+3];
                $skipUntil=$index+3;
                $sparseRow=true;
            }
            // Tax belongs to a product row. Parse the arithmetic before skipping tax/footer lines.
            $product=preg_replace('/\s+(?:[НH][ДDАAОO][СC]|VAT)\b.*$/ui','',$line);
            if (preg_match('/^(.+?\p{L}.*?)\s+'.$money.'\s*[xXхХ×*#жЖмМ«]\s*(\d+(?:[.,]\d+)?)\s*=\s*'.$money.'\s*$/u',$product,$m)) {
                $price=$number($m[2]); $qty=$number($m[3]); $amount=$number($m[4]);
                // A free gift is not an expense; it does not change the receipt total.
                if ($price===0.0 && $amount===0.0 && $qty>0) continue;
                $item=['name'=>mb_substr(trim($m[1]),0,255),'qty'=>$qty,'price'=>$price,'category'=>'Покупки'];
                if ($sparseRow || $price<=0 || $qty<=0 || abs(round($qty*$price,2)-$amount)>0.02) $item['needs_review']=true;
                $items[]=$item; continue;
            }
            // Preserve a damaged arithmetic row for editing rather than taking its total as its price.
            if (preg_match('/^(.+?\p{L}.*?)\s+'.$money.'\s*[xXхХ×*#жЖмМ«].*=.*$/u',$product,$m)) {
                $items[]=['name'=>mb_substr(trim($m[1]),0,255),'qty'=>0,'price'=>$number($m[2]),'category'=>'Покупки','needs_review'=>true]; continue;
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
        if (preg_match('/\b(\d{2})[.\/](\d{2})[.\/](\d{4}|\d{2})\b/', $text, $m)) {
            $year=strlen($m[3])===2?'20'.$m[3]:$m[3];
            if (checkdate((int)$m[2],(int)$m[1],(int)$year)) $date="$year-$m[2]-$m[1]";
        }
        if (count(array_unique($totals,SORT_REGULAR))>1) return ['merchant'=>null,'date'=>null,'total'=>null,'currency'=>'RUB','items'=>[],'review_reason'=>'MULTIPLE_RECEIPTS'];
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
