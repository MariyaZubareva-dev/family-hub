<?php
namespace App\Console\Commands;
use App\Models\Reminder;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Console\Command;
use Carbon\CarbonImmutable;
class SendDueReminders extends Command
{
 protected $signature='family:send-reminders';
 protected $description='Send due Family Hub reminders to Telegram users';
 public function handle():int{
  $now=CarbonImmutable::now('Europe/Moscow');
  $items=Reminder::whereNull('notification_sent_at')->where('status','SCHEDULED')->whereBetween('scheduled_at',[$now->subMinutes(2),$now->addMinute()])->get();
  foreach($items as $r){TelegramNotificationService::notifyReminderDue($r);$r->forceFill(['notification_sent_at'=>now()])->save();}
  $this->info("Processed {$items->count()} reminders."); return self::SUCCESS;
 }
}
