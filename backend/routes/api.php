<?php
use App\Http\Controllers\Api\EventController;
use App\Http\Controllers\Api\FamilyController;
use App\Http\Controllers\Api\FinanceTransactionController;
use App\Http\Controllers\Api\IdeaController;
use App\Http\Controllers\Api\ListController;
use App\Http\Controllers\Api\ListItemController;
use App\Http\Controllers\Api\NoteController;
use App\Http\Controllers\Api\ReminderController;
use App\Http\Controllers\Api\CreditController;
use App\Http\Middleware\TelegramAuthenticate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
Route::prefix('v1')->group(function(){
 Route::get('/health',fn()=>response()->json(['ok'=>true,'service'=>'family-hub-api','version'=>'0.5.0']));
 Route::middleware(TelegramAuthenticate::class)->group(function(){
  Route::get('/me',function(Request $r){$u=$r->user();$m=$u->familyMembers()->where('status','ACTIVE')->with('family')->first();return response()->json(['data'=>['id'=>$u->id,'telegram_user_id'=>$u->telegram_user_id,'username'=>$u->username,'first_name'=>$u->first_name,'last_name'=>$u->last_name,'avatar_url'=>$u->avatar_url,'timezone'=>$u->timezone,'locale'=>$u->locale,'family'=>$m?['id'=>$m->family->id,'name'=>$m->family->name,'role'=>$m->role]:null]]);});
  Route::get('/family',[FamilyController::class,'show']);
  Route::post('/families',[FamilyController::class,'create']);
  Route::post('/family/invite',[FamilyController::class,'invite']);
  Route::patch('/family/members/{member}',[FamilyController::class,'updateMember']);
  Route::delete('/family/members/{member}',[FamilyController::class,'removeMember']);
  Route::apiResource('events',EventController::class)->only(['index','store','show','update','destroy']);
  Route::apiResource('reminders',ReminderController::class)->only(['index','store','update','destroy']);
  Route::apiResource('lists',ListController::class)->only(['index','store','update','destroy']);
  Route::post('/lists/{list}/items',[ListItemController::class,'store']);
  Route::patch('/lists/{list}/items/{item}',[ListItemController::class,'update']);
  Route::delete('/lists/{list}/items/{item}',[ListItemController::class,'destroy']);
  Route::apiResource('notes',NoteController::class)->only(['index','store','update','destroy']);
  Route::apiResource('ideas',IdeaController::class)->only(['index','store','update','destroy']);
  Route::apiResource('finances',FinanceTransactionController::class)->only(['index','store','update','destroy']);
  Route::apiResource('credits',CreditController::class)->only(['index','store','update','destroy']);
  Route::post('/credits/{credit}/prepayments',[CreditController::class,'storePrepayment']);
  Route::delete('/credit-prepayments/{prepayment}',[CreditController::class,'destroyPrepayment']);
 });
});
