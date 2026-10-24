<?php

namespace App\Console\Commands;

use App\Services\Finance\ReceiptRecognizer;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckReceiptOcr extends Command
{
    protected $signature='family:check-receipt-ocr {--receipt= : Read-only local OCR diagnostics for a saved receipt ID or filename}';
    protected $description='Check local rotated receipt OCR without personal data or provider requests';

    public function handle(ReceiptRecognizer $reader): int
    {
        if ($this->option('receipt')) return $this->inspectReceipt($reader,(string)$this->option('receipt'));
        $image=imagecreatetruecolor(600,300);
        imagefill($image,0,0,imagecolorallocate($image,255,255,255));
        $ink=imagecolorallocate($image,0,0,0);
        imagestring($image,5,40,60,'MILK 100.00 *2 =200.00 VAT 10%',$ink);
        imagestring($image,5,40,130,'TOTAL 200.00',$ink);
        imagestring($image,5,40,200,'24.10.26 18:11',$ink);
        $sideways=imagerotate($image,90,0xffffff);
        $path=tempnam(sys_get_temp_dir(),'ocr_diagnostic_');
        $key=config('services.openai.key'); $ok=false; $longOk=false; $long=null;
        try {
            // This diagnostic must remain offline even if vision recognition is configured.
            config(['services.openai.key'=>null]);
            imagepng($sideways,$path);
            $r=$reader->recognize('data:image/png;base64,'.base64_encode(file_get_contents($path)),null,true);
            $p=$r['payload'];
            $ok=$r['status']==='COMPLETED' && ($p['total']??null)==200 && count($p['items'])===1 &&
                $p['items'][0]['qty']==2 && $p['items'][0]['price']==100;
            // A three-line fixture cannot expose a timeout on a real shopping receipt.
            $long=imagecreatetruecolor(600,3200);
            imagefill($long,0,0,imagecolorallocate($long,255,255,255));
            $black=imagecolorallocate($long,0,0,0);
            for ($i=0;$i<80;$i++) imagestring($long,5,40,40+$i*36,'MILK 100.00 *2 =200.00 VAT 10%',$black);
            imagestring($long,5,40,3010,'TOTAL 16000.00',$black);
            imagestring($long,5,40,3100,'24.10.26 18:11',$black);
            imagepng($long,$path);
            $r=$reader->recognize('data:image/png;base64,'.base64_encode(file_get_contents($path)),null,true);
            $longOk=$r['status']==='COMPLETED' && ($r['payload']['total']??null)==16000 && count($r['payload']['items'])===80;
        } catch (\Throwable $e) {
            // No receipt contents, fiscal IDs, provider credentials or error bodies are printed.
        } finally {
            config(['services.openai.key'=>$key]);
            imagedestroy($image); if ($sideways) imagedestroy($sideways);
            if ($long) imagedestroy($long);
            if ($path!==false) @unlink($path);
        }
        $this->line(json_encode(['OCR_VERSION'=>ReceiptRecognizer::VERSION,'OCR_ROTATION_OK'=>$ok,'OCR_LONG_RECEIPT_OK'=>$longOk]));
        return $ok&&$longOk?self::SUCCESS:self::FAILURE;
    }

    private function inspectReceipt(ReceiptRecognizer $reader,string $value): int
    {
        $row=DB::table('receipts')->whereNull('deleted_at')->where(function($q)use($value){$q->where('id',$value)->orWhere('file_name',$value);})->orderByDesc('created_at')->first();
        if (!$row || !$row->image_data) {
            $this->line(json_encode(['OCR_VERSION'=>ReceiptRecognizer::VERSION,'RECEIPT_FOUND'=>false]));
            return self::FAILURE;
        }
        $key=config('services.openai.key'); $start=microtime(true);
        try {
            config(['services.openai.key'=>null]);
            // No provider requests, category updates, draft writes or expense creation.
            $r=$reader->recognize($row->image_data,null,true);
            $p=$r['payload'];
            $this->line(json_encode(['OCR_VERSION'=>ReceiptRecognizer::VERSION,'READ_ONLY'=>true,'OCR_STATUS'=>$r['status'],
                'ITEM_COUNT'=>count($p['items']),'TOTAL_READ'=>($p['total']??null)!==null,'REVIEW_REASON'=>$p['review_reason']??null,
                'ELAPSED_MS'=>(int)round((microtime(true)-$start)*1000),'ATTEMPTS'=>$reader->diagnostics()]));
            return count($p['items'])>0?self::SUCCESS:self::FAILURE;
        } finally { config(['services.openai.key'=>$key]); }
    }
}
