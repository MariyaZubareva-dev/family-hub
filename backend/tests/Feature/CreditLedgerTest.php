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
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.next_payment.amount',50)->assertJsonPath('data.0.summary.next_payment.planned_amount',200)->assertJsonPath('data.0.summary.next_payment.paid_amount',150);
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
    public function test_payments_in_bank_opening_balance_do_not_reduce_future_installments_twice(): void
    {
        $payment=$this->postJson($this->url('payments'),['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-04','amount'=>150])->assertCreated()->json('data.id');
        $graph=$this->graph();$graph['as_of']='2026-10-04';$this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.next_payment.amount',200)->assertJsonPath('data.0.summary.next_payment.paid_amount',0)
            ->assertJsonPath('data.0.summary.regular_schedule.0.date','2026-10-04')->assertJsonPath('data.0.summary.regular_schedule.0.status','PAID')
            ->assertJsonPath('data.0.summary.payment_history.0.included_in_bank_snapshot',true)->assertJsonPath('data.0.summary.payment_history.0.display_scheduled_on','2026-10-04');
        $this->assertDatabaseHas('credit_payments',['id'=>$payment,'scheduled_on'=>'2026-11-22','amount'=>150]);
        $this->putJson($this->url('schedule-payment'),['scheduled_on'=>'2026-10-04','paid'=>false,'base_version'=>1])->assertOk();
        $this->assertDatabaseCount('credit_payments',0);
    }
    public function test_legacy_snapshot_recognizes_existing_payments_without_altering_new_advance_payments(): void
    {
        $graph=$this->graph();$graph['as_of']='2026-10-04';$this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $bank=$this->credit->fresh()->bank_schedule;unset($bank['included_payment_ids']);$this->credit->update(['bank_schedule'=>$bank]);
        $old=$this->credit->payments()->create(['paid_on'=>'2026-10-04','scheduled_on'=>'2026-11-22','amount'=>150,'created_by'=>$this->admin->id]);
        $old->forceFill(['created_at'=>now()->subMinutes(5)])->save();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.next_payment.amount',200)->assertJsonPath('data.0.summary.payment_history.0.included_in_bank_snapshot',true);
        $this->credit->payments()->create(['paid_on'=>'2026-10-03','scheduled_on'=>'2026-12-22','amount'=>200,'created_by'=>$this->admin->id]);
        $result=$this->getJson('/api/v1/credits')->assertOk()->json('data.0.summary.regular_schedule');
        $this->assertSame('PAID',collect($result)->firstWhere('date','2026-12-22')['status']);
    }
    public function test_checkbox_payment_keeps_period_when_paid_on_another_date_and_is_idempotent(): void
    {
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertOk();
        $mark=['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-20','paid'=>true,'base_version'=>1];
        $this->putJson($this->url('schedule-payment'),$mark)->assertOk()->assertJsonPath('data.regular_schedule.0.status','PAID')->assertJsonPath('data.regular_schedule.0.paid_on','2026-10-20');
        $this->putJson($this->url('schedule-payment'),$mark)->assertOk();$this->assertDatabaseCount('credit_payments',1);
        $this->assertDatabaseHas('credit_payments',['credit_id'=>$this->credit->id,'scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-20','amount'=>200]);
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.regular_schedule.1.status','UPCOMING')->assertJsonPath('data.0.summary.next_payment.date','2026-12-22');
        $this->putJson($this->url('schedule-payment'),[...$mark,'base_version'=>0])->assertConflict();
        $this->putJson($this->url('schedule-payment'),[...$mark,'paid'=>false])->assertOk()->assertJsonPath('data.regular_schedule.0.status','UPCOMING');
        $this->putJson($this->url('schedule-payment'),[...$mark,'paid'=>false])->assertOk();$this->assertDatabaseCount('credit_payments',0);$this->assertDatabaseCount('finance_transactions',0);
        $this->putJson($this->url('schedule-payment'),[...$mark,'paid_on'=>'2026-10-23'])->assertUnprocessable();
        $this->putJson($this->url('schedule-payment'),[...$mark,'scheduled_on'=>'2026-11-21'])->assertUnprocessable();
    }
    public function test_checkbox_completes_partial_payment_and_forecast_uses_bank_graph_despite_journal_difference(): void
    {
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertOk();
        $this->postJson($this->url('payments'),['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-20','amount'=>150])->assertCreated();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.regular_schedule.0.status','PARTIAL');
        $this->postJson($this->url('forecast'),$this->forecast(['paid_on'=>'2026-11-22','amount'=>100]))->assertOk()->assertJsonPath('data.prepayment.principal',100);
        $this->putJson($this->url('schedule-payment'),['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-22','paid'=>true,'base_version'=>1])->assertOk()->assertJsonPath('data.regular_schedule.0.paid_amount',200);
        $this->assertDatabaseCount('credit_payments',2);$this->assertDatabaseHas('credit_payments',['amount'=>50]);
    }
    public function test_calculator_replays_recorded_prepayments_and_does_not_create_new_payments(): void
    {
        $graph=$this->graph();$graph['as_of']='2026-10-01';$this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-04','amount'=>200,'recalculation_mode'=>'TERM'])->assertCreated();
        $this->postJson($this->url('forecast'),$this->forecast(['amount'=>200]))->assertOk()->assertJsonPath('data.last_payment_date','2026-11-22')->assertJsonPath('data.original_last_payment_date','2026-12-22');
        $this->assertDatabaseCount('credit_prepayments',1);$this->assertDatabaseCount('credit_payments',0);
    }
    public function test_late_payment_marks_the_old_period_without_consuming_next_month(): void
    {
        $this->credit->update(['first_payment_date'=>'2026-10-05']);
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.next_payment.date','2026-11-05')->assertJsonPath('data.0.summary.regular_schedule.0.status','OVERDUE');
        $this->putJson($this->url('schedule-payment'),['scheduled_on'=>'2026-10-05','paid_on'=>'2026-10-22','paid'=>true,'base_version'=>0])->assertOk()->assertJsonPath('data.regular_schedule.0.status','PAID')->assertJsonPath('data.regular_schedule.1.status','UPCOMING')->assertJsonPath('data.next_payment.date','2026-11-05');
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
    public function test_saved_prepayments_recalculate_end_date_and_edits_deletes_replay_from_bank_basis(): void
    {
        $graph=$this->graph();$graph['as_of']='2026-10-01';
        $this->putJson($this->url('bank-schedule'),$graph)->assertOk()->assertJsonPath('data.as_of','2026-10-01');
        $early=$this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-04','amount'=>200,'recalculation_mode'=>'TERM','interest_policy'=>'NEXT_PAYMENT'])->assertCreated()->json('data.id');
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.last_payment_date','2027-01-22')->assertJsonPath('data.0.summary.estimated_last_payment_date','2026-12-22');
        $second=$this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-20','amount'=>200,'recalculation_mode'=>'TERM','interest_policy'=>'NEXT_PAYMENT'])->assertCreated()->json('data.id');
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date','2026-11-22');
        $this->patchJson('/api/v1/credit-prepayments/'.$second,['amount'=>100])->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date','2026-12-22');
        $this->deleteJson('/api/v1/credit-prepayments/'.$second)->assertNoContent();
        $this->deleteJson('/api/v1/credit-prepayments/'.$early)->assertNoContent();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date','2027-01-22');
        $this->assertEquals($graph['rows'],$this->credit->fresh()->bank_schedule['rows']);
    }
    public function test_reimport_includes_existing_prepayments_once_and_changed_basis_requires_bank_graph(): void
    {
        $graph=$this->graph();$graph['as_of']='2026-10-01';$this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $id=$this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-04','amount'=>200,'recalculation_mode'=>'TERM'])->json('data.id');
        $new=$this->graph();$new['as_of']='2026-10-05';$new['base_version']=1;$new['opening_balance']=400;array_pop($new['rows']);$new['rows'][0]['balance']=200;$new['rows'][1]['balance']=0;
        $this->putJson($this->url('bank-schedule'),$new)->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.last_payment_date','2026-12-22')->assertJsonPath('data.0.summary.estimated_last_payment_date',null);
        $this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-22','amount'=>200,'recalculation_mode'=>'TERM'])->assertCreated();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date','2026-11-22');
        $this->patchJson('/api/v1/credit-prepayments/'.$id,['amount'=>150])->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date',null)->assertJsonPath('data.0.summary.projection_error','Изменён платёж, уже учтённый в исходном остатке. Обновите график банка.');
    }
    public function test_interest_policy_and_actual_event_dates_drive_projection_without_using_upload_date(): void
    {
        $graph=['as_of'=>'2026-10-01','opening_balance'=>1000,'base_version'=>0,'rows'=>[
            ['date'=>'2026-11-01','payment'=>515,'principal'=>500,'interest'=>10,'fees'=>5,'balance'=>500],
            ['date'=>'2026-12-01','payment'=>510,'principal'=>500,'interest'=>7,'fees'=>3,'balance'=>0],
        ]];
        $this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $id=$this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-11','amount'=>200,'recalculation_mode'=>'TERM'])->json('data.id');
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.projection_available',false);
        $this->patchJson('/api/v1/credit-prepayments/'.$id,['interest_policy'=>'NEXT_PAYMENT'])->assertOk();
        $service=app(\App\Services\Finance\CreditSchedule::class);$next=$service->projection($this->credit->fresh());
        $expected=round(1000*.01*10/31+800*.01*21/31,2);
        $this->assertEquals($expected,$next['rows'][0]['interest']);$this->assertEquals(5,$next['rows'][0]['fees']);
        $this->patchJson('/api/v1/credit-prepayments/'.$id,['interest_policy'=>'FROM_PREPAYMENT'])->assertOk();
        $from=$service->projection($this->credit->fresh());$this->assertLessThan($next['rows'][0]['interest'],$from['rows'][0]['interest']);
        $this->patchJson('/api/v1/credit-prepayments/'.$id,['paid_on'=>'2026-10-21','interest_policy'=>'NEXT_PAYMENT'])->assertOk();
        $later=$service->projection($this->credit->fresh());$this->assertGreaterThan($next['rows'][0]['interest'],$later['rows'][0]['interest']);
        $this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-22','amount'=>100,'recalculation_mode'=>'TERM','interest_policy'=>'NEXT_PAYMENT'])->assertCreated();
        $multiple=$service->projection($this->credit->fresh());
        $this->assertEquals(round(1000*.01*20/31+800*.01*1/31+700*.01*10/31,2),$multiple['rows'][0]['interest']);
        $this->assertEqualsWithDelta(700,array_sum(array_column($multiple['rows'],'principal')),0.02);
        $this->assertEquals(0,end($multiple['rows'])['balance']);
    }
    public function test_same_day_regular_payment_precedes_early_payment_and_payment_mode_preserves_term(): void
    {
        $graph=$this->graph();$graph['as_of']='2026-10-01';$graph['rows'][0]['date']='2026-10-10';$this->putJson($this->url('bank-schedule'),$graph)->assertOk();
        $this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-10','amount'=>200,'recalculation_mode'=>'TERM'])->assertCreated();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.estimated_last_payment_date','2026-12-22');
        $this->postJson($this->url('prepayments'),['paid_on'=>'2026-10-20','amount'=>100,'recalculation_mode'=>'PAYMENT'])->assertCreated();
        $result=app(\App\Services\Finance\CreditSchedule::class)->projection($this->credit->fresh());
        $this->assertSame('2026-12-22',$result['last_payment_date']);$this->assertEqualsWithDelta(100,$result['rows'][1]['payment'],0.01);
        $this->patchJson('/api/v1/credits/'.$this->credit->id,['standard_payment'=>210,'first_payment_date'=>'2026-10-10'])->assertOk();
        $this->getJson('/api/v1/credits')->assertJsonPath('data.0.summary.projection_available',false)->assertJsonPath('data.0.summary.estimated_last_payment_date',null);
    }
    public function test_members_cannot_write_and_other_family_cannot_read_or_change_ledger(): void
    {
        $payment=$this->postJson($this->url('payments'),['paid_on'=>'2026-10-22','scheduled_on'=>'2026-11-22','amount'=>200])->json('data.id');
        $member=User::create(['telegram_user_id'=>76102,'first_name'=>'Участник']);
        FamilyMember::create(['family_id'=>$this->credit->family_id,'user_id'=>$member->id,'role'=>'USER','status'=>'ACTIVE']);
        $this->actingAs($member)->deleteJson('/api/v1/credit-payments/'.$payment)->assertForbidden();
        $this->putJson($this->url('schedule-payment'),['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-22','paid'=>true,'base_version'=>0])->assertForbidden();
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertForbidden();
        $other=User::create(['telegram_user_id'=>76103,'first_name'=>'Другой']);$family=Family::create(['name'=>'Другая','created_by'=>$other->id]);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$other->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($other)->deleteJson('/api/v1/credit-payments/'.$payment)->assertNotFound();
        $this->putJson($this->url('schedule-payment'),['scheduled_on'=>'2026-11-22','paid_on'=>'2026-10-22','paid'=>true,'base_version'=>0])->assertNotFound();
        $this->postJson($this->url('forecast'),$this->forecast())->assertNotFound();
        $this->putJson($this->url('bank-schedule'),$this->graph())->assertNotFound();
    }
    public function test_pdf_rows_keep_decimal_thousands_and_column_order_for_manual_mapping(): void
    {
        $service=app(\App\Services\Finance\CreditPdfImporter::class);
        $result=$service->parseText("Дата Платёж Долг Проценты Остаток\n1 22.11.2026    11 500,25    10 000,00    1 500,25    90 000,00\n2 22.12.2026    11 500,25    10 125,50    1 374,75    79 874,50");
        $this->assertSame(4,$result['column_count']);$this->assertCount(2,$result['rows']);
        $this->assertSame('2026-11-22',$result['rows'][0]['date']);
        $this->assertEquals([11500.25,10000,1500.25,90000],$result['rows'][0]['values']);
        $bad=$service->parseText('31.02.2026   200.00   100.00   10.00   0.00');$this->assertCount(0,$bad['rows']);
        $boundary=$service->parseText("04.11.2026   100.00   10.00   110.00   900.00\n\f04.11.2026   100.00   10.00   110.00   900.00\n04.12.2026   100.00   9.00   109.00   800.00");
        $this->assertCount(2,$boundary['rows']);$this->assertSame(1,$boundary['duplicate_rows_removed']);
        $different=$service->parseText("04.11.2026   100.00   10.00   110.00   900.00\n04.11.2026   200.00   10.00   210.00   700.00");$this->assertCount(2,$different['rows']);
    }
    public function test_pdf_upload_rejects_invalid_files_and_non_admin_before_processing(): void
    {
        $this->postJson($this->url('bank-schedule/import-pdf'),['pdf_data'=>'data:application/pdf;base64,'.base64_encode('not a pdf')])->assertUnprocessable();
        $user=User::create(['telegram_user_id'=>76107,'first_name'=>'Участник']);FamilyMember::create(['family_id'=>$this->credit->family_id,'user_id'=>$user->id,'role'=>'USER','status'=>'ACTIVE']);
        $this->actingAs($user)->postJson($this->url('bank-schedule/import-pdf'),['pdf_data'=>'bad'])->assertForbidden();
        $this->assertNull($this->credit->fresh()->bank_schedule);
    }
    public function test_real_multipage_pdf_extracts_all_rows_without_saving_graph_or_document(): void
    {
        if(!is_executable('/usr/bin/pdftotext'))$this->markTestSkipped('Poppler is installed before the full test suite.');
        $pdf=trim(file_get_contents(__DIR__.'/../Fixtures/credit-schedule.pdf.b64'));
        $this->postJson($this->url('bank-schedule/import-pdf'),['pdf_data'=>'data:application/pdf;base64,'.$pdf])->assertOk()->assertJsonPath('data.source','PDF_TEXT')->assertJsonPath('data.pages',2)->assertJsonPath('data.column_count',5)->assertJsonCount(3,'data.rows')->assertJsonPath('data.rows.2.date','2027-01-22')->assertJsonPath('data.rows.0.values.0',200);
        $this->assertNull($this->credit->fresh()->bank_schedule);$this->assertDatabaseCount('credit_payments',0);
    }
    public function test_scanned_pdf_uses_local_ocr_and_does_not_save_a_credit_graph(): void
    {
        if(!is_executable('/usr/bin/pdftoppm')||!is_executable('/usr/bin/tesseract'))$this->markTestSkipped('OCR tools are installed before the full test suite.');
        // Synthetic image-only PDF: no account numbers or personal data.
        $image=imagecreatetruecolor(1400,260);$white=imagecolorallocate($image,255,255,255);$black=imagecolorallocate($image,0,0,0);imagefill($image,0,0,$white);
        foreach([30=>'22.11.2026',300=>'200.00',550=>'200.00',800=>'0.00',1000=>'0.00',1200=>'0.00'] as $x=>$value)imagestring($image,5,$x,100,$value,$black);
        ob_start();imagejpeg($image,null,100);$jpeg=ob_get_clean();imagedestroy($image);
        $content='q 700 0 0 130 0 0 cm /Im0 Do Q';
        $objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 130] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',"<< /Type /XObject /Subtype /Image /Width 1400 /Height 260 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ".strlen($jpeg)." >>\nstream\n".$jpeg."\nendstream","<< /Length ".strlen($content)." >>\nstream\n".$content."\nendstream"];
        $pdf="%PDF-1.4\n";$offsets=[0];foreach($objects as $i=>$object){$offsets[]=strlen($pdf);$pdf.=($i+1)." 0 obj\n".$object."\nendobj\n";}
        $xref=strlen($pdf);$pdf.="xref\n0 6\n0000000000 65535 f \n";foreach(array_slice($offsets,1) as $offset)$pdf.=sprintf('%010d 00000 n ',$offset)."\n";$pdf.="trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n".$xref."\n%%EOF\n";
        $this->postJson($this->url('bank-schedule/import-pdf'),['pdf_data'=>'data:application/pdf;base64,'.base64_encode($pdf)])->assertOk()->assertJsonPath('data.source','PDF_OCR')->assertJsonCount(1,'data.rows')->assertJsonPath('data.rows.0.date','2026-11-22')->assertJsonPath('data.rows.0.values.0',200);
        $this->assertNull($this->credit->fresh()->bank_schedule);
    }
}
