<?php

namespace Tests\Feature;

use App\Services\Finance\{ReceiptRecognizer,ReceiptPhoto};
use Tests\TestCase;

class ReceiptTableTest extends TestCase
{
    public function test_table_receipt_keeps_quantity_price_and_weight_and_ignores_tax_and_free_gifts(): void
    {
        $text="Магазин\nЙогурт 120.00 *2 =240.00 НДС 10%\nАпельсины вес 300,00 x0,650 =195,00 НДС 10%\nПодарок 0.00 *1 =0.00 НДС 22%\nИТОГО К ОПЛАТЕ =435.00\nБЕЗНАЛИЧНЫМИ =435.00\nСУММА НДС 10% =39.55\nВАША СКИДКА 10.00\n24.10.26 18:11";
        $p=(new ReceiptRecognizer)->parseText($text);
        $this->assertCount(2,$p['items']);
        $this->assertSame(2.0,$p['items'][0]['qty']);
        $this->assertSame(120.0,$p['items'][0]['price']);
        $this->assertSame(0.65,$p['items'][1]['qty']);
        $this->assertSame(300.0,$p['items'][1]['price']);
        $this->assertArrayNotHasKey('needs_review',$p['items'][1]);
        $this->assertSame(435.0,$p['total']);
        $this->assertSame('2026-10-24',$p['date']);
    }

    public function test_table_arithmetic_errors_and_unreadable_quantity_require_editing(): void
    {
        $p=(new ReceiptRecognizer)->parseText("Товар 100.00 *2 =100.00 НДС 10%\nМолоко 50.00 *? =50.00 НДС 10%\nИТОГО К ОПЛАТЕ =150.00");
        $this->assertCount(2,$p['items']);
        $this->assertTrue($p['items'][0]['needs_review']);
        $this->assertTrue($p['items'][1]['needs_review']);
        $this->assertSame(0,$p['items'][1]['qty']);
    }

    public function test_total_can_wrap_onto_the_next_line_and_ocr_multiplication_symbols_are_supported(): void
    {
        $p=(new ReceiptRecognizer)->parseText("Яблоки 80.00 #2 =160.00 HAC 10%\nХлеб 40.00 ж1 =40.00 НДС 10%\nИТОГО К ОПЛАТЕ\n=200.00\nСУММА НДС 18.18\n24.10.2026 18:11");
        $this->assertCount(2,$p['items']);
        $this->assertSame(200.0,$p['total']);
        $this->assertSame('2026-10-24',$p['date']);
    }

    public function test_different_receipt_totals_are_not_combined_into_one_expense(): void
    {
        $p=(new ReceiptRecognizer)->parseText("Молоко 100.00 *1 =100.00 НДС 10%\nИТОГО К ОПЛАТЕ =100.00\nХлеб 50.00 *1 =50.00 НДС 10%\nИТОГО К ОПЛАТЕ =50.00");
        $this->assertSame('MULTIPLE_RECEIPTS',$p['review_reason']);
        $this->assertNull($p['total']);
        $this->assertSame([],$p['items']);
    }

    public function test_sparse_columns_are_preserved_for_review_and_footer_noise_does_not_switch_parser(): void
    {
        $p=(new ReceiptRecognizer)->parseText("Торт\n\n100.00\n\n*2\n\n=200.00 НДС 10%\nИТОГО К ОПЛАТЕ\n200.00\n40) qu");
        $this->assertCount(1,$p['items']);
        $this->assertSame('Торт',$p['items'][0]['name']);
        $this->assertSame(2.0,$p['items'][0]['qty']);
        $this->assertTrue($p['items'][0]['needs_review']);
        $this->assertSame(200.0,$p['total']);
    }

    public function test_photo_preparation_isolates_paper_without_modifying_the_original_bytes(): void
    {
        $im=imagecreatetruecolor(600,800);
        imagefill($im,0,0,imagecolorallocate($im,140,90,40));
        imagefilledpolygon($im,[120,80,420,100,480,700,90,700],imagecolorallocate($im,240,238,230));
        imagestring($im,5,160,500,'ITEM 100.00 *1 =100.00',imagecolorallocate($im,0,0,0));
        $input=tempnam(sys_get_temp_dir(),'paper_input_'); $output=tempnam(sys_get_temp_dir(),'paper_output_');
        try {
            imagepng($im,$input); $bytes=file_get_contents($input);
            $this->assertSame([],(new ReceiptPhoto)->prepare($output,$bytes));
            $result=imagecreatefrompng($output);
            try {
                $this->assertLessThan(1100,imagesx($result));
                $rgb=imagecolorat($result,0,0);
                $channels=[($rgb>>16)&255,($rgb>>8)&255,$rgb&255];
                // Bicubic interpolation can make a white boundary a few levels darker.
                $this->assertGreaterThan(240,min($channels));
                $this->assertLessThan(5,max($channels)-min($channels));
            } finally { imagedestroy($result); }
            $this->assertSame($bytes,file_get_contents($input));
        } finally { imagedestroy($im); @unlink($input); @unlink($output); }
    }

