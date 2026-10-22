<?php

namespace App\Services\Finance;

use Symfony\Component\Process\Process;

class FiscalQr
{
    public function decode(string $image): ?array
    {
        $path = tempnam(sys_get_temp_dir(), 'fiscal_qr_');
        try {
            $bytes = base64_decode(explode(',', $image, 2)[1] ?? '', true);
            if (!$bytes) return null;
            $size=@getimagesizefromstring($bytes);
            if (!$size || $size[0]*$size[1]>16000000) return null;
            // Normalize the upload to PNG locally. No photo is sent to the receipt provider.
            $source = @imagecreatefromstring($bytes);
            if (!$source) return null;
            try { imagepng($source, $path); } finally { imagedestroy($source); }
            $process = new Process(['zbarimg', '--quiet', '--raw', '--set', '*.enable=0', '--set', 'qrcode.enable=1', $path]);
            $process->setTimeout(8);
            $process->run();
            $found = [];
            foreach (preg_split('/\R/', trim($process->getOutput())) as $line) {
                $qr = $this->parse($line);
                if ($qr) $found[$this->fingerprint($qr)] = $qr;
            }
            // Several different fiscal QRs on one photo are ambiguous: retain manual/OCR review.
            return count($found) === 1 ? array_values($found)[0] : null;
        } catch (\Throwable $e) {
            return null;
        } finally { @unlink($path); }
    }

    public function parse(string $raw): ?array
    {
        $raw = trim($raw);
        if (strlen($raw) > 512 || !str_starts_with($raw, 't=')) return null;
        $fields = [];
        foreach (explode('&', $raw) as $part) {
            $pair = explode('=', $part, 2);
            if (count($pair) !== 2 || isset($fields[$pair[0]])) return null;
            $fields[$pair[0]] = $pair[1];
        }
        if (array_diff(['t','s','fn','i','fp','n'], array_keys($fields))) return null;
        if (!preg_match('/^\d{8}T\d{4}(?:\d{2})?$/D', $fields['t']) ||
            !preg_match('/^\d{16}$/D', $fields['fn']) ||
            !preg_match('/^[1-9]\d{0,9}$/D', $fields['i']) ||
            !preg_match('/^\d{1,10}$/D', $fields['fp']) ||
            !preg_match('/^[1-4]$/D', $fields['n']) ||
            !preg_match('/^\d{1,9}(?:\.\d{1,2})?$/D', $fields['s'])) return null;
        $format = strlen($fields['t']) === 13 ? '!Ymd\THi' : '!Ymd\THis';
        $date = \DateTimeImmutable::createFromFormat($format, $fields['t']);
        if (!$date || $date->format(substr($format, 1)) !== $fields['t'] || (float)$fields['s'] <= 0) return null;
        return array_intersect_key($fields, array_flip(['t','s','fn','i','fp','n']));
    }

    public function fingerprint(array $qr): string
    {
        return hash('sha256', $qr['fn'].':'.$qr['i'].':'.$qr['fp']);
    }

    public function payload(array $qr): array
    {
        $date = substr($qr['t'],0,4).'-'.substr($qr['t'],4,2).'-'.substr($qr['t'],6,2);
        return ['merchant'=>null,'date'=>$date,'total'=>(float)$qr['s'],'receipt_total'=>(float)$qr['s'],'currency'=>'RUB','items'=>[], 'recognition_source'=>'QR'];
    }
}
