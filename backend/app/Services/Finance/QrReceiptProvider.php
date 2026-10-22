<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\Http;

class QrReceiptProvider
{
    public function fetch(array $qr): array
    {
        if (!config('services.receipts.token')) return ['state'=>'NOT_CONFIGURED'];
        // A purchase is n=1 ("приход" for the seller). Never turn a refund into an expense.
        if ($qr['n'] !== '1') return ['state'=>'UNSUPPORTED'];
        try {
            $response = Http::asForm()->acceptJson()->connectTimeout(3)->timeout(10)
                ->withOptions(['allow_redirects'=>false])
                ->post('https://proverkacheka.com/api/v1/check/get', [
                    'fn'=>$qr['fn'],'fd'=>$qr['i'],'fp'=>$qr['fp'],'t'=>$qr['t'],
                    'n'=>$qr['n'],'s'=>$qr['s'],'qr'=>1,'token'=>config('services.receipts.token'),
                ]);
            if (in_array($response->status(), [401,403])) return ['state'=>'ACCESS_ERROR'];
            if ($response->status() === 429) return ['state'=>'LIMIT_EXCEEDED'];
            if (!$response->successful() || strlen($response->body()) > 2*1024*1024) return ['state'=>'WAITING'];
            $result = $response->json();
            // Codes follow the provider's API contract; a quota failure is not a pending receipt.
            if (!is_array($result) || !isset($result['code']) || !is_numeric($result['code'])) return ['state'=>'INVALID_DATA'];
            $code = (int)$result['code'];
            if ($code === 0) return ['state'=>'INVALID_QR'];
            if ($code === 3) return ['state'=>'LIMIT_EXCEEDED'];
            if (in_array($code, [2,4,5], true)) return ['state'=>'WAITING'];
            if ($code !== 1) return ['state'=>'INVALID_DATA'];
            $data = $result['data']['json'] ?? null;
            if (!is_array($data)) return ['state'=>'INVALID_DATA'];
            $payload = $this->normalize($data, $qr);
            return $payload ? ['state'=>'READY','payload'=>$payload] : ['state'=>'INVALID_DATA'];
        } catch (\Throwable $e) {
            // Provider bodies and exception messages may contain credentials: never persist them.
            return ['state'=>'WAITING'];
        }
    }

    public function normalize(array $data, array $qr): ?array
    {
        $total = $data['totalSum'] ?? null;
        if (!is_numeric($total) || (int)$total <= 0 || abs((float)$total - round((float)$qr['s']*100)) > 0.01) return null;
        foreach (['fiscalDriveNumber'=>'fn','fiscalDocumentNumber'=>'i','fiscalSign'=>'fp'] as $field=>$key) {
            if (!isset($data[$field]) || (string)$data[$field] !== $qr[$key]) return null;
        }
        if (isset($data['operationType']) && (int)$data['operationType'] !== 1) return null;
        $rows = $data['items'] ?? [];
        if (!is_array($rows) || !$rows || count($rows)>1000) return null;
        $items = []; $sum = 0;
        foreach ($rows as $row) {
            if (!is_array($row) || !is_string($row['name'] ?? null) || trim($row['name']) === '') return null;
            if (!is_numeric($row['quantity'] ?? null) || !is_numeric($row['price'] ?? null) || !is_numeric($row['sum'] ?? null)) return null;
            $qty=(float)$row['quantity']; $price=(float)$row['price']; $amount=(float)$row['sum'];
            if (!is_finite($qty) || $qty<=0 || !is_finite($price) || $price<=0 || floor($price)!==$price || !is_finite($amount) || $amount<=0 || floor($amount)!==$amount) return null;
            $item=['name'=>mb_substr(trim($row['name']),0,255),'qty'=>$qty,'price'=>$price/100,'category'=>'Покупки'];
            // Preserve authoritative line totals for discounted/weighted items. Existing confirmation
            // multiplies qty*price, so discrepancies must be reviewed instead of silently rounded away.
            if (abs(round($qty*$price)-$amount)>0.01) $item['needs_review']=true;
            $items[]=$item; $sum+=(int)$amount;
        }
        if ($sum !== (int)$total) return null;
        $payload=app(FiscalQr::class)->payload($qr);
        $payload['merchant']=is_string($data['user'] ?? null)?mb_substr($data['user'],0,255):null;
        $payload['items']=$items;
        return $payload;
    }
}
