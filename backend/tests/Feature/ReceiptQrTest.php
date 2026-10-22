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
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::response(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->assertJsonPath('data.qr_state','READY')->assertJsonPath('data.review_payload.items.0.qty',2)
            ->assertJsonPath('data.review_payload.items.0.price',99.9)->assertJsonPath('data.review_payload.receipt_total',199.8)->json('data.id');
        $this->assertDatabaseCount('finance_transactions',0);
        Http::assertSent(fn($request)=>$request->url()==='https://proverkacheka.com/api/v1/check/get' && $request['fd']==='123' && $request['token']==='secret-test-token' && !isset($request['image_data']));
        $this->getJson('/api/v1/finance/categories')->assertOk();
        $payload=['date'=>'2026-10-22','receipt_total'=>199.8,'total'=>199.8,'items'=>[['name'=>'Молоко','qty'=>2,'price'=>99.9,'category'=>'Покупки']]];
        $this->postJson("/api/v1/finance/receipts/$id/confirm",$payload)->assertCreated()->assertJsonPath('data.total_amount',199.8);
        $this->postJson("/api/v1/finance/receipts/$id/confirm",$payload)->assertConflict();
        $this->assertDatabaseCount('finance_transactions',1);
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
        $this->mockQr(); Http::fake(['proverkacheka.com/*'=>Http::sequence()->push(['code'=>2])->push(['code'=>1,'data'=>['json'=>$this->data()]])]);
        $id=$this->upload()->assertCreated()->assertJsonPath('data.ocr_status','AWAITING_DATA')->assertJsonPath('data.review_payload.items',[])->json('data.id');
        $this->travel(2)->minutes();
        $this->artisan('family:refresh-qr-receipts')->assertSuccessful();
        $this->getJson("/api/v1/finance/receipts/$id")->assertJsonPath('data.qr_state','READY')->assertJsonPath('data.review_payload.items.0.name','Молоко');
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
}
