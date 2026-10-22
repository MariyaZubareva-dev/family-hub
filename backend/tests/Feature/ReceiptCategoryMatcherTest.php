<?php

namespace Tests\Feature;

use App\Models\{User,Family,FamilyMember,ExpenseCategory};
use App\Http\Middleware\TelegramAuthenticate;
use App\Services\Finance\{FiscalQr,ReceiptRecognizer};
use App\Services\Finance\ReceiptCategoryMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB,Http};
use Illuminate\Support\Str;
use Tests\TestCase;

class ReceiptCategoryMatcherTest extends TestCase
{
    use RefreshDatabase;
    private User $user;
    private Family $family;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        $this->user=User::create(['telegram_user_id'=>71201,'first_name'=>'Тест']);
        $this->family=Family::create(['name'=>'Семья','created_by'=>$this->user->id]);
    }

    private function category(string $name, array $extra=[]): ExpenseCategory
    {
        return ExpenseCategory::create(array_replace(['family_id'=>$this->family->id,'created_by'=>$this->user->id,'name'=>$name,'transaction_type'=>'EXPENSE','status'=>'ACTIVE'],$extra));
    }

    private function match(array $names): array
    {
        return app(ReceiptCategoryMatcher::class)->categorize($this->family->id,['total'=>123.45,'date'=>'2026-10-22','items'=>array_map(fn($name)=>['name'=>$name,'qty'=>1.25,'price'=>98.76,'needs_review'=>true],$names)]);
    }

    private function history(string $name, ExpenseCategory $category, string $status='CONFIRMED', int $daysAgo=0): string
    {
        $receipt=(string)Str::ulid();
        DB::table('receipts')->insert(['id'=>$receipt,'family_id'=>$category->family_id,'uploaded_by'=>$this->user->id,'ocr_status'=>$status,'created_at'=>now()->subDays($daysAgo),'updated_at'=>now()]);
        DB::table('finance_transactions')->insert(['id'=>(string)Str::ulid(),'family_id'=>$category->family_id,'created_by'=>$this->user->id,'receipt_id'=>$receipt,'type'=>'EXPENSE','category_id'=>$category->id,'category'=>$category->name,'amount'=>100,'description'=>$name,'occurred_on'=>'2026-10-22','created_at'=>now()->subDays($daysAgo),'updated_at'=>now()]);
        return $receipt;
    }

    public function test_mixed_basket_uses_existing_categories_and_preserves_recognized_values(): void
    {
        foreach (['Продукты','Здоровье','Дом. хоз-во','Одежда','Покупки'] as $name) $this->category($name);
        $names=['Молоко 3,2% 1л','Парацетамол 500мг','Шампунь молочный','Футболка хлопок','УЗИ органов','XQ-179'];
        $result=$this->match($names);
        $this->assertSame(['Продукты','Здоровье','Дом. хоз-во','Одежда','Здоровье','Покупки'],array_column($result['items'],'category'));
        $this->assertSame($names,array_column($result['items'],'name'));
        $this->assertSame(123.45,$result['total']); $this->assertSame('2026-10-22',$result['date']);
        foreach ($result['items'] as $item) { $this->assertSame(1.25,$item['qty']); $this->assertSame(98.76,$item['price']); $this->assertTrue($item['needs_review']); }
        $this->assertTrue($result['items'][5]['category_needs_review']);
        $this->assertSame('MANUAL_REVIEW',$result['items'][5]['category_source']);
        $this->assertDatabaseCount('expense_categories',5); $this->assertDatabaseCount('finance_transactions',0);
        Http::assertNothingSent();
    }

    public function test_only_active_expense_categories_from_the_same_family_are_candidates(): void
    {
        $fallback=$this->category('Покупки');
        $this->category('Здоровье',['transaction_type'=>'INCOME']);
        $this->category('Продукты',['status'=>'ARCHIVED']);
        $deleted=$this->category('Одежда'); $deleted->delete();
        $other=Family::create(['name'=>'Другая семья','created_by'=>$this->user->id]);
        $foreign=$this->category('Продукты',['family_id'=>$other->id]);
        $this->history('Молоко',$foreign);
        $result=$this->match(['Молоко','Парацетамол','Футболка']);
        foreach ($result['items'] as $item) { $this->assertSame($fallback->id,$item['category_id']); $this->assertTrue($item['category_needs_review']); }
    }

    public function test_latest_confirmed_family_choice_wins_but_drafts_and_deleted_receipts_do_not_teach(): void
    {
        $food=$this->category('Продукты'); $custom=$this->category('Для детей'); $fallback=$this->category('Покупки');
        $this->history('Молоко «Тест» 1 л',$food,'CONFIRMED',2);
        $this->history('Молоко «Тест» 1 л',$custom,'CONFIRMED',1);
        $this->history('Молоко «Тест» 1 л',$fallback,'NEEDS_REVIEW');
        $deleted=$this->history('Молоко «Тест» 1 л',$fallback);
        DB::table('receipts')->where('id',$deleted)->update(['deleted_at'=>now()]);
        $item=$this->match(['МОЛОКО — ТЕСТ, 1 Л'])['items'][0];
        $this->assertSame($custom->id,$item['category_id']); $this->assertSame('HISTORY',$item['category_source']);
        $this->assertFalse($item['category_needs_review']);
        // A different product/size is not silently treated as the same previously purchased item.
        $this->assertSame($food->id,$this->match(['Молоко Тест 2 л'])['items'][0]['category_id']);
    }

    public function test_custom_category_and_missing_fallback_do_not_create_or_choose_arbitrary_categories(): void
    {
        $coffee=$this->category('Кофе'); $this->category('Одежда');
        $result=$this->match(['Кофе зерновой 1 кг','Неизвестный товар']);
        $this->assertSame($coffee->id,$result['items'][0]['category_id']);
        $this->assertNull($result['items'][1]['category_id']);
        $this->assertSame('',$result['items'][1]['category']); $this->assertTrue($result['items'][1]['category_needs_review']);
        $this->assertDatabaseCount('expense_categories',2);
    }

    public function test_overlapping_custom_categories_and_missing_specific_domain_need_review(): void
    {
        $fallback=$this->category('Покупки'); $this->category('Кофе'); $this->category('Молоко'); $this->category('Продукты');
        $result=$this->match(['Кофе Молоко','Корм для кошек с мясом']);
        foreach ($result['items'] as $item) { $this->assertSame($fallback->id,$item['category_id']); $this->assertTrue($item['category_needs_review']); }
    }

    public function test_photo_recognition_pipeline_saves_suggestions_without_creating_expenses(): void
    {
        $food=$this->category('Продукты'); $health=$this->category('Здоровье');
        FamilyMember::create(['family_id'=>$this->family->id,'user_id'=>$this->user->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class); $this->actingAs($this->user);
        $this->partialMock(FiscalQr::class,fn($mock)=>$mock->shouldReceive('decode')->andReturn(null));
        $this->partialMock(ReceiptRecognizer::class,fn($mock)=>$mock->shouldReceive('recognize')->andReturn([
            'text'=>'','status'=>'COMPLETED','payload'=>['total'=>200,'receipt_total'=>200,'items'=>[
                ['name'=>'Молоко','qty'=>1,'price'=>100,'category'=>'Покупки'],
                ['name'=>'Ибупрофен','qty'=>1,'price'=>100,'category'=>'Покупки'],
            ]],
        ]));
        $this->postJson('/api/v1/finance/receipts',['image_data'=>'data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64'))])
            ->assertCreated()->assertJsonPath('data.review_payload.items.0.category_id',$food->id)
            ->assertJsonPath('data.review_payload.items.1.category_id',$health->id);
        $this->assertDatabaseCount('finance_transactions',0);
        Http::assertNothingSent();
    }
}
