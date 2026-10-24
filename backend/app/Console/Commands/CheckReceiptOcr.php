<?php

namespace App\Console\Commands;

use App\Services\Finance\ReceiptRecognizer;
use Illuminate\Console\Command;

class CheckReceiptOcr extends Command
{
    protected $signature='family:check-receipt-ocr';
    protected $description='Check local rotated receipt OCR without personal data or provider requests';

    public function handle(ReceiptRecognizer $reader): int
    {
        $image=imagecreatetruecolor(600,300);
        imagefill($image,0,0,imagecolorallocate($image,255,255,255));
        $ink=imagecolorallocate($image,0,0,0);
        imagestring($image,5,40,60,'MILK 100.00 *2 =200.00 VAT 10%',$ink);
        imagestring($image,5,40,130,'TOTAL 200.00',$ink);
        imagestring($image,5,40,200,'24.10.26 18:11',$ink);
        $sideways=imagerotate($image,90,0xffffff);
        $path=tempnam(sys_get_temp_dir(),'ocr_diagnostic_');
        $key=config('services.openai.key'); $ok=false;
        try {
            // This diagnostic must remain offline even if vision recognition is configured.
            config(['services.openai.key'=>null]);
            imagepng($sideways,$path);
            $r=$reader->recognize('data:image/png;base64,'.base64_encode(file_get_contents($path)),null,true);
            $p=$r['payload'];
            $ok=$r['status']==='COMPLETED' && ($p['total']??null)==200 && count($p['items'])===1 &&
                $p['items'][0]['qty']==2 && $p['items'][0]['price']==100;
        } catch (\Throwable $e) {
            // No receipt contents, fiscal IDs, provider credentials or error bodies are printed.
        } finally {
            config(['services.openai.key'=>$key]);
            imagedestroy($image); if ($sideways) imagedestroy($sideways);
            if ($path!==false) @unlink($path);
        }
        $this->line(json_encode(['OCR_VERSION'=>ReceiptRecognizer::VERSION,'OCR_ROTATION_OK'=>$ok]));
        return $ok?self::SUCCESS:self::FAILURE;
    }
}
