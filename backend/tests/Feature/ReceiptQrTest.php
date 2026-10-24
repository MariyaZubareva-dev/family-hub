<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{User, Family, FamilyMember};
use App\Services\Finance\{FiscalQr, QrReceiptProvider, ReceiptQrRefresh};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http};
use Symfony\Component\Process\Process;
use Tests\TestCase;

class ReceiptQrTest extends TestCase
{
    use RefreshDatabase;
    private array $qr=['t'=>'20261022T100000','s'=>'199.80','fn'=>'9286000100012345','i'=>'123','fp'=>'4567','n'=>'1'];
    private Family $family;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        config(['services.openai.key'=>null,'services.receipts.token'=>'secret-test-token']);
        $this->withoutMiddleware(TelegramAuthenticate::class);
        $this->user=User::create(['telegram_user_id'=>71101,'first_name'=>'Тест']);
        $this->family=Family::create(['name'=>'Тестовая семья','created_by'=>$this->user->id]);
        FamilyMember::create(['family_id'=>$this->family->id,'user_id'=>$this->user->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($this->user);
    }

    private function mockQr(?array $qr=null): void
    {
        $value=$qr ?? $this->qr;
        $this->partialMock(FiscalQr::class, fn($mock)=>$mock->shouldReceive('decode')->andReturn($value));
    }

    private function data(): array
    {
        return ['totalSum'=>19980,'fiscalDriveNumber'=>$this->qr['fn'],'fiscalDocumentNumber'=>123,'fiscalSign'=>4567,'operationType'=>1,'user'=>'Тестовый магазин',
            'items'=>[['name'=>'Молоко','quantity'=>2,'price'=>9990,'sum'=>19980]]];
    }

    private function upload(): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/finance/receipts',['file_name'=>'qr.png','image_data'=>'data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64'))]);
    }

    public function test_decodes_an_actual_qr_locally_and_rejects_invalid_payloads(): void
    {
        $fiscal=new FiscalQr(); $raw=http_build_query($this->qr);
        $path=tempnam(sys_get_temp_dir(),'qr_fixture_');
        try {
            $process=new Process(['qrencode','-o',$path,'-s','8','--',$raw]); $process->mustRun();
            $this->assertSame($this->qr,$fiscal->decode('data:image/png;base64,'.base64_encode(file_get_contents($path))));
            $source=imagecreatefrompng($path);
            try {
                imagepalettetotruecolor($source);
                $this->assertTrue(imagewebp($source,$path,100));
                $this->assertSame($this->qr,$fiscal->decode('data:image/webp;base64,'.base64_encode(file_get_contents($path))));
            } finally { imagedestroy($source); }
        } finally { @unlink($path); }
        foreach (['https://example.com/?'.$raw,str_replace('20261022','20260230',$raw),str_replace('s=199.80','s=-1',$raw),$raw.'&s=1'] as $invalid) $this->assertNull($fiscal->parse($invalid));
        Http::assertNothingSent();
    }

    public function test_receipt_uses_electronic_items_and_requires_confirmation(): void
    {
        $categories=$this->getJson('/api/v1/finance/categories')->assertOk()->json('data');
        $food=collect($categories)->firstWhere('name','Продукты');
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->assertJsonPath('data.qr_state','READY')->assertJsonPath('data.review_payload.items.0.qty',2)
            ->assertJsonPath('data.review_payload.items.0.price',99.9)->assertJsonPath('data.review_payload.items.0.category_id',$food['id'])->assertJsonPath('data.review_payload.receipt_total',199.8)->json('data.id');
        $this->assertDatabaseCount('finance_transactions',0);
        Http::assertSent(fn($request)=>$request->url()==='https://proverkacheka.com/api/v1/check/get' && $request['fd']==='123' && $request['token']==='secret-test-token' && !isset($request['image_data']));
        $this->getJson('/api/v1/finance/categories')->assertOk();
        $payload=['date'=>'2026-10-22','receipt_total'=>199.8,'total'=>199.8,'items'=>[['name'=>'Молоко','qty'=>2,'price'=>99.9,'category'=>'Покупки']]];
        $this->postJson("/api/v1/finance/receipts/$id/confirm",$payload)->assertCreated()->assertJsonPath('data.total_amount',199.8);
        $this->postJson("/api/v1/finance/receipts/$id/confirm",$payload)->assertConflict();
        $this->assertDatabaseCount('finance_transactions',1);
    }

