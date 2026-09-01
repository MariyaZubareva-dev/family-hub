<?php
namespace App\Http\Controllers\Api;
use App\Models\FinanceTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class FinanceTransactionController extends BaseApiController {
 private function admin(Request $r,$familyId){$m=$this->membership($r,$familyId);$this->assertAdmin($m);return $m;}
 public function index(Request $r):JsonResponse{$m=$this->membership($r);$this->assertAdmin($m);$q=FinanceTransaction::where('family_id',$m->family_id)->orderByDesc('occurred_on')->orderByDesc('created_at');$items=$q->get();$income=(float)$items->where('type','INCOME')->sum('amount');$expense=(float)$items->where('type','EXPENSE')->sum('amount');return response()->json(['data'=>$items,'summary'=>['income'=>$income,'expense'=>$expense,'balance'=>$income-$expense]]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$this->assertAdmin($m);$d=$r->validate(['type'=>['required','in:INCOME,EXPENSE'],'amount'=>['required','numeric','gt:0'],'category'=>['required','string','max:80'],'budget_type'=>['nullable','in:FIXED,FLEXIBLE,FUTURE'],'description'=>['nullable','string','max:255'],'occurred_on'=>['required','date']]);$x=FinanceTransaction::create([...$d,'family_id'=>$m->family_id,'created_by'=>$m->user_id]);return response()->json(['data'=>$x],201);}
 public function update(Request $r,FinanceTransaction $transaction):JsonResponse{$m=$this->admin($r,$transaction->family_id);$d=$r->validate(['type'=>['sometimes','in:INCOME,EXPENSE'],'amount'=>['sometimes','numeric','gt:0'],'category'=>['sometimes','string','max:80'],'budget_type'=>['nullable','in:FIXED,FLEXIBLE,FUTURE'],'description'=>['nullable','string','max:255'],'occurred_on'=>['sometimes','date']]);$transaction->update($d);return response()->json(['data'=>$transaction->fresh()]);}
 public function destroy(Request $r,FinanceTransaction $transaction):JsonResponse{$this->admin($r,$transaction->family_id);$transaction->delete();return response()->json([],204);}
}
