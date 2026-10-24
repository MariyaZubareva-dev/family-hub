<?php

namespace App\Services\Finance;

use Symfony\Component\Process\Process;

class FiscalQr
{
    public function decode(string $image): ?array
    {
        $path = tempnam(sys_get_temp_dir(), 'fiscal_qr_');
        $source = null;
        $deadline = microtime(true) + 12;
        try {
            if ($path === false) return null;
            $bytes = base64_decode(explode(',', $image, 2)[1] ?? '', true);
            if (!$bytes) return null;
            $size=@getimagesizefromstring($bytes);
            if (!$size || $size[0]*$size[1]>16000000) return null;
            // Normalize the upload to PNG locally. No photo is sent to the receipt provider.
            $source = @imagecreatefromstring($bytes);
            if (!$source) return null;
            if ((new ReceiptPhoto())->hasMultiple($source)) return null;
            imagepng($source, $path);
            $found = $this->readCodes($path, $deadline);
            if ($found === null) return null;
            if ($found) return count($found) === 1 ? array_values($found)[0] : null;

            // Camera photos have grey paper, shadows and soft module edges. ZBar's
            // original-image pass can miss an otherwise readable QR. Try several
            // local black/white thresholds; never change or upload the stored photo.
            imagefilter($source, IMG_FILTER_GRAYSCALE);
            foreach ([145, 165, 125] as $threshold) {
                if (microtime(true) >= $deadline) break;
                $variant = imagecreatetruecolor(imagesx($source), imagesy($source));
                try {
                    imagecopy($variant, $source, 0, 0, 0, 0, imagesx($source), imagesy($source));
                    imagefilter($variant, IMG_FILTER_BRIGHTNESS, 127 - $threshold);
                    // GD's strongest contrast is only 4x; repeat to reach black/white.
                    for ($pass = 0; $pass < 5; $pass++) imagefilter($variant, IMG_FILTER_CONTRAST, -100);
                    imagepng($variant, $path);
                } finally { imagedestroy($variant); }
                $codes = $this->readCodes($path, $deadline);
                if ($codes === null) break;
                $found += $codes;
                // Collect all thresholds, rather than choosing the first of two receipts.
                if (count($found) > 1) return null;
            }
            if (!$found && microtime(true) < $deadline) {
                $scale = min(2, 3200 / max(imagesx($source), imagesy($source)));
                $variant = imagescale($source, max(1, (int)round(imagesx($source)*$scale)), max(1, (int)round(imagesy($source)*$scale)), IMG_BICUBIC_FIXED);
                if ($variant) {
                    try {
                        imagefilter($variant, IMG_FILTER_CONTRAST, -35);
                        imagepng($variant, $path);
                    } finally { imagedestroy($variant); }
                    $found = $this->readCodes($path, $deadline) ?? [];
                }
            }
            // Several different fiscal QRs on one photo are ambiguous: retain manual/OCR review.
            return count($found) === 1 ? array_values($found)[0] : null;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Receipt QR decoder unavailable', ['exception_type'=>get_class($e)]);
            return null;
        } finally {
            if ($source) imagedestroy($source);
            if ($path !== false) @unlink($path);
        }
    }

    private function readCodes(string $path, float $deadline): ?array
    {
        if (microtime(true) >= $deadline) return [];
        $process = new Process(['/usr/bin/zbarimg', '--quiet', '--raw', '--set', '*.enable=0', '--set', 'qrcode.enable=1', $path]);
        $process->setTimeout(max(0.1, min(4, $deadline - microtime(true))));
        try { $process->run(); }
        catch (\Symfony\Component\Process\Exception\ProcessTimedOutException $e) { return []; }
        if (!in_array($process->getExitCode(), [0, 4], true)) {
            // Do not log the photo, fiscal identifiers or decoder output.
            \Illuminate\Support\Facades\Log::warning('Receipt QR decoder failed', ['exit_code'=>$process->getExitCode()]);
            return null;
        }
        $found = [];
        foreach (preg_split('/\R/', trim($process->getOutput())) as $line) {
            $qr = $this->parse($line);
            if ($qr) $found[$this->fingerprint($qr)] = $qr;
        }
        return $found;
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
