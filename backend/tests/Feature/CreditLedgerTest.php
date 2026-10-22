<?php
namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{Credit,Family,FamilyMember,User};
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CreditLedgerTest extends TestCase
{
    use RefreshDatabase;
    private User $admin;
    private Credit $credit;
    protected function setUp(): void
    {
        parent::setUp();$this->travelTo(Carbon::parse('2026-10-22 12:00:00','UTC'));
        $this->admin=User::create(['telegram_user_id'=>76101,'first_name'=>'Мария']);
        $family=Family::create(['name'=>'Семья','created_by'=>$this->admin->id,'timezone'=>'Europe/Moscow']);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$this->admin->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($this->admin);
        $this->credit=Credit::create(['family_id'=>$family->id,'created_by'=>$this->admin->id,'type'=>'INSTALLMENT','name'=>'Техника','principal'=>600,'annual_rate'=>0,'standard_payment'=>200,'term_months'=>3,'start_date'=>'2026-10-01','first_payment_date'=>'2026-11-22','recalculation_mode'=>'TERM','status'=>'ACTIVE']);
    }
    private function graph(): array
    {
        return ['as_of'=>'2026-10-22','opening_balance'=>600,'base_version'=>0,'rows'=>[
            ['date'=>'2026-11-22','payment'=>200,'principal'=>200,'interest'=>0,'fees'=>0,'balance'=>400],
            ['date'=>'2026-12-22','payment'=>200,'principal'=>200,'interest'=>0,'fees'=>0,'balance'=>200],
            ['date'=>'2027-01-22','payment'=>200,'principal'=>200,'interest'=>0,'fees'=>0,'balance'=>0],
        ]];
    }
    private function url(string $suffix): string{return '/api/v1/credits/'.$this->credit->id.'/'.$suffix;}
    private function forecast(array $extra=[]): array{return array_replace(['paid_on'=>'2026-10-22','amount'=>100,'recalculation_mode'=>'TERM','interest_policy'=>'NEXT_PAYMENT'],$extra);}
    public function test_monthly_payment_create_edit_delete_and_summary_without_duplicate_expenses(): void
    {
        $this->getJson('/api/v1/credits')->assertOk()->assertJsonPath('data.0.summary.last_payment_date','2027-01-22')->assertJsonPath('data.0.summary.last_paid_on',null);
        $data=['paid_on'=>'2026-10-22','scheduled_on'=>'2026-11-22','amount'=>200,'comment'=>'Оплачено заранее'];
        $id=$this->postJson($this->url('payments'),$data)->assertCreated()->assertJsonPath('data.created_by',$this->admin->id)->json('data.id');
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.last_paid_on','2026-10-22')->assertJsonPath('data.0.summary.next_payment.date','2026-12-22');
        $this->patchJson('/api/v1/credit-payments/'.$id,[...$data,'amount'=>150])->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.next_payment.amount',50);
        $this->deleteJson('/api/v1/credit-payments/'.$id)->assertNoContent();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.last_paid_on',null)->assertJsonCount(0,'data.0.payments');
        $this->assertDatabaseCount('finance_transactions',0);
        $this->postJson($this->url('payments'),[...$data,'paid_on'=>'2026-10-23'])->assertUnprocessable();
    }
    public function test_bank_graph_arithmetic_version_and_completeness_are_checked(): void
    {
        $bad=$this->graph();$bad['rows'][1]['balance']=150;
        $this->putJson($this->url('bank-schedule'),$bad)->assertUnprocessable();
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertOk()->assertJsonPath('data.complete',true)->assertJsonPath('data.version',1);
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertConflict();
        $partial=$this->graph();$partial['base_version']=1;array_pop($partial['rows']);
        $this->putJson($this->url('bank-schedule'),$partial)->assertOk()->assertJsonPath('data.complete',false);
        $this->postJson($this->url('forecast'),$this->forecast())->assertUnprocessable();
    }
    public function test_zero_interest_term_and_payment_scenarios_preserve_money(): void
    {
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertOk();
        $term=$this->postJson($this->url('forecast'),$this->forecast(['amount'=>200]))->assertOk()->assertJsonPath('data.last_payment_date','2026-12-22')->assertJsonPath('data.payments_removed',1)->json('data');
        $this->assertEquals(400,array_sum(array_column($term['rows'],'principal')));
        $payment=$this->postJson($this->url('forecast'),$this->forecast(['recalculation_mode'=>'PAYMENT']))->assertOk()->assertJsonPath('data.last_payment_date','2027-01-22')->json('data');
        $this->assertEqualsWithDelta(166.67,$payment['next_payment']['payment'],0.01);
        $this->assertEqualsWithDelta(500,array_sum(array_column($payment['rows'],'principal')),0.02);
        $this->postJson($this->url('forecast'),$this->forecast(['amount'=>601]))->assertUnprocessable();
        $this->assertDatabaseCount('credit_payments',0);$this->assertDatabaseCount('credit_prepayments',0);
    }
    public function test_variable_intervals_interest_fees_and_interest_policy_are_respected(): void
    {
        $graph=['as_of'=>'2026-10-22','opening_balance'=>1000,'base_version'=>0,'rows'=>[
            ['date'=>'2026-11-22','payment'=>515,'principal'=>500,'interest'=>10,'fees'=>5,'balance'=>500],
            ['date'=>'2026-12-28','payment'=>510,'principal'=>500,'interest'=>7,'fees'=>3,'balance'=>0],
        ]];
        $this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $next=$this->postJson($this->url('forecast'),$this->forecast(['paid_on'=>'2026-11-06','amount'=>200]))->assertOk()->json('data');
        $from=$this->postJson($this->url('forecast'),$this->forecast(['paid_on'=>'2026-11-06','amount'=>200,'interest_policy'=>'FROM_PREPAYMENT']))->assertOk()->json('data');
        $this->assertEquals(200,$next['prepayment']['principal']);
        $this->assertGreaterThan(0,$from['prepayment']['interest']);$this->assertLessThan(200,$from['prepayment']['principal']);
        $this->assertEquals(5,$next['rows'][0]['fees']);$this->assertEquals(3,$next['rows'][1]['fees']);
        $this->assertGreaterThan(0,$next['interest_saved']);
        foreach([$next,$from] as $result){
            $this->assertEqualsWithDelta(1000,$result['prepayment']['principal']+array_sum(array_column($result['rows'],'principal')),0.02);
            foreach($result['rows'] as $row)$this->assertEqualsWithDelta($row['payment'],$row['principal']+$row['interest']+$row['fees'],0.02);
            $this->assertEquals(0,end($result['rows'])['balance']);
        }
    }
    public function test_prepayment_changes_invalidate_graph_and_deleted_payment_is_removed(): void
    {
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertOk();
        $id=$this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-22','amount'=>100,'recalculation_mode'=>'TERM'])->assertCreated()->json('data.id');
        $this->postJson($this->url('forecast'),$this->forecast())->assertUnprocessable();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.bank_schedule_stale',true);
        $this->deleteJson('/api/v1/credit-prepayments/'.$id)->assertNoContent();
        $this->getJson('/api/v1/credits')->assertJsonCount(0,'data.0.prepayments');
    }
    public function test_members_cannot_write_and_other_family_cannot_read_or_change_ledger(): void
    {
        $payment=$this->postJson($this->url('payments'),['paid_on'=>'2026-10-22','scheduled_on'=>'2026-11-22','amount'=>200])->json('data.id');
        $member=User::create(['telegram_user_id'=>76102,'first_name'=>'Участник']);
        FamilyMember::create(['family_id'=>$this->credit->family_id,'user_id'=>$member->id,'role'=>'USER','status'=>'ACTIVE']);
        $this->actingAs($member)->deleteJson('/api/v1/credit-payments/'.$payment)->assertForbidden();
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertForbidden();
        $other=User::create(['telegram_user_id'=>76103,'first_name'=>'Другой']);$family=Family::create(['name'=>'Другая','created_by'=>$other->id]);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$other->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($other)->deleteJson('/api/v1/credit-payments/'.$payment)->assertNotFound();
        $this->postJson($this->url('forecast'),$this->forecast())->assertNotFound();
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertNotFound();
    }
}
