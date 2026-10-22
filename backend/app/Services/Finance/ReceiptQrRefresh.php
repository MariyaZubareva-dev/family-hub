<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;

class ReceiptQrRefresh
{
    public function run(): int
    {
        if (!config('services.receipts.token')) return 0;
        $rows=DB::table('receipts')->whereNull('deleted_at')->where('qr_state','WAITING')
            ->where('ocr_status','AWAITING_DATA')->where('qr_next_attempt_at','<=',now())->orderBy('qr_next_attempt_at')->limit(5)->get();
        $processed=0;
        foreach ($rows as $row) {
            $qr=json_decode($row->qr_data ?? '',true);
            if (!is_array($qr)) continue;
            $result=app(QrReceiptProvider::class)->fetch($qr);
            $attempt=(int)$row->qr_attempts+1;
            $state=$result['state'];
            $delays=[60,300,900,3600,21600];
            if ($state==='WAITING' && $attempt>=6) $state='UNAVAILABLE';
            $update=['qr_state'=>$state,'qr_attempts'=>$attempt,'qr_next_attempt_at'=>$state==='WAITING'?now()->addSeconds($delays[min($attempt-1,4)]):null,'updated_at'=>now()];
            if ($state==='READY') {
                $payload=$result['payload']; $payload['recognizer_version']='qr-v1';
                $update['review_payload']=json_encode($payload,JSON_UNESCAPED_UNICODE);
                $update['ocr_status']=collect($payload['items'])->contains(fn($item)=>!empty($item['needs_review']))?'NEEDS_REVIEW':'COMPLETED';
            } elseif ($state!=='WAITING') $update['ocr_status']='NEEDS_REVIEW';
            // Do not overwrite an edit, confirmation, deletion or explicit retry made while HTTP ran.
            $processed+=DB::table('receipts')->where('id',$row->id)->whereNull('deleted_at')
                ->where('qr_state','WAITING')->where('ocr_status','AWAITING_DATA')
                ->where('updated_at',$row->updated_at)->where('qr_attempts',$row->qr_attempts)->update($update);
        }
        return $processed;
    }
}
