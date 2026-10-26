<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Process\Process;

class ReceiptRecognizer
{
    public const VERSION = 'table-v6';
    private array $ocrAttempts=[];
    private ?string $ocrFailure=null;

    public function diagnostics(): array { return $this->ocrAttempts; }
    public function recognize(string $image, ?array $knownQr=null, bool $qrAlreadyDecoded=false): array
    {
        $this->ocrAttempts=[]; $this->ocrFailure=null;
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
                $payload['recognition_source']='OCR'; $payload['recognizer_version']=self::VERSION;
                return ['text'=>'','payload'=>$payload,'qr_data'=>$qr,'qr_state'=>$lookup['state']??null,'status'=>'NEEDS_REVIEW'];
            }
            [$payload,$text]=$this->readOcr($tmp);
        } catch (\Throwable $e) {
            $payload['review_reason']='OCR_UNAVAILABLE';
            \Illuminate\Support\Facades\Log::warning('Receipt OCR unavailable',['version'=>self::VERSION,'exception_type'=>get_class($e)]);
        } finally {
            @unlink($tmp);
        }
        if (in_array($payload['review_reason']??null,[null,'OCR_TIMEOUT','OCR_UNAVAILABLE'],true) && config('services.openai.key')) {
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
        $payload['recognizer_version'] = self::VERSION;
        $payload['receipt_total'] = $payload['total'];
        $payload['recognition_source'] = 'OCR';
        if ($qr) {
            // The QR amount and calendar date are exact even when an API token is not configured.
            $fiscal = app(FiscalQr::class)->payload($qr);
            $payload['total'] = $fiscal['total']; $payload['receipt_total'] = $fiscal['total']; $payload['date'] = $fiscal['date'];
        }
        return ['text' => $text, 'payload' => $payload, 'status' => $this->isBalanced($payload) ? 'COMPLETED' : 'NEEDS_REVIEW', 'qr_data'=>$qr, 'qr_state'=>$lookup['state'] ?? null];
    }

    private function readOcr(string $path): array
    {
        $payload=$this->parseText(''); $text=''; $deadline=microtime(true)+35;
        $source=@imagecreatefrompng($path);
        if (!$source) return [$payload,$text];
        $rotated=tempnam(sys_get_temp_dir(),'receipt_rotation_');
        $angle=null; $bestAngle=0;
        try {
            if ($rotated===false) return [$payload,$text];
            $angles=imagesx($source)>imagesy($source)*1.6?[90,270,0,180]:[0,180,90,270];
            // Find the reading direction first; then refine segmentation in that direction.
            // Do not rely on optional EXIF or the separately packaged Tesseract OSD model.
            $attempts=array_map(fn($a)=>[$a,'6'],$angles);
            for ($index=0;$index<count($attempts);$index++) {
                if (microtime(true)>=$deadline) break;
                [$rotation,$mode]=$attempts[$index];
                if ($angle!==$rotation) {
                    $image=imagerotate($source,$rotation,0xffffff);
                    if (!$image) continue;
                    try { imagepng($image,$rotated,1); }
                    finally { imagedestroy($image); }
                    $angle=$rotation;
                }
                try { $candidateText=$this->readText($rotated,$mode,$deadline); }
                catch (\Throwable $e) {
                    $this->ocrFailure='OCR_UNAVAILABLE';
                    \Illuminate\Support\Facades\Log::warning('Receipt OCR attempt unavailable',['version'=>self::VERSION,'exception_type'=>get_class($e)]);
                    continue;
                }
                if ($candidateText===null) continue;
                $candidate=$this->parseText($candidateText);
                if (!empty($candidate['review_reason'])) return [$candidate,$candidateText];
                // A sparse pass can read the total/date better than the product rows.
                // Share only missing metadata; never concatenate product lists.
                foreach (['total','date'] as $field) {
                    if ($payload[$field]===null && $candidate[$field]!==null) $payload[$field]=$candidate[$field];
                    elseif ($candidate[$field]===null) $candidate[$field]=$payload[$field];
                    elseif ($payload[$field]!==null && $payload[$field]!==$candidate[$field]) {
                        $payload['review_reason']=$field==='total'?'TOTAL_UNCERTAIN':'DATE_UNCERTAIN';
                        $candidate['review_reason']=$payload['review_reason'];
                    }
                }
                if (!empty($payload['review_reason'])) $candidate['review_reason']=$payload['review_reason'];
                if ($this->ocrScore($candidate)>$this->ocrScore($payload)) {
                    $payload=$candidate; $text=$candidateText; $bestAngle=$rotation;
                }
                if ($this->isBalanced($payload)) break;
                $valid=count(array_filter($candidate['items'],fn($item)=>empty($item['needs_review'])));
                if ($mode==='6' && (($candidate['total']>0 && $valid>=3)||$valid>=8||$index===3)) {
                    // One candidate is kept; separate passes never add the same items twice.
                    $attempts=array_slice($attempts,0,$index+1);
                    $attempts[]=[$bestAngle,'4'];
                    if (max(imagesx($source),imagesy($source))>1800 && max(imagesx($source),imagesy($source))>min(imagesx($source),imagesy($source))*2.5) $attempts[]=[$bestAngle,'bands'];
                    $attempts[]=[$bestAngle,'11'];
                }
            }
            if (!$payload['items'] && $payload['total']===null && $this->ocrFailure) $payload['review_reason']=$this->ocrFailure;
            return [$payload,$text];
        } finally {
            imagedestroy($source);
            if ($rotated!==false) @unlink($rotated);
        }
    }

    protected function readText(string $path,string $mode,float $deadline): ?string
    {
        if ($mode==='bands') return $this->readBands($path,$deadline);
        $process=new Process(['tesseract',$path,'stdout','-l','rus+eng','--psm',$mode]);
        // Four OCR threads on a one-core VPS can exceed the timeout on a long receipt.
        $process->setEnv(['OMP_THREAD_LIMIT'=>'1']);
        $process->setTimeout(max(.1,min(25,$deadline-microtime(true))));
        $start=microtime(true); $timedOut=false;
        try { $process->run(); }
        catch (\Symfony\Component\Process\Exception\ProcessTimedOutException $e) {
            $timedOut=true; $this->ocrFailure='OCR_TIMEOUT';
            return null;
        } finally {
            $attempt=['mode'=>$mode,'elapsed_ms'=>(int)round((microtime(true)-$start)*1000),'timed_out'=>$timedOut,'exit_code'=>$process->getExitCode()];
            $this->ocrAttempts[]=$attempt;
            if ($timedOut || !$process->isSuccessful()) {
                \Illuminate\Support\Facades\Log::warning('Receipt OCR process incomplete',['version'=>self::VERSION,...$attempt]);
                if (!$timedOut) $this->ocrFailure='OCR_UNAVAILABLE';
            }
        }
        return $process->isSuccessful()?trim($process->getOutput()):null;
    }

    private function readBands(string $path,float $deadline): ?string
    {
        $image=@imagecreatefrompng($path);
        if (!$image) return null;
        $tmp=tempnam(sys_get_temp_dir(),'receipt_band_'); $text=[];
        try {
            if ($tmp===false) return null;
            $height=imagesy($image); $width=imagesx($image);
            $count=8;
            for ($i=0;$i<$count;$i++) {
                if (microtime(true)>=$deadline) return null; // Never rank a truncated pass as a full receipt.
                $start=(int)floor($height*$i/$count); $end=(int)floor($height*($i+1)/$count);
                $top=max(0,$start-60); $bottom=min($height,$end+60);
                $band=imagecrop($image,['x'=>0,'y'=>$top,'width'=>$width,'height'=>$bottom-$top]);
                $angle=$this->bandAngle($band);
                $straight=imagerotate($band,$angle,0xffffff);
                try { imagepng($straight,$tmp,1); $straightHeight=imagesy($straight); }
                finally { imagedestroy($band); imagedestroy($straight); }
                $process=new Process(['tesseract',$tmp,'stdout','-l','rus+eng','--psm','6','tsv']);
                $process->setEnv(['OMP_THREAD_LIMIT'=>'1']);
                $process->setTimeout(max(.1,min(25,$deadline-microtime(true))));
                $began=microtime(true); $timedOut=false;
                try { $process->run(); }
                catch (\Symfony\Component\Process\Exception\ProcessTimedOutException $e) { $timedOut=true; $this->ocrFailure='OCR_TIMEOUT'; }
                $this->ocrAttempts[]=['mode'=>'band-'.$i,'elapsed_ms'=>(int)round((microtime(true)-$began)*1000),'timed_out'=>$timedOut,'exit_code'=>$process->getExitCode()];
                if ($timedOut || !$process->isSuccessful()) return null;
                $lines=[];
                foreach (explode("\n",$process->getOutput()) as $row) {
                    $cols=explode("\t",$row,12);
                    if (count($cols)!==12 || $cols[0]!=='5' || trim($cols[11])==='') continue;
                    $key=implode(':',array_slice($cols,1,4));
                    $lines[$key]['words'][]=$cols[11];
                    $lines[$key]['top']=min($lines[$key]['top']??PHP_INT_MAX,(int)$cols[7]);
                    $lines[$key]['bottom']=max($lines[$key]['bottom']??0,(int)$cols[7]+(int)$cols[9]);
                }
                foreach ($lines as $line) {
                    // Each physical row belongs to one band, even if two rows have identical text.
                    $center=$top+($bottom-$top)/2+cos(deg2rad($angle))*(($line['top']+$line['bottom'])/2-$straightHeight/2);
                    if ($center>=$start && $center<$end) $text[]=implode(' ',$line['words']);
                }
            }
            return implode("\n",$text);
        } finally { imagedestroy($image); if ($tmp!==false) @unlink($tmp); }
    }

    private function bandAngle($image): float
    {
        // A bent receipt can have different baseline angles at its top and bottom.
        // Maximise the horizontal ink projection independently in each fragment.
        $scale=min(1,500/imagesx($image));
        $sample=imagescale($image,max(1,(int)(imagesx($image)*$scale)),max(1,(int)(imagesy($image)*$scale)));
        try {
            $points=[]; $w=imagesx($sample); $h=imagesy($sample);
            for ($y=0;$y<$h;$y++) for ($x=0;$x<$w;$x++) {
                $c=imagecolorat($sample,$x,$y);
                if (max(($c>>16)&255,($c>>8)&255,$c&255)<150) $points[]=[$x-$w/2,$y-$h/2];
            }
            $best=0; $bestScore=0;
            for ($step=-10;$step<=10;$step++) {
                $angle=$step/2; $s=sin(deg2rad($angle)); $c=cos(deg2rad($angle)); $rows=[];
                foreach ($points as [$x,$y]) { $row=(int)round(-$s*$x+$c*$y); $rows[$row]=($rows[$row]??0)+1; }
                $score=array_sum(array_map(fn($count)=>$count*$count,$rows));
                if ($score>$bestScore) { $best=$angle; $bestScore=$score; }
            }
            return $best;
        } finally { imagedestroy($sample); }
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
        $money = '(\d+(?: \d{3})*(?:[.,]\s*\d{2}))';
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
            if (preg_match('/^'.$totalLabel.'\s*[=:#\s]*(\d+(?: \d{3})*(?:[.,]\s*\d{1,2})?)\s*(?:₽|руб\.?)?$/ui', $line, $m) ||
                $pendingTotal && preg_match('/^[=:#\s]*(\d+(?: \d{3})*(?:[.,]\s*\d{1,2})?)\s*(?:₽|руб\.?)?$/ui',$line,$m)) {
                $finish(); $value=$number($m[1]); $totals[]=$value; $total??=$value; $ended=true; $pendingTotal=false; continue;
            }
            $pendingTotal=(bool)preg_match('/^'.$totalLabel.'\s*[=:#\s]*$/ui',$line);
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
            $product=preg_replace('/\s+(?:[НH][ДDАAОOИIЦUN]?[СC]|VAT)\b.*$/ui','',$line);
            $product=preg_replace('/\s+[A-ZА-Я]{2,4}\s+\d{1,3}%?$/ui','',$product);
            $product=preg_replace('/(?<=\d)[`\x{0027}](?=\d{2}(?:\s|$))/u','.',$product);
            // Table prices have their own column: a trailing pack size ("20 138.99")
            // is part of the name, not a thousands separator in the unit price.
            $cell='(\d+[.,]\s*\d{1,2})';
            $amountCell='(\d+(?:[.,]| )\s*\d{2})';
            if (preg_match('/^(.+?\p{L}.*?)\s+'.$cell.'\s+(.{1,14}?)\s*[=:]\s*'.$amountCell.'\s*$/u',$product,$m)) {
                $price=$number($m[2]); $amount=$number(preg_replace('/ (\d{2})$/u', '.$1',$m[4]));
                $token=trim($m[3]); $qty=null; $recovered=false;
                if (preg_match('/^[xXхХ×*#жЖмМ«»+]?\s*(\d+(?:[.,]\d+)?)\.?$/u',$token,$q)) $qty=$number($q[1]);
                // OCR substitutes a marker with 8/9/2 or a letter. Accept a repair
                // only when the remaining printed number matches price × quantity.
                if ($qty===null || abs(round($price*$qty,2)-$amount)>.02) {
                    $clean=strtr($token,['|'=>'1',']'=>'1','!'=>'1']);
                    if (preg_match('/^[^\d.,]{0,4}(\d+(?:[.,]\d+)?)$/u',$clean,$q) && abs(round($price*$number($q[1]),2)-$amount)<=.02) { $qty=$number($q[1]); $recovered=true; }
                    elseif (preg_match('/^[892](\d+(?:[.,]\d+)?)$/u',$clean,$q) && abs(round($price*$number($q[1]),2)-$amount)<=.02) { $qty=$number($q[1]); $recovered=true; }
                }
                if ($price===0.0 && $amount===0.0 && $qty>0) continue;
                $item=['name'=>mb_substr(trim($m[1]),0,255),'qty'=>$qty??0,'price'=>$price,'category'=>'Покупки'];
                if ($sparseRow || $recovered || $qty===null || $qty<=0 || $price<=0 || abs(round($price*$qty,2)-$amount)>.02) $item['needs_review']=true;
                $items[]=$item; continue;
            }
            if (preg_match('/^(.+?\p{L}.*?)\s+'.$money.'\s*(?:[xXхХ×*#жЖмМ«]\s*|\s+)(\d+(?:[.,]\d+)?)\.?\s*=\s*'.$money.'\s*$/u',$product,$m)) {
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
            if (preg_match('/итог|всего|сумма|оплат|налич|безнал|скидк|сдача|ндс|терминал|касс|фиск|ИНН|ФН|ФД|ФП|TOTAL|CASH|VISA|MASTERCARD|^(?:РОССИЯ\b|г\.|ул\.|адрес\b)/ui', $line)) continue;
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
