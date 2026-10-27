<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{Family,FamilyMember,User,PlannedPurchase,StoreListItem};
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StoreListTest extends TestCase
{
    use RefreshDatabase;
    private Family $family;
    private User $admin;
    private User $member;
    private string $url='/api/v1/planned-purchases/store-items';
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-22 12:00:00','UTC'));
        $this->admin=User::create(['telegram_user_id'=>72101,'first_name'=>'Админ']);
        $this->member=User::create(['telegram_user_id'=>72102,'first_name'=>'Участник']);
        $this->family=Family::create(['name'=>'Семья','created_by'=>$this->admin->id,'timezone'=>'Europe/Moscow']);
        foreach([$this->admin,$this->member] as $user)FamilyMember::create(['family_id'=>$this->family->id,'user_id'=>$user->id,'role'=>$user->id===$this->admin->id?'ADMIN':'USER','status'=>'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class);$this->actingAs($this->admin);
    }
    private function recurring(array $extra=[]): PlannedPurchase
    {
        return PlannedPurchase::create(array_replace(['family_id'=>$this->family->id,'created_by'=>$this->admin->id,'type'=>'RECURRING','name'=>'Шампунь','status'=>'ACTIVE','due_date'=>'2026-10-22','cadence_months'=>1],$extra));
    }
    public function test_family_members_can_build_edit_complete_reopen_and_delete_the_shared_list(): void
    {
        $id=$this->postJson($this->url,['name'=>'  Молоко  ','quantity'=>'2 л','notes'=>'Без лактозы'])->assertCreated()->assertJsonPath('data.name','Молоко')->assertJsonPath('data.is_completed',false)->json('data.id');
        $this->actingAs($this->member)->getJson($this->url)->assertOk()->assertJsonPath('data.0.id',$id);
        $this->patchJson($this->url.'/'.$id,['name'=>'Молоко 3,2%','quantity'=>'3 л'])->assertOk()->assertJsonPath('data.notes','Без лактозы');
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk()->assertJsonPath('data.is_completed',true)->assertJsonPath('data.completed_by',$this->member->id);
        $stamp=StoreListItem::find($id)->completed_at;
        $this->travel(1)->minutes();
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->assertEquals($stamp,StoreListItem::find($id)->completed_at);
        $this->patchJson($this->url.'/'.$id,['is_completed'=>false])->assertOk()->assertJsonPath('data.completed_at',null);
        $this->assertDatabaseCount('finance_transactions',0);
        $this->deleteJson($this->url.'/'.$id)->assertNoContent();
        $this->getJson($this->url)->assertJsonCount(0,'data');
        $this->postJson($this->url,['name'=>'   '])->assertUnprocessable();
        $this->postJson($this->url,['name'=>['bad']])->assertUnprocessable();
    }
    public function test_due_items_arrive_once_in_family_timezone_without_opening_the_app(): void
    {
        $this->travelTo(Carbon::parse('2026-10-21 21:01:00','UTC'));
        $this->recurring();$this->recurring(['name'=>'Просрочено','due_date'=>'2026-10-20']);
        $this->recurring(['name'=>'Завтра','due_date'=>'2026-10-23']);
        $this->recurring(['name'=>'Крупная','type'=>'LARGE']);
        $this->recurring(['name'=>'Архив','status'=>'ARCHIVED']);
        $deleted=$this->recurring(['name'=>'Удалено']);$deleted->delete();
        $other=Family::create(['name'=>'Запад','created_by'=>$this->admin->id,'timezone'=>'America/New_York']);
        $this->recurring(['family_id'=>$other->id,'name'=>'Не сегодня']);
        $this->artisan('family:sync-store-list')->assertSuccessful();
        $this->assertSame(2,StoreListItem::count());
        $this->artisan('family:sync-store-list')->assertSuccessful();
        $this->getJson($this->url)->assertJsonCount(2,'data');
        $id=StoreListItem::first()->id;
        $this->deleteJson($this->url.'/'.$id)->assertNoContent();
        $this->artisan('family:sync-store-list')->assertSuccessful();
        $this->getJson($this->url)->assertJsonCount(1,'data');
        $this->assertSame(2,StoreListItem::withTrashed()->count());
    }
    public function test_recurring_checkbox_reschedules_once_and_undo_restores_the_previous_schedule(): void
    {
        $this->travelTo(Carbon::parse('2026-10-31 12:00:00','UTC'));
        $purchase=$this->recurring(['due_date'=>'2026-10-31','last_purchased_at'=>'2026-09-30']);
        $id=$this->getJson($this->url)->assertOk()->json('data.0.id');
        $this->actingAs($this->member)->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->assertSame('2026-11-30',$purchase->fresh()->due_date->toDateString());
        $revision=$purchase->fresh()->purchase_revision;
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->assertSame($revision,$purchase->fresh()->purchase_revision);
        $this->patchJson($this->url.'/'.$id,['is_completed'=>false])->assertOk();
        $this->assertSame('2026-10-31',$purchase->fresh()->due_date->toDateString());
        $this->assertSame('2026-09-30',$purchase->fresh()->last_purchased_at->toDateString());
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->assertSame('2026-11-30',$purchase->fresh()->due_date->toDateString());
        $this->getJson($this->url)->assertJsonCount(1,'data');
    }
    public function test_undo_does_not_overwrite_a_subsequent_regular_schedule_edit(): void
    {
        $purchase=$this->recurring();$id=$this->getJson($this->url)->json('data.0.id');
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->patchJson('/api/v1/planned-purchases/'.$purchase->id,['due_date'=>'2026-12-15'])->assertOk();
        $this->patchJson($this->url.'/'.$id,['is_completed'=>false])->assertOk();
        $this->assertSame('2026-12-15',$purchase->fresh()->due_date->toDateString());
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertOk();
        $this->assertSame('2026-12-15',$purchase->fresh()->due_date->toDateString());
    }
    public function test_the_next_cycle_is_added_on_its_date_and_old_checkbox_cannot_rewind_it(): void
    {
        $purchase=$this->recurring();$old=$this->getJson($this->url)->json('data.0.id');
        $this->patchJson($this->url.'/'.$old,['is_completed'=>true])->assertOk();
        $this->getJson($this->url)->assertJsonCount(1,'data');
        $this->travelTo(Carbon::parse('2026-11-22 12:00:00','UTC'));
        $this->artisan('family:sync-store-list')->assertSuccessful();
        $this->getJson($this->url)->assertJsonCount(2,'data');
        $this->patchJson($this->url.'/'.$old,['is_completed'=>false])->assertOk();
        $this->assertSame('2026-11-22',$purchase->fresh()->due_date->toDateString());
    }
    public function test_marking_regular_purchase_also_completes_its_store_item_without_extra_expenses(): void
    {
        $purchase=$this->recurring();$id=$this->getJson($this->url)->json('data.0.id');
        $this->postJson('/api/v1/planned-purchases/'.$purchase->id.'/purchased',[])->assertOk()->assertJsonPath('data.due_date','2026-11-22');
        $this->getJson($this->url)->assertJsonPath('data.0.is_completed',true);
        $this->patchJson($this->url.'/'.$id,['is_completed'=>false])->assertOk();
        $this->assertSame('2026-11-22',$purchase->fresh()->due_date->toDateString());
        $this->assertDatabaseCount('finance_transactions',0);
    }
    public function test_items_are_isolated_and_hidden_shopping_blocks_all_store_actions(): void
    {
        $id=$this->postJson($this->url,['name'=>'Секрет'])->json('data.id');
        $user=User::create(['telegram_user_id'=>72103,'first_name'=>'Другой']);
        $family=Family::create(['name'=>'Другая','created_by'=>$user->id]);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$user->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($user)->getJson($this->url)->assertJsonCount(0,'data');
        $this->patchJson($this->url.'/'.$id,['name'=>'Чужое'])->assertNotFound();
        $this->deleteJson($this->url.'/'.$id)->assertNotFound();
        FamilyMember::where('user_id',$this->member->id)->update(['section_visibility'=>json_encode(['shopping'=>false])]);
        $this->actingAs($this->member)->getJson($this->url)->assertForbidden();
        $this->postJson($this->url,['name'=>'Закрыто'])->assertForbidden();
        $this->patchJson($this->url.'/'.$id,['is_completed'=>true])->assertForbidden();
        $this->deleteJson($this->url.'/'.$id)->assertForbidden();
    }
}