    public function test_ocr_reads_both_sideways_directions_and_upside_down_without_exif(): void
    {
        config(['services.openai.key'=>null]);
        \Illuminate\Support\Facades\Http::preventStrayRequests();
        $image=imagecreatetruecolor(600,300);
        imagefill($image,0,0,imagecolorallocate($image,255,255,255));
        $ink=imagecolorallocate($image,0,0,0);
        imagestring($image,5,40,60,'BREAD 50.00 *3 =150.00 VAT 10%',$ink);
        imagestring($image,5,40,130,'TOTAL 150.00',$ink);
        imagestring($image,5,40,200,'24.10.26 18:11',$ink);
        $path=tempnam(sys_get_temp_dir(),'rotated_table_');
        try {
            foreach ([90,180,270] as $angle) {
                $sideways=imagerotate($image,$angle,0xffffff);
                try { imagepng($sideways,$path); }
                finally { imagedestroy($sideways); }
                $result=(new ReceiptRecognizer)->recognize('data:image/png;base64,'.base64_encode(file_get_contents($path)),null,true);
                $this->assertSame('COMPLETED',$result['status'],'rotation '.$angle);
                $this->assertSame(150.0,$result['payload']['total']);
                $this->assertSame(3.0,$result['payload']['items'][0]['qty']);
                $this->assertSame(50.0,$result['payload']['items'][0]['price']);
                $this->assertCount(1,$result['payload']['items']);
            }
        } finally { imagedestroy($image); @unlink($path); }
        \Illuminate\Support\Facades\Http::assertNothingSent();
    }

    public function test_sparse_pass_can_supply_missing_metadata_without_duplicating_products(): void
    {
        config(['services.openai.key'=>null]);
        $reader=\Mockery::mock(ReceiptRecognizer::class)->makePartial()->shouldAllowMockingProtectedMethods();
        $rows="Milk 20.00 *1 =20.00 VAT 10%\nBread 30.00 *1 =30.00 VAT 10%\nTea 50.00 *1 =50.00 VAT 10%\n24.10.26 18:11";
        $reader->shouldReceive('readText')->times(3)->andReturn($rows,$rows,"TOTAL\n#100, 00");
        $result=$reader->recognize('data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64')),null,true);
        $this->assertSame('COMPLETED',$result['status']);
        $this->assertCount(3,$result['payload']['items']);
        $this->assertSame(100.0,$result['payload']['total']);
        $this->assertSame('2026-10-24',$result['payload']['date']);
    }

    public function test_conflicting_totals_between_ocr_passes_require_review(): void
    {
        config(['services.openai.key'=>null]);
        $reader=\Mockery::mock(ReceiptRecognizer::class)->makePartial()->shouldAllowMockingProtectedMethods();
        $reader->shouldReceive('readText')->andReturn("Milk 100.00 *1 =100.00 VAT 10%\nTOTAL 120.00","Milk 100.00 *1 =100.00 VAT 10%\nTOTAL 100.00");
        $result=$reader->recognize('data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64')),null,true);
        $this->assertSame('NEEDS_REVIEW',$result['status']);
        $this->assertSame('TOTAL_UNCERTAIN',$result['payload']['review_reason']);
    }

    public function test_installed_ocr_self_check_reports_the_version_and_rotated_image_result(): void
    {
        config(['services.openai.key'=>'do-not-use-this-key']);
        \Illuminate\Support\Facades\Http::preventStrayRequests();
        $this->artisan('family:check-receipt-ocr')->expectsOutput('{"OCR_VERSION":"table-v5","OCR_ROTATION_OK":true,"OCR_LONG_RECEIPT_OK":true}')->assertSuccessful();
        $this->assertSame('do-not-use-this-key',config('services.openai.key'));
        \Illuminate\Support\Facades\Http::assertNothingSent();
    }

    public function test_a_later_failed_attempt_does_not_erase_previously_recognized_products(): void
    {
        config(['services.openai.key'=>null]);
        $reader=\Mockery::mock(ReceiptRecognizer::class)->makePartial()->shouldAllowMockingProtectedMethods();
        $attempt=0;
        $reader->shouldReceive('readText')->andReturnUsing(function()use(&$attempt){
            $attempt++;
            if ($attempt===2) throw new \RuntimeException('must not be printed');
            return $attempt===1?"Milk 20.00 *1 =20.00 VAT 10%\nBread 30.00 *1 =30.00 VAT 10%\nTea 50.00 *1 =50.00 VAT 10%":"TOTAL 100.00";
        });
        $r=$reader->recognize('data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64')),null,true);
        $this->assertSame('COMPLETED',$r['status']);
        $this->assertCount(3,$r['payload']['items']);
        $this->assertSame(100.0,$r['payload']['total']);
    }
}