    public function test_camera_photo_is_decoded_and_uses_electronic_items_without_a_qr_screenshot(): void
    {
        // Synthetic, blurred, low-contrast camera image made from the public diagnostic QR.
        // The original single ZBar pass misses it. No personal receipt is stored in tests.
        Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $image = 'data:image/jpeg;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/fiscal-qr-camera.jpg.b64'));
        $this->assertSame($this->qr, app(FiscalQr::class)->decode($image));
        $this->postJson('/api/v1/finance/receipts', ['file_name'=>'camera.jpg','image_data'=>$image])
            ->assertCreated()->assertJsonPath('data.qr_state','READY')
            ->assertJsonPath('data.review_payload.receipt_total',199.8)
            ->assertJsonPath('data.review_payload.items.0.name','Молоко');
        Http::assertSentCount(1);
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_several_fiscal_qrs_are_not_silently_treated_as_one_receipt(): void
    {
        $canvas = imagecreatetruecolor(1200,600);
        imagefill($canvas,0,0,imagecolorallocate($canvas,255,255,255));
        $path = tempnam(sys_get_temp_dir(),'qr_multiple_');
        try {
            foreach ([123,124] as $index=>$document) {
                $raw = http_build_query(array_replace($this->qr,['i'=>(string)$document]));
                (new Process(['qrencode','-o',$path,'-s','6','--',$raw]))->mustRun();
                $qr = imagecreatefrompng($path);
                try { imagecopy($canvas,$qr,50+$index*600,100,0,0,imagesx($qr),imagesy($qr)); }
                finally { imagedestroy($qr); }
            }
            imagepng($canvas,$path);
            $this->assertNull(app(FiscalQr::class)->decode('data:image/png;base64,'.base64_encode(file_get_contents($path))));
        } finally { imagedestroy($canvas); @unlink($path); }
        Http::assertNothingSent();
    }

    public function test_an_unsuccessful_qr_attempt_is_not_repeated_before_ocr(): void
    {
        $this->mock(FiscalQr::class, fn($mock)=>$mock->shouldReceive('decode')->once()->andReturn(null));
        $this->upload()->assertCreated();
        Http::assertNothingSent();
    }

    public function test_qr_on_another_receipt_in_the_background_is_not_requested(): void
    {
        $canvas=imagecreatetruecolor(900,900);
        imagefill($canvas,0,0,imagecolorallocate($canvas,140,90,40));
        $white=imagecolorallocate($canvas,245,245,240);
        imagefilledrectangle($canvas,40,200,420,800,$white);
        imagefilledrectangle($canvas,500,40,860,700,$white);
        $qr=imagecreatefromstring(base64_decode(trim(file_get_contents(resource_path('diagnostics/fiscal-qr.png.b64')))));
        $path=tempnam(sys_get_temp_dir(),'two_receipts_');
        try {
            imagecopy($canvas,$qr,545,200,0,0,imagesx($qr),imagesy($qr));
            imagepng($canvas,$path);
            $this->postJson('/api/v1/finance/receipts',['file_name'=>'two.png','image_data'=>'data:image/png;base64,'.base64_encode(file_get_contents($path))])
                ->assertCreated()->assertJsonPath('data.ocr_status','NEEDS_REVIEW')
                ->assertJsonPath('data.review_payload.review_reason','MULTIPLE_RECEIPTS')
                ->assertJsonPath('data.review_payload.items',[]);
        } finally { imagedestroy($canvas); imagedestroy($qr); @unlink($path); }
        Http::assertNothingSent();
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_free_gift_does_not_invalidate_an_electronic_receipt_or_create_a_zero_expense(): void
    {
        $data=$this->data();
        $data['items'][]=['name'=>'Подарок','quantity'=>1,'price'=>0,'sum'=>0];
        $payload=(new QrReceiptProvider)->normalize($data,$this->qr);
        $this->assertNotNull($payload);
        $this->assertCount(1,$payload['items']);
        $this->assertSame(199.8,$payload['receipt_total']);
    }

    public function test_a_table_receipt_without_a_fiscal_qr_is_read_locally_without_a_provider_request(): void
    {
        $this->mock(FiscalQr::class,fn($mock)=>$mock->shouldReceive('decode')->once()->andReturn(null));
        $canvas=imagecreatetruecolor(600,300);
        imagefill($canvas,0,0,imagecolorallocate($canvas,255,255,255));
        $black=imagecolorallocate($canvas,0,0,0);
        imagestring($canvas,5,40,60,'MILK 100.00 *2 =200.00 VAT 10%',$black);
        imagestring($canvas,5,40,130,'TOTAL 200.00',$black);
        imagestring($canvas,5,40,200,'24.10.26 18:11',$black);
        $path=tempnam(sys_get_temp_dir(),'table_photo_');
        try {
            imagepng($canvas,$path);
            $this->postJson('/api/v1/finance/receipts',['file_name'=>'table.png','image_data'=>'data:image/png;base64,'.base64_encode(file_get_contents($path))])
                ->assertCreated()->assertJsonPath('data.ocr_status','COMPLETED')
                ->assertJsonPath('data.review_payload.receipt_total',200)
                ->assertJsonPath('data.review_payload.items.0.qty',2)
                ->assertJsonPath('data.review_payload.items.0.price',100)
                ->assertJsonPath('data.review_payload.date','2026-10-24');
        } finally { imagedestroy($canvas); @unlink($path); }
        Http::assertNothingSent();
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_duplicate_photo_reuses_existing_receipt_without_another_provider_request(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->json('data.id');
        $this->upload()->assertCreated()->assertJsonPath('data.id',$id)->assertJsonPath('data.duplicate',true);
        $this->getJson('/api/v1/finance/receipts')->assertJsonCount(1,'data');
        Http::assertSentCount(1);
        $this->deleteJson("/api/v1/finance/receipts/$id")->assertNoContent();
        $new=$this->upload()->assertCreated()->assertJsonPath('data.duplicate',false)->json('data.id');
        $this->assertNotSame($id,$new);
    }

    public function test_same_fiscal_receipt_is_isolated_between_families(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->json('data.id');
        $other=User::create(['telegram_user_id'=>71102,'first_name'=>'Другой']);
        $family=Family::create(['name'=>'Другая семья','created_by'=>$other->id]);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$other->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($other);
        $this->getJson("/api/v1/finance/receipts/$id")->assertNotFound();
        $new=$this->upload()->assertCreated()->assertJsonPath('data.duplicate',false)->json('data.id');
        $this->assertNotSame($id,$new);
    }

    public function test_waiting_receipt_is_refreshed_in_background_without_creating_expenses(): void
    {
        $this->getJson('/api/v1/finance/categories')->assertOk();
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::sequence()->push(['code'=>2])->push(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->assertJsonPath('data.ocr_status','AWAITING_DATA')->assertJsonPath('data.review_payload.items',[])->json('data.id');
        $this->travel(2)->minutes();
        $this->artisan('family:refresh-qr-receipts')->assertSuccessful();
        $this->getJson("/api/v1/finance/receipts/$id")->assertJsonPath('data.qr_state','READY')->assertJsonPath('data.review_payload.items.0.name','Молоко')->assertJsonPath('data.review_payload.items.0.category','Продукты');
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_saving_manual_edits_stops_background_overwrite(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>2])]);
        $id=$this->upload()->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/finance/receipts/$id",['merchant'=>'Мои правки','receipt_total'=>199.8,'items'=>[]])->assertOk()->assertJsonPath('data.qr_state','MANUAL');
        $this->travel(2)->minutes();
        $this->assertSame(0,app(ReceiptQrRefresh::class)->run());
        $this->getJson("/api/v1/finance/receipts/$id")->assertJsonPath('data.review_payload.merchant','Мои правки');
        Http::assertSentCount(1);
    }

    public function test_deleted_draft_is_not_refetched(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>2])]);
        $id=$this->upload()->assertCreated()->json('data.id');
        $this->deleteJson("/api/v1/finance/receipts/$id")->assertNoContent(); $this->travel(2)->minutes();
        $this->assertSame(0,app(ReceiptQrRefresh::class)->run()); Http::assertSentCount(1);
    }

    public function test_wrong_totals_and_foreign_fiscal_identifiers_are_not_accepted(): void
    {
        $provider=new QrReceiptProvider();
        $this->assertNull($provider->normalize(array_replace($this->data(),['totalSum'=>29980]),$this->qr));
        $this->assertNull($provider->normalize(array_replace($this->data(),['fiscalDocumentNumber'=>999]),$this->qr));
        $data=$this->data(); $data['items'][0]['sum']=100;
        $this->assertNull($provider->normalize($data,$this->qr));
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$data]])]);
        $this->upload()->assertCreated()->assertJsonPath('data.qr_state','INVALID_DATA')->assertJsonPath('data.review_payload.items',[]);
    }

    public function test_refund_is_never_converted_into_an_expense(): void
    {
        $this->mockQr(array_replace($this->qr,['n'=>'2']));
        $id=$this->upload()->assertCreated()->assertJsonPath('data.qr_state','UNSUPPORTED')->json('data.id');
        $this->postJson("/api/v1/finance/receipts/$id/confirm",['receipt_total'=>199.8,'items'=>[['name'=>'Возврат','qty'=>1,'price'=>199.8]]])->assertUnprocessable();
        $this->assertDatabaseCount('finance_transactions',0); Http::assertNothingSent();
    }

    public function test_missing_token_keeps_local_ocr_with_exact_qr_amount(): void
    {
        $this->mockQr(); config(['services.receipts.token'=>null]);
        $this->upload()->assertCreated()->assertJsonPath('data.qr_state','NOT_CONFIGURED')->assertJsonPath('data.review_payload.receipt_total',199.8)->assertJsonPath('data.review_payload.date','2026-10-22');
        Http::assertNothingSent();
    }

    public function test_provider_auth_error_does_not_expose_credentials(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['message'=>'secret-test-token'],403)]);
        $response=$this->upload()->assertCreated()->assertJsonPath('data.qr_state','ACCESS_ERROR');
        $this->assertStringNotContainsString('secret-test-token',$response->getContent());
    }

    public function test_retries_are_bounded_and_respect_next_attempt_time(): void
    {
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>2])]);
        $id=$this->upload()->assertCreated()->json('data.id');
        $this->assertSame(0,app(ReceiptQrRefresh::class)->run());
        for($i=0;$i<5;$i++) { $this->travel(7)->hours(); app(ReceiptQrRefresh::class)->run(); }
        $this->assertDatabaseHas('receipts',['id'=>$id,'qr_state'=>'UNAVAILABLE','qr_attempts'=>6,'qr_next_attempt_at'=>null]);
        $this->travel(7)->hours(); $this->assertSame(0,app(ReceiptQrRefresh::class)->run()); Http::assertSentCount(6);
    }

    public function test_provider_codes_distinguish_pending_receipts_from_terminal_errors(): void
    {
        $provider = new QrReceiptProvider();
        $codes = [0=>'INVALID_QR',2=>'WAITING',3=>'LIMIT_EXCEEDED',4=>'WAITING',5=>'WAITING',99=>'INVALID_DATA'];
        $sequence = Http::sequence();
        foreach ($codes as $code=>$state) $sequence->push(['code'=>$code]);
        $sequence->push([],429)->push(['code'=>3]);
        Http::fake(['proverkacheka.com/*'=>$sequence]);
        foreach ($codes as $code=>$state) {
            $this->assertSame($state,$provider->fetch($this->qr)['state']);
        }
        $this->assertSame('LIMIT_EXCEEDED',$provider->fetch($this->qr)['state']);
        $this->mockQr();
        $this->upload()->assertCreated()->assertJsonPath('data.qr_state','LIMIT_EXCEEDED');
        $this->travel(7)->hours();
        $this->assertSame(0,app(ReceiptQrRefresh::class)->run());
    }

    public function test_installed_decoder_self_check_reads_the_packaged_fixture(): void
    {
        $this->artisan('family:check-receipt-qr')->expectsOutput('{"QR_DECODE_OK":true}')->assertSuccessful();
        Http::assertNothingSent();
    }

    public function test_saved_receipt_diagnostics_are_offline_and_do_not_modify_the_draft(): void
    {
        $id=(string)\Illuminate\Support\Str::ulid();
        $image='data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64'));
        DB::table('receipts')->insert(['id'=>$id,'family_id'=>$this->family->id,'uploaded_by'=>$this->user->id,'file_name'=>'saved-test.png','image_data'=>$image,'ocr_status'=>'NEEDS_REVIEW','created_at'=>now(),'updated_at'=>now()]);
        $before=DB::table('receipts')->where('id',$id)->first();
        config(['services.openai.key'=>'do-not-use-this-key']);
        $this->partialMock(\App\Services\Finance\ReceiptRecognizer::class,function($mock)use($image){
            $mock->shouldReceive('recognize')->once()->with($image,null,true)->andReturnUsing(function(){
                $this->assertNull(config('services.openai.key'));
                return ['status'=>'NEEDS_REVIEW','payload'=>['items'=>[['name'=>'Test','qty'=>1,'price'=>100]],'total'=>100]];
            });
        });
        $exit=\Illuminate\Support\Facades\Artisan::call('family:check-receipt-ocr',['--receipt'=>'saved-test.png']);
        $out=json_decode(\Illuminate\Support\Facades\Artisan::output(),true);
        $this->assertSame(0,$exit);
        $this->assertTrue($out['READ_ONLY']);
        $this->assertSame(1,$out['ITEM_COUNT']);
        $this->assertSame((array)$before,(array)DB::table('receipts')->where('id',$id)->first());
        $this->assertSame('do-not-use-this-key',config('services.openai.key'));
        $this->assertDatabaseCount('finance_transactions',0);
        Http::assertNothingSent();
    }
}
