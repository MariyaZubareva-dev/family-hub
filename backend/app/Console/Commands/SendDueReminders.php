<?php
namespace App\Console\Commands;
use App\Models\Reminder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Carbon\CarbonImmutable;
class SendDueReminders extends Command
{
 protected $signature='family:send-reminders';
 protected $description='Send due Family Hub reminders to Telegram users';
 public function handle():int{
  $token=env('TELEGRAM_BOT_TOKEN'); if(!$token){$this->warn('TELEGRAM_BOT_TOKEN is not configured.');return self::SUCCESS;}
  $now=CarbonImmutable::now('Europe/Moscow');
  $items=Reminder::with(['responsibleMember.user'])->whereNull('notification_sent_at')->where('status','SCHEDULED')->whereBetween('scheduled_at',[$now->subMinutes(2),$now->addMinutes(1)])->get();
  foreach($items as $r){$id=$r->responsibleMember?->user?->telegram_user_id;if(!$id)continue;$text="🔔 {$r->title}".($r->description?"\n{$r->description}":'');$ok=Http::timeout(10)->post("https://api.telegram.org/bot{$token}/sendMessage",['chat_id'=>$id,'text'=>$text])->successful();if($ok){$r->forceFill(['notification_sent_at'=>now()])->save();}}
  $this->info("Processed {$items->count()} reminders."); return self::SUCCESS;
 }
}
