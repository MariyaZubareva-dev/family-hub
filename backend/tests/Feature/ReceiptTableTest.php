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
                $this->assertSame(0xffffff,$rgb&0xffffff);
            } finally { imagedestroy($result); }
            $this->assertSame($bytes,file_get_contents($input));
        } finally { imagedestroy($im); @unlink($input); @unlink($output); }
    }
}
