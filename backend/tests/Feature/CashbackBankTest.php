<?php

namespace Tests\Feature;

use App\Http\Middleware\TelegramAuthenticate;
use App\Models\{CashbackBankPeriod,Family,FamilyMember,User};
use App\Services\Finance\CashbackRecognizer;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CashbackBankTest extends TestCase
{
    use RefreshDatabase;
    private User $admin;
    private User $member;
    private Family $family;
    private string $url='/api/v1/finance/cashback-banks';
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-31 22:00:00','UTC'));
        Http::preventStrayRequests();config(['services.openai.key'=>null]);
        $this->admin=User::create(['telegram_user_id'=>75101,'first_name'=>'Мария']);
        $this->member=User::create(['telegram_user_id'=>75102,'first_name'=>'Андрей']);
        $this->family=Family::create(['name'=>'Семья','created_by'=>$this->admin->id,'timezone'=>'Europe/Moscow']);
        foreach([$this->admin,$this->member] as $user)FamilyMember::create(['family_id'=>$this->family->id,'user_id'=>$user->id,'role'=>$user->id===$this->admin->id?'ADMIN':'USER','status'=>'ACTIVE']);
        $this->withoutMiddleware(TelegramAuthenticate::class)->actingAs($this->member);
    }
    private function payload(array $extra=[]): array
    {
        return array_replace(['bank_name'=>'Т-Банк','month'=>'2026-11','entries'=>[['category'=>'Супермаркеты','rate'=>5,'reward_unit'=>'RUB','active'=>true,'cap_amount'=>1000,'notes'=>null,'valid_from'=>null,'valid_to'=>null]]],$extra);
    }
    public function test_members_create_their_own_bank_and_share_it_without_cards(): void
    {
        $row=$this->postJson($this->url,$this->payload(['created_by'=>$this->admin->id]))->assertCreated()->assertJsonPath('data.created_by',$this->member->id)->assertJsonPath('data.creator.first_name','Андрей')->assertJsonPath('data.revision',1)->json('data');
        $response=$this->actingAs($this->admin)->getJson($this->url)->assertOk()->assertJsonPath('meta.month','2026-11')->assertJsonPath('meta.today','2026-11-01')->assertJsonPath('data.0.id',$row['id'])->assertJsonPath('data.0.can_edit',true);
        $this->assertArrayNotHasKey('telegram_user_id',$response->json('data.0.creator'));
        $this->postJson($this->url,$this->payload())->assertCreated();
        $this->assertDatabaseCount('cashback_bank_periods',2);$this->assertDatabaseCount('finance_cards',0);
        $this->assertDatabaseCount('finance_transactions',0);
    }
    public function test_updates_are_versioned_deduplicated_and_keep_owner_and_previous_month(): void
    {
        $row=$this->postJson($this->url,$this->payload())->assertCreated()->json('data');
        $this->postJson($this->url,$this->payload(['bank_name'=>'Тинькофф']))->assertConflict();
        $updated=$this->postJson($this->url,$this->payload(['bank_name'=>'Тинькофф','revision'=>1]))->assertOk()->assertJsonPath('data.id',$row['id'])->assertJsonPath('data.revision',2)->json('data');
        $this->patchJson($this->url.'/'.$row['id'],$this->payload(['revision'=>1]))->assertConflict();
        $this->actingAs($this->admin)->patchJson($this->url.'/'.$row['id'],$this->payload(['revision'=>2]))->assertOk()->assertJsonPath('data.created_by',$this->member->id)->assertJsonPath('data.revision',3);
        $this->actingAs($this->member)->postJson($this->url,$this->payload(['month'=>'2026-10']))->assertCreated();
        $this->deleteJson($this->url.'/'.$row['id'],['revision'=>2])->assertConflict();
        $this->deleteJson($this->url.'/'.$row['id'],['revision'=>3])->assertNoContent();
        $this->getJson($this->url)->assertJsonCount(0,'data');
        $this->getJson($this->url.'?month=2026-10')->assertJsonCount(1,'data');
        $this->postJson($this->url,$this->payload())->assertOk()->assertJsonPath('data.id',$row['id'])->assertJsonPath('data.revision',5);
        $this->assertDatabaseCount('cashback_bank_periods',2);
    }
    public function test_foreign_families_and_non_owners_cannot_modify_banks_and_hidden_finance_cannot_import(): void
    {
        $row=$this->actingAs($this->admin)->postJson($this->url,$this->payload())->json('data');
        $this->actingAs($this->member)->getJson($this->url)->assertJsonPath('data.0.can_edit',false);
        $this->patchJson($this->url.'/'.$row['id'],$this->payload(['revision'=>1]))->assertForbidden();
        $other=User::create(['telegram_user_id'=>75103,'first_name'=>'Чужой']);
        $family=Family::create(['name'=>'Другая','created_by'=>$other->id]);
        FamilyMember::create(['family_id'=>$family->id,'user_id'=>$other->id,'role'=>'ADMIN','status'=>'ACTIVE']);
        $this->actingAs($other)->getJson($this->url)->assertJsonCount(0,'data');
        $this->patchJson($this->url.'/'.$row['id'],$this->payload(['revision'=>1]))->assertNotFound();
        $this->deleteJson($this->url.'/'.$row['id'],['revision'=>1])->assertNotFound();
        FamilyMember::where('user_id',$this->member->id)->update(['section_visibility'=>json_encode(['finance'=>false])]);
        $this->actingAs($this->member)->getJson($this->url)->assertForbidden();
        $this->postJson($this->url.'/recognize',['image_data'=>'bad'])->assertForbidden();
    }
    public function test_validation_requires_real_types_dates_and_distinct_categories(): void
    {
        foreach([
            $this->payload(['bank_name'=>' --- ']),
            $this->payload(['month'=>'2026-13']),
            $this->payload(['entries'=>[]]),
            $this->payload(['entries'=>[['category'=>' ','rate'=>5,'active'=>true,'reward_unit'=>'RUB']]]),
            $this->payload(['entries'=>[['category'=>'Еда','rate'=>101,'active'=>true,'reward_unit'=>'RUB']]]),
            $this->payload(['entries'=>[['category'=>'Еда','rate'=>5,'active'=>true,'reward_unit'=>'UNKNOWN']]]),
            $this->payload(['entries'=>[['category'=>'Еда','rate'=>5,'active'=>true,'reward_unit'=>'RUB','valid_to'=>'2026-10-01']]]),
            $this->payload(['entries'=>[['category'=>'Еда','rate'=>5,'active'=>true,'reward_unit'=>'RUB'],['category'=>' еда ','rate'=>6,'active'=>false,'reward_unit'=>'RUB']]]),
        ] as $payload)$this->postJson($this->url,$payload)->assertUnprocessable();
        $this->postJson($this->url.'/recognize',['image_data'=>'data:image/png;base64,bm90LWFuLWltYWdl'])->assertUnprocessable();
        $this->assertDatabaseCount('cashback_bank_periods',0);
    }
    public function test_recognition_is_a_draft_and_does_not_store_images_or_create_offers(): void
    {
        $this->mock(CashbackRecognizer::class,function($mock){$mock->shouldReceive('recognize')->once()->andReturn(['bank_name'=>'Т-Банк','entries'=>[['category'=>'Аптеки','rate'=>7,'reward_unit'=>'UNKNOWN','active'=>false]],'source'=>'OCR']);});
        $image='data:image/png;base64,'.trim(file_get_contents(__DIR__.'/../Fixtures/receipt.png.b64'));
        $this->postJson($this->url.'/recognize',['image_data'=>$image])->assertOk()->assertJsonPath('data.entries.0.active',false);
        $this->assertDatabaseCount('cashback_bank_periods',0);
    }
    public function test_local_parser_defaults_to_selected_rubles_and_keeps_explicit_points(): void
    {
        $parser=new CashbackRecognizer();
        $data=$parser->parseText("Т-Банк\n5% Супермаркеты\nАптеки 7,5%\n10%\nКафе\nЛимит 1000 рублей");
        $this->assertSame('Т-Банк',$data['bank_name']);$this->assertCount(3,$data['entries']);
        $this->assertSame(7.5,$data['entries'][1]['rate']);
        foreach($data['entries'] as $entry){$this->assertTrue($entry['active']);$this->assertNull($entry['cap_amount']);}
        $unknown=$parser->parseText("5% Супермаркеты\n150% Выдумка\n2% Такси 5% Кафе");
        $this->assertCount(1,$unknown['entries']);$this->assertSame('RUB',$unknown['entries'][0]['reward_unit']);
        $this->assertSame('POINTS',$parser->parseText("Кешбэк баллами\nАптеки 5%")['entries'][0]['reward_unit']);
    }
    public function test_local_ocr_reads_percentages_from_a_generated_screenshot(): void
    {
        if(!is_executable('/usr/bin/tesseract'))$this->markTestSkipped('Tesseract is checked after OCR tools are installed.');
        $image=imagecreatetruecolor(800,160);$white=imagecolorallocate($image,255,255,255);$black=imagecolorallocate($image,0,0,0);
        imagefill($image,0,0,$white);imagestring($image,5,20,30,'SUPERMARKETS 5%',$black);imagestring($image,5,20,80,'PHARMACY 7%',$black);
        ob_start();imagepng($image);$bytes=ob_get_clean();imagedestroy($image);
        $result=(new CashbackRecognizer())->recognize('data:image/png;base64,'.base64_encode($bytes));
        $this->assertCount(2,$result['entries']);
        $this->assertEquals([5,7],array_column($result['entries'],'rate'));
        foreach($result['entries'] as $entry)$this->assertTrue($entry['active']);
    }
    public function test_catalog_and_canonical_names_prevent_new_bank_alias_duplicates(): void
    {
        $this->getJson($this->url)->assertOk()->assertJsonFragment(['name'=>'Яндекс Банк'])->assertJsonFragment(['name'=>'Ozon Банк']);
        $id=$this->postJson($this->url,$this->payload(['bank_name'=>'Ozon']))->assertCreated()->assertJsonPath('data.bank_name','Ozon Банк')->json('data.id');
        $this->postJson($this->url,$this->payload(['bank_name'=>'Озон Банк']))->assertConflict();
        $this->patchJson($this->url.'/'.$id,$this->payload(['bank_name'=>'ООО «ОЗОН Банк»','revision'=>1]))->assertOk()->assertJsonPath('data.bank_name','Ozon Банк');
        $this->postJson($this->url,$this->payload(['bank_name'=>'Яндекс']))->assertCreated()->assertJsonPath('data.bank_name','Яндекс Банк');
        $this->postJson($this->url,$this->payload(['bank_name'=>'Выдуманный банк']))->assertUnprocessable();
    }
    public function test_normalization_merges_aliases_without_crossing_owner_month_or_deleted_data_and_keeps_backups(): void
    {
        $create=function($name,$key,$owner,$month,$entries,$updated,$deleted=null){return \App\Models\CashbackBankPeriod::create(['family_id'=>$this->family->id,'created_by'=>$owner,'month'=>$month,'bank_name'=>$name,'bank_key'=>$key,'entries'=>$entries,'revision'=>2,'updated_at'=>$updated,'deleted_at'=>$deleted]);};
        $base=$this->payload()['entries'][0];
        $create('Ozon','ozon',$this->member->id,'2026-11',[$base,[...$base,'category'=>'Аптеки']],'2026-10-20');
        $latest=$create('Ozon Банк','ozonбанк',$this->member->id,'2026-11',[[...$base,'rate'=>9]],'2026-10-22');
        $create('Озон','озон',$this->member->id,'2026-11',[[...$base,'category'=>'Удалённая','rate'=>99]],'2026-10-23','2026-10-23');
        $create('Ozon','ozon',$this->admin->id,'2026-11',[$base],'2026-10-20');
        $create('Ozon','ozon',$this->member->id,'2026-10',[$base],'2026-10-20');
        $normalizer=app(\App\Services\Finance\NormalizeCashbackBanks::class);
        $audit=$normalizer->run();$this->assertEquals(2,$audit['merged']);$this->assertDatabaseCount('cashback_bank_periods',5);
        $normalizer->run(true);
        $this->assertDatabaseCount('cashback_bank_periods',3);$this->assertDatabaseCount('cashback_bank_normalization_backups',5);
        $merged=$latest->fresh();$this->assertSame('Ozon Банк',$merged->bank_name);$this->assertCount(2,$merged->entries);
        $this->assertSame(9,collect($merged->entries)->firstWhere('category','Супермаркеты')['rate']);
        $this->assertNull(collect($merged->entries)->firstWhere('category','Удалённая'));
        $again=$normalizer->run(true);$this->assertEquals(0,$again['merged']);$this->assertEquals(0,$again['renamed']);
        $this->assertDatabaseCount('cashback_bank_normalization_backups',5);
    }
}
