<?php
namespace Database\Seeders;
use App\Models\Event;
use App\Models\Family;
use App\Models\FamilyList;
use App\Models\FamilyMember;
use App\Models\Idea;
use App\Models\ListItem;
use App\Models\Note;
use App\Models\Reminder;
use App\Models\User;
use Illuminate\Database\Seeder;
class DatabaseSeeder extends Seeder {
 public function run():void{
  $maria=User::updateOrCreate(['telegram_user_id'=>423597651],['username'=>null,'first_name'=>'Мария','last_name'=>null,'avatar_url'=>null,'timezone'=>'Europe/Moscow','locale'=>'ru']);
  $andrey=User::updateOrCreate(['telegram_user_id'=>100000002],['username'=>'andrey','first_name'=>'Андрей','last_name'=>null,'avatar_url'=>null,'timezone'=>'Europe/Moscow','locale'=>'ru']);
  $family=Family::firstOrCreate(['name'=>'Наша семья'],['status'=>'ACTIVE','created_by'=>$maria->id]);
  $mm=FamilyMember::updateOrCreate(['family_id'=>$family->id,'user_id'=>$maria->id],['role'=>'ADMIN','status'=>'ACTIVE','invited_by'=>null,'joined_at'=>now()]);
  $am=FamilyMember::updateOrCreate(['family_id'=>$family->id,'user_id'=>$andrey->id],['role'=>'ADMIN','status'=>'ACTIVE','invited_by'=>$maria->id,'joined_at'=>now()]);
  $list=FamilyList::firstOrCreate(['family_id'=>$family->id,'name'=>'Продукты'],['type'=>'CUSTOM','created_by'=>$maria->id]);
  foreach([['Молоко',false,$maria->id],['Яйца',false,$andrey->id],['Хлеб',true,$maria->id]] as $i=>$row){ListItem::updateOrCreate(['list_id'=>$list->id,'title'=>$row[0]],['is_completed'=>$row[1],'created_by'=>$row[2],'completed_by'=>$row[1]?$maria->id:null,'completed_at'=>$row[1]?now():null,'position'=>$i]);}
  $event=Event::firstOrCreate(['family_id'=>$family->id,'title'=>'Встреча в школе','start_at'=>'2026-08-29 10:00:00+03','end_at'=>'2026-08-29 11:00:00+03'],['created_by'=>$andrey->id,'description'=>null,'timezone'=>'Europe/Moscow','location'=>'Школа','responsible_member_id'=>$am->id,'source'=>'FAMILY_HUB','status'=>'SCHEDULED']);$event->participants()->syncWithoutDetaching([$am->id]);
  Reminder::firstOrCreate(['family_id'=>$family->id,'title'=>'Оплатить интернет','scheduled_at'=>'2026-08-29 18:00:00+03'],['created_by'=>$andrey->id,'responsible_member_id'=>$am->id,'timezone'=>'Europe/Moscow','status'=>'SCHEDULED']);
  Note::firstOrCreate(['family_id'=>$family->id,'created_by'=>$maria->id,'title'=>'Важное'],['body'=>'Это личная заметка Марии.']);
  Idea::firstOrCreate(['family_id'=>$family->id,'created_by'=>$maria->id,'title'=>'Съездить на море'],['description'=>'Идея для семейной поездки.','status'=>'OPEN']);
  if(class_exists('App\Models\FinanceTransaction')) {\App\Models\FinanceTransaction::firstOrCreate(['family_id'=>$family->id,'created_by'=>$maria->id,'type'=>'EXPENSE','amount'=>1500,'category'=>'Продукты','occurred_on'=>'2026-08-29'],['description'=>'Тестовый расход']); }
 }
}
