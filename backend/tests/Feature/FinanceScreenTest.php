<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{User, Family, FamilyMember};
use App\Services\Finance\ReceiptRecognizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Queue};
use Tests\TestCase;

class FinanceScreenTest extends TestCase
{
    use RefreshDatabase;
    private User $admin;
    private User $member;
    private Family $family;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake(); Http::preventStrayRequests();
        config(['services.openai.key' => null]);
        $this->withoutMiddleware(TelegramAuthenticate::class);
        $this->admin = User::create(['telegram_user_id' => 50101, 'first_name' => 'Мария']);
        $this->member = User::create(['telegram_user_id' => 50102, 'first_name' => 'Андрей']);
        $this->family = Family::create(['name' => 'Семья', 'created_by' => $this->admin->id]);
        FamilyMember::create(['family_id' => $this->family->id, 'user_id' => $this->admin->id, 'role' => 'ADMIN', 'status' => 'ACTIVE']);
        FamilyMember::create(['family_id' => $this->family->id, 'user_id' => $this->member->id, 'role' => 'USER', 'status' => 'ACTIVE']);
        $this->actingAs($this->admin);
    }

    private function categories(): array { return $this->getJson('/api/v1/finance/categories')->assertOk()->json('data'); }
    private function image(): string { return 'data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64')); }
    private function upload(): string
    {
        $this->mock(ReceiptRecognizer::class, function ($mock) {
            $mock->shouldReceive('recognize')->once()->andReturn(['status' => 'COMPLETED', 'text' => 'Milk 99.90', 'payload' => ['merchant' => 'Магазин', 'date' => '2026-10-20', 'total' => 99.9, 'items' => [['name' => 'Молоко', 'qty' => 1, 'price' => 99.9, 'category' => 'Покупки']]]]);
        });
        return $this->postJson('/api/v1/finance/receipts', ['image_data' => $this->image(), 'file_name' => 'receipt.png'])->assertCreated()->assertJsonPath('data.ocr_status','COMPLETED')->json('data.id');
    }

    public function test_categories_persist_and_have_separate_types(): void
    {
        $categories = $this->categories();
        $this->assertSame(['Другое','ЗП','Премия'], collect($categories)->where('transaction_type','INCOME')->pluck('name')->sort()->values()->all());
        $this->assertCount(20, collect($categories)->where('transaction_type','EXPENSE'));
        $this->categories(); $this->assertDatabaseCount('expense_categories', 23);
        $this->postJson('/api/v1/finance/categories', ['name'=>'Кот','transaction_type'=>'EXPENSE'])->assertCreated();
        $this->postJson('/api/v1/finance/categories', ['name'=>'Кот','transaction_type'=>'INCOME'])->assertCreated();
        $this->postJson('/api/v1/finance/categories', ['name'=>'кот','transaction_type'=>'EXPENSE'])->assertUnprocessable();
        $this->actingAs($this->member)->postJson('/api/v1/finance/categories', ['name'=>'Нельзя','transaction_type'=>'EXPENSE'])->assertForbidden();
    }

    public function test_income_and_expense_are_stored_and_appear_in_analytics(): void
    {
        $cats = collect($this->categories());
        $salary = $cats->firstWhere('name','ЗП'); $food = $cats->firstWhere('name','Продукты');
        foreach ([['INCOME', $salary, 50000], ['EXPENSE', $food, 1200]] as [$type,$cat,$amount]) {
            $this->postJson('/api/v1/finances', ['type'=>$type,'amount'=>$amount,'category'=>$cat['name'],'category_id'=>$cat['id'],'occurred_on'=>today()->toDateString()])->assertCreated();
        }
        $this->getJson('/api/v1/finance/analytics')->assertOk()->assertJsonPath('data.total_income',50000)->assertJsonPath('data.total_expense',1200)->assertJsonPath('data.balance',48800);
        $this->postJson('/api/v1/finances', ['type'=>'INCOME','amount'=>100,'category'=>$food['name'],'category_id'=>$food['id'],'occurred_on'=>today()->toDateString()])->assertUnprocessable();
        $this->assertDatabaseCount('finance_transactions',2);
    }

    public function test_foreign_category_cannot_be_used(): void
    {
        $other = Family::create(['name'=>'Другая','created_by'=>$this->admin->id]);
        $cat = \App\Models\ExpenseCategory::create(['family_id'=>$other->id,'created_by'=>$this->admin->id,'name'=>'Чужая','transaction_type'=>'EXPENSE','status'=>'ACTIVE']);
        $this->postJson('/api/v1/finances',['type'=>'EXPENSE','category'=>'Чужая','category_id'=>$cat->id,'amount'=>100,'occurred_on'=>today()->toDateString()])->assertUnprocessable();
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_receipt_confirmation_creates_expenses_once(): void
    {
        $this->categories(); $id = $this->upload();
        $payload = ['date'=>'2026-10-20','total'=>199.8,'items'=>[['name'=>'Молоко','qty'=>2,'price'=>99.9,'category'=>'Покупки']]];
        $this->patchJson("/api/v1/finance/receipts/$id", $payload)->assertOk();
        $this->postJson("/api/v1/finance/receipts/$id/confirm", $payload)->assertCreated()->assertJsonPath('data.created_count',1)->assertJsonPath('data.total_amount',199.8);
        $this->postJson("/api/v1/finance/receipts/$id/confirm", $payload)->assertConflict();
        $this->patchJson("/api/v1/finance/receipts/$id", $payload)->assertConflict();
        $this->assertDatabaseCount('finance_transactions',1);
        $this->assertDatabaseHas('finance_transactions',['receipt_id'=>$id,'amount'=>199.8,'type'=>'EXPENSE']);
    }

    public function test_receipt_rejects_invalid_totals_and_cross_user_edits(): void
    {
        $id = $this->upload();
        $payload = ['total'=>1,'items'=>[['name'=>'Молоко','qty'=>1,'price'=>99.9,'category'=>'Покупки']]];
        $this->postJson("/api/v1/finance/receipts/$id/confirm", $payload)->assertUnprocessable();
        $this->actingAs($this->member)->postJson("/api/v1/finance/receipts/$id/confirm", $payload)->assertForbidden();
        $this->getJson("/api/v1/finance/receipts/$id")->assertJsonPath('data.can_edit', false);
        $this->assertDatabaseCount('finance_transactions',0);
    }

    public function test_unreadable_receipt_remains_a_saved_draft(): void
    {
        $this->mock(ReceiptRecognizer::class, fn($mock)=>$mock->shouldReceive('recognize')->andReturn(['status'=>'NEEDS_REVIEW','text'=>'','payload'=>['items'=>[]]]));
        $id = $this->postJson('/api/v1/finance/receipts',['image_data'=>$this->image()])->assertCreated()->assertJsonPath('data.ocr_status','NEEDS_REVIEW')->json('data.id');
        $this->getJson("/api/v1/finance/receipts/$id")->assertOk();
        $this->postJson('/api/v1/finance/receipts',['image_data'=>'not-an-image'])->assertUnprocessable();
        $this->assertDatabaseCount('receipts',1);
    }

    public function test_local_ocr_reads_photo_without_a_paid_api(): void
    {
        $result = app(ReceiptRecognizer::class)->recognize($this->image());
        $this->assertSame('COMPLETED', $result['status']);
        $this->assertCount(2, $result['payload']['items']);
        $this->assertSame(99.9, $result['payload']['items'][0]['price']);
        $this->assertSame(2.0, $result['payload']['items'][1]['qty']);
        $this->assertSame(159.9, $result['payload']['total']);
    }

    public function test_parser_does_not_treat_totals_and_payments_as_products(): void
    {
        $payload = (new ReceiptRecognizer)->parseText("Молоко 99,90\nХлеб 2 x 30,00 60,00\nИТОГ 159,90\nОПЛАТА КАРТОЙ 159,90\nНДС 20,00");
        $this->assertCount(2,$payload['items']);
        $this->assertSame(159.9,$payload['total']);
    }

    public function test_credit_installment_and_prepayment_survive_reload(): void
    {
        $credit = $this->postJson('/api/v1/credits',['type'=>'INSTALLMENT','name'=>'Техника','principal'=>12000,'annual_rate'=>0,'standard_payment'=>1000,'term_months'=>12,'start_date'=>'2026-01-01','first_payment_date'=>'2026-02-01','recalculation_mode'=>'TERM'])->assertCreated()->json('data.id');
        $pre = $this->postJson("/api/v1/credits/$credit/prepayments",['paid_on'=>'2026-03-01','amount'=>1500,'recalculation_mode'=>'TERM'])->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/credit-prepayments/$pre",['recalculation_mode'=>'PAYMENT'])->assertOk();
        $this->getJson('/api/v1/credits')->assertOk()->assertJsonPath('data.0.type','INSTALLMENT')->assertJsonPath('data.0.prepayments.0.recalculation_mode','PAYMENT');
        $this->actingAs($this->member)->getJson('/api/v1/credits')->assertOk();
        $this->postJson("/api/v1/credits/$credit/prepayments",['paid_on'=>'2026-03-01','amount'=>100])->assertForbidden();
    }

    public function test_budget_validation_does_not_erase_saved_limits(): void
    {
        $cat = collect($this->categories())->firstWhere('name','Продукты');
        $payload = ['year'=>2026,'month'=>10,'total_limit'=>10000,'categories'=>[['category_id'=>$cat['id'],'limit_amount'=>5000]]];
        $this->postJson('/api/v1/finance/budgets/save',$payload)->assertOk();
        $this->postJson('/api/v1/finance/budgets/save',[...$payload,'categories'=>[['category_id'=>'foreign','limit_amount'=>100]]])->assertNotFound();
        $this->getJson('/api/v1/finance/budgets/2026/10')->assertOk()->assertJsonPath('data.budget.total_limit',10000)->assertJsonPath('data.budget.categories.0.limit_amount',5000);
    }
}
